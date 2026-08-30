"""
Fare spike detection — robust z-score on log fares within each comparability cell.

Aligned with monograph §8.3 and §20.3:

  WITHIN A CELL. A fare is only compared against fares for the same route,
  carrier, fare class and booking lead-time bucket.

  ON LOG FARES. Fare moves are proportional. Taking logs makes a doubling of
  a ₹3,000 fare the same size as a doubling of a ₹30,000 fare.

  MEDIAN AND MAD, NOT MEAN AND STDDEV. A single extreme fare inflates a
  standard deviation enough to hide inside it. The median and MAD are
  unmoved by outliers.

  robust_z = 0.6745 × ( ln(fare) − median(ln fare) ) / MAD

  A fare is flagged only when BOTH its robust z exceeds the threshold AND
  it deviates at least 25% from its cell median — statistical significance
  alone would surface moves too small for an analyst's attention.
"""
import math
import statistics
from collections import defaultdict

from app.model import ROUTE_BASKET, cell_key, lead_bucket_label, route_weight

THRESHOLD = 3.5
MIN_PCT_DEVIATION = 25.0
# Minimum observations per cell for robust statistics. Below 8, more than 50%
# of values can be tied at the median, making MAD = 0 and z-scores undefined.
MIN_CELL_OBSERVATIONS = 8

# ─── Case file classification ────────────────────────────────────────────────


def classify_severity(abs_z: float, abs_pct: float) -> str:
    """Watch / Review / Escalate, based on z-score magnitude and % deviation."""
    if abs_z >= 7.0 or abs_pct >= 100.0:
        return "Escalate"
    if abs_z >= 5.0 or abs_pct >= 50.0:
        return "Review"
    return "Watch"


def classify_confidence(cell_observations: int) -> str:
    """Low / Medium / High, based on how many observations the cell statistic rests on."""
    if cell_observations >= 30:
        return "High"
    if cell_observations >= 15:
        return "Medium"
    return "Low"


# ─── Reason codes ────────────────────────────────────────────────────────────
# Deterministic rules evaluated in priority order. Each rule inspects the
# observation and its cell context — no ML, no black boxes, fully reproducible.

# Festive date ranges that produce predictable surges.
FESTIVAL_WINDOWS = [
    # (start, end, label)
    ("10-17", "10-27", "Diwali/Dussehra"),
    ("12-20", "12-31", "Christmas/New Year"),
    ("03-25", "03-31", "Holi"),
    ("08-10", "08-20", "Independence Day"),
]

REASON_GLOSSARY = {
    "LEAD_TIME_SURGE": "Last-minute booking (0–3 days) where the short lead time is the dominant price driver.",
    "FESTIVAL_PATTERN": "Travel date falls in a known festive/holiday window that produces predictable fare surges.",
    "CARRIER_SPECIFIC_SPIKE": "The anomaly is isolated to one carrier while others on the same route are normal.",
    "LOW_COMPETITION_ROUTE": "Route has ≤ 2 active carriers, limiting competitive pressure on fares.",
    "ROUTE_LEVEL_SPIKE": "Multiple carriers on this route show elevated fares in the same period.",
    "FARE_DROP_OUTLIER": "Fare is significantly below its cell median — possible promotional pricing or data error.",
    "LOW_COVERAGE_WARNING": "Cell has fewer than 15 observations; the statistical baseline may be unreliable.",
}


def _is_festival_travel(travel_date: str) -> str | None:
    """Return festival label if travel_date falls in a festive window, else None."""
    md = travel_date[5:]  # "YYYY-MM-DD" → "MM-DD"
    for start, end, label in FESTIVAL_WINDOWS:
        if start <= md <= end:
            return label
    return None


def assign_reason_code(
    spike: dict,
    *,
    route_carrier_count: int,
    route_flagged_carriers: int,
) -> str:
    """Assign the single most explanatory reason code for a flagged observation.

    Rules are evaluated in priority order — the first match wins.
    All inputs are derived from the observation and its cell context.
    """
    direction = spike["direction"]

    # 1. Drops get their own code immediately.
    if direction == "drop":
        return "FARE_DROP_OUTLIER"

    # 2. Low-coverage cells: the flag itself may be unreliable.
    if spike["cell_observations"] < 15:
        return "LOW_COVERAGE_WARNING"

    # 3. Last-minute bookings (0–3 day bucket) are the strongest price driver.
    if spike["lead_bucket"] == "D00_03":
        return "LEAD_TIME_SURGE"

    # 4. Festive travel dates.
    if _is_festival_travel(spike["travel_date"]):
        return "FESTIVAL_PATTERN"

    # 5. Carrier-specific: only this carrier is spiking on the route.
    if route_carrier_count >= 2 and route_flagged_carriers == 1:
        return "CARRIER_SPECIFIC_SPIKE"

    # 6. Low-competition route (≤ 2 carriers).
    if route_carrier_count <= 2:
        return "LOW_COMPETITION_ROUTE"

    # 7. Broad route-level spike (multiple carriers flagged).
    return "ROUTE_LEVEL_SPIKE"


def explain_spike(spike: dict) -> str:
    """One-sentence plain-English explanation for a judge or analyst."""
    direction_word = "above" if spike["direction"] == "spike" else "below"
    verb = "higher" if spike["direction"] == "spike" else "lower"

    base = (
        f"This {spike['fare_class'].replace('_', ' ').title()} fare on "
        f"{spike['route']} ({spike['airline']}, booked {spike['lead_bucket_label']}) "
        f"is ₹{round(spike['total_fare']):,} — "
        f"{abs(spike['pct_above_median']):.0f}% {direction_word} the cell median of "
        f"₹{round(spike['cell_median_fare']):,}. "
        f"Its robust z-score of {spike['robust_z']:+.1f} "
        f"places it {abs(spike['robust_z']):.1f} standard deviations {verb} "
        f"than typical fares in this cell ({spike['cell_observations']} observations)."
    )

    reason_detail = {
        "LEAD_TIME_SURGE": " The 0–3 day booking window is the strongest price driver — last-minute scarcity is the likely cause.",
        "FESTIVAL_PATTERN": f" Travel date {spike['travel_date']} falls in a festive/holiday window when demand surges are expected.",
        "CARRIER_SPECIFIC_SPIKE": f" This spike is isolated to {spike['airline']} — other carriers on {spike['route']} are pricing normally.",
        "LOW_COMPETITION_ROUTE": f" {spike['route']} has limited carrier competition, reducing downward price pressure.",
        "ROUTE_LEVEL_SPIKE": f" Multiple carriers on {spike['route']} show elevated fares in this period, suggesting a market-wide event.",
        "FARE_DROP_OUTLIER": " This fare is unusually low — possible promotional pricing, error, or inventory dump.",
        "LOW_COVERAGE_WARNING": f" Note: this cell has only {spike['cell_observations']} observations; the statistical baseline may be thin.",
    }
    return base + reason_detail.get(spike.get("reason_code", ""), "")


def recommend_action(severity: str, direction: str) -> str:
    """What an analyst should do next."""
    if severity == "Escalate":
        if direction == "spike":
            return "Verify with carrier or GDS feed. If confirmed, flag for regulatory review and check neighbouring routes for contagion."
        return "Confirm promotional or error pricing with carrier. Check if drop is isolated or route-wide."
    if severity == "Review":
        if direction == "spike":
            return "Cross-check against recent bookings on this route. Monitor for persistence across next 2–3 observation periods."
        return "Check if this is a flash sale or data error. Compare with same carrier on adjacent routes."
    return "Log for trend monitoring. No immediate action required unless pattern repeats."


# ─── Passenger Impact Score ─────────────────────────────────────────────────
# A decision-support indicator combining route traffic weight, fare deviation
# magnitude, booking-window urgency, detection severity and baseline confidence.
# Not an exact passenger count — clearly labelled as such in the UI.

LEAD_URGENCY: dict[str, float] = {
    "D00_03": 1.5,   # Last minute — travellers cannot easily switch
    "D04_07": 1.2,
    "D08_14": 1.0,
    "D15_30": 0.8,
    "D31_PLUS": 0.6,  # Plenty of time to shop around
}

_SEVERITY_FACTOR: dict[str, float] = {
    "Watch": 1.0,
    "Review": 1.3,
    "Escalate": 1.6,
}

_CONFIDENCE_FACTOR: dict[str, float] = {
    "Low": 0.5,
    "Medium": 0.75,
    "High": 1.0,
}


def compute_impact_score(
    route: str,
    abs_pct_deviation: float,
    lead_bucket: str,
    severity: str,
    confidence: str,
) -> int:
    """
    Passenger Impact Score (0–100).

    Formula:
        score = route_weight_pct
                × (abs_pct_deviation / 25)
                × lead_urgency
                × severity_factor
                × confidence_factor
        capped at 100, rounded to nearest integer.

    Components:
      route_weight_pct  — illustrative traffic-proportional route weight × 100
                          (DEL-BOM = 14.0, BLR-HYD = 4.0, unknown = 0)
      abs_pct / 25      — deviation normalised so 25% = 1×, 100% = 4×
      lead_urgency      — 0.6 (advance) → 1.5 (last-minute)
      severity_factor   — 1.0 (Watch) → 1.6 (Escalate)
      confidence_factor — 0.5 (Low) → 1.0 (High)
    """
    parts = route.split("-", 1)
    rw_pct = 0.0
    if len(parts) == 2:
        rw_pct = route_weight(parts[0], parts[1]) * 100.0

    raw = (
        rw_pct
        * (abs_pct_deviation / 25.0)
        * LEAD_URGENCY.get(lead_bucket, 1.0)
        * _SEVERITY_FACTOR.get(severity, 1.0)
        * _CONFIDENCE_FACTOR.get(confidence, 1.0)
    )
    return min(100, max(0, round(raw)))


def _median_abs_deviation(values: list[float], median: float) -> float:
    return statistics.median([abs(v - median) for v in values])


def detect_spikes(
    observations: list[dict],
    threshold: float = THRESHOLD,
    min_pct_deviation: float = MIN_PCT_DEVIATION,
) -> list[dict]:
    """Returns flagged observations, most extreme first."""
    by_cell: dict[tuple, list[dict]] = defaultdict(list)
    for obs in observations:
        by_cell[cell_key(obs)].append(obs)

    # Pre-compute carrier counts per route for reason-code assignment.
    route_carriers: dict[str, set[str]] = defaultdict(set)
    for obs in observations:
        route_carriers[f"{obs['origin']}-{obs['destination']}"].add(obs["airline"])

    # First pass: detect all flagged observations.
    raw_flagged: list[dict] = []
    for key, rows in by_cell.items():
        rows = [r for r in rows if r["total_fare"] > 0]
        if len(rows) < MIN_CELL_OBSERVATIONS:
            continue

        logs = [math.log(r["total_fare"]) for r in rows]
        median_log = statistics.median(logs)
        mad = _median_abs_deviation(logs, median_log)
        if mad == 0:
            continue

        median_fare = statistics.median([r["total_fare"] for r in rows])

        for row in rows:
            # 0.6745 = 1/Φ⁻¹(0.75): MAD-to-σ conversion for normal distribution
            # (monograph §22.2). Normalises the z-score so it reads like standard deviations.
            z = 0.6745 * (math.log(row["total_fare"]) - median_log) / mad
            pct = 100 * (row["total_fare"] - median_fare) / median_fare
            if abs(z) <= threshold or abs(pct) < min_pct_deviation:
                continue
            direction = "spike" if z > 0 else "drop"
            abs_z = abs(z)
            abs_pct = abs(pct)
            sev = classify_severity(abs_z, abs_pct)
            conf = classify_confidence(len(rows))
            impact = compute_impact_score(
                route=f"{row['origin']}-{row['destination']}",
                abs_pct_deviation=abs_pct,
                lead_bucket=row["lead_bucket"],
                severity=sev,
                confidence=conf,
            )
            entry = {
                "observation_id": row.get("id"),
                "route": f"{row['origin']}-{row['destination']}",
                "airline": row["airline"],
                "fare_class": row["fare_class"],
                "lead_bucket": row["lead_bucket"],
                "lead_bucket_label": lead_bucket_label(row["lead_bucket"]),
                "travel_date": row["travel_date"],
                "quote_date": row["quote_date"],
                "lead_days": row["lead_days"],
                "total_fare": row["total_fare"],
                "cell_median_fare": round(median_fare, 2),
                "cell_observations": len(rows),
                "pct_above_median": round(pct, 1),
                "robust_z": round(z, 2),
                "direction": direction,
                "severity": sev,
                "confidence": conf,
                "impact_score": impact,
                "reason_code": "",   # assigned in second pass
                "explanation": "",   # assigned after reason_code
                "recommended_action": recommend_action(sev, direction),
            }
            raw_flagged.append(entry)

    # Second pass: compute per-route flagged-carrier counts, then assign reason codes.
    route_flagged: dict[str, set[str]] = defaultdict(set)
    for entry in raw_flagged:
        route_flagged[entry["route"]].add(entry["airline"])

    for entry in raw_flagged:
        route = entry["route"]
        entry["reason_code"] = assign_reason_code(
            entry,
            route_carrier_count=len(route_carriers.get(route, set())),
            route_flagged_carriers=len(route_flagged.get(route, set())),
        )
        entry["explanation"] = explain_spike(entry)

    raw_flagged.sort(key=lambda r: abs(r["robust_z"]), reverse=True)
    return raw_flagged
