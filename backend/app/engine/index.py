"""
Airfare Price Index (APIx) — Jevons elementary aggregate with Laspeyres-type
fixed-weight aggregation.

Aligned with monograph §9.1 and §20.2:

  ELEMENTARY INDEX (within each cell):
    J[c,t] = exp[ (1/n) × SUM_i ln(p[i,t] / p[i,0]) ]
    Equivalent: ratio of geometric mean current prices to geometric mean
    reference prices.

  HEADLINE INDEX (across cells):
    APIx[t] = 100 × SUM_c  W[c] × R[c,t]
    where W[c] are fixed cell expenditure/traffic weights summing to 1,
    and R[c,t] is the Jevons price relative for cell c in period t.

  This is the Laspeyres-type formula recommended by the monograph for the
  official-aligned prototype. The unweighted geometric mean (pure Jevons across
  cells) is kept as a sensitivity series.

The distinction matters: the weighted index reflects India's actual travel
patterns (more weight to DEL-BOM than to a thin regional route), while the
unweighted index treats every route-carrier-class-bucket cell equally.
"""
import math
from collections import defaultdict
from datetime import datetime

from app.model import (
    GROUP_FIELDS, ROUTE_BASKET, LEAD_BUCKET_WEIGHTS, FARE_CLASS_WEIGHTS,
    QualityFlag, cell_key, quality_flag, route_of,
)

Observation = dict

# Below this share of the known cell universe, a period's index is still
# computed but marked thin.
LOW_COVERAGE_PCT = 60.0


def compute_reference_prices(observations: list[Observation]) -> dict[tuple, float]:
    """
    Each cell's P₀ = the geometric mean of total_fare on its own earliest
    quote_date.

    Monograph §20.4: geometric base per cell, averaged across first-day
    observations. Geometric mean is used (not arithmetic) so the base is
    consistent with the Jevons form — the ratio of two geometric means is a
    geometric mean of ratios.
    """
    first_day: dict[tuple, str] = {}
    for obs in observations:
        key = cell_key(obs)
        qd = obs["quote_date"]
        if key not in first_day or qd < first_day[key]:
            first_day[key] = qd

    base_fares: dict[tuple, list[float]] = defaultdict(list)
    for obs in observations:
        key = cell_key(obs)
        if obs["quote_date"] == first_day[key] and obs["total_fare"] > 0:
            base_fares[key].append(obs["total_fare"])

    refs = {}
    for key, fares in base_fares.items():
        if not fares:
            continue
        # Geometric mean of first-day fares.
        log_sum = sum(math.log(f) for f in fares)
        refs[key] = math.exp(log_sum / len(fares))
    return refs


def _bucket_key(date_str: str, granularity: str) -> str:
    if granularity == "week":
        iso = datetime.strptime(date_str, "%Y-%m-%d").isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    return date_str


def _cell_weight(key: tuple) -> float:
    """
    Compute a cell's fixed weight from the route basket, lead-bucket and
    fare-class weight tables. Monograph §9.1: W[c] are fixed and sum to 1.
    """
    origin, destination, _airline, fare_class, lead_bucket = key
    rw = ROUTE_BASKET.get((origin, destination), (None, 0.0))[1]
    lw = LEAD_BUCKET_WEIGHTS.get(lead_bucket, 0.0)
    fw = FARE_CLASS_WEIGHTS.get(fare_class, 0.0)
    return rw * lw * fw


def compute_index_timeseries(
    observations: list[Observation],
    granularity: str = "day",
    date_field: str = "quote_date",
    weighted: bool = True,
) -> list[dict]:
    """
    Returns one row per period, sorted chronologically.

    When weighted=True: Laspeyres-type fixed-weight aggregation.
      APIx[t] = 100 × Σ W[c] × R[c,t]  (only over active cells, renormalized)

    When weighted=False: unweighted Jevons geometric mean across cells.
      APIx[t] = 100 × exp( mean( ln R[c,t] ) )

    Both are computed and returned; the `apix_value` field reflects the
    `weighted` parameter choice. The other is in `sensitivity_value`.
    """
    if not observations:
        return []

    reference = compute_reference_prices(observations)
    total_cells = len(reference)

    # Pre-compute cell weights.
    weights = {key: _cell_weight(key) for key in reference}
    total_basket_weight = sum(weights.values())

    periods: dict[str, dict[tuple, list[float]]] = defaultdict(lambda: defaultdict(list))
    for obs in observations:
        period = _bucket_key(obs[date_field], granularity)
        periods[period][cell_key(obs)].append(obs["total_fare"])

    results = []
    for period in sorted(periods):
        # Compute each active cell's price relative.
        cell_relatives: dict[tuple, float] = {}
        obs_count = 0
        for key, fares in periods[period].items():
            p0 = reference.get(key)
            if not p0:
                continue
            pos_fares = [f for f in fares if f > 0]
            if not pos_fares:
                continue
            geo_mean_current = math.exp(sum(math.log(f) for f in pos_fares) / len(pos_fares))
            cell_relatives[key] = geo_mean_current / p0
            obs_count += len(fares)

        if not cell_relatives:
            continue

        # --- Unweighted Jevons (sensitivity) ---
        log_rels = [math.log(r) for r in cell_relatives.values()]
        jevons_value = 100 * math.exp(sum(log_rels) / len(log_rels))

        # --- Weighted Laspeyres ---
        active_weight = sum(weights.get(k, 0.0) for k in cell_relatives)
        if active_weight > 0:
            # Renormalize weights over active cells so they sum to 1.
            laspeyres_value = 100 * sum(
                (weights.get(k, 0.0) / active_weight) * r
                for k, r in cell_relatives.items()
            )
        else:
            laspeyres_value = jevons_value  # fallback if no weights

        # --- Quality flag ---
        cell_coverage = 100 * len(cell_relatives) / total_cells if total_cells else 0.0
        weight_coverage = 100 * active_weight / total_basket_weight if total_basket_weight else 0.0
        qf = quality_flag(weight_coverage)

        primary = laspeyres_value if weighted else jevons_value
        secondary = jevons_value if weighted else laspeyres_value

        results.append({
            "period": period,
            "apix_value": round(primary, 2),
            "apix_weighted": round(laspeyres_value, 2),
            "apix_unweighted": round(jevons_value, 2),
            "active_cells": len(cell_relatives),
            "total_cells": total_cells,
            "coverage_pct": round(cell_coverage, 1),
            "weight_coverage_pct": round(weight_coverage, 1),
            "quality_flag": qf.value,
            "low_coverage": cell_coverage < LOW_COVERAGE_PCT,
            "observation_count": obs_count,
            "sensitivity_value": round(secondary, 2),
        })

    return results


def compute_contributions(
    observations: list[Observation],
    granularity: str = "day",
) -> list[dict]:
    """
    Contribution decomposition: how much each route/cell contributed to the
    headline index change. Monograph §9.1:
      contribution[c] = W[c] × (R[c,t] - R[c,t-1])

    Returns contributions for the latest period vs the first period.
    """
    if not observations:
        return []

    reference = compute_reference_prices(observations)
    weights = {key: _cell_weight(key) for key in reference}
    total_basket_weight = sum(weights.values())

    periods: dict[str, dict[tuple, list[float]]] = defaultdict(lambda: defaultdict(list))
    for obs in observations:
        period = _bucket_key(obs["quote_date"], granularity)
        periods[period][cell_key(obs)].append(obs["total_fare"])

    sorted_periods = sorted(periods)
    if len(sorted_periods) < 2:
        return []

    first_period = sorted_periods[0]
    last_period = sorted_periods[-1]

    def _relatives(period_key: str) -> dict[tuple, float]:
        rels = {}
        for key, fares in periods[period_key].items():
            p0 = reference.get(key)
            if p0:
                rels[key] = math.exp(sum(math.log(f) for f in fares) / len(fares)) / p0
        return rels

    first_rels = _relatives(first_period)
    last_rels = _relatives(last_period)

    # All cells active in either period.
    all_keys = set(first_rels) | set(last_rels)
    active_weight = sum(weights.get(k, 0.0) for k in all_keys)

    contribs = []
    for key in all_keys:
        r0 = first_rels.get(key, 1.0)
        rt = last_rels.get(key, r0)
        w = weights.get(key, 0.0) / active_weight if active_weight else 0.0
        contribution_pts = 100 * w * (rt - r0)
        origin, destination, airline, fare_class, lb = key
        contribs.append({
            "route": f"{origin}-{destination}",
            "airline": airline,
            "fare_class": fare_class,
            "lead_bucket": lb,
            "weight": round(w, 6),
            "relative_start": round(r0, 4),
            "relative_end": round(rt, 4),
            "contribution_pts": round(contribution_pts, 4),
        })

    contribs.sort(key=lambda r: abs(r["contribution_pts"]), reverse=True)
    return contribs


def compute_group_index(
    observations: list[Observation],
    group_field: str,
    granularity: str = "day",
) -> list[dict]:
    """
    An independent index per route / carrier / fare class / lead bucket.

    Each group is indexed only over its own cells and rebased to 100 at its own
    start. Sorted by the size of the move, largest first.
    """
    resolve = GROUP_FIELDS.get(group_field)
    if resolve is None:
        raise ValueError(
            f"unknown group_field {group_field!r}; expected one of {sorted(GROUP_FIELDS)}"
        )

    groups: dict[str, list[Observation]] = defaultdict(list)
    for obs in observations:
        groups[resolve(obs)].append(obs)

    out = []
    for name, rows in groups.items():
        series = compute_index_timeseries(rows, granularity=granularity, weighted=True)
        if not series:
            continue
        first, latest = series[0], series[-1]
        out.append({
            "group": name,
            "apix_value": latest["apix_value"],
            "delta": round(latest["apix_value"] - first["apix_value"], 2),
            "change_pct": round(
                100 * (latest["apix_value"] - first["apix_value"]) / first["apix_value"], 2
            ) if first["apix_value"] else 0.0,
            "period_start": first["period"],
            "period_end": latest["period"],
            "cell_count": latest["total_cells"],
            "observation_count": sum(r["observation_count"] for r in series),
        })

    out.sort(key=lambda r: abs(r["delta"]), reverse=True)
    return out


def coverage_report(observations: list[Observation]) -> dict:
    """
    How complete the panel is — coverage by cell count and by weight.
    Monograph §8.5 data-quality scorecard.
    """
    if not observations:
        return {
            "total_cells": 0, "total_periods": 0,
            "mean_coverage_pct": 0.0, "mean_weight_coverage_pct": 0.0,
            "complete_cells": 0, "sparse_cells": [],
            "quality_flag": QualityFlag.RED.value,
        }

    periods = sorted({o["quote_date"] for o in observations})
    seen: dict[tuple, set] = defaultdict(set)
    for obs in observations:
        seen[cell_key(obs)].add(obs["quote_date"])

    total_periods = len(periods)
    complete = sum(1 for days in seen.values() if len(days) == total_periods)

    sparse = sorted(
        (
            {
                "cell": list(key),
                "periods_present": len(days),
                "coverage_pct": round(100 * len(days) / total_periods, 1),
            }
            for key, days in seen.items()
            if len(days) < total_periods
        ),
        key=lambda r: r["periods_present"],
    )

    mean_coverage = sum(len(d) for d in seen.values()) / (len(seen) * total_periods) * 100

    # Weight-based coverage: what share of the basket is observed?
    weights = {key: _cell_weight(key) for key in seen}
    total_basket = sum(weights.values())
    all_possible_weight = sum(
        _cell_weight(key) for key in _all_possible_cells(observations)
    ) if observations else 0.0
    weight_cov = 100.0 * total_basket / all_possible_weight if all_possible_weight > 0 else 0.0

    qf = quality_flag(weight_cov if weight_cov > 0 else mean_coverage)

    return {
        "total_cells": len(seen),
        "total_periods": total_periods,
        "mean_coverage_pct": round(mean_coverage, 1),
        "mean_weight_coverage_pct": round(weight_cov, 1),
        "complete_cells": complete,
        "sparse_cells": sparse[:20],
        "quality_flag": qf.value,
    }


def _all_possible_cells(observations: list[Observation]) -> set[tuple]:
    """The universe of cells ever observed."""
    return {cell_key(obs) for obs in observations}


# ================================================================ head-to-head

def compute_head_to_head(
    observations: list[Observation],
    origin: str,
    destination: str,
    fare_class: str | None = None,
    lead_bucket: str | None = None,
) -> list[dict]:
    """
    Head-to-head airline comparison on a specific route.

    Filters to the given route and optional fare_class/lead_bucket, then
    computes per-airline statistics: avg/median/min/max fare, observation
    count, and a mini index (base=100 at first period).
    """
    import statistics as stats

    filtered = [
        o for o in observations
        if o["origin"] == origin and o["destination"] == destination
        and (fare_class is None or o["fare_class"] == fare_class)
        and (lead_bucket is None or o["lead_bucket"] == lead_bucket)
    ]
    if not filtered:
        return []

    by_airline: dict[str, list[Observation]] = defaultdict(list)
    for obs in filtered:
        by_airline[obs["airline"]].append(obs)

    results = []
    for airline, rows in by_airline.items():
        fares = [r["total_fare"] for r in rows]
        # Mini index: compute first-day reference and latest-day relative.
        series = compute_index_timeseries(rows, granularity="day", weighted=False)
        idx_start = series[0]["apix_value"] if series else 100.0
        idx_end = series[-1]["apix_value"] if series else 100.0

        results.append({
            "airline": airline,
            "avg_fare": round(sum(fares) / len(fares), 2),
            "median_fare": round(stats.median(fares), 2),
            "min_fare": round(min(fares), 2),
            "max_fare": round(max(fares), 2),
            "observation_count": len(fares),
            "index_start": round(idx_start, 2),
            "index_end": round(idx_end, 2),
            "index_change": round(idx_end - idx_start, 2),
        })

    results.sort(key=lambda r: r["avg_fare"])
    return results


# ================================================================ sensitivity

def sensitivity_weighted_vs_unweighted(
    observations: list[Observation],
    granularity: str = "day",
) -> dict:
    """
    Monograph §5.2: produce sensitivity indices for equal vs traffic weights;
    large divergence is a representativeness warning.
    """
    series = compute_index_timeseries(observations, granularity, weighted=True)
    if not series:
        return {"periods": 0, "max_divergence_pts": 0.0, "mean_divergence_pts": 0.0}

    divergences = [abs(s["apix_weighted"] - s["apix_unweighted"]) for s in series]
    return {
        "periods": len(series),
        "max_divergence_pts": round(max(divergences), 2),
        "mean_divergence_pts": round(sum(divergences) / len(divergences), 2),
        "warning": max(divergences) > 2.0,
    }
