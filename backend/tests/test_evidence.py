"""
Tests that evidence metadata fields are present and valid in all engine outputs
used by the Evidence Trail feature (Feature 9).

These tests verify that the underlying engine functions return all the fields
the Evidence Trail UI depends on, without going through the HTTP layer.
"""
import csv
import io
import unittest

from app.engine.anomaly import detect_spikes
from app.engine.index import compute_index_timeseries, coverage_report
from app.ingestion.validate import validate_rows
from app.seed.generate_sample_data import generate


# ── shared fixture ────────────────────────────────────────────────────────────

_ACCEPTED: list[dict] | None = None


def _get_accepted() -> list[dict]:
    global _ACCEPTED
    if _ACCEPTED is None:
        rows = generate()
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
        accepted, _ = validate_rows(buf.getvalue())
        _ACCEPTED = accepted
    return _ACCEPTED


# ── spike evidence fields ─────────────────────────────────────────────────────

class TestSpikeEvidenceFields(unittest.TestCase):
    """Each flagged spike must carry every field the Evidence Trail UI renders."""

    @classmethod
    def setUpClass(cls):
        cls.flagged = detect_spikes(_get_accepted(), threshold=3.5)
        # Sanity: the fixture must produce at least one spike.
        assert cls.flagged, "No spikes detected — fixture data may be missing injected events"

    def _check_field(self, field: str):
        for spike in self.flagged[:10]:
            self.assertIn(field, spike, f"Spike missing required evidence field: {field!r}")

    def test_has_observation_id(self):
        self._check_field("observation_id")

    def test_has_route(self):
        self._check_field("route")

    def test_has_airline(self):
        self._check_field("airline")

    def test_has_fare_class(self):
        self._check_field("fare_class")

    def test_has_lead_bucket(self):
        self._check_field("lead_bucket")

    def test_has_cell_observations(self):
        for spike in self.flagged[:10]:
            self.assertIn("cell_observations", spike)
            self.assertIsInstance(spike["cell_observations"], int)
            self.assertGreater(spike["cell_observations"], 0)

    def test_has_cell_median_fare(self):
        for spike in self.flagged[:10]:
            self.assertIn("cell_median_fare", spike)
            self.assertGreater(spike["cell_median_fare"], 0)

    def test_robust_z_exceeds_threshold(self):
        for spike in self.flagged[:10]:
            self.assertIn("robust_z", spike)
            self.assertGreater(abs(spike["robust_z"]), 3.5)

    def test_has_pct_above_median(self):
        for spike in self.flagged[:10]:
            self.assertIn("pct_above_median", spike)
            # Both spikes (above) and drops (below) must have |pct| >= 25
            self.assertGreaterEqual(abs(spike["pct_above_median"]), 25.0)

    def test_has_confidence(self):
        for spike in self.flagged[:10]:
            self.assertIn("confidence", spike)
            self.assertIn(spike["confidence"], ("Low", "Medium", "High"))

    def test_has_severity(self):
        for spike in self.flagged[:10]:
            self.assertIn("severity", spike)
            self.assertIn(spike["severity"], ("Watch", "Review", "Escalate"))

    def test_has_direction(self):
        for spike in self.flagged[:10]:
            self.assertIn("direction", spike)
            self.assertIn(spike["direction"], ("spike", "drop"))

    def test_has_reason_code(self):
        for spike in self.flagged[:10]:
            self.assertIn("reason_code", spike)
            self.assertNotEqual(spike["reason_code"], "")

    def test_has_non_empty_explanation(self):
        for spike in self.flagged[:10]:
            self.assertIn("explanation", spike)
            self.assertGreater(len(spike["explanation"]), 30,
                               "Explanation should be a full sentence")

    def test_has_recommended_action(self):
        for spike in self.flagged[:10]:
            self.assertIn("recommended_action", spike)
            self.assertGreater(len(spike["recommended_action"]), 10)

    def test_has_impact_score_in_range(self):
        for spike in self.flagged[:10]:
            self.assertIn("impact_score", spike)
            self.assertGreaterEqual(spike["impact_score"], 0)
            self.assertLessEqual(spike["impact_score"], 100)

    def test_has_quote_date(self):
        self._check_field("quote_date")

    def test_has_travel_date(self):
        self._check_field("travel_date")

    def test_has_lead_days(self):
        self._check_field("lead_days")


# ── index timeseries evidence fields ─────────────────────────────────────────

class TestIndexEvidenceFields(unittest.TestCase):
    """The index timeseries must carry all coverage and quality fields the Evidence Trail shows."""

    @classmethod
    def setUpClass(cls):
        cls.series = compute_index_timeseries(_get_accepted(), granularity="day")
        assert cls.series, "Index timeseries is empty — fixture data problem"

    def test_has_observation_count(self):
        for point in self.series[:5]:
            self.assertIn("observation_count", point)
            self.assertGreater(point["observation_count"], 0)

    def test_has_coverage_pct(self):
        for point in self.series[:5]:
            self.assertIn("coverage_pct", point)
            self.assertGreaterEqual(point["coverage_pct"], 0.0)
            self.assertLessEqual(point["coverage_pct"], 100.0)

    def test_has_weight_coverage_pct(self):
        for point in self.series[:5]:
            self.assertIn("weight_coverage_pct", point)

    def test_has_quality_flag(self):
        for point in self.series[:5]:
            self.assertIn("quality_flag", point)
            self.assertIn(point["quality_flag"], ("GREEN", "AMBER", "RED"))

    def test_has_weighted_and_unweighted(self):
        for point in self.series[:5]:
            self.assertIn("apix_weighted", point)
            self.assertIn("apix_unweighted", point)
            self.assertGreater(point["apix_weighted"], 0)
            self.assertGreater(point["apix_unweighted"], 0)

    def test_has_active_and_total_cells(self):
        for point in self.series[:5]:
            self.assertIn("active_cells", point)
            self.assertIn("total_cells", point)
            self.assertGreater(point["total_cells"], 0)
            self.assertLessEqual(point["active_cells"], point["total_cells"])


# ── coverage report evidence fields ──────────────────────────────────────────

class TestCoverageEvidenceFields(unittest.TestCase):
    """coverage_report() must return all fields the Evidence Trail displays."""

    @classmethod
    def setUpClass(cls):
        cls.cov = coverage_report(_get_accepted())

    def test_has_total_cells(self):
        self.assertIn("total_cells", self.cov)
        self.assertGreater(self.cov["total_cells"], 0)

    def test_has_total_periods(self):
        self.assertIn("total_periods", self.cov)
        self.assertGreater(self.cov["total_periods"], 0)

    def test_has_mean_coverage_pct(self):
        self.assertIn("mean_coverage_pct", self.cov)
        self.assertGreater(self.cov["mean_coverage_pct"], 0.0)
        self.assertLessEqual(self.cov["mean_coverage_pct"], 100.0)

    def test_has_mean_weight_coverage_pct(self):
        self.assertIn("mean_weight_coverage_pct", self.cov)

    def test_has_complete_cells(self):
        self.assertIn("complete_cells", self.cov)
        self.assertGreaterEqual(self.cov["complete_cells"], 0)

    def test_has_quality_flag(self):
        self.assertIn("quality_flag", self.cov)
        self.assertIn(self.cov["quality_flag"], ("GREEN", "AMBER", "RED"))

    def test_empty_dataset_returns_red_flag(self):
        cov = coverage_report([])
        self.assertEqual(cov["quality_flag"], "RED")
        self.assertEqual(cov["total_cells"], 0)


if __name__ == "__main__":
    unittest.main()
