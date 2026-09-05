"""
API contract tests using FastAPI TestClient.

These tests exercise the HTTP layer end-to-end (routing, response shapes,
status codes, error handling) without requiring a running server.

Covered contracts:
  - /api/health          → {"status": "ok"}
  - /api/version         → version, demo_mode, methodology block
  - /api/provider/status → providers list, live_data_available flag
  - /api/overview        → empty state and required shape
  - /api/spikes          → threshold param, evidence block, flagged list
  - /api/filters         → required keys
  - /api/whatif          → projection block, risk_level
  - /api/admin/upload    → rejects non-CSV, rejects oversized, accepts valid CSV
  - /api/export/...      → CSV content-type response
"""
import io
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=True)


# ─── System endpoints ─────────────────────────────────────────────────────────

class TestHealth(unittest.TestCase):
    def test_returns_200(self):
        r = client.get("/api/health")
        self.assertEqual(r.status_code, 200)

    def test_status_is_ok(self):
        self.assertEqual(client.get("/api/health").json(), {"status": "ok"})

    def test_response_time_header_present(self):
        r = client.get("/api/health")
        self.assertIn("x-process-time", r.headers)


class TestVersion(unittest.TestCase):
    def test_returns_200(self):
        self.assertEqual(client.get("/api/version").status_code, 200)

    def test_has_version_string(self):
        body = client.get("/api/version").json()
        self.assertIn("version", body)
        self.assertIsInstance(body["version"], str)

    def test_has_demo_mode_field(self):
        body = client.get("/api/version").json()
        self.assertIn("demo_mode", body)
        self.assertIsInstance(body["demo_mode"], bool)

    def test_has_methodology_block(self):
        body = client.get("/api/version").json()
        self.assertIn("methodology", body)
        m = body["methodology"]
        self.assertIn("index", m)
        self.assertIn("anomaly", m)
        self.assertIn("cell_definition", m)

    def test_has_upload_limit(self):
        body = client.get("/api/version").json()
        self.assertIn("upload_max_bytes", body)
        self.assertGreater(body["upload_max_bytes"], 0)

    def test_separates_operating_mode_from_dataset_provenance(self):
        body = client.get("/api/version").json()
        self.assertIn(body["operating_mode"], {"demo", "live", "demo_fallback"})
        self.assertIn(body["dataset_mode"], {"empty", "demo", "live", "imported", "hybrid"})
        self.assertIsInstance(body["dataset_label"], str)


class TestProviderStatus(unittest.TestCase):
    def test_returns_200(self):
        self.assertEqual(client.get("/api/provider/status").status_code, 200)

    def test_has_providers_list(self):
        body = client.get("/api/provider/status").json()
        self.assertIn("providers", body)
        self.assertIsInstance(body["providers"], list)
        self.assertGreater(len(body["providers"]), 0)

    def test_has_live_data_available_flag(self):
        body = client.get("/api/provider/status").json()
        self.assertIn("live_data_available", body)
        self.assertIsInstance(body["live_data_available"], bool)

    def test_provider_readiness_does_not_claim_stored_live_data(self):
        with patch("app.main.fetch_data_source_types", return_value=[]):
            body = client.get("/api/provider/status").json()
        self.assertFalse(body["live_data_available"])

    def test_stored_live_provenance_sets_live_data_available(self):
        with patch("app.main.fetch_data_source_types", return_value=["demo", "live"]):
            body = client.get("/api/provider/status").json()
        self.assertTrue(body["live_data_available"])

    def test_has_demo_fallback_flag(self):
        body = client.get("/api/provider/status").json()
        self.assertIn("demo_fallback", body)
        self.assertTrue(body["demo_fallback"])  # always True

    def test_every_provider_has_configured_key(self):
        body = client.get("/api/provider/status").json()
        for p in body["providers"]:
            self.assertIn("provider", p)
            self.assertIn("configured", p)

    def test_demo_provider_is_always_configured(self):
        body = client.get("/api/provider/status").json()
        demo = next((p for p in body["providers"] if p["provider"] == "demo"), None)
        self.assertIsNotNone(demo, "demo provider not in response")
        self.assertTrue(demo["configured"])


# ─── Dashboard endpoints ──────────────────────────────────────────────────────

class TestOverviewEmpty(unittest.TestCase):
    """Overview with no data loaded must return a useful empty-state response."""

    def setUp(self):
        # Wipe the database to test the empty state.
        client.delete("/api/admin/data")

    def test_returns_200(self):
        self.assertEqual(client.get("/api/overview").status_code, 200)

    def test_empty_flag_is_true(self):
        body = client.get("/api/overview").json()
        self.assertTrue(body.get("empty"))

    def test_has_message(self):
        body = client.get("/api/overview").json()
        self.assertIn("message", body)

    def test_granularity_week_also_returns_200(self):
        r = client.get("/api/overview?granularity=week")
        self.assertEqual(r.status_code, 200)

    def test_invalid_granularity_returns_422(self):
        r = client.get("/api/overview?granularity=month")
        self.assertEqual(r.status_code, 422)


class TestSpikes(unittest.TestCase):
    def test_returns_200(self):
        self.assertEqual(client.get("/api/spikes").status_code, 200)

    def test_has_required_top_level_keys(self):
        body = client.get("/api/spikes").json()
        for key in ("threshold", "flagged_count", "scanned_count",
                    "event_window_count", "flagged", "evidence"):
            self.assertIn(key, body, f"spikes response missing key: {key!r}")

    def test_evidence_block_has_formula(self):
        body = client.get("/api/spikes").json()
        ev = body["evidence"]
        self.assertIn("formula", ev)
        self.assertIn("robust_z", ev["formula"])

    def test_threshold_param_is_reflected(self):
        body = client.get("/api/spikes?threshold=4.0").json()
        self.assertEqual(body["threshold"], 4.0)

    def test_threshold_below_min_returns_422(self):
        self.assertEqual(client.get("/api/spikes?threshold=0.5").status_code, 422)

    def test_threshold_above_max_returns_422(self):
        self.assertEqual(client.get("/api/spikes?threshold=11").status_code, 422)

    def test_flagged_is_a_list(self):
        body = client.get("/api/spikes").json()
        self.assertIsInstance(body["flagged"], list)


class TestFilters(unittest.TestCase):
    def test_returns_200(self):
        self.assertEqual(client.get("/api/filters").status_code, 200)

    def test_has_required_keys(self):
        body = client.get("/api/filters").json()
        for key in ("routes", "airlines", "fare_classes", "lead_buckets"):
            self.assertIn(key, body, f"filters response missing: {key!r}")

    def test_lead_buckets_in_model_order(self):
        from app.model import LEAD_BUCKET_CODES
        body = client.get("/api/filters").json()
        codes = [b["code"] for b in body["lead_buckets"]]
        # Codes returned must be a subsequence of the canonical order.
        idx = [LEAD_BUCKET_CODES.index(c) for c in codes]
        self.assertEqual(idx, sorted(idx), "lead_buckets not in model order")


class TestWhatIf(unittest.TestCase):
    def test_returns_200_with_defaults(self):
        self.assertEqual(client.get("/api/whatif").status_code, 200)

    def test_has_projected_change_pct(self):
        body = client.get("/api/whatif").json()
        self.assertIn("projected_change_pct", body)

    def test_has_risk_level(self):
        body = client.get("/api/whatif").json()
        self.assertIn("risk_level", body)
        self.assertIn(body["risk_level"], ("Low", "Watch", "Review", "Escalate"))

    def test_zero_inputs_produce_zero_change(self):
        r = client.get("/api/whatif?demand_change_pct=0&fuel_change_pct=0"
                       "&capacity_change_pct=0&carriers=4&baseline_apix=100")
        body = r.json()
        self.assertAlmostEqual(body["projected_change_pct"], 0.0, places=2)
        self.assertAlmostEqual(body["projected_apix"], 100.0, places=2)

    def test_demand_above_100_returns_422(self):
        r = client.get("/api/whatif?demand_change_pct=200")
        self.assertEqual(r.status_code, 422)

    def test_carriers_zero_returns_422(self):
        r = client.get("/api/whatif?carriers=0")
        self.assertEqual(r.status_code, 422)

    def test_has_explanation(self):
        body = client.get("/api/whatif").json()
        self.assertIn("explanation", body)
        self.assertGreater(len(body["explanation"]), 10)


# ─── Upload / ingestion ───────────────────────────────────────────────────────

GOOD_CSV = (
    "origin,destination,airline,travel_date,quote_date,fare_class,base_fare,taxes_fees\n"
    "DEL,BOM,SA1,2026-10-20,2026-10-01,ECONOMY_SAVER,4000,840\n"
    "BOM,DEL,BW2,2026-10-25,2026-10-01,ECONOMY_FLEX,5000,1050\n"
)


class TestUploadEndpoint(unittest.TestCase):
    def setUp(self):
        client.delete("/api/admin/data")

    def test_rejects_non_csv_file(self):
        r = client.post(
            "/api/admin/upload",
            files={"file": ("data.json", b'{"key": "value"}', "application/json")},
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("csv", r.json()["detail"].lower())

    def test_rejects_oversized_file(self):
        from app.config import settings
        # Generate a byte string larger than the limit.
        large = b"a" * (settings.upload_max_bytes + 1)
        r = client.post(
            "/api/admin/upload",
            files={"file": ("big.csv", large, "text/csv")},
        )
        self.assertEqual(r.status_code, 413)

    def test_accepts_valid_csv(self):
        r = client.post(
            "/api/admin/upload",
            files={"file": ("fares.csv", GOOD_CSV.encode(), "text/csv")},
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("accepted_count", body)
        self.assertIn("quarantined_count", body)
        self.assertGreaterEqual(body["accepted_count"], 0)

    def test_upload_returns_batch_id(self):
        r = client.post(
            "/api/admin/upload",
            files={"file": ("fares.csv", GOOD_CSV.encode(), "text/csv")},
        )
        body = r.json()
        self.assertIn("batch_id", body)
        self.assertTrue(body["batch_id"].startswith("upload-"))

    def test_uploaded_rows_are_labelled_imported(self):
        client.post(
            "/api/admin/upload",
            files={"file": ("fares.csv", GOOD_CSV.encode(), "text/csv")},
        )
        body = client.get("/api/filters").json()
        self.assertEqual(body["source_types"], ["imported"])

    def test_upload_rejects_invalid_fare_class(self):
        bad_csv = (
            "origin,destination,airline,travel_date,quote_date,fare_class,base_fare,taxes_fees\n"
            "DEL,BOM,SA1,2026-10-20,2026-10-01,FIRST_CLASS,4000,840\n"
        )
        r = client.post(
            "/api/admin/upload",
            files={"file": ("bad.csv", bad_csv.encode(), "text/csv")},
        )
        body = r.json()
        # Accepted 0, quarantined 1.
        self.assertEqual(body["accepted_count"], 0)
        self.assertGreater(body["quarantined_count"], 0)
        self.assertIn("INVALID_FARE_CLASS", body["quarantined"][0]["reject_reason"])

    def test_upload_rejects_negative_fare(self):
        bad_csv = (
            "origin,destination,airline,travel_date,quote_date,fare_class,base_fare,taxes_fees\n"
            "DEL,BOM,SA1,2026-10-20,2026-10-01,ECONOMY_SAVER,-100,840\n"
        )
        r = client.post(
            "/api/admin/upload",
            files={"file": ("bad.csv", bad_csv.encode(), "text/csv")},
        )
        body = r.json()
        self.assertEqual(body["accepted_count"], 0)
        self.assertIn("NON_POSITIVE_FARE", body["quarantined"][0]["reject_reason"])

    def test_upload_audit_guarantee(self):
        """accepted + quarantined must equal submitted rows."""
        mixed_csv = (
            "origin,destination,airline,travel_date,quote_date,fare_class,base_fare,taxes_fees\n"
            "DEL,BOM,SA1,2026-10-20,2026-10-01,ECONOMY_SAVER,4000,840\n"   # good
            "BOM,DEL,BW2,2026-10-25,2026-10-01,ECONOMY_FLEX,5000,1050\n"   # good
            "DEL,BOM,SA1,2026-10-20,2026-10-01,FIRST_CLASS,4000,840\n"      # bad
            "ZZZ,BOM,SA1,2026-10-20,2026-10-01,ECONOMY_SAVER,4000,840\n"   # bad (invalid IATA)
        )
        r = client.post(
            "/api/admin/upload",
            files={"file": ("mixed.csv", mixed_csv.encode(), "text/csv")},
        )
        body = r.json()
        # 4 rows total: 2 good + 2 bad (but good rows might already exist in DB
        # from previous tests → duplicates land in quarantine too)
        total = body["accepted_count"] + body["quarantined_count"]
        self.assertEqual(total, 4)


# ─── Export ──────────────────────────────────────────────────────────────────

class TestExport(unittest.TestCase):
    def setUp(self):
        client.post("/api/admin/load-sample")

    def test_export_returns_csv_content_type(self):
        r = client.get("/api/export/observations.csv")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers.get("content-type", ""))

    def test_export_has_standard_header_and_provenance_headers(self):
        r = client.get("/api/export/observations.csv")
        self.assertTrue(r.text.startswith("id,origin,destination,"))
        self.assertFalse(r.text.startswith("#"))
        self.assertEqual(r.headers["x-farepulse-dataset-mode"], "demo")
        self.assertEqual(r.headers["x-farepulse-active-source"], "demo")


class TestJudgeDemoPath(unittest.TestCase):
    """One contract test covers the exact five-minute navigation sequence."""

    def test_demo_path_is_populated_truthful_and_provider_safe(self):
        loaded = client.post("/api/admin/load-sample")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["accepted_count"], 23558)
        self.assertEqual(loaded.json()["quarantined_count"], 0)

        for path in (
            "/api/overview",
            "/api/spikes",
            "/api/competition",
            "/api/vulnerability",
            "/api/fairness",
            "/api/whatif",
            "/api/admin/batches",
            "/api/admin/observations?limit=1",
        ):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json().get("empty", False))

        version = client.get("/api/version").json()
        self.assertEqual(version["operating_mode"], "demo")
        self.assertEqual(version["dataset_mode"], "demo")

        provider = client.get("/api/provider/status").json()
        self.assertFalse(provider["live_fetch_enabled"])
        self.assertFalse(provider["live_data_available"])

        alert = client.get("/api/spikes").json()["flagged"][0]
        self.assertEqual(alert["source_type"], "demo")
        self.assertIn("synthetic", alert["source_label"].lower())

        blocked_fetch = client.post("/api/admin/live-fetch?quick=true")
        self.assertEqual(blocked_fetch.status_code, 409)


class TestAnalysisSourceIsolation(unittest.TestCase):
    def setUp(self):
        client.post("/api/admin/load-sample")

    def test_import_does_not_form_silent_hybrid_analysis(self):
        uploaded = client.post(
            "/api/admin/upload",
            files={"file": ("fares.csv", GOOD_CSV.encode(), "text/csv")},
        )
        self.assertEqual(uploaded.status_code, 200)
        self.assertEqual(uploaded.json()["accepted_count"], 2)

        version = client.get("/api/version").json()
        self.assertEqual(version["active_analysis_source"], "imported")
        self.assertEqual(version["dataset_mode"], "imported")
        self.assertEqual(version["stored_dataset"]["dataset_mode"], "hybrid")
        self.assertEqual(version["available_analysis_sources"], ["demo", "imported"])

        imported_overview = client.get("/api/overview").json()
        self.assertEqual(imported_overview["observation_count"], 2)
        self.assertEqual(
            imported_overview["evidence"]["audit"]["source_types"], ["imported"]
        )

        selected = client.post(
            "/api/admin/analysis-source?source_type=demo"
        )
        self.assertEqual(selected.status_code, 200)
        demo_overview = client.get("/api/overview").json()
        self.assertEqual(demo_overview["observation_count"], 23558)
        self.assertEqual(demo_overview["evidence"]["audit"]["source_types"], ["demo"])

    def test_cannot_select_a_source_that_has_no_rows(self):
        response = client.post("/api/admin/analysis-source?source_type=live")
        self.assertEqual(response.status_code, 409)

    def test_publication_gate_suppresses_red_national_headline(self):
        body = client.get("/api/overview").json()
        self.assertEqual(body["coverage"]["quality_flag"], "RED")
        self.assertEqual(body["publication_status"], "SUPPRESSED")
        self.assertFalse(body["headline_publishable"])
        self.assertEqual(body["indicator_name"], "Experimental Basket Indicator")
        self.assertIn("must not be quoted as a national index", body["suppression_reason"])

    def test_evidence_has_reproducible_calculation_metadata(self):
        evidence = client.get("/api/spikes?threshold=5").json()["evidence"]
        audit = evidence["audit"]
        self.assertEqual(audit["parameters"]["robust_z_threshold"], 5.0)
        self.assertEqual(audit["source_types"], ["demo"])
        self.assertEqual(audit["observation_count"], 23558)
        self.assertTrue(audit["calculation_id"])
        self.assertEqual(len(audit["dataset_fingerprint_sha256"]), 64)
        self.assertIn("not an immutable", audit["audit_scope"])


if __name__ == "__main__":
    unittest.main()
