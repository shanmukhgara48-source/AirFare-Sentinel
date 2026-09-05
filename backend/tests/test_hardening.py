"""Regression tests for high-risk integrity and interpretation boundaries."""

import csv
import io
import sqlite3
import urllib.request

from fastapi.testclient import TestClient
import pytest

import app.main as main_module
from app.engine.competition import compute_route_competition
from app.engine.anomaly import assign_reason_code
from app.engine.fairness import compute_fairness
from app.engine.index import (
    compute_contributions,
    compute_index_timeseries,
    coverage_report,
)
from app.engine.vulnerability import compute_vulnerability
from app.engine.whatif import project
from app.config import settings
from app.db.database import (
    SCHEMA_PATH,
    _migrate_observation_source_uniqueness,
    _run_migrations,
)
from app.providers.amadeus import AmadeusProvider
from app.providers.base import ProviderError


client = TestClient(main_module.app)


def _index_row(
    quote_date: str,
    fare: float,
    *,
    origin: str = "DEL",
    destination: str = "BOM",
    fare_class: str = "ECONOMY_SAVER",
) -> dict:
    return {
        "origin": origin,
        "destination": destination,
        "airline": "SA1",
        "fare_class": fare_class,
        "lead_bucket": "D15_30",
        "quote_date": quote_date,
        "total_fare": fare,
    }


def test_unknown_route_weight_is_explicit_and_publication_quality_is_red():
    rows = [
        _index_row("2026-01-01", 1000, origin="AAA", destination="BBB"),
        _index_row("2026-01-02", 1100, origin="AAA", destination="BBB"),
    ]

    series = compute_index_timeseries(rows)
    report = coverage_report(rows)

    assert series[-1]["aggregation_method"] == "unweighted_jevons_fallback"
    assert series[-1]["weighted_result_available"] is False
    assert series[-1]["weighting_complete"] is False
    assert series[-1]["quality_flag"] == "RED"
    assert report["weighting_complete"] is False
    assert report["unsupported_weight_cells"] == 1
    assert report["quality_flag"] == "RED"


def test_contributions_use_only_cells_present_at_both_endpoints():
    rows = [
        _index_row("2026-01-01", 1000),
        _index_row("2026-01-01", 2000, fare_class="ECONOMY_FLEX"),
        _index_row("2026-01-02", 1100),
    ]

    contributions = compute_contributions(rows)

    assert len(contributions) == 1
    assert contributions[0]["fare_class"] == "ECONOMY_SAVER"
    assert contributions[0]["contribution_pts"] == 10.0
    assert (
        contributions[0]["comparison_basis"]
        == "cells_observed_in_both_endpoint_periods"
    )


def test_extreme_scenario_never_displays_a_negative_price_index():
    result = project(-100, -100, 100, 8)

    assert result["raw_projected_apix"] < 0
    assert result["projected_apix"] == 0
    assert result["outside_model_domain"] is True
    assert result["validity_warning"]


def test_proxy_engines_disclose_their_basis_and_confidence_adjustment():
    competition = compute_route_competition(
        [
            {
                "origin": "DEL",
                "destination": "BOM",
                "airline": "SA1",
                "total_fare": 5000,
            }
        ]
    )[0]
    vulnerability = compute_vulnerability(
        [{"lead_bucket": "D00_03", "total_fare": 5000}], []
    )[0]

    assert competition["concentration_measure"] == "observation_share_hhi_proxy"
    assert competition["market_share_data_available"] is False
    assert vulnerability["score_basis"] == (
        "heuristic_signal_discounted_for_sample_size"
    )
    assert vulnerability["unadjusted_signal_score"] >= (
        vulnerability["vulnerability_score"]
    )


def test_alert_reason_codes_reuse_the_event_engine_windows():
    reason = assign_reason_code(
        {
            "direction": "spike",
            "cell_observations": 30,
            "lead_bucket": "D15_30",
            "travel_date": "2026-10-12",
        },
        route_carrier_count=4,
        route_flagged_carriers=2,
    )
    assert reason == "FESTIVAL_PATTERN"


def test_fairness_does_not_fabricate_an_index_without_comparability_fields():
    metro = compute_fairness(
        [{"origin": "DEL", "destination": "BOM", "total_fare": 5000}], []
    )[0]

    assert metro["index_value"] is None
    assert metro["index_change_pct"] is None
    assert metro["relative_to_basket_pts"] is None
    assert metro["fare_pressure"] is None


def test_export_is_standard_csv_and_round_trips_into_a_separate_source():
    loaded = client.post("/api/admin/load-sample")
    assert loaded.status_code == 200

    exported = client.get(
        "/api/export/observations.csv",
        params={"origin": "DEL", "destination": "BOM", "airline": "SA1"},
    )
    assert exported.status_code == 200
    assert not exported.text.startswith("#")
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert rows
    assert exported.headers["x-farepulse-dataset-mode"] == "demo"

    imported = client.post(
        "/api/admin/upload",
        files={
            "file": (
                "farepulse-roundtrip.csv",
                exported.content,
                "text/csv",
            )
        },
    )
    assert imported.status_code == 200
    assert imported.json()["accepted_count"] == len(rows)
    assert imported.json()["quarantined_count"] == 0

    version = client.get("/api/version").json()
    assert version["active_analysis_source"] == "imported"
    assert version["stored_dataset"]["dataset_mode"] == "hybrid"


def test_batch_history_separates_stored_rows_from_live_rows():
    assert client.post("/api/admin/load-sample").status_code == 200
    batch = client.get("/api/admin/batches").json()["batches"][0]

    assert batch["stored_rows"] == 23_558
    assert batch["live_rows"] == 0


def test_corrupt_sample_cannot_erase_existing_data(tmp_path, monkeypatch):
    assert client.post("/api/admin/load-sample").status_code == 200
    before = client.get("/api/admin/observations", params={"limit": 1}).json()[
        "total"
    ]
    corrupt_sample = tmp_path / "sample_airfares.csv"
    corrupt_sample.write_text(
        "origin,destination,airline,travel_date,quote_date,fare_class,"
        "base_fare,taxes_fees\n"
    )
    monkeypatch.setattr(main_module, "SAMPLE_CSV", corrupt_sample)

    response = client.post("/api/admin/load-sample")

    assert response.status_code == 500
    after = client.get("/api/admin/observations", params={"limit": 1}).json()[
        "total"
    ]
    assert after == before


def test_observation_pagination_rejects_negative_offsets():
    response = client.get("/api/admin/observations", params={"offset": -1})
    assert response.status_code == 422


def test_upload_accepts_utf8_bom_from_spreadsheet_exports():
    client.delete("/api/admin/data")
    csv_text = (
        "\ufefforigin,destination,airline,travel_date,quote_date,fare_class,"
        "base_fare,taxes_fees\n"
        "DEL,BOM,SA1,2026-10-20,2026-10-01,ECONOMY_SAVER,4000,840\n"
    )
    response = client.post(
        "/api/admin/upload",
        files={"file": ("bom.csv", csv_text.encode("utf-8"), "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["accepted_count"] == 1
    assert response.json()["quarantined_count"] == 0


def test_legacy_observation_uniqueness_migrates_without_data_loss():
    current_schema = SCHEMA_PATH.read_text()
    legacy_constraint = "UNIQUE (origin, destination, airline, fare_class, travel_date, quote_date)"
    # Build the old inline key from the current schema. New live/nonlive partial
    # indexes are absent in legacy databases.
    legacy_schema = current_schema.replace("\n);", ",\n  " + legacy_constraint + "\n);", 1)
    start = legacy_schema.index("-- Preserve CSV/demo natural keys")
    end = legacy_schema.index("-- The comparability cell", start)
    legacy_schema = legacy_schema[:start] + legacy_schema[end:]
    assert legacy_schema != current_schema

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(legacy_schema)
    values = (
        "DEL",
        "BOM",
        "SA1",
        "2026-10-20",
        "2026-10-01",
        19,
        "D15_30",
        "ECONOMY_SAVER",
        4000,
        840,
        4840,
        "batch-demo",
        "demo",
    )
    columns = (
        "origin, destination, airline, travel_date, quote_date, lead_days, "
        "lead_bucket, fare_class, base_fare, taxes_fees, total_fare, "
        "source_batch_id, source_type"
    )
    placeholders = ", ".join("?" for _ in values)
    conn.execute(
        f"INSERT INTO observations ({columns}) VALUES ({placeholders})",
        values,
    )

    assert _migrate_observation_source_uniqueness(conn, current_schema) is True
    conn.execute(
        f"INSERT INTO observations ({columns}) VALUES ({placeholders})",
        (*values[:-1], "imported"),
    )

    rows = conn.execute(
        "SELECT source_type FROM observations ORDER BY source_type"
    ).fetchall()
    assert [row["source_type"] for row in rows] == ["demo", "imported"]


def test_migrations_do_not_swallow_unexpected_sqlite_errors():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    with pytest.raises(sqlite3.OperationalError, match="no such table"):
        _run_migrations(conn)


class _TokenResponse:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return b"{}"


def test_provider_rejects_auth_response_without_token(monkeypatch):
    monkeypatch.setattr(settings, "amadeus_client_id", "client-id")
    monkeypatch.setattr(settings, "amadeus_client_secret", "client-secret")
    monkeypatch.setattr(urllib.request, "urlopen", lambda *_args, **_kwargs: _TokenResponse())

    with pytest.raises(ProviderError, match="no usable access token"):
        AmadeusProvider()._get_token()


def test_provider_failure_logs_never_include_credentials(monkeypatch, caplog):
    client_id = "judge-visible-client-id"
    client_secret = "judge-visible-client-secret"
    monkeypatch.setattr(settings, "amadeus_client_id", client_id)
    monkeypatch.setattr(settings, "amadeus_client_secret", client_secret)

    def fail_request(*_args, **_kwargs):
        raise OSError("network unavailable")

    monkeypatch.setattr(urllib.request, "urlopen", fail_request)
    with pytest.raises(ProviderError):
        AmadeusProvider()._get_token()

    assert client_id not in caplog.text
    assert client_secret not in caplog.text
