"""Decision-support case snapshots. No automated legal conclusions or submissions."""
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import statistics

from app.audit import calculation_audit
from app.engine.anomaly import MIN_CELL_OBSERVATIONS, MIN_PCT_DEVIATION, THRESHOLD
from app.model import cell_key

WORKFLOW_VERSION = "regulatory-review-1.0"
NOTICE = (
    "Decision support, not a legal finding. A tariff anomaly may indicate a possible excessive fare "
    "and requires verification; it does not establish overcharging or a Rule 135 violation. "
    "Severity is an app triage priority, not a DGCA determination."
)
STATUSES = ["New Alert", "Evidence Pending", "Analyst Review", "Airline Clarification Needed",
            "Monitoring", "Recommended Escalation", "Closed"]
CHECKLIST = [
    ("quote_snapshot", "Verify quote snapshot", "Record the original quote reference, capture time, fare components and any expiry or repricing."),
    ("declared_range", "Compare against airline declared fare range", "Record the published Rule 135 fare range, URL/reference, applicable dates and class, and like-for-like tax/fee basis. The statistical baseline is not a declared range."),
    ("peer_airlines", "Compare peer airlines", "Check matched route, travel and quote dates, lead bucket and fare class. Document missing peers or product differences."),
    ("event_context", "Check event/disruption/festival context", "Verify route-specific event dates, disruptions and passenger hardship from dated sources; demo event windows are not evidence."),
    ("capacity", "Check capacity/cancellation indicators", "Record dated capacity or cancellation evidence, or explicitly document that it is unavailable. Quote counts are not seat capacity."),
    ("airline_explanation", "Request airline explanation", "Record the request reference, date, response or non-response and follow-up. This app does not contact the airline."),
    ("grievance_summary", "Prepare AirSewa/CPGRAMS-ready summary", "Review the draft, add relevant passenger/grievance references and supporting evidence before manual routing."),
    ("dgca_review", "Recommend DGCA review if unresolved", "Document unresolved questions and the basis for a regulatory review recommendation after the preceding checks."),
]
POLICY_SOURCES = [
    {"title": "MoCA: market-driven fares and Rule 135 (21 July 2022)", "url": "https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1843408"},
    {"title": "Rajya Sabha: TMU random-route monitoring (5 August 2024)", "url": "https://sansad.in/getFile/annex/265/AU1441_DS9Auu.pdf?source=pqars"},
    {"title": "Rajya Sabha: Rule 135 and selected-route monitoring (3 February 2025)", "url": "https://sansad.in/getFile/annex/267/AU28_eFPaIZ.pdf?source=pqars"},
    {"title": "Lok Sabha: airline, AirSewa and CPGRAMS grievances (6 February 2025)", "url": "https://sansad.in/getFile/loksabhaquestions/annex/184/AU570_Vf37gf.pdf?source=pqals"},
    {"title": "Rajya Sabha: festive demand and capacity (1 December 2025)", "url": "https://sansad.in/getFile/annex/269/AU27_gR0KjL.pdf?source=pqars"},
    {"title": "MoCA: intervention during disruption (6 December 2025; historical example)", "url": "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2199755"},
]
POLICY = {
    "reviewed_on": "2026-09-05",
    "summary": (
        "Airfares are normally market-driven. Airlines publish/display fare structures under Rule 135. "
        "DGCA's Tariff Monitoring Unit monitors selected/random routes. DGCA/MoCA may intervene during "
        "abnormal surges, festivals, disruptions or passenger hardship. Passenger grievances may be "
        "routed through the airline, AirSewa or CPGRAMS. Under Rule 135(4), DGCA may issue directions "
        "if it is satisfied that excessive/predatory tariffs or oligopolistic practice are established. "
        "This app's checklist and thresholds are an analytical aid, not an official government procedure. "
        "Check any date-specific government directions separately; historical emergency caps are not a standing ceiling."
    ),
    "sources": POLICY_SOURCES,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def fingerprint(value) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def new_checklist() -> list[dict]:
    return [{"id": key, "label": label, "guidance": guidance, "done": False, "notes": ""}
            for key, label, guidance in CHECKLIST]


def build_case_snapshot(observation: dict, alert: dict, route_observations: list[dict]) -> dict:
    """Freeze normalized quote and comparators from exactly one source cohort."""
    source = observation["source_type"]
    if any(row["source_type"] != source for row in route_observations):
        raise ValueError("Case evidence cannot mix source types")
    baseline = [row for row in route_observations if cell_key(row) == cell_key(observation)]
    peer_rows = [row for row in route_observations if row["airline"] != observation["airline"]
                 and all(row[key] == observation[key] for key in
                         ("origin", "destination", "travel_date", "quote_date", "lead_bucket", "fare_class"))]
    by_airline = defaultdict(list)
    for row in peer_rows:
        by_airline[row["airline"]].append(row)
    peers = []
    for airline, rows in sorted(by_airline.items()):
        median = statistics.median(row["total_fare"] for row in rows)
        peers.append({"airline": airline, "median_fare": round(median, 2), "observation_count": len(rows),
                      "percent_above_peer": round(100 * (observation["total_fare"] / median - 1), 1),
                      "source_type": source, "providers": sorted({row.get("provider") or "Not recorded" for row in rows}),
                      "observation_ids": [row["id"] for row in rows]})
    audit = calculation_audit(route_observations, "regulatory-alert-snapshot", {
        "robust_z_threshold": THRESHOLD, "min_deviation_pct": MIN_PCT_DEVIATION,
        "min_cell_observations": MIN_CELL_OBSERVATIONS,
    })
    snapshot = {
        "workflow_version": WORKFLOW_VERSION,
        "route": alert["route"], "airline": observation["airline"],
        "travel_date": observation["travel_date"], "quote_date": observation["quote_date"],
        "lead_bucket": observation["lead_bucket"], "fare_class": observation["fare_class"],
        "observed_fare": observation["total_fare"], "currency": "INR",
        "baseline_median_fare": alert["cell_median_fare"], "percent_above_baseline": alert["pct_above_median"],
        "source_type": source, "provider": observation.get("provider"),
        "source_label": alert["source_label"], "alert": alert,
        "quote_snapshot": observation, "baseline_observations": baseline,
        "peer_observations": peer_rows, "peer_airline_comparison": peers,
        "peer_comparison_basis": "Same source type, route, travel date, quote date, lead bucket and fare class; other airlines. Intraday timing and fare-product equivalence require verification.",
        "baseline_basis": "Median observed total fare in the same source, route, airline, fare class and lead bucket across available dates, including the flagged quote; not an airline-declared range or legal ceiling.",
        "evidence_limitations": [
            "Stored normalized quote only; an original provider response, screenshot or ticket is not automatically captured.",
            "Baseline dates may span different market conditions. Historical quotes are not current booking offers.",
            "Declared fare range, disruptions, festivals, capacity, cancellations and airline response require analyst evidence.",
            "Demo cases are synthetic exercises; imported data are user-supplied and require source verification.",
            "Local history and hashes support traceability, not certified custody, authentication or a tamper-proof audit.",
        ],
        "audit": audit, "decision_support_notice": NOTICE, "policy_basis": POLICY,
    }
    snapshot["snapshot_sha256"] = fingerprint(snapshot)
    return snapshot


def case_summary(case: dict) -> dict:
    fields = ("case_id", "observation_id", "route", "airline", "travel_date", "quote_date", "lead_bucket",
              "fare_class", "observed_fare", "currency", "baseline_median_fare", "percent_above_baseline",
              "peer_airline_comparison", "source_type", "provider", "source_label", "severity", "status",
              "created_at", "updated_at", "version", "snapshot_sha256", "audit", "decision_support_notice")
    return {**{key: case[key] for key in fields},
            "reason_code": case["alert"]["reason_code"], "why_flagged": case["alert"]["explanation"],
            "checklist": case["checklist"], "analyst_notes": case["analyst_notes"],
            "baseline_basis": case["baseline_basis"], "peer_comparison_basis": case["peer_comparison_basis"],
            "evidence_limitations": case["evidence_limitations"]}


def grievance_summary(case: dict) -> str:
    pending = [item["label"] for item in case["checklist"] if not item["done"]]
    peer_summary = "; ".join(f"{p['airline']}: INR {p['median_fare']:,.2f} ({p['observation_count']} quotes)"
                             for p in case["peer_airline_comparison"]) or "No matched peer quotes available"
    prefix = "SYNTHETIC DEMO EXERCISE — " if case["source_type"] == "demo" else "DRAFT FOR ANALYST REVIEW — "
    recorded_checks = "\n".join(
        f"- {item['label']} [{'documented' if item['done'] else 'pending'}]: {item['notes']}"
        for item in case["checklist"] if item["notes"]
    ) or "No analyst evidence notes recorded."
    text = (
        f"{prefix}Tariff anomaly / possible excessive fare\n"
        f"Case {case['case_id']}; workflow status: {case['status']}.\n"
        f"Route {case['route']}; airline {case['airline']}; travel {case['travel_date']}; quote {case['quote_date']}.\n"
        f"Class {case['fare_class']}; lead bucket {case['lead_bucket']}. "
        f"Observed INR {case['observed_fare']:,.2f}; baseline median INR {case['baseline_median_fare']:,.2f}; "
        f"{case['percent_above_baseline']:.1f}% above baseline.\n"
        f"Why flagged: {case['alert']['explanation']}\n"
        f"Peer comparison: {peer_summary}.\n"
        f"Source: {case['source_type']}; provider: {case['provider'] or 'Not recorded'}; "
        f"batch: {case['quote_snapshot']['source_batch_id']}.\n"
        f"Pending checks: {'; '.join(pending) or 'None marked pending; analyst assertions require verification'}.\n"
        f"Analyst-recorded evidence notes (not independently verified):\n{recorded_checks}\n"
        f"Analyst notes: {case['analyst_notes'] or 'None recorded.'}\n"
        "Requested follow-up: verify the quote and applicable published tariff, seek airline clarification, "
        "and consider DGCA review if unresolved.\n"
        f"{NOTICE}\n"
        "Manual routing only. Add relevant passenger consent, booking/grievance references, hardship details "
        "and original evidence before submitting via the airline, AirSewa or CPGRAMS. No submission has been made."
    )
    return text


def evidence_pack(case: dict) -> dict:
    pack = {"schema_version": WORKFLOW_VERSION, "generated_at": utc_now(),
            "decision_support_notice": NOTICE, "summary": case_summary(case),
            "quote_snapshot": case["quote_snapshot"],
            "baseline_observations": case["baseline_observations"], "peer_observations": case["peer_observations"],
            "snapshot_sha256": case["snapshot_sha256"],
            "frozen_snapshot": {key: value for key, value in case.items() if key not in {
                "case_id", "observation_id", "severity", "status", "checklist", "analyst_notes", "version",
                "created_at", "updated_at", "history"}},
            "history": case["history"], "policy_basis": case["policy_basis"],
            "grievance_routing_summary": grievance_summary(case)}
    pack["pack_sha256"] = fingerprint(pack)
    return pack
