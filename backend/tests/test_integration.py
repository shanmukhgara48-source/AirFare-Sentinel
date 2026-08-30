"""
Integration test: full pipeline from sample generation through index computation.

Exercises: generate → validate → index → spikes → contributions → head-to-head.
"""
import csv
import io
import unittest

from app.seed.generate_sample_data import generate
from app.ingestion.validate import validate_rows
from app.engine.index import (
    compute_contributions,
    compute_head_to_head,
    compute_index_timeseries,
    sensitivity_weighted_vs_unweighted,
)
from app.engine.anomaly import detect_spikes


def _generate_csv() -> str:
    """Generate sample data and return as CSV string."""
    rows = generate()
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


# Cache across tests — generation is deterministic (seed 26056).
_CSV_CACHE: str | None = None
_ACCEPTED_CACHE: list[dict] | None = None


def _get_csv() -> str:
    global _CSV_CACHE
    if _CSV_CACHE is None:
        _CSV_CACHE = _generate_csv()
    return _CSV_CACHE


def _get_accepted() -> list[dict]:
    global _ACCEPTED_CACHE
    if _ACCEPTED_CACHE is None:
        accepted, _ = validate_rows(_get_csv())
        _ACCEPTED_CACHE = accepted
    return _ACCEPTED_CACHE


class TestSampleDataValidation(unittest.TestCase):
    """The sample generator must produce data that passes all validation checks."""

    def test_sample_data_validates_cleanly(self):
        accepted, quarantined = validate_rows(_get_csv())
        self.assertGreater(len(accepted), 20000)
        self.assertEqual(len(quarantined), 0,
                         f"Quarantined rows: {quarantined[:5]}")

    def test_sample_has_14_routes(self):
        accepted = _get_accepted()
        routes = {(r["origin"], r["destination"]) for r in accepted}
        self.assertEqual(len(routes), 14)

    def test_sample_has_4_carriers(self):
        accepted = _get_accepted()
        airlines = {r["airline"] for r in accepted}
        self.assertEqual(airlines, {"SA1", "BW2", "NS3", "CE9"})

    def test_sample_has_all_fare_classes(self):
        accepted = _get_accepted()
        classes = {r["fare_class"] for r in accepted}
        self.assertEqual(classes, {"ECONOMY_SAVER", "ECONOMY_FLEX",
                                   "PREMIUM_ECONOMY", "BUSINESS"})

    def test_sample_has_all_lead_buckets(self):
        accepted = _get_accepted()
        buckets = {r["lead_bucket"] for r in accepted}
        self.assertEqual(buckets, {"D00_03", "D04_07", "D08_14",
                                    "D15_30", "D31_PLUS"})


class TestIndexPipeline(unittest.TestCase):
    """Index computation on sample data produces valid, non-trivial results."""

    def test_headline_starts_at_100(self):
        series = compute_index_timeseries(_get_accepted(), granularity="day")
        self.assertGreater(len(series), 0)
        self.assertAlmostEqual(series[0]["apix_weighted"], 100.0, places=0)

    def test_both_weighted_and_unweighted_computed(self):
        series = compute_index_timeseries(_get_accepted(), granularity="day")
        for point in series:
            self.assertIn("apix_weighted", point)
            self.assertIn("apix_unweighted", point)
            self.assertGreater(point["apix_weighted"], 0)
            self.assertGreater(point["apix_unweighted"], 0)

    def test_weighted_and_unweighted_differ(self):
        series = compute_index_timeseries(_get_accepted(), granularity="day")
        # They should differ on at least some periods.
        diffs = [abs(s["apix_weighted"] - s["apix_unweighted"]) for s in series]
        self.assertGreater(max(diffs), 0.01,
                           "Weighted and unweighted should diverge on real data")

    def test_every_period_has_quality_flag(self):
        series = compute_index_timeseries(_get_accepted(), granularity="day")
        for point in series:
            self.assertIn(point["quality_flag"], ("GREEN", "AMBER", "RED"))

    def test_weekly_granularity_has_fewer_periods(self):
        daily = compute_index_timeseries(_get_accepted(), granularity="day")
        weekly = compute_index_timeseries(_get_accepted(), granularity="week")
        self.assertGreater(len(daily), len(weekly))


class TestSpikeDetection(unittest.TestCase):
    """The injected surge and collapse events must be detected."""

    def test_spikes_detected_on_sample_data(self):
        flagged = detect_spikes(_get_accepted(), threshold=3.5)
        self.assertGreater(len(flagged), 0, "No spikes detected at all")

    def test_surge_event_detected(self):
        """HYD-BLR CE9 surge (×3.4 on Sep 18-20) should be flagged."""
        flagged = detect_spikes(_get_accepted(), threshold=3.0)
        surge_flags = [
            f for f in flagged
            if f["route"] == "HYD-BLR" and f["airline"] == "CE9"
            and f["direction"] == "spike"
        ]
        self.assertGreater(len(surge_flags), 0,
                           "HYD-BLR CE9 surge event not detected")

    def test_drop_event_detected(self):
        """BOM-BLR BW2 promo collapse (×0.42 on Sep 24-25) should be flagged."""
        flagged = detect_spikes(_get_accepted(), threshold=3.0)
        drop_flags = [
            f for f in flagged
            if f["route"] == "BOM-BLR" and f["airline"] == "BW2"
            and f["direction"] == "drop"
        ]
        self.assertGreater(len(drop_flags), 0,
                           "BOM-BLR BW2 promo collapse not detected")

    def test_flagged_fares_have_required_fields(self):
        flagged = detect_spikes(_get_accepted(), threshold=3.5)
        if flagged:
            for f in flagged[:5]:
                for field in ("observation_id", "route", "airline", "fare_class",
                              "lead_bucket", "total_fare", "cell_median_fare",
                              "robust_z", "direction"):
                    self.assertIn(field, f, f"Missing field {field}")


class TestContributions(unittest.TestCase):

    def test_contributions_sum_approximately_to_total_change(self):
        accepted = _get_accepted()
        series = compute_index_timeseries(accepted, granularity="day")
        total_change = series[-1]["apix_weighted"] - series[0]["apix_weighted"]

        contribs = compute_contributions(accepted, granularity="day")
        contrib_sum = sum(c["contribution_pts"] for c in contribs)

        # Should be close — not exact due to rounding and weight renormalization.
        self.assertAlmostEqual(contrib_sum, total_change, delta=1.0)

    def test_contributions_are_sorted_by_magnitude(self):
        contribs = compute_contributions(_get_accepted(), granularity="day")
        magnitudes = [abs(c["contribution_pts"]) for c in contribs]
        self.assertEqual(magnitudes, sorted(magnitudes, reverse=True))


class TestSensitivity(unittest.TestCase):

    def test_sensitivity_returns_divergence_metrics(self):
        result = sensitivity_weighted_vs_unweighted(_get_accepted(), "day")
        self.assertIn("max_divergence_pts", result)
        self.assertIn("mean_divergence_pts", result)
        self.assertGreater(result["periods"], 0)


class TestHeadToHead(unittest.TestCase):

    def test_head_to_head_returns_all_airlines_on_route(self):
        results = compute_head_to_head(_get_accepted(), "DEL", "BOM")
        airlines = {r["airline"] for r in results}
        self.assertEqual(airlines, {"SA1", "BW2", "NS3", "CE9"})

    def test_head_to_head_with_fare_class_filter(self):
        results = compute_head_to_head(
            _get_accepted(), "DEL", "BOM", fare_class="ECONOMY_SAVER")
        self.assertGreater(len(results), 0)
        for r in results:
            self.assertIn("avg_fare", r)
            self.assertIn("index_change", r)

    def test_head_to_head_empty_on_nonexistent_route(self):
        results = compute_head_to_head(_get_accepted(), "AAA", "BBB")
        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
