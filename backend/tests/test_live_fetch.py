"""
Live fare ingestion tests.

Covers:
  - validate_live_quotes: valid input, schema errors, fare sanity, audit guarantee
  - fetch_live_fares: provider error isolation, rate-limit delay (mocked), result shape
  - Admin endpoints: /api/admin/live-fetch is gated in demo mode and returns
                     503 when live mode has no provider,
                     /api/admin/live-fetch/status returns 200 always
"""
import datetime
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.ingestion.validate import validate_live_quotes

client = TestClient(app, raise_server_exceptions=True)

TODAY = datetime.date.today()


# ─── validate_live_quotes ────────────────────────────────────────────────────

class TestValidateLiveQuotes(unittest.TestCase):

    def _make_quote(self, **overrides) -> dict:
        base = {
            "origin": "DEL",
            "destination": "BOM",
            "airline": "AI",
            "fare_class": "ECONOMY_SAVER",
            "travel_date": (TODAY + datetime.timedelta(days=7)).isoformat(),
            "quote_date": TODAY.isoformat(),
            "base_fare": 4000.0,
            "taxes_fees": 840.0,
            "source_type": "live",
            "provider": "amadeus",
            "flight_number": "AI101",
            "offer_id": "off-abc123",
            "offer_expiry": None,
        }
        base.update(overrides)
        return base

    def test_valid_quote_is_accepted(self):
        accepted, quarantined = validate_live_quotes([self._make_quote()])
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(quarantined), 0)

    def test_accepted_row_has_normalized_fields(self):
        accepted, _ = validate_live_quotes([self._make_quote()])
        row = accepted[0]
        self.assertIn("lead_days", row)
        self.assertIn("lead_bucket", row)
        self.assertIn("total_fare", row)
        self.assertAlmostEqual(row["total_fare"], 4840.0)

    def test_extended_fields_are_preserved(self):
        accepted, _ = validate_live_quotes([self._make_quote()])
        row = accepted[0]
        self.assertEqual(row["source_type"], "live")
        self.assertEqual(row["provider"], "amadeus")
        self.assertEqual(row["flight_number"], "AI101")
        self.assertEqual(row["offer_id"], "off-abc123")

    def test_inconsistent_provider_total_is_quarantined(self):
        _, quarantined = validate_live_quotes([
            self._make_quote(total_fare=9999.0)
        ])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("COMPONENTS_DO_NOT_RECONCILE", quarantined[0]["reject_reason"])

    def test_provider_cannot_override_live_provenance(self):
        accepted, _ = validate_live_quotes([
            self._make_quote(source_type="demo")
        ])
        self.assertEqual(accepted[0]["source_type"], "live")

    def test_invalid_fare_class_is_quarantined(self):
        _, quarantined = validate_live_quotes([self._make_quote(fare_class="FIRST_CLASS")])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("INVALID_FARE_CLASS", quarantined[0]["reject_reason"])

    def test_negative_fare_is_quarantined(self):
        _, quarantined = validate_live_quotes([self._make_quote(base_fare=-100.0)])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("NON_POSITIVE_FARE", quarantined[0]["reject_reason"])

    def test_invalid_airport_code_is_quarantined(self):
        _, quarantined = validate_live_quotes([self._make_quote(origin="ZZZ123")])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("INVALID_AIRPORT_CODE", quarantined[0]["reject_reason"])

    def test_same_origin_destination_is_quarantined(self):
        _, quarantined = validate_live_quotes([self._make_quote(destination="DEL")])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("ORIGIN_EQUALS_DESTINATION", quarantined[0]["reject_reason"])

    def test_schema_error_is_quarantined(self):
        _, quarantined = validate_live_quotes([self._make_quote(base_fare="not-a-number")])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("SCHEMA_ERROR", quarantined[0]["reject_reason"])

    def test_audit_guarantee_accepted_plus_quarantined_equals_input(self):
        quotes = [
            self._make_quote(),                              # good
            self._make_quote(fare_class="INVALID"),          # bad
            self._make_quote(base_fare=-50.0),               # bad
            self._make_quote(airline="6E", offer_id="x2"),   # good (different key)
        ]
        accepted, quarantined = validate_live_quotes(quotes)
        self.assertEqual(len(accepted) + len(quarantined), len(quotes))

    def test_duplicate_key_within_batch_is_quarantined(self):
        q = self._make_quote()
        accepted, quarantined = validate_live_quotes([q, q])
        self.assertEqual(len(accepted), 1)
        self.assertEqual(len(quarantined), 1)
        self.assertIn("DUPLICATE_KEY", quarantined[0]["reject_reason"])

    def test_fare_out_of_plausible_range_is_quarantined(self):
        # 100 INR base + 0 taxes = 100 INR total — below MIN_PLAUSIBLE_FARE (500)
        _, quarantined = validate_live_quotes([self._make_quote(base_fare=100.0, taxes_fees=0.0)])
        self.assertEqual(len(quarantined), 1)
        self.assertIn("FARE_OUT_OF_PLAUSIBLE_RANGE", quarantined[0]["reject_reason"])

    def test_empty_list_returns_empty_results(self):
        accepted, quarantined = validate_live_quotes([])
        self.assertEqual(accepted, [])
        self.assertEqual(quarantined, [])

    def test_source_type_defaults_to_live_when_missing(self):
        q = self._make_quote()
        del q["source_type"]
        accepted, _ = validate_live_quotes([q])
        self.assertEqual(accepted[0]["source_type"], "live")


# ─── fetch_live_fares ────────────────────────────────────────────────────────

class TestFetchLiveFares(unittest.TestCase):

    def _make_mock_provider(self, offers_per_call: list[dict] | None = None):
        provider = MagicMock()
        provider.name = "mock"
        provider.fetch_quotes.return_value = offers_per_call or []
        return provider

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_result_has_required_keys(self, _sleep):
        from app.ingestion.live_fetch import fetch_live_fares
        provider = self._make_mock_provider()
        result = fetch_live_fares(provider, quick=True)
        for key in ("quotes", "fetch_count", "error_count", "errors",
                    "fetched_at", "quick_mode"):
            self.assertIn(key, result, f"missing key: {key!r}")

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_quick_mode_flag_is_set(self, _sleep):
        from app.ingestion.live_fetch import fetch_live_fares
        result = fetch_live_fares(self._make_mock_provider(), quick=True)
        self.assertTrue(result["quick_mode"])

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_full_mode_flag_is_false(self, _sleep):
        from app.ingestion.live_fetch import fetch_live_fares
        result = fetch_live_fares(self._make_mock_provider(), quick=False)
        self.assertFalse(result["quick_mode"])

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_successful_calls_counted(self, _sleep):
        from app.ingestion.live_fetch import fetch_live_fares, QUICK_FETCH_ROUTES
        from app.model import PS_LEAD_ANCHORS
        result = fetch_live_fares(self._make_mock_provider(), quick=True)
        expected = len(QUICK_FETCH_ROUTES) * len(PS_LEAD_ANCHORS)
        self.assertEqual(result["fetch_count"], expected)

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_provider_error_is_isolated(self, _sleep):
        from app.ingestion.live_fetch import fetch_live_fares
        from app.providers.base import ProviderError
        provider = MagicMock()
        provider.name = "mock"
        provider.fetch_quotes.side_effect = ProviderError("rate limited")
        result = fetch_live_fares(provider, quick=True)
        self.assertEqual(result["fetch_count"], 0)
        self.assertGreater(result["error_count"], 0)
        self.assertGreater(len(result["errors"]), 0)

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_quotes_are_collected_from_all_calls(self, _sleep):
        from app.ingestion.live_fetch import fetch_live_fares, QUICK_FETCH_ROUTES
        from app.model import PS_LEAD_ANCHORS
        fake_offer = {"origin": "DEL", "destination": "BOM", "base_fare": 4000.0}
        provider = self._make_mock_provider(offers_per_call=[fake_offer])
        result = fetch_live_fares(provider, quick=True)
        expected = len(QUICK_FETCH_ROUTES) * len(PS_LEAD_ANCHORS)
        self.assertEqual(len(result["quotes"]), expected)

    @patch("app.ingestion.live_fetch.time.sleep")
    def test_sleep_is_called_between_requests(self, mock_sleep):
        from app.ingestion.live_fetch import fetch_live_fares, QUICK_FETCH_ROUTES
        from app.model import PS_LEAD_ANCHORS
        fetch_live_fares(self._make_mock_provider(), quick=True)
        # Sleep is called n-1 times (not before the first request)
        expected_calls = len(QUICK_FETCH_ROUTES) * len(PS_LEAD_ANCHORS) - 1
        self.assertEqual(mock_sleep.call_count, expected_calls)


# ─── Admin endpoints ─────────────────────────────────────────────────────────

class TestLiveFetchEndpoint(unittest.TestCase):

    def test_returns_409_while_demo_mode_is_active(self):
        r = client.post("/api/admin/live-fetch")
        self.assertEqual(r.status_code, 409)
        self.assertIn("demo_mode", r.json()["detail"].lower())

    def test_returns_503_when_live_mode_has_no_provider(self):
        import os
        if os.environ.get("AMADEUS_CLIENT_ID") and os.environ.get("AMADEUS_CLIENT_SECRET"):
            self.skipTest("Live provider is configured")
        from app.config import settings
        with patch.object(settings, "demo_mode", False):
            r = client.post("/api/admin/live-fetch?quick=true")
        self.assertEqual(r.status_code, 503)


class TestLiveFetchStatusEndpoint(unittest.TestCase):

    def test_returns_200_always(self):
        r = client.get("/api/admin/live-fetch/status")
        self.assertEqual(r.status_code, 200)

    def test_has_has_result_flag(self):
        body = client.get("/api/admin/live-fetch/status").json()
        self.assertIn("has_result", body)
        self.assertIsInstance(body["has_result"], bool)

    def test_has_live_provider_configured_flag(self):
        body = client.get("/api/admin/live-fetch/status").json()
        self.assertIn("live_provider_configured", body)
        self.assertIn("active_live_provider", body)
        self.assertIn("configured_live_provider", body)

    def test_has_message_when_no_fetch_run(self):
        # Status may or may not have a result depending on test order;
        # when has_result=False we expect a message.
        body = client.get("/api/admin/live-fetch/status").json()
        if not body["has_result"]:
            self.assertIn("message", body)


if __name__ == "__main__":
    unittest.main()
