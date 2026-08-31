"""
Ingestion validation: every reject reason, and the guarantee that rows in equals
rows accepted plus rows quarantined.
"""
import unittest

from app.ingestion.validate import validate_rows

HEADER = ("origin,destination,airline,travel_date,quote_date,fare_class,"
          "base_fare,taxes_fees,total_fare")
GOOD = "DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,4840"


def csv_of(*rows):
    return "\n".join([HEADER, *rows]) + "\n"


class TestAcceptance(unittest.TestCase):
    def test_a_good_row_is_accepted_and_fully_derived(self):
        accepted, quarantined = validate_rows(csv_of(GOOD))
        self.assertEqual(quarantined, [])
        (row,) = accepted
        self.assertEqual(row["total_fare"], 4840.0)
        self.assertEqual(row["lead_days"], 19)
        self.assertEqual(row["lead_bucket"], "D15_30")

    def test_codes_are_normalised(self):
        accepted, _ = validate_rows(csv_of(
            " del , bom , sa1 ,2026-09-20,2026-09-01, economy_saver ,4000,840,4840"))
        self.assertEqual(accepted[0]["origin"], "DEL")
        self.assertEqual(accepted[0]["fare_class"], "ECONOMY_SAVER")

    def test_total_fare_column_is_optional(self):
        short_header = HEADER.rsplit(",", 1)[0]
        accepted, quarantined = validate_rows(
            f"{short_header}\nDEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840\n")
        self.assertEqual(quarantined, [])
        self.assertEqual(accepted[0]["total_fare"], 4840.0)


class TestRejections(unittest.TestCase):
    def _reason(self, row):
        accepted, quarantined = validate_rows(csv_of(row))
        self.assertEqual(accepted, [])
        self.assertEqual(len(quarantined), 1)
        return quarantined[0]["reject_reason"]

    def test_every_reject_reason(self):
        cases = [
            ("DEL,BOM,SA1,not-a-date,2026-09-01,ECONOMY_SAVER,4000,840,4840", "SCHEMA_ERROR"),
            ("DELHI,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,4840", "INVALID_AIRPORT_CODE"),
            ("DEL,DEL,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,4840", "ORIGIN_EQUALS_DESTINATION"),
            ("DEL,BOM,SA1,2026-09-20,2026-09-01,FIRST_CLASS,4000,840,4840", "INVALID_FARE_CLASS"),
            ("DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,-100,840,740", "NON_POSITIVE_FARE"),
            ("DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,100,20,120", "FARE_OUT_OF_PLAUSIBLE_RANGE"),
            ("DEL,BOM,SA1,2026-09-01,2026-09-20,ECONOMY_SAVER,4000,840,4840", "QUOTE_DATE_AFTER_TRAVEL_DATE"),
            ("DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,9999", "COMPONENTS_DO_NOT_RECONCILE"),
        ]
        for row, expected in cases:
            with self.subTest(reason=expected):
                self.assertTrue(self._reason(row).startswith(expected))

    def test_duplicate_within_a_batch(self):
        accepted, quarantined = validate_rows(csv_of(GOOD, GOOD))
        self.assertEqual(len(accepted), 1)
        self.assertEqual(quarantined[0]["reject_reason"], "DUPLICATE_KEY")

    def test_rounding_difference_is_tolerated(self):
        """A ₹0.50 discrepancy is rounding, not a disagreement about the price."""
        accepted, quarantined = validate_rows(csv_of(
            "DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,4840.5"))
        self.assertEqual(quarantined, [])
        self.assertEqual(len(accepted), 1)

    def test_missing_columns_reject_the_file_not_each_row(self):
        accepted, quarantined = validate_rows("origin,destination\nDEL,BOM\n")
        self.assertEqual(accepted, [])
        self.assertTrue(quarantined[0]["reject_reason"].startswith("MISSING_COLUMNS"))

    def test_invalid_optional_total_is_not_silently_ignored(self):
        accepted, quarantined = validate_rows(csv_of(
            "DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,not-a-number"
        ))
        self.assertEqual(accepted, [])
        self.assertTrue(quarantined[0]["reject_reason"].startswith("SCHEMA_ERROR"))
        self.assertIn("not-a-number", quarantined[0]["raw_row"])

    def test_non_finite_fare_is_rejected(self):
        reason = self._reason(
            "DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,nan,840,4840"
        )
        self.assertTrue(reason.startswith("SCHEMA_ERROR"))

    def test_invalid_airline_code_is_rejected(self):
        reason = self._reason(
            "DEL,BOM,,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,4840"
        )
        self.assertEqual(reason, "INVALID_AIRLINE_CODE")

    def test_invalid_granular_component_is_quarantined(self):
        header = (
            "origin,destination,airline,travel_date,quote_date,fare_class,"
            "base_fare,taxes_fees,total_fare,airline_surcharge,statutory_taxes,airport_charges"
        )
        row = (
            "DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,"
            "4000,840,4840,bad,500,340"
        )
        accepted, quarantined = validate_rows(f"{header}\n{row}\n")
        self.assertEqual(accepted, [])
        self.assertTrue(quarantined[0]["reject_reason"].startswith("SCHEMA_ERROR"))

    def test_granular_components_must_match_aggregate_fees(self):
        header = (
            "origin,destination,airline,travel_date,quote_date,fare_class,"
            "base_fare,taxes_fees,total_fare,airline_surcharge,statutory_taxes,airport_charges"
        )
        row = (
            "DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,"
            "4000,840,4840,100,200,300"
        )
        accepted, quarantined = validate_rows(f"{header}\n{row}\n")
        self.assertEqual(accepted, [])
        self.assertTrue(
            quarantined[0]["reject_reason"].startswith("COMPONENTS_DO_NOT_RECONCILE")
        )

    def test_empty_file(self):
        _, quarantined = validate_rows("")
        self.assertEqual(quarantined[0]["reject_reason"], "EMPTY_FILE")


class TestNothingIsLost(unittest.TestCase):
    def test_rows_in_equals_accepted_plus_quarantined(self):
        """The audit guarantee: no row is ever silently dropped."""
        rows = [
            GOOD,
            "BOM,DEL,BW2,2026-09-25,2026-09-01,ECONOMY_FLEX,5000,1050,6050",
            "DEL,DEL,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000,840,4840",
            "XX,BOM,SA1,2026-09-20,2026-09-02,ECONOMY_SAVER,4000,840,4840",
            GOOD,
        ]
        accepted, quarantined = validate_rows(csv_of(*rows))
        self.assertEqual(len(accepted) + len(quarantined), len(rows))
        self.assertEqual(len(accepted), 2)


if __name__ == "__main__":
    unittest.main()
