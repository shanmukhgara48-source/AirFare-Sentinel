"""Source-scoped, persistent regulatory review workflow for local analysts."""
import csv
import io
import json
from typing import Literal
import uuid

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from app.api.queries import fetch_observations
from app.db.database import db_session, get_active_source_type
from app.engine.anomaly import detect_spikes
from app.engine.regulatory import (
    NOTICE, POLICY, STATUSES, build_case_snapshot, canonical_json,
    case_summary, evidence_pack, grievance_summary, new_checklist, utc_now,
)

router = APIRouter(prefix="/api/review", tags=["regulatory review"])
Source = Literal["demo", "imported", "live"]
CaseStatus = Literal["New Alert", "Evidence Pending", "Analyst Review", "Airline Clarification Needed",
                     "Monitoring", "Recommended Escalation", "Closed"]
CheckId = Literal["quote_snapshot", "declared_range", "peer_airlines", "event_context", "capacity",
                  "airline_explanation", "grievance_summary", "dgca_review"]


class CreateCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observation_id: int = Field(gt=0)
    source_type: Source


class CheckUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: CheckId
    done: bool
    notes: str = Field(max_length=4000)


class UpdateCase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    status: CaseStatus | None = None
    checklist: list[CheckUpdate] = Field(default_factory=list, max_length=8)
    analyst_notes: str | None = Field(default=None, max_length=10000)


def _guard(source_type: str) -> None:
    if source_type != get_active_source_type():
        raise HTTPException(409, "Analysis source changed or is unavailable. Refresh the review queue for the active source.")


def _load(conn, case_id: str, source_type: str) -> dict:
    row = conn.execute("SELECT * FROM regulatory_cases WHERE case_id = ? AND source_type = ?",
                       (case_id, source_type)).fetchone()
    if row is None:
        raise HTTPException(404, "Case not found in the active source.")
    return dict(row)


def _case(conn, row: dict) -> dict:
    history = [{"version": entry["version"], "recorded_at": entry["recorded_at"],
                "action": entry["action"], "changes": json.loads(entry["changes_json"]),
                "actor": "Local analyst session (identity not authenticated)"}
               for entry in conn.execute("SELECT * FROM regulatory_case_history WHERE case_id = ? ORDER BY version",
                                         (row["case_id"],)).fetchall()]
    return {**json.loads(row["snapshot_json"]),
            **{key: value for key, value in row.items() if key not in {"snapshot_json", "checklist_json"}},
            "checklist": json.loads(row["checklist_json"]), "history": history}


@router.get("/queue")
def queue(offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)) -> dict:
    source = get_active_source_type()
    if not source:
        return {"source_type": None, "cases": [], "alerts": [], "eligible_alert_count": 0,
                "severe_alert_count": 0, "statuses": STATUSES, "notice": NOTICE, "policy": POLICY}
    observations = fetch_observations(source_type=source)
    with db_session() as conn:
        rows = [dict(row) for row in conn.execute(
            "SELECT * FROM regulatory_cases WHERE source_type = ? ORDER BY created_at DESC, case_id",
            (source,)).fetchall()]
        cases = [case_summary(_case(conn, row)) for row in rows]
    existing = {row["observation_id"] for row in rows}
    alerts = [alert for alert in detect_spikes(observations)
              if alert["direction"] == "spike" and alert["observation_id"] not in existing]
    return {"source_type": source, "cases": cases, "alerts": alerts[offset:offset + limit],
            "eligible_alert_count": len(alerts),
            "severe_alert_count": sum(alert["severity"] in {"Review", "Escalate"} for alert in alerts),
            "statuses": STATUSES, "notice": NOTICE, "policy": POLICY}


@router.post("/cases")
def create_case(body: CreateCase, response: Response) -> dict:
    _guard(body.source_type)
    with db_session() as conn:
        # Prevent two concurrent clicks from creating separate cases or histories.
        conn.execute("BEGIN IMMEDIATE")
        existing = conn.execute("SELECT * FROM regulatory_cases WHERE source_type = ? AND observation_id = ?",
                                (body.source_type, body.observation_id)).fetchone()
        if existing:
            return _case(conn, dict(existing))
        observation = conn.execute("SELECT * FROM observations WHERE id = ? AND source_type = ?",
                                   (body.observation_id, body.source_type)).fetchone()
        if not observation:
            raise HTTPException(404, "Observation not found in the active source.")
        observation = dict(observation)
        route_rows = [dict(row) for row in conn.execute(
            "SELECT * FROM observations WHERE source_type = ? AND origin = ? AND destination = ? ORDER BY quote_date, id",
            (body.source_type, observation["origin"], observation["destination"])).fetchall()]
        alert = next((item for item in detect_spikes(route_rows)
                      if item["observation_id"] == body.observation_id and item["direction"] == "spike"), None)
        if alert is None:
            raise HTTPException(422, "This observation is not an upward tariff anomaly at the case threshold (robust z > 3.5 and at least 25% above baseline).")
        snapshot = build_case_snapshot(observation, alert, route_rows)
        case_id = f"AFS-{uuid.uuid4().hex}"
        now = utc_now()
        conn.execute(
            "INSERT INTO regulatory_cases (case_id, observation_id, source_type, severity, status, snapshot_json, "
            "checklist_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'New Alert', ?, ?, ?, ?)",
            (case_id, body.observation_id, body.source_type, alert["severity"], canonical_json(snapshot),
             canonical_json(new_checklist()), now, now))
        conn.execute("INSERT INTO regulatory_case_history (case_id, version, recorded_at, action, changes_json) "
                     "VALUES (?, 1, ?, 'Case created from tariff anomaly', ?)",
                     (case_id, now, canonical_json({"status": "New Alert", "severity": alert["severity"],
                                                   "snapshot_sha256": snapshot["snapshot_sha256"]})))
        response.status_code = 201
        return _case(conn, _load(conn, case_id, body.source_type))


@router.get("/cases/{case_id}")
def get_case(case_id: str, source_type: Source) -> dict:
    _guard(source_type)
    with db_session() as conn:
        case = _case(conn, _load(conn, case_id, source_type))
        return {**case, "grievance_routing_summary": grievance_summary(case)}


@router.patch("/cases/{case_id}")
def update_case(case_id: str, body: UpdateCase, source_type: Source) -> dict:
    _guard(source_type)
    with db_session() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = _load(conn, case_id, source_type)
        if row["version"] != body.expected_version:
            raise HTTPException(409, "This case was updated elsewhere. Reload the case before saving.")
        checks = json.loads(row["checklist_json"])
        updates = {item.id: item for item in body.checklist}
        if len(updates) != len(body.checklist):
            raise HTTPException(422, "Checklist entries must be unique.")
        for item in checks:
            if item["id"] in updates:
                update = updates[item["id"]]
                if update.done and not update.notes.strip():
                    raise HTTPException(422, "Completed checks require an evidence reference or an explanation of unavailable evidence.")
                item.update(done=update.done, notes=update.notes.strip())
        status = body.status or row["status"]
        notes = row["analyst_notes"] if body.analyst_notes is None else body.analyst_notes.strip()
        if (checks[-1]["done"] or status == "Recommended Escalation") and not all(item["done"] for item in checks):
            raise HTTPException(422, "Document all eight government action checks before recommending escalation. Unresolved or unavailable evidence must be explained.")
        if status == "Closed" and not notes:
            raise HTTPException(422, "Add an analyst note explaining the closure or monitoring outcome.")
        changes = {}
        for key, old, new in [("status", row["status"], status),
                              ("analyst_notes", row["analyst_notes"], notes),
                              ("checklist", json.loads(row["checklist_json"]), checks)]:
            if old != new:
                changes[key] = {"before": old, "after": new}
        if changes:
            now, version = utc_now(), row["version"] + 1
            conn.execute("UPDATE regulatory_cases SET status = ?, checklist_json = ?, analyst_notes = ?, "
                         "version = ?, updated_at = ? WHERE case_id = ?",
                         (status, canonical_json(checks), notes, version, now, case_id))
            conn.execute("INSERT INTO regulatory_case_history (case_id, version, recorded_at, action, changes_json) "
                         "VALUES (?, ?, ?, 'Analyst workflow updated', ?)",
                         (case_id, version, now, canonical_json(changes)))
        case = _case(conn, _load(conn, case_id, source_type))
        return {**case, "grievance_routing_summary": grievance_summary(case)}


@router.get("/cases/{case_id}/evidence")
def download_evidence(case_id: str, source_type: Source) -> Response:
    case = get_case(case_id, source_type)
    # The generated summary is not part of the original frozen snapshot.
    case.pop("grievance_routing_summary", None)
    return Response(json.dumps(evidence_pack(case), indent=2, ensure_ascii=False), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{case_id}-evidence.json"'})


def _csv_safe(value):
    if isinstance(value, (list, dict)):
        return canonical_json(value)
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


@router.get("/cases/{case_id}/export")
def export_case(case_id: str, source_type: Source, format: Literal["json", "csv"] = "json") -> Response:
    case = get_case(case_id, source_type)
    summary = {**case_summary(case), "grievance_routing_summary": case["grievance_routing_summary"]}
    if format == "csv":
        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=list(summary))
        writer.writeheader()
        writer.writerow({key: _csv_safe(value) for key, value in summary.items()})
        content, media_type = buffer.getvalue(), "text/csv"
    else:
        content, media_type = json.dumps(summary, indent=2, ensure_ascii=False), "application/json"
    return Response(content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{case_id}-summary.{format}"'})
