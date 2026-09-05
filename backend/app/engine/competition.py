"""
Route competition analysis — concentration risk monitoring signals.

Computes per-route metrics that serve as concentration-risk proxies.
These signals highlight routes where limited carrier presence may warrant
closer monitoring. They do NOT constitute legal findings of anti-competitive
behaviour — they are statistical monitoring indicators only.

Metrics
-------
carrier_count : int
    Number of distinct airlines with at least one observed fare on the route
    within the supplied dataset.

hhi : float  (0–1)
    Herfindahl-Hirschman Index, computed on observation-count shares.
    Four equal-share carriers → 0.25.  Monopoly → 1.0.
    Used here as a first-pass concentration signal, not a regulatory threshold.

dominant_carrier : str
    Airline with the largest share of observations on the route.

dominant_share : float  (0–1)
    Fraction of observations belonging to the most-observed carrier.

fare_pressure : "Low" | "Moderate" | "High"
    Whether average fares on this route sit below (Low), near (Moderate), or
    above (High) the basket-wide median of route averages.

status : "Healthy" | "Watch" | "High Risk"
    Summary monitoring label derived from carrier_count and HHI:
      Healthy   — 3+ carriers AND HHI < 0.35
      Watch     — 2 carriers OR HHI in [0.35, 0.60)
      High Risk — 1 carrier OR HHI ≥ 0.60

How status is derived (plain English)
--------------------------------------
We count how many distinct carriers have priced a fare on this route in the
observation window and compute the Herfindahl-Hirschman Index — the sum of
squared observation-share fractions.  An HHI near 0.25 means four carriers
each supply roughly 25 % of captured fare observations; a value of 1.0 means
all captured observations came from one carrier. Neither result establishes
actual competition or monopoly because market shares are absent.

  Healthy  — at least three carriers and HHI below 0.35, meaning no single
             observation supplier dominates the captured rows. This is not a
             conclusion about competitive conditions.

  Watch    — exactly two carriers present, OR HHI is between 0.35 and 0.60.
             One carrier likely holds a majority.  Worth monitoring.

  High Risk — only one carrier present, OR HHI at or above 0.60, indicating
              a strong concentration signal.  Warrants analyst review.

Fare pressure cross-checks concentration: a route that shows High Risk AND
High fare pressure is the combination that merits the most scrutiny.
"""
import statistics
from collections import defaultdict


def compute_route_competition(observations: list[dict]) -> list[dict]:
    """
    Return per-route competition metrics for every origin-destination pair
    present in *observations*.

    Parameters
    ----------
    observations:
        Each dict must contain at minimum the keys
        ``origin``, ``destination``, ``airline``, ``total_fare``.

    Returns
    -------
    List of dicts, one per route, sorted by status severity (High Risk first)
    then alphabetically by route code.
    """
    if not observations:
        return []

    # ── Group by route ────────────────────────────────────────────────────────
    by_route: dict[str, list[dict]] = defaultdict(list)
    for o in observations:
        by_route[f"{o['origin']}-{o['destination']}"].append(o)

    # Basket-wide median of per-route average fares (cross-route baseline).
    route_avg_fares = {
        route: statistics.mean(o["total_fare"] for o in obs)
        for route, obs in by_route.items()
    }
    basket_median = statistics.median(route_avg_fares.values())

    results = []
    for route_key, obs in by_route.items():
        origin, destination = route_key.split("-", 1)

        # ── Carrier share counts ──────────────────────────────────────────────
        carrier_obs: dict[str, int] = defaultdict(int)
        for o in obs:
            carrier_obs[o["airline"]] += 1

        carrier_count = len(carrier_obs)
        total_obs = len(obs)

        # ── HHI on observation-count shares ──────────────────────────────────
        hhi = round(
            sum((count / total_obs) ** 2 for count in carrier_obs.values()), 4
        )

        # ── Dominant carrier ─────────────────────────────────────────────────
        dominant_carrier = max(carrier_obs, key=carrier_obs.__getitem__)
        dominant_share = round(carrier_obs[dominant_carrier] / total_obs, 4)

        # ── Average fare & pressure vs basket ────────────────────────────────
        avg_fare = round(statistics.mean(o["total_fare"] for o in obs), 2)
        ratio = avg_fare / basket_median
        if ratio > 1.10:
            fare_pressure = "High"
        elif ratio < 0.90:
            fare_pressure = "Low"
        else:
            fare_pressure = "Moderate"

        # ── Competition status ────────────────────────────────────────────────
        if carrier_count == 1 or hhi >= 0.60:
            status = "High Risk"
        elif carrier_count == 2 or hhi >= 0.35:
            status = "Watch"
        else:
            status = "Healthy"

        results.append({
            "route": route_key,
            "origin": origin,
            "destination": destination,
            "concentration_measure": "observation_share_hhi_proxy",
            "market_share_data_available": False,
            "threshold_basis": "team_defined_monitoring_bands",
            "fare_pressure_basis": "route_average_fare_vs_cross_route_median",
            "carrier_count": carrier_count,
            "carriers": sorted(carrier_obs.keys()),
            "dominant_carrier": dominant_carrier,
            "dominant_share": dominant_share,
            "hhi": hhi,
            "avg_fare": avg_fare,
            "fare_pressure": fare_pressure,
            "status": status,
            "observation_count": total_obs,
        })

    # High Risk → Watch → Healthy; then alphabetical by route code.
    _order = {"High Risk": 0, "Watch": 1, "Healthy": 2}
    results.sort(key=lambda r: (_order[r["status"]], r["route"]))
    return results
