"""Lead-time bucketing, fare normalisation, route weights and the comparability cell."""
import unittest
from datetime import date

from app.model import (
    LEAD_BUCKET_CODES,
    PS_LEAD_ANCHORS,
    PS_LEAD_ANCHOR_BUCKETS,
    ROUTE_BASKET,
    QualityFlag,
    cell_key,
    cell_weight,
    compute_lead_days,
    lead_bucket,
    normalize_fare,
    normalize_fare_simple,
    normalize_observation,
    quality_flag,
    route_weight,
)


class TestLeadBuckets(unittest.TestCase):
    def test_every_boundary(self):
        cases = [
            (0, "D00_03"), (1, "D00_03"), (3, "D00_03"),
            (4, "D04_07"), (7, "D04_07"),
            (8, "D08_14"), (14, "D08_14"),
            (15, "D15_30"), (30, "D15_30"),
            (31, "D31_PLUS"), (60, "D31_PLUS"), (365, "D31_PLUS"),
        ]
        for lead_days, expected in cases:
            with self.subTest(lead_days=lead_days):
                self.assertEqual(lead_bucket(lead_days), expected)

    def test_buckets_are_exhaustive_and_disjoint(self):
        for days in range(0, 401):
            self.assertIn(lead_bucket(days), LEAD_BUCKET_CODES)

    def test_negative_lead_time_is_rejected(self):
        with self.assertRaises(ValueError):
            lead_bucket(-1)

    def test_bucket_codes_sort_chronologically(self):
        self.assertEqual(sorted(LEAD_BUCKET_CODES), list(LEAD_BUCKET_CODES))

    def test_ps_lead_anchors_map_to_correct_buckets(self):
        """SIH problem statement T+1/7/15/30/45 anchor days."""
        expected = {
            1: "D00_03",
            7: "D04_07",
            15: "D15_30",
            30: "D15_30",
            45: "D31_PLUS",
        }
        for anchor in PS_LEAD_ANCHORS:
            with self.subTest(anchor=anchor):
                self.assertEqual(PS_LEAD_ANCHOR_BUCKETS[anchor], expected[anchor])


class TestNormalisation(unittest.TestCase):
    def test_total_is_base_plus_taxes_simple(self):
        self.assertEqual(normalize_fare_simple(4000.0, 840.0), 4840.0)

    def test_total_is_four_component_sum(self):
        """Monograph §4.2: total = base + surcharge + taxes + airport."""
        self.assertEqual(normalize_fare(3000.0, 450.0, 250.0, 100.0), 3800.0)

    def test_lead_days_is_travel_minus_quote(self):
        self.assertEqual(compute_lead_days(date(2026, 9, 20), date(2026, 9, 1)), 19)

    def test_same_day_booking_is_zero_lead(self):
        d = date(2026, 9, 1)
        self.assertEqual(compute_lead_days(d, d), 0)
        self.assertEqual(lead_bucket(0), "D00_03")

    def test_observation_has_granular_components(self):
        """When 4-component data is provided, all fields are populated."""
        obs = normalize_observation(
            origin="DEL", destination="BOM", airline="SA1",
            fare_class="ECONOMY_SAVER",
            travel_date=date(2026, 9, 20), quote_date=date(2026, 9, 1),
            base_fare=3000.0, taxes_fees=800.0,
            airline_surcharge=200.0, statutory_taxes=400.0, airport_charges=200.0,
        )
        self.assertEqual(obs["base_fare"], 3000.0)
        self.assertEqual(obs["airline_surcharge"], 200.0)
        self.assertEqual(obs["statutory_taxes"], 400.0)
        self.assertEqual(obs["airport_charges"], 200.0)
        self.assertEqual(obs["total_fare"], 3800.0)  # 3000+200+400+200

    def test_observation_backward_compat_without_components(self):
        """When only base_fare + taxes_fees is given, components are estimated."""
        obs = normalize_observation(
            origin="DEL", destination="BOM", airline="SA1",
            fare_class="ECONOMY_SAVER",
            travel_date=date(2026, 9, 20), quote_date=date(2026, 9, 1),
            base_fare=4000.0, taxes_fees=840.0,
        )
        self.assertEqual(obs["total_fare"], 4840.0)
        self.assertGreater(obs["statutory_taxes"], 0)
        self.assertGreater(obs["airport_charges"], 0)


class TestRouteWeights(unittest.TestCase):
    """Monograph §5: DGCA traffic-proportional route weights."""

    def test_basket_weights_sum_to_approximately_one(self):
        total = sum(w for _, w in ROUTE_BASKET.values())
        self.assertAlmostEqual(total, 1.0, places=2)

    def test_known_route_has_positive_weight(self):
        self.assertGreater(route_weight("DEL", "BOM"), 0)

    def test_unknown_route_has_zero_weight(self):
        self.assertEqual(route_weight("AAA", "BBB"), 0.0)

    def test_direction_has_separate_weight(self):
        """DEL-BOM and BOM-DEL may have different weights."""
        w1 = route_weight("DEL", "BOM")
        w2 = route_weight("BOM", "DEL")
        self.assertGreater(w1, 0)
        self.assertGreater(w2, 0)

    def test_cell_weight_is_product_of_three_dimensions(self):
        obs = {"origin": "DEL", "destination": "BOM", "airline": "SA1",
               "fare_class": "ECONOMY_SAVER", "lead_bucket": "D15_30"}
        w = cell_weight(obs)
        self.assertGreater(w, 0)


class TestQualityFlags(unittest.TestCase):
    """Monograph §22.4: coverage-based publication gates."""

    def test_green_above_90(self):
        self.assertEqual(quality_flag(95.0), QualityFlag.GREEN)
        self.assertEqual(quality_flag(90.0), QualityFlag.GREEN)

    def test_amber_80_to_90(self):
        self.assertEqual(quality_flag(85.0), QualityFlag.AMBER)
        self.assertEqual(quality_flag(80.0), QualityFlag.AMBER)

    def test_red_below_80(self):
        self.assertEqual(quality_flag(79.9), QualityFlag.RED)
        self.assertEqual(quality_flag(0.0), QualityFlag.RED)


class TestComparabilityCell(unittest.TestCase):
    def _obs(self, **overrides):
        base = {"origin": "DEL", "destination": "BOM", "airline": "SA1",
                "fare_class": "ECONOMY_SAVER", "lead_bucket": "D15_30"}
        return {**base, **overrides}

    def test_same_bucket_is_the_same_cell(self):
        self.assertEqual(cell_key(self._obs()), cell_key(self._obs()))

    def test_different_bucket_is_a_different_cell(self):
        self.assertNotEqual(
            cell_key(self._obs(lead_bucket="D00_03")),
            cell_key(self._obs(lead_bucket="D31_PLUS")),
        )

    def test_different_class_is_a_different_cell(self):
        self.assertNotEqual(
            cell_key(self._obs(fare_class="ECONOMY_SAVER")),
            cell_key(self._obs(fare_class="BUSINESS")),
        )

    def test_direction_matters(self):
        self.assertNotEqual(
            cell_key(self._obs(origin="DEL", destination="BOM")),
            cell_key(self._obs(origin="BOM", destination="DEL")),
        )


if __name__ == "__main__":
    unittest.main()
