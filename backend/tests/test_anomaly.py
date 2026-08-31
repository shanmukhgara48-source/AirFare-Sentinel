"""
Worked examples for spike detection.

    robust_z = 0.6745 × ( ln(fare) − median(ln fare) ) / MAD(ln fare)

A fare is flagged only when |robust_z| exceeds the threshold AND it sits at least
25% away from its cell's median fare.
"""
import unittest

from app.engine.anomaly import (
    MIN_CELL_OBSERVATIONS, REASON_GLOSSARY, assign_reason_code,
    classify_confidence, classify_severity, compute_impact_score,
    detect_spikes, explain_spike, recommend_action,
)


def cell(fares, route=("HYD", "CCU"), airline="CE9",
         fare_class="ECONOMY_SAVER", bucket="D04_07"):
    return [
        {
            "id": i, "origin": route[0], "destination": route[1], "airline": airline,
            "fare_class": fare_class, "lead_bucket": bucket, "lead_days": 5,
            "quote_date": f"2026-09-{i + 1:02d}", "travel_date": "2026-09-20",
            "total_fare": float(f),
        }
        for i, f in enumerate(fares)
    ]


class TestSpikeDetection(unittest.TestCase):
    def test_one_extreme_fare_among_stable_ones_is_flagged(self):
        """
        Nine fares near ₹5,000 and one at ₹18,000. The median and MAD are set by the
        nine, so the tenth cannot hide inside its own dispersion.
        """
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 18000])
        flagged = detect_spikes(rows)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["total_fare"], 18000.0)
        self.assertEqual(flagged[0]["direction"], "spike")
        self.assertGreater(flagged[0]["robust_z"], 3.5)
        self.assertGreater(flagged[0]["pct_above_median"], 200)

    def test_a_collapse_is_flagged_as_a_drop(self):
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 1400])
        flagged = detect_spikes(rows)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["direction"], "drop")
        self.assertLess(flagged[0]["robust_z"], -3.5)

    def test_ordinary_variation_is_not_flagged(self):
        rows = cell([4900, 5000, 5100, 5050, 4950, 5200, 4850, 5000, 5100, 4900])
        self.assertEqual(detect_spikes(rows), [])

    def test_mean_and_stddev_would_have_missed_it(self):
        """
        The reason for using median/MAD. With these fares the ordinary z-score of the
        outlier is under 3, because the outlier itself inflates the standard
        deviation it is measured against. The robust score is far above 3.5.
        """
        import statistics
        fares = [5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 18000]
        naive_z = (18000 - statistics.mean(fares)) / statistics.stdev(fares)
        self.assertLess(naive_z, 3.0)

        flagged = detect_spikes(cell(fares))
        self.assertGreater(flagged[0]["robust_z"], 3.5)


class TestMaterialityFloor(unittest.TestCase):
    def test_statistically_odd_but_economically_trivial_is_not_flagged(self):
        """
        Nine fares within ₹10 of each other and one 12% higher. The MAD is tiny, so
        the robust z is enormous — but a 12% move is not a fare spike, and the 25%
        materiality floor keeps it out.
        """
        rows = cell([5000, 5005, 4995, 5000, 5002, 4998, 5001, 4999, 5003, 5600])
        scored = detect_spikes(rows, min_pct_deviation=0.0)
        self.assertEqual(len(scored), 1)
        self.assertGreater(abs(scored[0]["robust_z"]), 3.5)  # passes the z test
        self.assertLess(abs(scored[0]["pct_above_median"]), 25)  # fails materiality

        self.assertEqual(detect_spikes(rows), [])  # so the default flags nothing

    def test_threshold_is_adjustable(self):
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 7000])
        self.assertGreaterEqual(len(detect_spikes(rows, threshold=2.5)), 1)
        self.assertEqual(detect_spikes(rows, threshold=20.0), [])


class TestInsufficientData(unittest.TestCase):
    def test_a_thin_cell_is_declined_not_guessed_at(self):
        """
        Below the minimum, no score is produced at all — the alternative is
        manufacturing a z-score from a handful of points of noise.
        """
        rows = cell([5000, 5100, 4950, 18000])
        self.assertLess(len(rows), MIN_CELL_OBSERVATIONS)
        self.assertEqual(detect_spikes(rows), [])

    def test_identical_fares_have_no_dispersion_to_score_against(self):
        self.assertEqual(detect_spikes(cell([5000] * 10)), [])


class TestCellIsolation(unittest.TestCase):
    def test_a_last_minute_fare_is_not_flagged_for_being_last_minute(self):
        """
        The property that makes the detector usable. Ten advance fares near ₹5,000
        and ten last-minute fares near ₹15,000, all on the same route and carrier.
        Pooled, the last-minute fares look like a mass of spikes; kept in their own
        lead-time bucket, none of them is unusual.
        """
        rows = (
            cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 4980],
                 bucket="D31_PLUS")
            + cell([15000, 15200, 14800, 15100, 15000, 14900, 15300, 15050, 14950, 15100],
                   bucket="D00_03")
        )
        self.assertEqual(detect_spikes(rows), [])

    def test_classes_are_scored_separately(self):
        rows = (
            cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 4980],
                 fare_class="ECONOMY_SAVER")
            + cell([19000, 19200, 18800, 19100, 19000, 18900, 19300, 19050, 18950, 19100],
                   fare_class="BUSINESS")
        )
        self.assertEqual(detect_spikes(rows), [])


class TestCaseFileClassification(unittest.TestCase):
    """Tests for the derived case-file fields added to each spike."""

    def test_severity_escalate_on_extreme_z(self):
        self.assertEqual(classify_severity(8.0, 30.0), "Escalate")

    def test_severity_escalate_on_extreme_pct(self):
        self.assertEqual(classify_severity(4.0, 120.0), "Escalate")

    def test_severity_review(self):
        self.assertEqual(classify_severity(5.5, 40.0), "Review")

    def test_severity_watch(self):
        self.assertEqual(classify_severity(4.0, 30.0), "Watch")

    def test_confidence_high(self):
        self.assertEqual(classify_confidence(50), "High")

    def test_confidence_medium(self):
        self.assertEqual(classify_confidence(20), "Medium")

    def test_confidence_low(self):
        self.assertEqual(classify_confidence(10), "Low")

    def test_detect_spikes_returns_case_file_fields(self):
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 18000])
        flagged = detect_spikes(rows)
        self.assertEqual(len(flagged), 1)
        s = flagged[0]
        self.assertIn(s["severity"], ("Watch", "Review", "Escalate"))
        self.assertIn(s["confidence"], ("Low", "Medium", "High"))
        self.assertIn(s["reason_code"], REASON_GLOSSARY)
        self.assertIn("₹", s["explanation"])
        self.assertGreater(len(s["recommended_action"]), 10)
        self.assertEqual(s["source_type"], "imported")
        self.assertEqual(s["source_label"], "Imported dataset")

    def test_explain_spike_includes_reason_detail(self):
        entry = {
            "route": "HYD-BLR", "airline": "CE9", "fare_class": "ECONOMY_SAVER",
            "lead_bucket": "D04_07", "lead_bucket_label": "4–7 days",
            "total_fare": 18000, "cell_median_fare": 5050,
            "pct_above_median": 256.4, "robust_z": 8.2,
            "cell_observations": 10, "direction": "spike",
            "travel_date": "2026-09-20", "reason_code": "LOW_COVERAGE_WARNING",
        }
        text = explain_spike(entry)
        self.assertIn("HYD-BLR", text)
        self.assertIn("18,000", text)
        self.assertIn("baseline may be thin", text)

    def test_recommend_action_varies_by_severity(self):
        esc = recommend_action("Escalate", "spike")
        watch = recommend_action("Watch", "spike")
        self.assertIn("regulatory", esc.lower())
        self.assertIn("no immediate", watch.lower())


class TestReasonCodes(unittest.TestCase):
    """Tests for deterministic reason-code assignment."""

    def _spike(self, **overrides):
        base = {
            "direction": "spike", "lead_bucket": "D15_30",
            "travel_date": "2026-09-15", "cell_observations": 30,
            "route": "DEL-BOM", "airline": "SA1",
        }
        base.update(overrides)
        return base

    def test_drop_always_gets_fare_drop_outlier(self):
        s = self._spike(direction="drop")
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=1)
        self.assertEqual(code, "FARE_DROP_OUTLIER")

    def test_low_coverage_warning(self):
        s = self._spike(cell_observations=10)
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=2)
        self.assertEqual(code, "LOW_COVERAGE_WARNING")

    def test_lead_time_surge_for_d00_03(self):
        s = self._spike(lead_bucket="D00_03")
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=2)
        self.assertEqual(code, "LEAD_TIME_SURGE")

    def test_festival_pattern_for_diwali(self):
        s = self._spike(travel_date="2026-10-20")
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=2)
        self.assertEqual(code, "FESTIVAL_PATTERN")

    def test_festival_pattern_for_christmas(self):
        s = self._spike(travel_date="2026-12-25")
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=2)
        self.assertEqual(code, "FESTIVAL_PATTERN")

    def test_carrier_specific_spike(self):
        s = self._spike()
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=1)
        self.assertEqual(code, "CARRIER_SPECIFIC_SPIKE")

    def test_low_competition_route(self):
        s = self._spike()
        code = assign_reason_code(s, route_carrier_count=2, route_flagged_carriers=2)
        self.assertEqual(code, "LOW_COMPETITION_ROUTE")

    def test_route_level_spike_fallback(self):
        s = self._spike()
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=3)
        self.assertEqual(code, "ROUTE_LEVEL_SPIKE")

    def test_all_reason_codes_in_glossary(self):
        """Every code the assigner can return must have a glossary entry."""
        all_codes = {
            "LEAD_TIME_SURGE", "ROUTE_LEVEL_SPIKE", "CARRIER_SPECIFIC_SPIKE",
            "FESTIVAL_PATTERN", "LOW_COMPETITION_ROUTE", "FARE_DROP_OUTLIER",
            "LOW_COVERAGE_WARNING",
        }
        self.assertEqual(all_codes, set(REASON_GLOSSARY.keys()))

    def test_integration_with_detect_spikes_on_surge(self):
        """The injected extreme fare should get a valid reason code."""
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 18000])
        flagged = detect_spikes(rows)
        self.assertEqual(len(flagged), 1)
        self.assertIn(flagged[0]["reason_code"], REASON_GLOSSARY)

    def test_integration_with_detect_spikes_on_drop(self):
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 1400])
        flagged = detect_spikes(rows)
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged[0]["reason_code"], "FARE_DROP_OUTLIER")

    def test_priority_order_drop_beats_lead_time(self):
        """Drops always get FARE_DROP_OUTLIER regardless of lead bucket."""
        s = self._spike(direction="drop", lead_bucket="D00_03")
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=1)
        self.assertEqual(code, "FARE_DROP_OUTLIER")

    def test_priority_order_low_coverage_beats_festival(self):
        """Low coverage overrides festival — the flag itself may be unreliable."""
        s = self._spike(cell_observations=10, travel_date="2026-10-20")
        code = assign_reason_code(s, route_carrier_count=4, route_flagged_carriers=1)
        self.assertEqual(code, "LOW_COVERAGE_WARNING")


class TestPassengerImpactScore(unittest.TestCase):
    """Tests for the Passenger Impact Score — formula properties, not exact values."""

    def test_high_traffic_route_scores_higher_than_low_traffic(self):
        """DEL-BOM (14% weight) must outscore BLR-HYD (4% weight) at identical other inputs."""
        del_bom = compute_impact_score("DEL-BOM", 50.0, "D15_30", "Watch", "High")
        blr_hyd = compute_impact_score("BLR-HYD", 50.0, "D15_30", "Watch", "High")
        self.assertGreater(del_bom, blr_hyd)

    def test_last_minute_booking_scores_higher_than_advance(self):
        """D00_03 urgency (1.5) must beat D31_PLUS (0.6) at identical other inputs."""
        last_min = compute_impact_score("DEL-BOM", 50.0, "D00_03", "Watch", "High")
        advance = compute_impact_score("DEL-BOM", 50.0, "D31_PLUS", "Watch", "High")
        self.assertGreater(last_min, advance)

    def test_escalate_scores_higher_than_watch(self):
        esc = compute_impact_score("DEL-BOM", 50.0, "D15_30", "Escalate", "High")
        watch = compute_impact_score("DEL-BOM", 50.0, "D15_30", "Watch", "High")
        self.assertGreater(esc, watch)

    def test_high_confidence_scores_higher_than_low(self):
        high = compute_impact_score("DEL-BOM", 50.0, "D15_30", "Watch", "High")
        low = compute_impact_score("DEL-BOM", 50.0, "D15_30", "Watch", "Low")
        self.assertGreater(high, low)

    def test_larger_deviation_scores_higher(self):
        big = compute_impact_score("DEL-BOM", 100.0, "D15_30", "Watch", "High")
        small = compute_impact_score("DEL-BOM", 30.0, "D15_30", "Watch", "High")
        self.assertGreater(big, small)

    def test_score_capped_at_100(self):
        """Extreme route + extreme deviation + highest urgency must not exceed 100."""
        score = compute_impact_score("DEL-BOM", 1000.0, "D00_03", "Escalate", "High")
        self.assertEqual(score, 100)

    def test_unknown_route_scores_zero(self):
        """A route not in the basket has zero traffic weight and therefore zero impact."""
        score = compute_impact_score("ZZZ-YYY", 100.0, "D00_03", "Escalate", "High")
        self.assertEqual(score, 0)

    def test_score_always_non_negative(self):
        self.assertGreaterEqual(compute_impact_score("BOM-DEL", 25.0, "D08_14", "Watch", "Low"), 0)

    def test_detect_spikes_includes_impact_score_field(self):
        rows = cell([5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 18000])
        flagged = detect_spikes(rows)
        self.assertEqual(len(flagged), 1)
        s = flagged[0]
        self.assertIn("impact_score", s)
        self.assertIsInstance(s["impact_score"], int)
        self.assertGreaterEqual(s["impact_score"], 0)
        self.assertLessEqual(s["impact_score"], 100)

    def test_impact_score_positive_for_basket_route(self):
        """DEL-BOM (14% basket weight) must yield impact_score > 0."""
        rows = cell(
            [5000, 5100, 4950, 5050, 5000, 4900, 5150, 5000, 5100, 18000],
            route=("DEL", "BOM"),
        )
        flagged = detect_spikes(rows)
        self.assertGreater(flagged[0]["impact_score"], 0)


if __name__ == "__main__":
    unittest.main()
