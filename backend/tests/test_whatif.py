"""
Tests for the What-If Scenario Simulator projection formula.
"""
import math

import pytest

from app.engine.whatif import (
    BASELINE_CARRIERS,
    CAPACITY_ELASTICITY,
    COMPETITION_SCALE,
    DEMAND_ELASTICITY,
    FUEL_PASSTHROUGH,
    IMPACT_MULTIPLIER,
    competition_adjustment,
    project,
    risk_level,
)


# ── competition_adjustment ────────────────────────────────────────────────────

class TestCompetitionAdjustment:
    def test_baseline_carriers_is_zero(self):
        assert competition_adjustment(BASELINE_CARRIERS) == pytest.approx(0.0, abs=0.001)

    def test_monopoly_is_positive(self):
        """Fewer carriers → higher prices → positive adjustment."""
        assert competition_adjustment(1) > 0

    def test_more_carriers_is_negative(self):
        """More carriers than baseline → competitive relief → negative."""
        assert competition_adjustment(8) < 0

    def test_monopoly_value(self):
        expected = COMPETITION_SCALE * math.log(BASELINE_CARRIERS / 1)
        assert competition_adjustment(1) == pytest.approx(expected, abs=0.01)

    def test_two_carriers_value(self):
        expected = COMPETITION_SCALE * math.log(BASELINE_CARRIERS / 2)
        assert competition_adjustment(2) == pytest.approx(expected, abs=0.01)

    def test_eight_carriers_value(self):
        expected = COMPETITION_SCALE * math.log(BASELINE_CARRIERS / 8)
        assert competition_adjustment(8) == pytest.approx(expected, abs=0.01)

    def test_zero_carriers_clamped_to_one(self):
        """Zero or negative carrier count treated as monopoly."""
        assert competition_adjustment(0) == competition_adjustment(1)
        assert competition_adjustment(-5) == competition_adjustment(1)

    def test_monotone_decreasing(self):
        """More carriers → less adjustment (lower pressure)."""
        vals = [competition_adjustment(c) for c in range(1, 9)]
        for i in range(len(vals) - 1):
            assert vals[i] > vals[i + 1]

    def test_five_carriers_less_than_baseline_adjustment(self):
        assert competition_adjustment(5) < competition_adjustment(4)


# ── risk_level ────────────────────────────────────────────────────────────────

class TestRiskLevel:
    def test_low(self):
        assert risk_level(0.0) == "Low"
        assert risk_level(4.9) == "Low"

    def test_watch_lower_boundary(self):
        assert risk_level(5.0) == "Watch"

    def test_watch_upper_interior(self):
        assert risk_level(14.9) == "Watch"

    def test_review_lower_boundary(self):
        assert risk_level(15.0) == "Review"

    def test_review_upper_interior(self):
        assert risk_level(29.9) == "Review"

    def test_escalate_lower_boundary(self):
        assert risk_level(30.0) == "Escalate"

    def test_escalate_large(self):
        assert risk_level(100.0) == "Escalate"

    def test_near_zero_is_low(self):
        assert risk_level(0.001) == "Low"


# ── project — individual factor contributions ─────────────────────────────────

class TestProjectContributions:
    def test_all_zero_inputs_no_change(self):
        result = project(0, 0, 0, BASELINE_CARRIERS)
        assert result["projected_change_pct"] == pytest.approx(0.0, abs=0.01)

    def test_demand_only_positive(self):
        result = project(10, 0, 0, BASELINE_CARRIERS)
        assert result["demand_contribution"] == pytest.approx(DEMAND_ELASTICITY * 10, abs=0.001)

    def test_demand_only_negative(self):
        result = project(-10, 0, 0, BASELINE_CARRIERS)
        assert result["demand_contribution"] == pytest.approx(DEMAND_ELASTICITY * (-10), abs=0.001)

    def test_demand_contribution_sign_positive(self):
        result = project(20, 0, 0, BASELINE_CARRIERS)
        assert result["demand_contribution"] > 0

    def test_fuel_only_positive(self):
        result = project(0, 10, 0, BASELINE_CARRIERS)
        assert result["fuel_contribution"] == pytest.approx(FUEL_PASSTHROUGH * 10, abs=0.001)

    def test_fuel_contribution_sign_positive(self):
        result = project(0, 30, 0, BASELINE_CARRIERS)
        assert result["fuel_contribution"] > 0

    def test_capacity_increase_relieves_pressure(self):
        """More seats → negative contribution (fare relief)."""
        result = project(0, 0, 10, BASELINE_CARRIERS)
        assert result["capacity_contribution"] < 0

    def test_capacity_decrease_adds_pressure(self):
        """Fewer seats → positive contribution."""
        result = project(0, 0, -10, BASELINE_CARRIERS)
        assert result["capacity_contribution"] > 0

    def test_capacity_only_value(self):
        result = project(0, 0, 10, BASELINE_CARRIERS)
        assert result["capacity_contribution"] == pytest.approx(CAPACITY_ELASTICITY * 10, abs=0.001)

    def test_competition_baseline_zero_contribution(self):
        result = project(0, 0, 0, BASELINE_CARRIERS)
        assert result["competition_contribution"] == pytest.approx(0.0, abs=0.001)

    def test_competition_monopoly_adds_pressure(self):
        result = project(0, 0, 0, 1)
        assert result["competition_contribution"] > 0

    def test_competition_many_carriers_relieves_pressure(self):
        result = project(0, 0, 0, 8)
        assert result["competition_contribution"] < 0

    def test_contributions_sum_to_total(self):
        result = project(10, 20, 5, 3)
        total = (
            result["demand_contribution"]
            + result["fuel_contribution"]
            + result["capacity_contribution"]
            + result["competition_contribution"]
        )
        assert result["projected_change_pct"] == pytest.approx(total, abs=0.01)


# ── project — projected_apix ──────────────────────────────────────────────────

class TestProjectedApix:
    def test_baseline_unchanged_at_zero(self):
        result = project(0, 0, 0, BASELINE_CARRIERS, baseline_apix=100.0)
        assert result["projected_apix"] == pytest.approx(100.0, abs=0.1)

    def test_apix_formula(self):
        result = project(10, 0, 0, BASELINE_CARRIERS, baseline_apix=100.0)
        expected = 100.0 * (1 + result["projected_change_pct"] / 100)
        assert result["projected_apix"] == pytest.approx(expected, abs=0.01)

    def test_custom_baseline_scales_proportionally(self):
        r1 = project(10, 5, 0, 3, baseline_apix=100.0)
        r2 = project(10, 5, 0, 3, baseline_apix=200.0)
        # Change pct is the same; apix scales with baseline.
        assert r1["projected_change_pct"] == pytest.approx(r2["projected_change_pct"])
        assert r2["projected_apix"] == pytest.approx(r1["projected_apix"] * 2, rel=0.001)

    def test_positive_change_raises_apix(self):
        result = project(20, 0, 0, BASELINE_CARRIERS)
        assert result["projected_apix"] > 100.0

    def test_negative_change_lowers_apix(self):
        result = project(0, 0, 30, BASELINE_CARRIERS)
        assert result["projected_apix"] < 100.0


# ── project — exposure proxy ──────────────────────────────────────────────────

class TestExposureProxy:
    def test_zero_change_zero_impact(self):
        result = project(0, 0, 0, BASELINE_CARRIERS)
        assert result["exposure_proxy"] == pytest.approx(0.0, abs=0.1)
        assert result["impact_score"] == result["exposure_proxy"]

    def test_impact_proportional_to_change(self):
        result = project(10, 0, 0, BASELINE_CARRIERS)
        expected = min(100.0, abs(result["projected_change_pct"]) * IMPACT_MULTIPLIER)
        assert result["exposure_proxy"] == pytest.approx(expected, abs=0.1)

    def test_impact_caps_at_100(self):
        """Very large scenario must not exceed 100."""
        result = project(50, 50, -50, 1)
        assert result["exposure_proxy"] <= 100.0

    def test_impact_non_negative(self):
        """Even a fare-relief scenario scores ≥ 0."""
        result = project(-50, -50, 50, 8)
        assert result["exposure_proxy"] >= 0.0

    def test_impact_symmetric(self):
        """Equal magnitude positive and negative changes have equal impact scores."""
        r_up   = project(20, 0, 0, BASELINE_CARRIERS)
        r_down = project(-20, 0, 0, BASELINE_CARRIERS)
        assert r_up["exposure_proxy"] == pytest.approx(r_down["exposure_proxy"], abs=0.1)


# ── project — risk_level ──────────────────────────────────────────────────────

class TestProjectRiskLevel:
    def test_zero_input_is_low(self):
        assert project(0, 0, 0, BASELINE_CARRIERS)["risk_level"] == "Low"

    def test_large_demand_surge_escalates(self):
        result = project(50, 0, 0, BASELINE_CARRIERS)
        assert result["risk_level"] == "Escalate"

    def test_monopoly_with_demand_spike(self):
        result = project(20, 0, 0, 1)
        assert result["risk_level"] in {"Review", "Escalate"}

    def test_high_competition_can_lower_risk(self):
        """Eight carriers significantly dampen fare pressure."""
        r_low_comp  = project(10, 0, 0, 1)
        r_high_comp = project(10, 0, 0, 8)
        # More competition → same demand change reads as lower risk (or equal).
        assert r_high_comp["projected_change_pct"] < r_low_comp["projected_change_pct"]


# ── project — output structure ────────────────────────────────────────────────

class TestProjectStructure:
    def test_all_keys_present(self):
        result = project(5, 10, -5, 3)
        required = {
            "demand_contribution", "fuel_contribution",
            "capacity_contribution", "competition_contribution",
            "projected_change_pct", "projected_apix",
            "exposure_proxy", "impact_score", "risk_level", "explanation",
            "model_metadata",
        }
        assert required.issubset(set(result.keys()))
        assert result["model_metadata"]["model_status"] == "UNCALIBRATED_ILLUSTRATIVE_SCENARIO"
        assert "No external study" in result["model_metadata"]["citation_status"]

    def test_explanation_is_non_empty_string(self):
        result = project(10, 5, 5, 3)
        assert isinstance(result["explanation"], str)
        assert len(result["explanation"]) > 20

    def test_risk_level_is_valid_string(self):
        for carriers in [1, 2, 4, 8]:
            result = project(10, 10, 0, carriers)
            assert result["risk_level"] in {"Low", "Watch", "Review", "Escalate"}

    def test_float_inputs_handled(self):
        result = project(7.5, 12.3, -3.1, 3)
        assert isinstance(result["projected_change_pct"], float)

    def test_large_negative_scenario(self):
        """Demand crash + capacity glut + many carriers → big negative change."""
        result = project(-30, -20, 40, 8)
        assert result["projected_change_pct"] < 0
