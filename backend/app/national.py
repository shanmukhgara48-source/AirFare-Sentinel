"""Bounded, observable India-wide live search. No synthetic fallback."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import datetime
import json
import math
from pathlib import Path
import threading
import uuid

from fastapi import APIRouter, HTTPException, Query
from app.config import settings
from app.db.database import DB_PATH, get_connection, set_active_source_type
from app.ingestion.validate import validate_live_quotes
from app.model import ROUTE_BASKET
from app.providers import get_live_provider
from app.providers.ignav import IgnavAccessError

AIRPORTS = json.loads(Path(__file__).with_name('india_airports.json').read_text())
HUBS = ('DEL', 'BOM', 'BLR', 'CCU', 'HYD', 'MAA')

def national_routes():
    # A nationwide search plan, not a claim that service exists on these pairs.
    # Start with the original basket, then connect every catalog airport to
    # its closest hub in both directions. Any pair can also be searched on demand.
    routes = list(ROUTE_BASKET)
    for code, airport in AIRPORTS.items():
        if code in HUBS:
            continue
        def distance(hub):
            other = AIRPORTS[hub]
            return ((airport['lat'] - other['lat']) ** 2
                    + ((airport['lon'] - other['lon']) * math.cos(math.radians(airport['lat']))) ** 2)
        hub = min(HUBS, key=distance)
        routes.extend([(hub, code), (code, hub)])
    return list(dict.fromkeys(routes))

router = APIRouter()
_lock = threading.Lock()
_job = {'state': 'idle', 'completed': 0, 'total': 0, 'accepted': 0, 'errors': 0, 'empty_routes': 0, 'results': []}

_STATUS_FILE = DB_PATH.with_suffix('.network.json')
def persist_status():
    temporary = _STATUS_FILE.with_suffix('.tmp')
    temporary.write_text(json.dumps(_job))
    temporary.replace(_STATUS_FILE)
try:
    if _STATUS_FILE.exists():
        _job.update(json.loads(_STATUS_FILE.read_text()))
        if _job['state'] == 'running': _job['state'] = 'interrupted'
except (OSError, ValueError):
    pass

@router.get('/api/network')
def network():
    conn = get_connection()
    try:
        totals = dict(conn.execute("SELECT COUNT(*) AS quotes, COUNT(DISTINCT origin || '-' || destination) AS routes, MAX(created_at) AS last_observed FROM observations WHERE source_type='live'").fetchone())
        codes = conn.execute("SELECT origin AS code FROM observations WHERE source_type='live' UNION SELECT destination FROM observations WHERE source_type='live'").fetchall()
    finally:
        conn.close()
    return {'live_only': settings.live_only, 'catalog_airports': len(AIRPORTS), 'observed_airports': len(codes),
            'planned_routes': len(national_routes()), **totals,
            'coverage_notice': 'Only returned fare snapshots are displayed. This is not a complete flight schedule or aircraft tracking feed.'}

@router.get('/api/admin/network-fetch/status')
def network_status():
    with _lock:
        return {**_job, 'results': list(_job['results'])}

def _run(provider, routes, departure_date, max_offers):
    from app.main import _insert_live_observations
    pending = {}
    iterator = iter(routes)
    stopped = False
    def submit(pool):
        pair = next(iterator, None)
        if pair:
            pending[pool.submit(provider.fetch_quotes, *pair, departure_date, max_offers=max_offers)] = pair
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for _ in range(4): submit(pool)
            while pending:
                finished, _ = wait(pending, return_when=FIRST_COMPLETED)
                for future in finished:
                    origin, destination = pending.pop(future)
                    result = {'route': f'{origin}-{destination}', 'accepted': 0, 'returned': 0, 'status': 'empty'}
                    try:
                        quotes = future.result()
                        valid, quarantined = validate_live_quotes(quotes)
                        batch_id = 'live-network-' + uuid.uuid4().hex[:12]
                        rejected = _insert_live_observations(valid, batch_id, quarantined)
                        accepted = len(valid) - (len(rejected) - len(quarantined))
                        result.update(returned=len(quotes), accepted=accepted, quarantined=len(rejected), status='ok' if quotes else 'empty')
                        if accepted: set_active_source_type('live')
                    except Exception as exc:
                        # Never expose upstream bodies, URLs or credentials.
                        result['status'] = 'error'
                        result['http_status'] = getattr(exc, 'status_code', None)
                        result['message'] = ('Provider account access/billing or rate limit blocked further searches.'
                                             if isinstance(exc, IgnavAccessError) else 'Provider request or ingestion failed.')
                        if isinstance(exc, IgnavAccessError): stopped = True
                    with _lock:
                        _job['completed'] += 1
                        _job['accepted'] += result['accepted']
                        _job['errors'] += result['status'] == 'error'
                        _job['empty_routes'] += result['status'] == 'empty'
                        _job['results'].append(result)
                    if not stopped: submit(pool)
        with _lock:
            _job['state'] = 'blocked' if stopped else 'complete'
            _job['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            persist_status()
    except Exception:
        with _lock:
            _job['state'] = 'failed'
            _job['message'] = 'Network search stopped. Stored successful snapshots are retained.'

@router.post('/api/admin/network-fetch', status_code=202)
def start_network(scope: str = Query('india', pattern='^(india|basket|route|failed)$'),
                  origin: str | None = None, destination: str | None = None,
                  lead_days: int = Query(7, ge=1, le=330),
                  max_offers: int = Query(1000, ge=1, le=1000)):
    if settings.demo_mode:
        raise HTTPException(409, 'Live search is disabled while DEMO_MODE=true.')
    provider = get_live_provider()
    if provider is None:
        raise HTTPException(503, 'No live provider is configured.')
    if scope == 'failed':
        with _lock:
            routes = [tuple(result['route'].split('-')) for result in _job['results'] if result['status'] == 'error']
        if not routes:
            raise HTTPException(409, 'No failed routes are available to retry.')
    elif scope == 'route':
        origin, destination = (origin or '').upper(), (destination or '').upper()
        if origin not in AIRPORTS or destination not in AIRPORTS or origin == destination:
            raise HTTPException(422, 'Choose two different Indian airport codes from the catalog.')
        routes = [(origin, destination)]
    else:
        routes = national_routes() if scope == 'india' else list(ROUTE_BASKET)
    departure_date = (datetime.date.today() + datetime.timedelta(days=lead_days)).isoformat()
    with _lock:
        if _job['state'] == 'running':
            raise HTTPException(409, 'A network fetch is already running. Check its progress.')
        _job.clear()
        _job.update(state='running', completed=0, total=len(routes), accepted=0, errors=0, empty_routes=0,
                    results=[], scope=scope, provider=provider.name, departure_date=departure_date,
                    max_offers=max_offers, started_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        persist_status()
    threading.Thread(target=_run, args=(provider, routes, departure_date, max_offers), daemon=True).start()
    return network_status()

@router.get('/api/live-itineraries')
def live_itineraries(origin: str, destination: str, airline: str | None = None,
                     fare_class: str | None = None, lead_bucket: str | None = None,
                     limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0)):
    clauses = ["source_type='live'", 'origin=?', 'destination=?']
    params = [origin.upper(), destination.upper()]
    for field, value in [('airline', airline), ('fare_class', fare_class), ('lead_bucket', lead_bucket)]:
        if value:
            clauses.append(field + '=?'); params.append(value.upper())
    where = ' AND '.join(clauses)
    conn = get_connection()
    try:
        count = conn.execute('SELECT COUNT(*) FROM observations WHERE ' + where, params).fetchone()[0]
        rows = conn.execute('SELECT id, origin, destination, airline, flight_number, departure_time, arrival_time, travel_date, quote_date, created_at, total_fare, source_type, provider, price_status FROM observations WHERE ' + where + ' ORDER BY travel_date, total_fare, id LIMIT ? OFFSET ?', [*params, limit, offset]).fetchall()
        return {'total': count, 'rows': [dict(row) for row in rows], 'currency': 'INR'}
    finally: conn.close()
