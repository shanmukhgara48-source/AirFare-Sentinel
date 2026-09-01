"""
Fairness Lens — like-for-like route-category index comparison.

Aggregates within-category price-index change, anomaly frequency, and a
passenger exposure proxy across
five policy categories, plus an explicit unclassified bucket for routes whose
category metadata has not been supplied.

These signals are monitoring indicators for policy context.  Observed
differences across categories may reflect legitimate demand/supply dynamics
rather than systemic bias.  No claim of discrimination or wrongdoing is made.

Route categories (synthetic demo classification)
-------------------------------------------------
Metro              : High-frequency trunk routes between Tier-1 metro cities.
                     Typically high supply and strong competition.
Business-heavy     : Corridors dominated by corporate travel patterns.
                     Demand can be price-inelastic; CCI-monitoring interest.
Tourism-heavy      : Routes with strong seasonal leisure demand.
                     Elevated fares in event windows are expected.
Connectivity-sensitive : Routes where air is the primary long-haul option.
                     Passengers have limited transport alternatives.
Tier-2             : Routes serving smaller regional centres (not in demo dataset).
                     Lower frequency, fewer carriers — highest monitoring priority.
Unclassified       : Imported/live routes outside the prototype mapping. Kept
                     separate so they cannot distort a named policy category.
"""
import statistics
from collections import defaultdict
from typing import Literal

from app.engine.index import compute_index_timeseries

CategoryLabel = Literal[
    "Metro", "Business-heavy", "Tourism-heavy",
    "Connectivity-sensitive", "Tier-2", "Unclassified",
]

# ── Route → category mapping (synthetic demo data) ───────────────────────────
ROUTE_CATEGORIES: dict[str, str] = {
    "DEL-BOM": "Metro",
    "BOM-DEL": "Metro",
    "DEL-BLR": "Business-heavy",
    "BLR-DEL": "Business-heavy",
    "BOM-BLR": "Business-heavy",
    "BLR-BOM": "Business-heavy",
    "BLR-HYD": "Business-heavy",
    "HYD-BLR": "Business-heavy",
    "DEL-HYD": "Tourism-heavy",
    "HYD-DEL": "Tourism-heavy",
    "DEL-MAA": "Connectivity-sensitive",
    "MAA-DEL": "Connectivity-sensitive",
    "DEL-CCU": "Connectivity-sensitive",
    "CCU-DEL": "Connectivity-sensitive",
}

CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "Metro": (
        "High-frequency trunk routes between Tier-1 metro cities.  Strong competition "
        "and high capacity typically moderate fare pressure — passengers can choose "
        "across many flights and carriers."
    ),
    "Business-heavy": (
        "Corridors dominated by corporate travellers with time-sensitive itineraries.  "
        "Demand can be price-inelastic, and last-minute fares on these routes are "
        "a common focus of consumer-protection monitoring."
    ),
    "Tourism-heavy": (
        "Routes with strong seasonal leisure demand tied to festivals, holidays, and "
        "school breaks.  Elevated fares in event windows are expected; sustained "
        "elevation outside event windows is the signal to watch."
    ),
    "Connectivity-sensitive": (
        "Routes where air travel is often the primary long-haul transport option.  "
        "Passengers on these corridors face limited alternatives, making fare "
        "pressure particularly significant from an equitable-access standpoint."
    ),
    "Tier-2": (
        "Routes serving smaller regional centres with fewer flight options and "
        "carriers.  Not represented in the current synthetic dataset — would appear "
        "when real data including regional airports is loaded."
    ),
    "Unclassified": (
        "Routes not present in the prototype category mapping. They remain visible "
        "but are not assigned to a policy category until route metadata is reviewed."
    ),
}

# Fixed display order for the response.
CATEGORY_ORDER: list[str] = [
    "Metro",
    "Business-heavy",
    "Tourism-heavy",
    "Connectivity-sensitive",
    "Tier-2",
    "Unclassified",
]


def _category_for(origin: str, destination: str) -> str:
    """Return the configured category without guessing for unknown routes."""
    return ROUTE_CATEGORIES.get(f"{origin}-{destination}", "Unclassified")


def _index_summary(rows: list[dict]) -> dict:
    """Return a within-group index summary when comparability fields exist."""
    required = {
        "origin", "destination", "airline", "fare_class", "lead_bucket",
        "quote_date", "total_fare",
    }
    if not rows or any(not required.issubset(row) for row in rows):
        return {
            "index_value": 100.0,
            "index_change_pct": 0.0,
            "index_period_start": None,
            "index_period_end": None,
            "index_quality_flag": None,
        }
    series = compute_index_timeseries(rows, granularity="day", weighted=True)
    if not series:
        return {
            "index_value": None,
            "index_change_pct": None,
            "index_period_start": None,
            "index_period_end": None,
            "index_quality_flag": None,
        }
    first, latest = series[0], series[-1]
    change = (
        100 * (latest["apix_value"] - first["apix_value"]) / first["apix_value"]
        if first["apix_value"] else 0.0
    )
    return {
        "index_value": latest["apix_value"],
        "index_change_pct": round(change, 2),
        "index_period_start": first["period"],
        "index_period_end": latest["period"],
        "index_quality_flag": latest["quality_flag"],
    }


def compute_fairness(
    observations: list[dict],
    spike_cases: list[dict],
) -> list[dict]:
    """
    Aggregate fare-pressure metrics per route category.

    Parameters
    ----------
    observations:
        Each dict must contain ``origin``, ``destination``, ``total_fare``.
    spike_cases:
        Output of ``detect_spikes()`` — each dict must contain ``origin``,
        ``destination``, ``direction``, and ``exposure_proxy`` (the deprecated
        ``impact_score`` alias is also accepted).
        Only cases with ``direction == 'spike'`` count as alerts; drops are
        excluded because they represent fare relief, not pressure.

    Returns
    -------
    List of category dicts in CATEGORY_ORDER. Categories with no observations
    are included with zero/null metrics so the frontend has a stable contract.
    """
    # ── Group observations by category ───────────────────────────────────────
    observations_by_cat: dict[str, list[dict]] = defaultdict(list)
    fares_by_cat: dict[str, list[float]] = defaultdict(list)
    routes_by_cat: dict[str, set[str]] = defaultdict(set)
    for o in observations:
        cat = _category_for(o["origin"], o["destination"])
        observations_by_cat[cat].append(o)
        fares_by_cat[cat].append(float(o["total_fare"]))
        routes_by_cat[cat].add(f"{o['origin']}-{o['destination']}")

    # Only upward spikes count as fare pressure (drops = relief, not pressure).
    # Support both {origin, destination} and {route: "ORG-DST"} dict formats.
    spikes_by_cat: dict[str, list[dict]] = defaultdict(list)
    for case in spike_cases:
        if case.get("direction") == "spike":
            if "route" in case:
                origin, destination = case["route"].split("-", 1)
            else:
                origin, destination = case["origin"], case["destination"]
            cat = _category_for(origin, destination)
            spikes_by_cat[cat].append(case)

    # Compare index movement with index movement — never a category mean against
    # a median of individual fares. The basket is calculated with the same
    # cell-relative method as each category.
    basket_index = _index_summary(observations)
    basket_change = basket_index["index_change_pct"] or 0.0

    results: list[dict] = []
    for cat in CATEGORY_ORDER:
        fares = fares_by_cat.get(cat, [])
        cat_spikes = spikes_by_cat.get(cat, [])
        obs_count = len(fares)
        alert_count = len(cat_spikes)

        if obs_count == 0:
            results.append({
                "category": cat,
                "description": CATEGORY_DESCRIPTIONS[cat],
                "route_count": 0,
                "observation_count": 0,
                "avg_fare": None,
                "median_fare": None,
                "alert_count": 0,
                "alert_rate": None,
                "avg_impact_score": None,
                "avg_exposure_proxy": None,
                "index_value": None,
                "index_change_pct": None,
                "relative_to_basket_pts": None,
                "index_period_start": None,
                "index_period_end": None,
                "index_quality_flag": None,
                "fare_pressure": None,
                "routes": [],
            })
            continue

        avg_fare = statistics.mean(fares)
        median_fare = statistics.median(fares)
        alert_rate = alert_count / obs_count

        avg_exposure = (
            statistics.mean(
                c.get("exposure_proxy", c.get("impact_score", 0.0))
                for c in cat_spikes
            )
            if cat_spikes else None
        )
        index_summary = _index_summary(observations_by_cat[cat])
        category_change = index_summary["index_change_pct"] or 0.0
        relative_to_basket = round(category_change - basket_change, 2)
        if relative_to_basket > 2.0:
            fare_pressure = "High"
        elif relative_to_basket < -2.0:
            fare_pressure = "Low"
        else:
            fare_pressure = "Moderate"

        results.append({
            "category": cat,
            "description": CATEGORY_DESCRIPTIONS[cat],
            "route_count": len(routes_by_cat.get(cat, set())),
            "observation_count": obs_count,
            "avg_fare": round(avg_fare, 2),
            "median_fare": round(median_fare, 2),
            "alert_count": alert_count,
            "alert_rate": round(alert_rate, 4),
            "avg_exposure_proxy": round(avg_exposure, 1) if avg_exposure is not None else None,
            "avg_impact_score": round(avg_exposure, 1) if avg_exposure is not None else None,
            **index_summary,
            "relative_to_basket_pts": relative_to_basket,
            "fare_pressure": fare_pressure,
            "pressure_method": (
                "Category index change minus basket index change; ±2 percentage-point "
                "prototype monitoring bands."
            ),
            "routes": sorted(routes_by_cat.get(cat, set())),
        })

    return results
