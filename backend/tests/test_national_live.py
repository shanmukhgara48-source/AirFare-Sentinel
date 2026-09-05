"""Live-only provenance and individual itinerary preservation; no network."""
from datetime import date, timedelta
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from app.main import app, _insert_live_observations, _insert_observations
from app.config import settings
from app.db.database import reset_db, set_active_source_type, get_connection, init_db
from app.ingestion.validate import validate_live_quotes
from app.national import AIRPORTS, national_routes

client = TestClient(app)

@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    reset_db()
    monkeypatch.setattr(settings, 'live_only', False)
    monkeypatch.setattr(settings, 'demo_mode', True)
    yield
    reset_db()

def quote(offer='offer-1', flight='AI101', total=6425.37):
    base = round(total * .75, 2); fees = round(total-base, 2)
    return dict(origin='DEL', destination='BOM', airline='AI', fare_class='ECONOMY_SAVER',
                travel_date=(date.today()+timedelta(days=7)).isoformat(), quote_date=date.today().isoformat(),
                base_fare=base, taxes_fees=fees, total_fare=total, source_type='live', provider='ignav',
                flight_number=flight, offer_id=offer, departure_time='2026-09-12T08:00:00', price_status='verified')

def test_distinct_live_itineraries_survive_validation_and_storage():
    valid,rejected=validate_live_quotes([quote(),quote('offer-2','AI103',7100.59),quote()])
    assert len(valid)==2 and len(rejected)==1
    assert _insert_live_observations(valid,'live-test',[])==[]
    repeated=_insert_live_observations(valid,'live-repeat',[])
    assert len(repeated)==2
    result=client.get('/api/live-itineraries?origin=DEL&destination=BOM&limit=1').json()
    assert result['total']==2 and len(result['rows'])==1
    assert result['rows'][0]['total_fare']==6425.37
    assert result['rows'][0]['flight_number']=='AI101'
    assert result['rows'][0]['source_type']=='live'
    assert result['rows'][0]['price_status']=='verified'
    assert client.get('/api/live-itineraries?origin=DEL&destination=BOM&offset=1').json()['rows'][0]['flight_number']=='AI103'
    # Reinitializing a current database must not rebuild/drop itinerary rows.
    init_db(); assert client.get('/api/live-itineraries?origin=DEL&destination=BOM').json()['total']==2

def test_live_only_ignores_stored_demo_and_blocks_switches(monkeypatch):
    rows,_=validate_live_quotes([quote()])
    _insert_observations(rows,'demo-test','sample',[],source_type='demo')
    set_active_source_type('demo')
    monkeypatch.setattr(settings,'live_only',True)
    monkeypatch.setattr(settings,'demo_mode',False)
    assert client.get('/api/overview').json()['empty'] is True
    assert client.get('/api/admin/analysis-source').json()['active_analysis_source']=='live'
    assert client.post('/api/admin/analysis-source?source_type=demo').status_code==409
    assert client.post('/api/admin/load-sample').status_code==409
    assert client.post('/api/admin/upload',files={'file':('demo.csv',b'not data','text/csv')}).status_code==409
    assert client.get('/api/events').json()['events']==[]
    _insert_live_observations(rows,'live-test',[])
    assert client.get('/api/overview').json()['observation_count']==1
    assert client.get('/api/filters').json()['airlines']==['AI']
    assert client.get('/api/live-itineraries?origin=DEL&destination=BOM').json()['total']==1

def test_nationwide_plan_and_demo_gate():
    routes=national_routes()
    assert len(AIRPORTS)==116
    assert len(routes)==234==len(set(routes))
    assert {airport for route in routes for airport in route}==set(AIRPORTS)
    assert all(o!=d for o,d in routes)
    with patch('app.national.get_live_provider') as provider:
        assert client.post('/api/admin/network-fetch').status_code==409
        provider.assert_not_called()

def test_carrier_filter_in_route_comparison():
    first=quote();second=quote('offer-2','6E100',8123.45);second['airline']='6E'
    rows,_=validate_live_quotes([first,second]);_insert_live_observations(rows,'live-test',[])
    set_active_source_type('live')
    result=client.get('/api/compare?dimension=route&airline=6E').json()['rows'][0]
    assert result['avg_fare']==8123.45 and result['observation_count']==1
