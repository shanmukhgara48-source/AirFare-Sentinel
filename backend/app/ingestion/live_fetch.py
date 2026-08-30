"""
Live fare orchestrator.

For each (route, lead-day anchor) pair, asks the configured live provider for
fare quotes, then validates and returns them.  Rate-limiting and per-route error
isolation are built in — a single failed route never aborts the whole run.

Only call this when get_live_provider() returns a non-None provider.
"""
import datetime
import logging
import time

from app.model import PS_LEAD_ANCHORS, ROUTE_BASKET
from app.providers.base import FareProvider, ProviderError

log = logging.getLogger(__name__)

# Seconds between consecutive API calls.  Amadeus test environment enforces a
# rate limit; 1.2 s gives comfortable headroom.
REQUEST_DELAY_SECONDS = 1.2

# "Quick fetch" uses only the six highest-traffic trunk routes.  Useful for a
# live demo when time is short or the provider has limited test data.
QUICK_FETCH_ROUTES: list[tuple[str, str]] = [
    ("DEL", "BOM"), ("BOM", "DEL"),
    ("DEL", "BLR"), ("BLR", "DEL"),
    ("BOM", "BLR"), ("BLR", "BOM"),
]

ALL_FETCH_ROUTES: list[tuple[str, str]] = list(ROUTE_BASKET.keys())


def fetch_live_fares(
    provider: FareProvider,
    *,
    quick: bool = False,
) -> dict:
    """
    Fetch live fare quotes for configured routes × lead-day anchors.

    Returns:
        quotes      — raw quote dicts (to be validated by validate_live_quotes)
        fetch_count — number of successful API calls
        error_count — calls that raised or returned nothing
        errors      — list of {route, lead_days, error} for operator review
        fetched_at  — UTC ISO timestamp
        quick_mode  — whether quick (6-route) mode was used
    """
    routes = QUICK_FETCH_ROUTES if quick else ALL_FETCH_ROUTES
    today = datetime.date.today()
    quotes: list[dict] = []
    errors: list[dict] = []
    fetch_count = 0
    first = True

    for origin, destination in routes:
        for lead_days in PS_LEAD_ANCHORS:
            if not first:
                time.sleep(REQUEST_DELAY_SECONDS)
            first = False

            travel_date = (today + datetime.timedelta(days=lead_days)).isoformat()
            route_tag = f"{origin}-{destination}"
            try:
                offers = provider.fetch_quotes(origin, destination, travel_date)
                fetch_count += 1
                quotes.extend(offers)
                log.info(
                    "live_fetch: %d offers %s +%dd (travel %s)",
                    len(offers), route_tag, lead_days, travel_date,
                )
            except ProviderError as exc:
                log.warning(
                    "live_fetch: provider error %s +%dd: %s",
                    route_tag, lead_days, exc,
                )
                errors.append({
                    "route": route_tag,
                    "lead_days": lead_days,
                    "error": str(exc),
                })
            except Exception as exc:  # noqa: BLE001 — isolate per-route failures
                log.error(
                    "live_fetch: unexpected error %s +%dd: %s",
                    route_tag, lead_days, exc,
                )
                errors.append({
                    "route": route_tag,
                    "lead_days": lead_days,
                    "error": f"Unexpected: {exc}",
                })

    return {
        "quotes": quotes,
        "fetch_count": fetch_count,
        "error_count": len(errors),
        "errors": errors[:20],  # cap to avoid bloating the response
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "quick_mode": quick,
    }
