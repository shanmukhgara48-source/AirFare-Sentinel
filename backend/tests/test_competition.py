"""
Tests for route competition analysis (app.engine.competition).

Coverage
--------
- Empty / single observation
- HHI formula correctness (1, 2, 3, 4 equal carriers)
- Status thresholds: Healthy / Watch / High Risk
- Dominant carrier identification
- Fare pressure categorisation
- Multi-route sorting (High Risk first)
- Carriers list is sorted alphabetically
- observation_count accuracy
"""
import pytest
from app.engine.competition import compute_route_competition


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _obs(origin: str, destination: str, airline: str, fare: float) -> dict:
    return {
        "origin": origin,
        "destination": destination,
        "airline": airline,
        "total_fare": fare,
    }


def _route_obs(route_pair: tuple[str, str], airlines: list[str],
               fare: float, n_each: int = 10) -> list[dict]:
    """Build n_each observations per airline on a single route."""
    origin, dest = route_pair
    return [_obs(origin, dest, a, fare) for a in airlines for _ in range(n_each)]


# ─── Empty / trivial ─────────────────────────────────────────────────────────


def test_empty_returns_empty_list():
    assert compute_route_competition([]) == []


def test_single_observation():
    result = compute_route_competition([_obs("DEL", "BOM", "SA1", 5000.0)])
    assert len(result) == 1
    r = result[0]
    assert r["carrier_count"] == 1
    assert r["hhi"] == 1.0
    assert r["status"] == "High Risk"


# ─── HHI formula correctness ─────────────────────────────────────────────────


def test_hhi_monopoly():
    obs = [_obs("DEL", "BOM", "SA1", 5000.0)] * 20
    r = compute_route_competition(obs)[0]
    assert r["hhi"] == 1.0


def test_hhi_two_equal_carriers():
    """2 equal → HHI = 0.50."""
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2"], 5000.0, n_each=10)
    r = compute_route_competition(obs)[0]
    assert abs(r["hhi"] - 0.50) < 1e-4


def test_hhi_three_equal_carriers():
    """3 equal → HHI ≈ 1/3."""
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2", "NS3"], 5000.0, n_each=10)
    r = compute_route_competition(obs)[0]
    assert abs(r["hhi"] - 1 / 3) < 1e-3


def test_hhi_four_equal_carriers():
    """4 equal → HHI = 0.25."""
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2", "NS3", "CE9"], 5000.0, n_each=10)
    r = compute_route_competition(obs)[0]
    assert abs(r["hhi"] - 0.25) < 1e-4


def test_hhi_skewed_split():
    """80/20 split → HHI = 0.80² + 0.20² = 0.68."""
    obs = ([_obs("DEL", "BOM", "SA1", 5000.0)] * 80 +
           [_obs("DEL", "BOM", "BW2", 5000.0)] * 20)
    r = compute_route_competition(obs)[0]
    assert abs(r["hhi"] - (0.80 ** 2 + 0.20 ** 2)) < 1e-3


# ─── Status thresholds ───────────────────────────────────────────────────────


def test_status_healthy_four_equal_carriers():
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2", "NS3", "CE9"], 5000.0)
    r = compute_route_competition(obs)[0]
    assert r["status"] == "Healthy"


def test_status_healthy_three_equal_carriers():
    """3 equal carriers → HHI ≈ 0.333 ≥ 0.35 — should be Watch."""
    # HHI = 0.333 is < 0.35, so it's Healthy — verify
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2", "NS3"], 5000.0, n_each=10)
    r = compute_route_competition(obs)[0]
    # 3 carriers, HHI = 0.333 < 0.35 → Healthy
    assert r["status"] == "Healthy"
    assert r["carrier_count"] == 3


def test_status_watch_two_carriers():
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2"], 5000.0)
    r = compute_route_competition(obs)[0]
    assert r["status"] == "Watch"
    assert r["carrier_count"] == 2


def test_status_watch_high_hhi_three_carriers():
    """Highly skewed 3-carrier split → HHI > 0.35 → Watch."""
    # 70 / 20 / 10 split → HHI = 0.49 + 0.04 + 0.01 = 0.54
    obs = ([_obs("DEL", "BOM", "SA1", 5000.0)] * 70 +
           [_obs("DEL", "BOM", "BW2", 5000.0)] * 20 +
           [_obs("DEL", "BOM", "NS3", 5000.0)] * 10)
    r = compute_route_competition(obs)[0]
    assert r["hhi"] > 0.35
    assert r["carrier_count"] == 3
    # HHI = 0.54 < 0.60 → Watch
    assert r["status"] == "Watch"


def test_status_high_risk_monopoly():
    obs = [_obs("DEL", "BOM", "SA1", 5000.0)] * 10
    r = compute_route_competition(obs)[0]
    assert r["status"] == "High Risk"


def test_status_high_risk_hhi_above_threshold():
    """80/20 split → HHI = 0.68 ≥ 0.60 → High Risk."""
    obs = ([_obs("DEL", "BOM", "SA1", 5000.0)] * 80 +
           [_obs("DEL", "BOM", "BW2", 5000.0)] * 20)
    r = compute_route_competition(obs)[0]
    assert r["hhi"] >= 0.60
    assert r["status"] == "High Risk"


# ─── Dominant carrier ────────────────────────────────────────────────────────


def test_dominant_carrier_identified_correctly():
    obs = ([_obs("DEL", "BOM", "SA1", 5000.0)] * 30 +
           [_obs("DEL", "BOM", "BW2", 5000.0)] * 10 +
           [_obs("DEL", "BOM", "NS3", 5000.0)] * 10)
    r = compute_route_competition(obs)[0]
    assert r["dominant_carrier"] == "SA1"
    assert abs(r["dominant_share"] - 0.60) < 1e-3


def test_dominant_share_monopoly_is_one():
    obs = [_obs("DEL", "BOM", "BW2", 5000.0)] * 15
    r = compute_route_competition(obs)[0]
    assert r["dominant_carrier"] == "BW2"
    assert r["dominant_share"] == 1.0


# ─── Fare pressure ───────────────────────────────────────────────────────────


def test_fare_pressure_all_equal_is_moderate():
    """When all routes have the same avg fare, every route is Moderate."""
    obs = []
    for route in [("DEL", "BOM"), ("BOM", "DEL"), ("DEL", "BLR")]:
        obs += _route_obs(route, ["SA1", "BW2", "NS3"], 5000.0, n_each=5)
    result = compute_route_competition(obs)
    assert all(r["fare_pressure"] == "Moderate" for r in result)


def test_fare_pressure_high_when_route_far_above_basket():
    # Two cheap routes, one expensive
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2"], 4000.0, n_each=10)
    obs += _route_obs(("BOM", "DEL"), ["SA1", "BW2"], 4200.0, n_each=10)
    obs += _route_obs(("DEL", "BLR"), ["SA1", "BW2"], 12000.0, n_each=10)
    result = compute_route_competition(obs)
    expensive = next(r for r in result if r["route"] == "DEL-BLR")
    assert expensive["fare_pressure"] == "High"


def test_fare_pressure_low_when_route_far_below_basket():
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2"], 500.0, n_each=10)
    obs += _route_obs(("BOM", "DEL"), ["SA1", "BW2"], 5500.0, n_each=10)
    obs += _route_obs(("DEL", "BLR"), ["SA1", "BW2"], 6000.0, n_each=10)
    result = compute_route_competition(obs)
    cheap = next(r for r in result if r["route"] == "DEL-BOM")
    assert cheap["fare_pressure"] == "Low"


# ─── Multi-route sorting ─────────────────────────────────────────────────────


def test_sorting_high_risk_before_watch_before_healthy():
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2", "NS3", "CE9"], 5000.0)  # Healthy
    obs += _route_obs(("BOM", "DEL"), ["SA1", "BW2"], 5000.0)               # Watch
    obs += [_obs("DEL", "BLR", "SA1", 5000.0)] * 10                         # High Risk
    result = compute_route_competition(obs)
    statuses = [r["status"] for r in result]
    assert statuses[0] == "High Risk"
    assert statuses[1] == "Watch"
    assert statuses[2] == "Healthy"


def test_secondary_sort_alphabetical_within_status():
    """Routes with same status should be sorted alphabetically by route code."""
    obs = _route_obs(("DEL", "BOM"), ["SA1", "BW2", "NS3"], 5000.0)  # Healthy
    obs += _route_obs(("BLR", "DEL"), ["SA1", "BW2", "NS3"], 5000.0)  # Healthy
    obs += _route_obs(("BOM", "DEL"), ["SA1", "BW2", "NS3"], 5000.0)  # Healthy
    result = compute_route_competition(obs)
    route_codes = [r["route"] for r in result]
    assert route_codes == sorted(route_codes)


# ─── Carriers list & observation count ───────────────────────────────────────


def test_carriers_list_sorted_alphabetically():
    obs = ([_obs("DEL", "BOM", "NS3", 5000.0)] * 5 +
           [_obs("DEL", "BOM", "SA1", 5000.0)] * 5 +
           [_obs("DEL", "BOM", "BW2", 5000.0)] * 5)
    r = compute_route_competition(obs)[0]
    assert r["carriers"] == sorted(["SA1", "BW2", "NS3"])


def test_observation_count_matches_input():
    n = 17
    obs = [_obs("DEL", "BOM", "SA1", 5000.0)] * n
    r = compute_route_competition(obs)[0]
    assert r["observation_count"] == n


def test_multiple_routes_all_returned():
    routes = [("DEL", "BOM"), ("BOM", "DEL"), ("DEL", "BLR"), ("BLR", "DEL")]
    obs = []
    for route in routes:
        obs += _route_obs(route, ["SA1", "BW2"], 5000.0, n_each=5)
    result = compute_route_competition(obs)
    assert len(result) == len(routes)
    returned_routes = {r["route"] for r in result}
    for origin, dest in routes:
        assert f"{origin}-{dest}" in returned_routes


def test_route_key_format():
    obs = [_obs("CCU", "MAA", "CE9", 4000.0)] * 5
    r = compute_route_competition(obs)[0]
    assert r["route"] == "CCU-MAA"
    assert r["origin"] == "CCU"
    assert r["destination"] == "MAA"
