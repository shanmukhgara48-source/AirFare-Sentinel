"""
What-If Scenario Simulator — projection formula.

Transparent, deterministic formula for projecting how changes in demand,
fuel cost, seat capacity, and competition could affect the airfare index.

This is a scenario-planning tool, NOT a forecast.  Projections use
simplified elasticity coefficients and are intended to explore the
directional sensitivity of the index to market-structure changes.
They do not predict real future fares.

Formula
-------
    projected_change_pct = (
        DEMAND_ELASTICITY   × demand_change_pct
      + FUEL_PASSTHROUGH    × fuel_change_pct
      + CAPACITY_ELASTICITY × capacity_change_pct
      + competition_adjustment(carriers)
    )

    competition_adjustment(n) = COMPETITION_SCALE × ln(BASELINE_CARRIERS / max(1, n))

    projected_apix  = baseline_apix × (1 + projected_change_pct / 100)
    impact_score    = min(100, |projected_change_pct| × 3)

Coefficients
------------
DEMAND_ELASTICITY   = 0.60
    Illustrative assumption: a 1 % demand increase contributes 0.60
    percentage points of upward fare pressure.

FUEL_PASSTHROUGH    = 0.35
    Illustrative assumption: a 1 % fuel-cost increase contributes 0.35
    percentage points of upward fare pressure.

CAPACITY_ELASTICITY = −0.50
    Illustrative assumption: a 1 % seat-capacity increase contributes 0.50
    percentage points of downward fare pressure.

COMPETITION_SCALE   = 15.0
BASELINE_CARRIERS   = 4
    competition_adjustment(n) = 15 × ln(4 / max(1, n)).
    This is an explicit prototype scale, not an estimated market coefficient.
    At baseline (4 carriers): 0 pp adjustment.
    Monopoly (1 carrier):     ≈ +20.8 pp (concentration premium).
    Eight carriers:            ≈ −10.4 pp (competitive relief).

Risk levels
-----------
    |projected_change_pct| <  5 % → Low
    5 %  ≤ … < 15 %            → Watch
    15 % ≤ … < 30 %            → Review
    ≥ 30 %                     → Escalate
"""
import math

# ── Coefficients ──────────────────────────────────────────────────────────────

DEMAND_ELASTICITY   =  0.60
FUEL_PASSTHROUGH    =  0.35
CAPACITY_ELASTICITY = -0.50
COMPETITION_SCALE   = 15.0
BASELINE_CARRIERS   = 4

# ── Impact score multiplier ───────────────────────────────────────────────────
# 3× means a ±33.3 % index change saturates the 0–100 impact scale.
IMPACT_MULTIPLIER = 3.0

# ── Risk thresholds (inclusive lower bound, exclusive upper) ──────────────────
_RISK_BANDS = [(5.0, "Low"), (15.0, "Watch"), (30.0, "Review")]


# ── Public API ────────────────────────────────────────────────────────────────

def competition_adjustment(carriers: int) -> float:
    """
    Percentage-point adjustment from a change in the number of active carriers.

    Parameters
    ----------
    carriers : int  (clamped to ≥ 1 internally)

    Returns
    -------
    float — positive means higher fare pressure (fewer carriers than baseline),
             negative means fare relief (more carriers than baseline),
             zero at baseline (4 carriers).
    """
    c = max(1, int(carriers))
    return round(COMPETITION_SCALE * math.log(BASELINE_CARRIERS / c), 4)


def risk_level(abs_change_pct: float) -> str:
    """Map an absolute projected change to a risk label."""
    for threshold, label in _RISK_BANDS:
        if abs_change_pct < threshold:
            return label
    return "Escalate"


def project(
    demand_change_pct:   float,
    fuel_change_pct:     float,
    capacity_change_pct: float,
    carriers:            int,
    baseline_apix:       float = 100.0,
) -> dict:
    """
    Project airfare index change given four market-factor inputs.

    Parameters
    ----------
    demand_change_pct:
        Percentage change in passenger demand.  Positive = more demand.
    fuel_change_pct:
        Percentage change in jet-fuel cost.  Positive = higher costs.
    capacity_change_pct:
        Percentage change in available seat capacity.  Positive = more seats.
    carriers:
        Number of active carriers in the market segment.
    baseline_apix:
        Starting index value (default 100.0).

    Returns
    -------
    dict with:
        demand_contribution      float  (percentage points)
        fuel_contribution        float  (percentage points)
        capacity_contribution    float  (percentage points)
        competition_contribution float  (percentage points)
        projected_change_pct     float  (sum of all contributions)
        projected_apix           float  (baseline × (1 + change/100))
        impact_score             float  (0–100)
        risk_level               str    ("Low" | "Watch" | "Review" | "Escalate")
        explanation              str    (plain-English summary)
    """
    demand_contrib      = round(DEMAND_ELASTICITY   * demand_change_pct,   4)
    fuel_contrib        = round(FUEL_PASSTHROUGH    * fuel_change_pct,     4)
    capacity_contrib    = round(CAPACITY_ELASTICITY * capacity_change_pct, 4)
    competition_contrib = competition_adjustment(carriers)

    projected_change = round(
        demand_contrib + fuel_contrib + capacity_contrib + competition_contrib, 2
    )
    projected_apix = round(baseline_apix * (1 + projected_change / 100), 2)
    impact_score   = round(min(100.0, max(0.0, abs(projected_change) * IMPACT_MULTIPLIER)), 1)
    risk           = risk_level(abs(projected_change))

    explanation = _build_explanation(
        demand_change_pct, fuel_change_pct, capacity_change_pct,
        carriers, demand_contrib, fuel_contrib, capacity_contrib,
        competition_contrib, projected_change, risk,
    )

    return {
        "demand_contribution":      demand_contrib,
        "fuel_contribution":        fuel_contrib,
        "capacity_contribution":    capacity_contrib,
        "competition_contribution": competition_contrib,
        "projected_change_pct":     projected_change,
        "projected_apix":           projected_apix,
        "impact_score":             impact_score,
        "risk_level":               risk,
        "explanation":              explanation,
    }


# ── Private helpers ───────────────────────────────────────────────────────────

def _signed(val: float, unit: str = "%") -> str:
    sign = "+" if val >= 0 else ""
    return f"{sign}{val:.1f}{unit}"


def _build_explanation(
    demand_pct: float,
    fuel_pct: float,
    capacity_pct: float,
    carriers: int,
    demand_contrib: float,
    fuel_contrib: float,
    capacity_contrib: float,
    competition_contrib: float,
    projected_change: float,
    risk: str,
) -> str:
    parts: list[str] = []

    # Demand
    if abs(demand_pct) >= 1.0:
        direction = "increases" if demand_pct > 0 else "decreases"
        effect = "adding" if demand_contrib > 0 else "subtracting"
        parts.append(
            f"Passenger demand {direction} by {abs(demand_pct):.0f}%, "
            f"{effect} {abs(demand_contrib):.1f} percentage points to the index."
        )

    # Fuel
    if abs(fuel_pct) >= 1.0:
        direction = "rise" if fuel_pct > 0 else "fall"
        effect = "adding" if fuel_contrib > 0 else "reducing"
        parts.append(
            f"Fuel costs {direction} by {abs(fuel_pct):.0f}%, "
            f"{effect} {abs(fuel_contrib):.1f} points via cost pass-through."
        )

    # Capacity
    if abs(capacity_pct) >= 1.0:
        direction = "expands" if capacity_pct > 0 else "contracts"
        effect = "relieving" if capacity_contrib < 0 else "adding"
        pts = abs(capacity_contrib)
        parts.append(
            f"Seat capacity {direction} by {abs(capacity_pct):.0f}%, "
            f"{effect} {pts:.1f} points of fare pressure."
        )

    # Competition
    c = max(1, int(carriers))
    if c < BASELINE_CARRIERS:
        parts.append(
            f"With {c} active carrier{'s' if c > 1 else ''} (below the {BASELINE_CARRIERS}-carrier "
            f"baseline), reduced competition adds {abs(competition_contrib):.1f} points."
        )
    elif c > BASELINE_CARRIERS:
        parts.append(
            f"With {c} active carriers (above the {BASELINE_CARRIERS}-carrier baseline), "
            f"stronger competition reduces pressure by {abs(competition_contrib):.1f} points."
        )

    # Summary
    direction_word = "increase" if projected_change > 0 else "decrease"
    if abs(projected_change) < 0.5:
        summary = (
            "The scenario factors largely offset each other — "
            "the net projected change is near zero."
        )
    else:
        summary = (
            f"Net projected index change: {_signed(projected_change, ' pp')}. "
            f"This {direction_word} triggers a {risk} alert."
        )
    parts.append(summary)

    return "  ".join(parts) if parts else "No significant market changes in this scenario."
