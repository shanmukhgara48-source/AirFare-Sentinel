"""Regulatory review: evidence integrity, workflow and source isolation."""
import csv
from datetime import date, timedelta
import io
import json

from fastapi.testclient import TestClient
import pytest

from app.config import settings
from app.db import database
from app.db.database import db_session, init_db, reset_db, set_active_source_type
from app.engine.anomaly import classify_severity
from app.engine.regulatory import fingerprint
from app.main import app


@pytest.fixture
def review_data(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "review.db")
    monkeypatch.setattr(settings, "live_only", False)
    init_db()
    ids = {}
    with db_session() as conn:
        for source, multiplier in [("demo", 1), ("imported", 2), ("live", 3)]:
            batch = f"batch-{source}"
            conn.execute("INSERT INTO ingestion_batches (batch_id, accepted_count, quarantined_count) VALUES (?, 14, 0)", (batch,))
            def insert(fare, day, airline="TEST", fare_class="ECONOMY_SAVER", travel_override=None):
                quote = date(2026, 8, 1) + timedelta(days=day)
                travel = quote + timedelta(days=20)
                cursor = conn.execute(
                    "INSERT INTO observations (origin, destination, airline, travel_date, quote_date, lead_days, lead_bucket, "
                    "fare_class, base_fare, taxes_fees, total_fare, source_batch_id, source_type, provider, offer_id, flight_number, price_status) "
                    "VALUES ('DEL', 'BOM', ?, ?, ?, 20, 'D15_30', ?, ?, 0, ?, ?, ?, ?, ?, 'TEST001', 'observed')",
                    (airline, travel_override or travel.isoformat(), quote.isoformat(), fare_class,
                     fare * multiplier, fare * multiplier, batch, source, f"provider-{source}", f"offer-{source}-{day}-{airline}-{fare_class}"))
                return cursor.lastrowid
            normal = [insert(fare, i) for i, fare in enumerate([4800, 4900, 5000, 5050, 5100, 5150, 5200, 5250, 5300, 16000])]
            peer = insert(6000, 9, airline="PEER")
            insert(800, 8, airline="OLD", travel_override="2026-08-30")  # different quote date
            insert(900, 9, airline="CLASS", fare_class="BUSINESS")
            drop = insert(600, 10)
            ids[source] = {"spike": normal[-1], "normal": normal[3], "peer": peer, "drop": drop}
    set_active_source_type("demo")
    return TestClient(app), ids


def create(client, observation_id, source="demo"):
    response = client.post("/api/review/cases", json={"observation_id": observation_id, "source_type": source})
    assert response.status_code == 201, response.text
    return response.json()


def path(item, suffix=""):
    return f"/api/review/cases/{item['case_id']}{suffix}?source_type={item['source_type']}"


@pytest.mark.parametrize("z,pct,expected", [(3.51, 25, "Watch"), (4.99, 49.9, "Watch"), (5, 25, "Review"),
    (4, 50, "Review"), (6.99, 99.9, "Review"), (7, 25, "Escalate"), (4, 100, "Escalate")])
def test_severity_boundaries_are_priorities(z, pct, expected):
    assert classify_severity(z, pct) == expected


def test_severe_alert_creates_persistent_idempotent_case(review_data):
    client, ids = review_data
    queue = client.get("/api/review/queue").json()
    assert queue["source_type"] == "demo" and queue["severe_alert_count"] >= 1
    assert all(alert["direction"] == "spike" for alert in queue["alerts"])
    item = create(client, ids["demo"]["spike"])
    assert item["severity"] == "Escalate" and item["status"] == "New Alert"
    assert item["route"] == "DEL-BOM" and item["airline"] == "TEST"
    assert item["observed_fare"] == 16000 and item["percent_above_baseline"] > 100
    assert item["baseline_median_fare"] == 5100 and item["provider"] == "provider-demo"
    assert len(item["checklist"]) == 8 and not any(check["done"] for check in item["checklist"])
    repeated = client.post("/api/review/cases", json={"observation_id": ids["demo"]["spike"], "source_type": "demo"})
    assert repeated.status_code == 200 and repeated.json()["case_id"] == item["case_id"]
    init_db()
    stored = client.get(path(item)).json()
    assert stored["snapshot_sha256"] == item["snapshot_sha256"] and len(stored["history"]) == 1
    queue = client.get("/api/review/queue").json()
    assert len(queue["cases"]) == 1
    assert ids["demo"]["spike"] not in [alert["observation_id"] for alert in queue["alerts"]]
    assert queue["cases"][0]["why_flagged"]


@pytest.mark.parametrize("kind", ["normal", "drop"])
def test_non_upward_or_normal_observation_cannot_create_case(review_data, kind):
    client, ids = review_data
    response = client.post("/api/review/cases", json={"observation_id": ids["demo"][kind], "source_type": "demo"})
    assert response.status_code == 422
    assert client.get("/api/review/queue").json()["cases"] == []


def test_sparse_live_history_has_no_manufactured_case(review_data):
    client, ids = review_data
    set_active_source_type("live")
    with db_session() as conn:
        conn.execute("DELETE FROM observations WHERE source_type = 'live' AND id <> ?", (ids["live"]["spike"],))
    assert client.get("/api/review/queue").json()["alerts"] == []
    assert client.post("/api/review/cases", json={"observation_id": ids["live"]["spike"], "source_type": "live"}).status_code == 422


def test_evidence_pack_is_frozen_and_fingerprints_verifiable(review_data):
    client, ids = review_data
    item = create(client, ids["demo"]["spike"])
    first = client.get(path(item, "/evidence"))
    assert first.status_code == 200 and 'attachment;' in first.headers["content-disposition"]
    pack = first.json()
    digest = pack.pop("pack_sha256")
    assert fingerprint(pack) == digest
    frozen = pack["frozen_snapshot"].copy()
    snapshot_digest = frozen.pop("snapshot_sha256")
    assert fingerprint(frozen) == snapshot_digest == item["snapshot_sha256"]
    assert pack["summary"]["why_flagged"]
    assert pack["quote_snapshot"]["offer_id"] == "offer-demo-9-TEST-ECONOMY_SAVER"
    assert {row["source_type"] for row in pack["baseline_observations"] + pack["peer_observations"]} == {"demo"}
    assert pack["summary"]["audit"]["source_types"] == ["demo"]
    assert pack["summary"]["peer_airline_comparison"][0]["airline"] == "PEER"
    assert pack["summary"]["peer_airline_comparison"][0]["median_fare"] == 6000
    assert len(pack["peer_observations"]) == 1
    with db_session() as conn:
        conn.execute("UPDATE observations SET total_fare = 40000, provider = 'changed' WHERE id = ?", (ids["demo"]["spike"],))
    later = client.get(path(item, "/evidence")).json()
    assert later["frozen_snapshot"] == pack["frozen_snapshot"]
    assert later["quote_snapshot"]["total_fare"] == 16000
    assert "Decision support, not a legal finding" in later["decision_support_notice"]
    assert "SYNTHETIC DEMO EXERCISE" in later["grievance_routing_summary"]
    assert "No submission has been made" in later["grievance_routing_summary"]


def test_missing_peers_are_reported_without_source_fallback(review_data):
    client, ids = review_data
    with db_session() as conn:
        conn.execute("DELETE FROM observations WHERE id = ?", (ids["demo"]["peer"],))
    item = create(client, ids["demo"]["spike"])
    assert item["peer_airline_comparison"] == []
    assert "No matched peer quotes" in client.get(path(item)).json()["grievance_routing_summary"]


def test_source_isolation_on_create_read_update_and_download(review_data):
    client, ids = review_data
    demo = create(client, ids["demo"]["spike"])
    for source in ("imported", "live"):
        assert client.post("/api/review/cases", json={"observation_id": ids[source]["spike"], "source_type": source}).status_code == 409
        assert client.post("/api/review/cases", json={"observation_id": ids[source]["spike"], "source_type": "demo"}).status_code == 404
        set_active_source_type(source)
        assert client.get("/api/review/queue").json()["cases"] == []
        for suffix in ("", "/evidence", "/export"):
            assert client.get(path(demo, suffix)).status_code == 409
        assert client.get(path(demo, "/export") + "&format=csv").status_code == 409
        assert client.patch(path(demo), json={"expected_version": 1, "status": "Monitoring"}).status_code == 409
        assert client.get(path(demo).replace("source_type=demo", f"source_type={source}")).status_code == 404
        case = create(client, ids[source]["spike"], source)
        evidence = client.get(path(case, "/evidence")).json()
        assert evidence["summary"]["provider"] == f"provider-{source}"
        assert evidence["summary"]["audit"]["source_types"] == [source]
        assert all(row["source_type"] == source for row in evidence["baseline_observations"] + evidence["peer_observations"])
        assert "SYNTHETIC DEMO EXERCISE" not in evidence["grievance_routing_summary"]
        set_active_source_type("demo")
    assert len(client.get("/api/review/queue").json()["cases"]) == 1


def test_live_only_never_exposes_saved_demo_cases(review_data, monkeypatch):
    client, ids = review_data
    item = create(client, ids["demo"]["spike"])
    monkeypatch.setattr(settings, "live_only", True)
    assert client.get("/api/review/queue").json()["source_type"] == "live"
    assert client.get("/api/review/queue").json()["cases"] == []
    assert client.get(path(item)).status_code == 409


def test_workflow_validates_notes_statuses_and_optimistic_versions(review_data):
    client, ids = review_data
    item = create(client, ids["demo"]["spike"])
    url = path(item)
    for invalid in [{"status": "Recommended Escalation"}, {"status": "Closed"}, {"status": "Violation proven"},
                    {"severity": "Escalate"}, {"checklist": [{"id": "quote_snapshot", "done": True, "notes": " "}]}]:
        assert client.patch(url, json={"expected_version": 1, **invalid}).status_code == 422
    duplicate = [{"id": "quote_snapshot", "done": False, "notes": ""}] * 2
    assert client.patch(url, json={"expected_version": 1, "checklist": duplicate}).status_code == 422
    for version, status in enumerate(["Evidence Pending", "Analyst Review", "Airline Clarification Needed", "Monitoring"], start=1):
        result = client.patch(url, json={"expected_version": version, "status": status})
        assert result.status_code == 200 and result.json()["version"] == version + 1
    assert client.patch(url, json={"expected_version": 1, "status": "New Alert"}).status_code == 409
    assert client.get(url).json()["status"] == "Monitoring"
    checks = [{"id": check["id"], "done": True, "notes": "Analyst test reference; unresolved details documented."} for check in item["checklist"]]
    result = client.patch(url, json={"expected_version": 5, "status": "Recommended Escalation", "checklist": checks})
    assert result.status_code == 200
    assert result.json()["severity"] == "Escalate" and result.json()["version"] == 6
    assert result.json()["snapshot_sha256"] == item["snapshot_sha256"]
    assert client.patch(url, json={"expected_version": 6, "checklist": [{"id": "quote_snapshot", "done": False, "notes": ""}]}).status_code == 422
    closed = client.patch(url, json={"expected_version": 6, "status": "Closed", "analyst_notes": "Clarification recorded; continue routine monitoring."}).json()
    assert closed["status"] == "Closed" and closed["version"] == 7 and len(closed["history"]) == 7
    assert client.patch(url, json={"expected_version": 7, "status": "Closed"}).json()["version"] == 7


def test_json_csv_exports_retain_context_and_neutral_copy(review_data):
    client, ids = review_data
    item = create(client, ids["demo"]["spike"])
    client.patch(path(item), json={"expected_version": 1, "analyst_notes": "=HYPERLINK(\"https://example.invalid\")"})
    summary = client.get(path(item, "/export")).json()
    response = client.get(path(item, "/export") + "&format=csv")
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/csv")
    record = list(csv.DictReader(io.StringIO(response.text)))[0]
    for key in ("route", "airline", "travel_date", "quote_date", "lead_bucket", "fare_class", "source_type", "provider", "snapshot_sha256"):
        assert record[key] == str(summary[key])
    assert json.loads(record["peer_airline_comparison"]) == summary["peer_airline_comparison"]
    assert record["analyst_notes"].startswith("'=")
    assert "Decision support, not a legal finding" in record["decision_support_notice"]
    assert summary["status"] == "New Alert"
    assert "Analyst-recorded evidence notes" in summary["grievance_routing_summary"]
    assert client.get(path(item, "/export") + "&format=pdf").status_code == 422
    assert client.get(f"/api/review/cases/{item['case_id']}/evidence").status_code == 422


def test_reset_clears_case_history_and_stale_observation_references(review_data):
    client, ids = review_data
    item = create(client, ids["demo"]["spike"])
    reset_db()
    assert client.get("/api/review/queue").json()["cases"] == []
    with db_session() as conn:
        assert conn.execute("SELECT COUNT(*) FROM regulatory_case_history").fetchone()[0] == 0
    assert client.get(path(item)).status_code == 409
