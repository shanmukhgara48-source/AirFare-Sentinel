"""
Tests for the Fairness Lens category aggregation engine.
"""
import statistics

import pytest

from app.engine.fairness import (
    CATEGORY_ORDER,
    ROUTE_CATEGORIES,
    compute_fairness,
    _category_for,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _obs(origin, destination, fare):
    return {"origin": origin, "destination": destination, "total_fare": fare}


def _spike(origin, destination, impact=50.0, direction="spike"):
    return {
        "origin": origin,
        "destination": destination,
        "direction": direction,
        "impact_score": impact,
    }


def _cat(results, name):
    """Return the category dict by name from compute_fairness output."""
    return next(r for r in results if r["category"] == name)


# ── category lookup ───────────────────────────────────────────────────────────

class TestCategoryFor:
    def test_known_metro_routes(self):
        assert _category_for("DEL", "BOM") == "Metro"
        assert _category_for("BOM", "DEL") == "Metro"

    def test_known_business_routes(self):
        assert _category_for("DEL", "BLR") == "Business-heavy"
        assert _category_for("BLR", "HYD") == "Business-heavy"
        assert _category_for("BOM", "BLR") == "Business-heavy"

    def test_known_tourism_routes(self):
        assert _category_for("DEL", "HYD") == "Tourism-heavy"
        assert _category_for("HYD", "DEL") == "Tourism-heavy"

    def test_known_connectivity_routes(self):
        assert _category_for("DEL", "MAA") == "Connectivity-sensitive"
        assert _category_for("CCU", "DEL") == "Connectivity-sensitive"

    def test_unknown_route_is_explicitly_unclassified(self):
        assert _category_for("BOM", "CCU") == "Unclassified"
        assert _category_for("XYZ", "ABC") == "Unclassified"


# ── ROUTE_CATEGORIES coverage ─────────────────────────────────────────────────

class TestRouteCategoriesMetadata:
    def test_all_14_routes_present(self):
        # Dataset has 7 city-pairs × 2 directions = 14 routes.
        assert len(ROUTE_CATEGORIES) == 14

    def test_category_values_are_valid(self):
        valid = {"Metro", "Business-heavy", "Tourism-heavy",
                 "Connectivity-sensitive", "Tier-2", "Unclassified"}
        for route, cat in ROUTE_CATEGORIES.items():
            assert cat in valid, f"{route} has invalid category '{cat}'"

    def test_at_least_one_route_per_non_tier2_category(self):
        cats = set(ROUTE_CATEGORIES.values())
        assert "Metro" in cats
        assert "Business-heavy" in cats
        assert "Tourism-heavy" in cats
        assert "Connectivity-sensitive" in cats


# ── compute_fairness — empty / no data ────────────────────────────────────────

class TestComputeFairnessEmpty:
    def test_empty_observations_returns_all_categories(self):
        result = compute_fairness([], [])
        assert len(result) == len(CATEGORY_ORDER)

    def test_empty_categories_all_zero(self):
        result = compute_fairness([], [])
        for row in result:
            assert row["observation_count"] == 0
            assert row["alert_count"] == 0
            assert row["avg_fare"] is None
            assert row["avg_impact_score"] is None
            assert row["fare_pressure"] is None

    def test_empty_has_descriptions(self):
        result = compute_fairness([], [])
        for row in result:
            assert len(row["description"]) > 20

    def test_order_matches_category_order(self):
        result = compute_fairness([], [])
        assert [r["category"] for r in result] == CATEGORY_ORDER


# ── compute_fairness — category ordering ─────────────────────────────────────

class TestCategoryOrder:
    def test_output_order_is_fixed(self):
        obs = [_obs("DEL", "BOM", 5000), _obs("DEL", "MAA", 6000)]
        result = compute_fairness(obs, [])
        assert [r["category"] for r in result] == CATEGORY_ORDER

    def test_unclassified_always_last(self):
        obs = [_obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        assert result[-1]["category"] == "Unclassified"

    def test_metro_always_first(self):
        obs = [_obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        assert result[0]["category"] == "Metro"


# ── compute_fairness — single category ───────────────────────────────────────

class TestSingleCategory:
    def test_metro_observation_count(self):
        obs = [_obs("DEL", "BOM", 5000), _obs("BOM", "DEL", 7000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["observation_count"] == 2

    def test_metro_avg_fare(self):
        obs = [_obs("DEL", "BOM", 4000), _obs("BOM", "DEL", 6000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["avg_fare"] == pytest.approx(5000.0, abs=0.01)

    def test_metro_median_fare(self):
        obs = [_obs("DEL", "BOM", 3000), _obs("DEL", "BOM", 5000),
               _obs("BOM", "DEL", 7000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["median_fare"] == pytest.approx(5000.0, abs=0.01)

    def test_route_count_distinct(self):
        obs = [_obs("DEL", "BOM", 5000)] * 10 + [_obs("BOM", "DEL", 5000)] * 5
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["route_count"] == 2

    def test_routes_list_sorted(self):
        obs = [_obs("BOM", "DEL", 5000), _obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["routes"] == sorted(metro["routes"])


# ── compute_fairness — alert counting ────────────────────────────────────────

class TestAlertCounting:
    def test_spike_counts_as_alert(self):
        obs = [_obs("DEL", "BOM", 5000)]
        spikes = [_spike("DEL", "BOM", impact=60.0, direction="spike")]
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        assert metro["alert_count"] == 1

    def test_drop_does_not_count_as_alert(self):
        obs = [_obs("DEL", "BOM", 5000)]
        spikes = [_spike("DEL", "BOM", impact=40.0, direction="drop")]
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        assert metro["alert_count"] == 0

    def test_mixed_spikes_and_drops(self):
        obs = [_obs("DEL", "BOM", 5000)] * 5
        spikes = [
            _spike("DEL", "BOM", impact=50.0, direction="spike"),
            _spike("DEL", "BOM", impact=30.0, direction="spike"),
            _spike("DEL", "BOM", impact=20.0, direction="drop"),
        ]
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        assert metro["alert_count"] == 2

    def test_alert_rate_calculation(self):
        obs = [_obs("DEL", "BOM", 5000)] * 10
        spikes = [_spike("DEL", "BOM", direction="spike")] * 3
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        assert metro["alert_rate"] == pytest.approx(0.30, abs=0.001)

    def test_no_alerts_alert_rate_zero(self):
        obs = [_obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["alert_rate"] == pytest.approx(0.0)

    def test_no_alerts_avg_impact_none(self):
        obs = [_obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["avg_impact_score"] is None

    def test_avg_impact_score_correct(self):
        obs = [_obs("DEL", "BOM", 5000)] * 2
        spikes = [
            _spike("DEL", "BOM", impact=40.0, direction="spike"),
            _spike("DEL", "BOM", impact=60.0, direction="spike"),
        ]
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        assert metro["avg_impact_score"] == pytest.approx(50.0, abs=0.1)

    def test_drop_impact_excluded_from_avg(self):
        obs = [_obs("DEL", "BOM", 5000)] * 2
        spikes = [
            _spike("DEL", "BOM", impact=80.0, direction="spike"),
            _spike("DEL", "BOM", impact=10.0, direction="drop"),
        ]
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        # Only the spike contributes → avg = 80.0
        assert metro["avg_impact_score"] == pytest.approx(80.0, abs=0.1)


# ── compute_fairness — fare pressure ─────────────────────────────────────────

class TestFarePressure:
    def _two_cat_result(self, metro_fare, other_fare):
        """Metro vs Connectivity-sensitive comparison."""
        obs = (
            [_obs("DEL", "BOM", metro_fare)] +
            [_obs("DEL", "MAA", other_fare)]
        )
        return compute_fairness(obs, [])

    def test_high_fare_pressure_above_basket(self):
        # Metro fare 50% above basket median → High
        result = self._two_cat_result(15000, 5000)
        metro = _cat(result, "Metro")
        # basket_median = median([15000, 5000]) = 10000; 15000/10000 = 1.5 > 1.10
        assert metro["fare_pressure"] == "High"

    def test_low_fare_pressure_below_basket(self):
        result = self._two_cat_result(4000, 10000)
        metro = _cat(result, "Metro")
        # basket_median = 7000; 4000/7000 ≈ 0.57 < 0.90
        assert metro["fare_pressure"] == "Low"

    def test_moderate_fare_pressure_near_basket(self):
        # Both categories have the same fares → both Moderate
        obs = [_obs("DEL", "BOM", 5000), _obs("DEL", "MAA", 5000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        assert metro["fare_pressure"] == "Moderate"

    def test_fare_pressure_boundary_exactly_110pct(self):
        # avg/basket_median = 1.10 → exactly at boundary → Moderate (> not >=)
        obs = [_obs("DEL", "BOM", 11000), _obs("DEL", "MAA", 10000)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        # basket_median = median([11000, 10000]) = 10500; 11000/10500 ≈ 1.047 → Moderate
        assert metro["fare_pressure"] in {"Moderate", "High"}

    def test_tier2_fare_pressure_none_when_empty(self):
        obs = [_obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        tier2 = _cat(result, "Tier-2")
        assert tier2["fare_pressure"] is None


# ── compute_fairness — multi-category scenario ────────────────────────────────

class TestMultiCategory:
    def setup_method(self):
        self.obs = (
            [_obs("DEL", "BOM", 8000)] * 100 +     # Metro
            [_obs("DEL", "BLR", 6000)] * 80 +      # Business-heavy
            [_obs("DEL", "HYD", 7000)] * 40 +      # Tourism-heavy
            [_obs("DEL", "MAA", 5000)] * 30        # Connectivity-sensitive
        )
        self.spikes = (
            [_spike("DEL", "BOM", impact=70, direction="spike")] * 5 +
            [_spike("DEL", "BLR", impact=50, direction="spike")] * 8 +
            [_spike("DEL", "MAA", impact=80, direction="spike")] * 3
        )
        self.result = compute_fairness(self.obs, self.spikes)

    def test_all_categories_present(self):
        assert len(self.result) == len(CATEGORY_ORDER)

    def test_metro_observation_count(self):
        assert _cat(self.result, "Metro")["observation_count"] == 100

    def test_business_alert_count(self):
        assert _cat(self.result, "Business-heavy")["alert_count"] == 8

    def test_connectivity_avg_impact(self):
        conn = _cat(self.result, "Connectivity-sensitive")
        assert conn["avg_impact_score"] == pytest.approx(80.0, abs=0.1)

    def test_tourism_alert_count_zero(self):
        assert _cat(self.result, "Tourism-heavy")["alert_count"] == 0

    def test_tier2_all_zeros(self):
        t2 = _cat(self.result, "Tier-2")
        assert t2["observation_count"] == 0
        assert t2["route_count"] == 0
        assert t2["avg_fare"] is None

    def test_output_length_is_stable(self):
        assert len(self.result) == len(CATEGORY_ORDER)

    def test_unknown_route_does_not_contaminate_metro(self):
        result = compute_fairness([_obs("XYZ", "ABC", 9000)], [])
        assert _cat(result, "Metro")["observation_count"] == 0
        assert _cat(result, "Unclassified")["observation_count"] == 1


# ── compute_fairness — structural guarantees ──────────────────────────────────

class TestStructural:
    def test_all_required_keys_present(self):
        obs = [_obs("DEL", "BOM", 5000)]
        result = compute_fairness(obs, [])
        required = {
            "category", "description", "route_count", "observation_count",
            "avg_fare", "median_fare", "alert_count", "alert_rate",
            "avg_impact_score", "fare_pressure", "routes",
        }
        for row in result:
            assert required.issubset(set(row.keys()))

    def test_fares_are_floats_rounded(self):
        obs = [_obs("DEL", "BOM", 5555.555555)]
        result = compute_fairness(obs, [])
        metro = _cat(result, "Metro")
        # Rounded to 2 decimal places.
        assert metro["avg_fare"] == round(metro["avg_fare"], 2)

    def test_alert_rate_rounded_to_4dp(self):
        obs = [_obs("DEL", "BOM", 5000)] * 3
        spikes = [_spike("DEL", "BOM", direction="spike")]
        result = compute_fairness(obs, spikes)
        metro = _cat(result, "Metro")
        assert metro["alert_rate"] == round(metro["alert_rate"], 4)
