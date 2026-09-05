"""Ignav contract and Admin ingestion regressions; no real network or secrets."""
from copy import deepcopy
from datetime import date, timedelta
import io
import json
from unittest.mock import MagicMock
import urllib.error
import urllib.request

from fastapi.testclient import TestClient
import pytest

from app.config import settings
from app.ingestion.validate import validate_live_quotes
from app.providers import get_configured_live_provider, get_live_provider
from app.providers.base import ProviderError, ProviderNotConfiguredError
from app.providers.ignav import IgnavProvider, _NoRedirect

TRAVEL = (date.today() + timedelta(days=7)).isoformat()
TEST_KEY = "test-only-ignav-credential"


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    monkeypatch.setattr(settings, "ignav_api_key", TEST_KEY)
    monkeypatch.setattr(settings, "ignav_base_url", "https://ignav.com/api")
    monkeypatch.setattr(settings, "amadeus_client_id", "")
    monkeypatch.setattr(settings, "amadeus_client_secret", "")
    monkeypatch.setattr(settings, "demo_mode", False)


@pytest.fixture
def itinerary():
    return {
        "price": {"amount": 6000.12, "currency": "INR", "status": "verified"},
        "outbound": {"carrier": "Air India", "segments": [{
            "marketing_carrier_code": "AI", "flight_number": "101",
            "departure_airport": "DEL", "arrival_airport": "BOM",
            "departure_time_local": f"{TRAVEL}T08:00:00",
        }]},
        "cabin_class": "economy", "ignav_id": "opaque-offer-1",
    }


@pytest.fixture
def upstream(monkeypatch, itinerary):
    opener = MagicMock()
    opener.open.return_value.__enter__.return_value.read.return_value = json.dumps({
        "itineraries": [itinerary],
    }).encode()
    monkeypatch.setattr(urllib.request, "build_opener", lambda *args: opener)
    return opener


@pytest.mark.parametrize("key", ["", "   "])
def test_not_configured(monkeypatch, upstream, key):
    monkeypatch.setattr(settings, "ignav_api_key", key)
    provider = IgnavProvider()
    assert provider.is_configured() is False
    assert provider.status()["configured"] is False
    with pytest.raises(ProviderNotConfiguredError):
        provider.fetch_quotes("DEL", "BOM", TRAVEL)
    upstream.open.assert_not_called()


def test_configured_status_has_no_secret_or_url(monkeypatch):
    monkeypatch.setattr(settings, "ignav_base_url", f"https://example.test/{TEST_KEY}")
    status = IgnavProvider().status()
    assert status["configured"] and status["enabled"]
    assert status["provider"] == "ignav"
    assert status["source_type"] == "live"
    assert status["data_freshness"] == "not_fetched"
    assert TEST_KEY not in json.dumps(status)
    assert TEST_KEY not in json.dumps(settings.masked_credentials())
    assert settings.masked_credentials()["ignav_api_key"] == "(set)"


def test_successful_normalization_and_request(upstream):
    rows = IgnavProvider().fetch_quotes("del", "bom", TRAVEL, adults=2, max_offers=1)
    (row,) = rows
    request = upstream.open.call_args.args[0]
    assert request.full_url == "https://ignav.com/api/fares/one-way"
    assert request.method == "POST"
    assert request.get_header("X-api-key") == TEST_KEY
    assert upstream.open.call_args.kwargs["timeout"] == 30
    assert json.loads(request.data) == {
        "origin": "DEL", "destination": "BOM", "departure_date": TRAVEL,
        "adults": 2, "cabin_class": "economy", "market": "IN",
    }
    assert row == {
        "origin": "DEL", "destination": "BOM", "airline": "AI",
        "travel_date": TRAVEL, "quote_date": date.today().isoformat(),
        "lead_days": 7, "lead_bucket": "D04_07", "fare_class": "ECONOMY_SAVER",
        "base_fare": 4500.09, "airline_surcharge": 0.0,
        "statutory_taxes": 975.02, "airport_charges": 525.01,
        "taxes_fees": 1500.03, "total_fare": 6000.12,
        "source_type": "live", "provider": "ignav", "flight_number": "AI101",
        "offer_id": "opaque-offer-1", "offer_expiry": None,
        "departure_time": f"{TRAVEL}T08:00:00", "arrival_time": None, "price_status": "verified",
    }
    accepted, quarantined = validate_live_quotes(rows)
    assert len(accepted) == 1 and not quarantined


@pytest.mark.parametrize("bad", [None, [], "bad", {}, {"price": {}}, {"price": None}])
def test_malformed_or_missing_price_item_does_not_lose_good_item(upstream, itinerary, bad):
    upstream.open.return_value.__enter__.return_value.read.return_value = json.dumps({
        "itineraries": [bad, itinerary],
    }).encode()
    rows = IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL, max_offers=1)
    assert len(rows) == 1


@pytest.mark.parametrize("amount", [None, "", "bad", -1, 0, True, "NaN", "Infinity"])
def test_invalid_price_skipped(upstream, itinerary, amount):
    itinerary["price"]["amount"] = amount
    upstream.open.return_value.__enter__.return_value.read.return_value = json.dumps({"itineraries": [itinerary]}).encode()
    assert IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL) == []


def test_non_inr_not_relabeled(upstream, itinerary):
    itinerary["price"]["currency"] = "USD"
    upstream.open.return_value.__enter__.return_value.read.return_value = json.dumps({"itineraries": [itinerary]}).encode()
    assert IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL) == []


def test_zero_itineraries(upstream):
    upstream.open.return_value.__enter__.return_value.read.return_value = b'{"itineraries": []}'
    assert IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL) == []


@pytest.mark.parametrize("body", [b'no json', b'[]', b'null', b'{}', b'{"itineraries": {}}', b'{"itineraries": null}'])
def test_malformed_response_raises_safe_error(upstream, body):
    upstream.open.return_value.__enter__.return_value.read.return_value = body
    with pytest.raises(ProviderError, match="malformed response"):
        IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL)


@pytest.mark.parametrize("code, message", [(401, "authentication"), (403, "authentication"), (429, "rate limit"), (500, "upstream"), (502, "upstream"), (503, "upstream"), (302, "upstream")])
def test_http_errors_never_expose_body_or_secret(upstream, caplog, code, message):
    upstream.open.side_effect = urllib.error.HTTPError(
        f"https://ignav.com/{TEST_KEY}", code, TEST_KEY, {}, io.BytesIO(TEST_KEY.encode()),
    )
    with pytest.raises(ProviderError, match=message) as error:
        IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL)
    assert TEST_KEY not in str(error.value) + caplog.text
    assert error.value.__suppress_context__ is True


@pytest.mark.parametrize("failure", [TimeoutError(TEST_KEY), urllib.error.URLError(TEST_KEY)])
def test_network_errors_are_safe(upstream, failure, caplog):
    upstream.open.side_effect = failure
    with pytest.raises(ProviderError, match="request failed") as error:
        IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL)
    assert TEST_KEY not in str(error.value) + caplog.text


def test_redirect_does_not_forward_key():
    request = urllib.request.Request("https://ignav.com/api/fares/one-way", headers={"X-Api-Key": TEST_KEY})
    assert _NoRedirect().redirect_request(request, None, 302, "", {}, "https://other.test") is None


def test_echoed_key_in_offer_is_discarded(upstream, itinerary, caplog):
    itinerary["ignav_id"] = TEST_KEY
    upstream.open.return_value.__enter__.return_value.read.return_value = json.dumps({"itineraries": [itinerary]}).encode()
    assert IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL) == []
    assert TEST_KEY not in caplog.text


def test_connecting_itinerary_is_one_quote(upstream, itinerary):
    first = itinerary["outbound"]["segments"][0]
    second = deepcopy(first)
    first["arrival_airport"] = "HYD"
    second.update(departure_airport="HYD", flight_number="202")
    itinerary["outbound"]["segments"].append(second)
    upstream.open.return_value.__enter__.return_value.read.return_value = json.dumps({"itineraries": [itinerary]}).encode()
    (row,) = IgnavProvider().fetch_quotes("DEL", "BOM", TRAVEL)
    assert (row["origin"], row["destination"], row["flight_number"]) == ("DEL", "BOM", "AI101/AI202")
    assert row["total_fare"] == 6000.12


def test_ignav_preferred_and_amadeus_fallback(monkeypatch):
    monkeypatch.setattr(settings, "amadeus_client_id", "test-client")
    monkeypatch.setattr(settings, "amadeus_client_secret", "test-secret")
    assert get_live_provider().name == "ignav"
    monkeypatch.setattr(settings, "ignav_api_key", "")
    assert get_live_provider().name == "amadeus"


@pytest.fixture
def client(monkeypatch, tmp_path):
    import app.db.database as database
    import app.main as main
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "ignav-test.db")
    monkeypatch.setattr(main, "_last_live_fetch", None)
    database.init_db()
    with TestClient(main.app) as api:
        yield api


def test_demo_mode_blocks_live_fetch_even_with_key(monkeypatch, client, upstream):
    monkeypatch.setattr(settings, "demo_mode", True)
    assert get_configured_live_provider().name == "ignav"
    assert get_live_provider() is None
    response = client.post("/api/admin/live-fetch?quick=true")
    assert response.status_code == 409
    status = client.get("/api/provider/status").json()
    assert status["configured_live_provider"] == "ignav"
    assert not status["live_fetch_enabled"]
    assert not IgnavProvider().status()["enabled"]
    upstream.open.assert_not_called()


def test_admin_stores_validated_ignav_live_rows_and_isolates_sources(monkeypatch, client, upstream):
    import app.main as main
    import app.ingestion.live_fetch as live
    from app.api.queries import fetch_observations
    # Exercise existing demo and CSV paths, then actual provider/orchestrator/
    # validator/storage code with only the HTTP transport mocked.
    assert client.post("/api/admin/load-sample").status_code == 200
    exported = client.get("/api/export/observations.csv").content
    response = client.post("/api/admin/upload", files={"file": ("fares.csv", exported, "text/csv")})
    assert response.status_code == 200
    monkeypatch.setattr(live, "QUICK_FETCH_ROUTES", [("DEL", "BOM")])
    monkeypatch.setattr(live, "PS_LEAD_ANCHORS", [7])
    validated = MagicMock(wraps=validate_live_quotes)
    monkeypatch.setattr(main, "validate_live_quotes", validated)
    status = client.get("/api/provider/status").json()
    assert status["live_fetch_enabled"] and status["active_live_provider"] == "ignav"
    response = client.post("/api/admin/live-fetch?quick=true")
    assert response.status_code == 200
    result = response.json()
    assert result["provider"] == "ignav"
    assert result["accepted_count"] == 1
    assert result["api_errors"] == 0
    validated.assert_called_once()
    assert validated.call_args.args[0][0]["provider"] == "ignav"
    rows = fetch_observations()
    assert len(rows) == 1
    assert rows[0]["source_type"] == "live" and rows[0]["provider"] == "ignav"
    assert rows[0]["offer_id"] == "opaque-offer-1"
    version = client.get("/api/version").json()
    assert version["active_analysis_source"] == "live"
    assert set(version["available_analysis_sources"]) == {"demo", "imported", "live"}
    assert TEST_KEY not in json.dumps([status, result, rows, version])
