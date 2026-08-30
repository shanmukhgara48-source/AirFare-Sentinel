"""
CSV ingestion validation.

Checks run in a fixed order; each one either rejects a row with a named reason
or lets it through. A rejected row is quarantined with that reason and the
original text — nothing is ever silently dropped.

Aligned with monograph §8.1 (validation sequence) and Appendix G (reason codes).
"""
import csv
import io

from app.model import (
    FARE_CLASSES,
    MAX_PLAUSIBLE_FARE,
    MIN_PLAUSIBLE_FARE,
    RECONCILIATION_TOLERANCE,
    compute_lead_days,
    normalize_code,
    normalize_fare_simple,
    normalize_observation,
    parse_iso_date,
)

REQUIRED_COLUMNS = [
    "origin", "destination", "airline", "travel_date", "quote_date",
    "fare_class", "base_fare", "taxes_fees",
]

# Granular components are optional — the system works with just base_fare + taxes_fees
# but will use the breakdown if provided.
OPTIONAL_COLUMNS = ["total_fare", "airline_surcharge", "statutory_taxes", "airport_charges"]

VALID_FARE_CLASSES = set(FARE_CLASSES)


def validate_rows(csv_text: str) -> tuple[list[dict], list[dict]]:
    """Returns (accepted_rows, quarantined_rows). Quarantined rows carry a reject_reason."""
    reader = csv.DictReader(io.StringIO(csv_text))
    accepted: list[dict] = []
    quarantined: list[dict] = []
    seen_keys: set[tuple] = set()

    if reader.fieldnames is None:
        return [], [{"raw_row": "", "reject_reason": "EMPTY_FILE"}]

    missing = [c for c in REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        return [], [{
            "raw_row": ",".join(reader.fieldnames),
            "reject_reason": f"MISSING_COLUMNS: {', '.join(missing)}",
        }]

    has_granular = all(c in reader.fieldnames for c in
                       ["airline_surcharge", "statutory_taxes", "airport_charges"])

    for row in reader:
        raw = ",".join(str(row.get(c, "")) for c in REQUIRED_COLUMNS)

        def reject(reason: str) -> None:
            quarantined.append({"raw_row": raw, "reject_reason": reason})

        # 1. Schema and types
        try:
            origin = normalize_code(row["origin"])
            destination = normalize_code(row["destination"])
            airline = normalize_code(row["airline"])
            fare_class = normalize_code(row["fare_class"])
            travel_date = parse_iso_date(row["travel_date"])
            quote_date = parse_iso_date(row["quote_date"])
            base_fare = float(row["base_fare"])
            taxes_fees = float(row["taxes_fees"])
        except (ValueError, AttributeError, KeyError, TypeError) as exc:
            reject(f"SCHEMA_ERROR: {exc}")
            continue

        # Parse optional granular components
        airline_surcharge = 0.0
        statutory_taxes = None
        airport_charges = None
        if has_granular:
            try:
                airline_surcharge = float(row.get("airline_surcharge", 0) or 0)
                statutory_taxes = float(row.get("statutory_taxes", 0) or 0)
                airport_charges = float(row.get("airport_charges", 0) or 0)
            except (ValueError, TypeError):
                pass  # Fall back to 2-component mode

        # 2. Controlled vocabularies
        if len(origin) != 3 or not origin.isalpha() or len(destination) != 3 or not destination.isalpha():
            reject("INVALID_AIRPORT_CODE")
            continue

        if origin == destination:
            reject("ORIGIN_EQUALS_DESTINATION")
            continue

        if fare_class not in VALID_FARE_CLASSES:
            reject(f"INVALID_FARE_CLASS: {fare_class}")
            continue

        # 3. Fare sanity
        if base_fare <= 0 or taxes_fees < 0:
            reject("NON_POSITIVE_FARE")
            continue

        total_fare = normalize_fare_simple(base_fare, taxes_fees)
        if not MIN_PLAUSIBLE_FARE <= total_fare <= MAX_PLAUSIBLE_FARE:
            reject(
                f"FARE_OUT_OF_PLAUSIBLE_RANGE: {total_fare} outside "
                f"[{MIN_PLAUSIBLE_FARE:.0f}, {MAX_PLAUSIBLE_FARE:.0f}]"
            )
            continue

        # 4. Lead time
        if compute_lead_days(travel_date, quote_date) < 0:
            reject("QUOTE_DATE_AFTER_TRAVEL_DATE")
            continue

        # 5. Component reconciliation
        supplied_total = (row.get("total_fare") or "").strip()
        if supplied_total:
            try:
                if abs(float(supplied_total) - total_fare) > RECONCILIATION_TOLERANCE:
                    reject(
                        f"COMPONENTS_DO_NOT_RECONCILE: {supplied_total} != "
                        f"{base_fare} + {taxes_fees}"
                    )
                    continue
            except ValueError:
                pass

        # 6. Duplicates
        key = (origin, destination, airline, fare_class,
               travel_date.isoformat(), quote_date.isoformat())
        if key in seen_keys:
            reject("DUPLICATE_KEY")
            continue
        seen_keys.add(key)

        accepted.append(normalize_observation(
            origin=origin,
            destination=destination,
            airline=airline,
            fare_class=fare_class,
            travel_date=travel_date,
            quote_date=quote_date,
            base_fare=base_fare,
            taxes_fees=taxes_fees,
            airline_surcharge=airline_surcharge,
            statutory_taxes=statutory_taxes,
            airport_charges=airport_charges,
        ))

    return accepted, quarantined


def validate_live_quotes(quotes: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Validate pre-parsed live fare quote dicts from a provider.

    Runs the same checks as validate_rows() but on already-parsed dicts.
    Extended provider fields (source_type, provider, flight_number, offer_id,
    offer_expiry) are passed through unchanged on accepted rows.
    """
    accepted: list[dict] = []
    quarantined: list[dict] = []
    seen_keys: set[tuple] = set()

    for q in quotes:
        raw = (f"{q.get('origin')},{q.get('destination')},"
               f"{q.get('airline')},{q.get('travel_date')}")

        def _reject(reason: str, _q: dict = q) -> None:  # noqa: ANN001
            quarantined.append({"raw_row": raw, "reject_reason": reason})

        # 1. Parse and normalise
        try:
            origin = normalize_code(str(q["origin"]))
            destination = normalize_code(str(q["destination"]))
            airline = normalize_code(str(q["airline"]))
            fare_class = normalize_code(str(q.get("fare_class", "")))
            td = q["travel_date"]
            qd = q["quote_date"]
            travel_date = td if hasattr(td, "isoformat") else parse_iso_date(str(td))
            quote_date = qd if hasattr(qd, "isoformat") else parse_iso_date(str(qd))
            base_fare = float(q["base_fare"])
            taxes_fees = float(q.get("taxes_fees", 0.0))
        except (ValueError, AttributeError, KeyError, TypeError) as exc:
            _reject(f"SCHEMA_ERROR: {exc}")
            continue

        # 2. Controlled vocabularies
        if (len(origin) != 3 or not origin.isalpha()
                or len(destination) != 3 or not destination.isalpha()):
            _reject("INVALID_AIRPORT_CODE")
            continue

        if origin == destination:
            _reject("ORIGIN_EQUALS_DESTINATION")
            continue

        if fare_class not in VALID_FARE_CLASSES:
            _reject(f"INVALID_FARE_CLASS: {fare_class}")
            continue

        # 3. Fare sanity
        if base_fare <= 0 or taxes_fees < 0:
            _reject("NON_POSITIVE_FARE")
            continue

        total_fare = normalize_fare_simple(base_fare, taxes_fees)
        if not MIN_PLAUSIBLE_FARE <= total_fare <= MAX_PLAUSIBLE_FARE:
            _reject(
                f"FARE_OUT_OF_PLAUSIBLE_RANGE: {total_fare} outside "
                f"[{MIN_PLAUSIBLE_FARE:.0f}, {MAX_PLAUSIBLE_FARE:.0f}]"
            )
            continue

        # 4. Lead time
        if compute_lead_days(travel_date, quote_date) < 0:
            _reject("QUOTE_DATE_AFTER_TRAVEL_DATE")
            continue

        # 5. Duplicates within this batch
        key = (origin, destination, airline, fare_class,
               travel_date.isoformat(), quote_date.isoformat())
        if key in seen_keys:
            _reject("DUPLICATE_KEY")
            continue
        seen_keys.add(key)

        obs = normalize_observation(
            origin=origin,
            destination=destination,
            airline=airline,
            fare_class=fare_class,
            travel_date=travel_date,
            quote_date=quote_date,
            base_fare=base_fare,
            taxes_fees=taxes_fees,
        )
        # Preserve extended provider-sourced fields
        obs["source_type"] = q.get("source_type", "live")
        obs["provider"] = q.get("provider")
        obs["flight_number"] = q.get("flight_number")
        obs["offer_id"] = q.get("offer_id")
        obs["offer_expiry"] = q.get("offer_expiry")
        accepted.append(obs)

    return accepted, quarantined
