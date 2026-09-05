"""
The APIx data model — one file, one source of truth.

Ingestion, the index engine, the anomaly detector and the API all import their
definitions from here, so the model can never drift between the code that writes
rows and the code that reads them.

Aligned with: SIH 26056 research monograph §4 (measurement design), §5 (route
basket and weighting), §8 (missingness), §9 (index methodology), §20
(mathematical specification) and Appendix A/D (data dictionary).
"""
from datetime import date, datetime
from enum import Enum

# ================================================================== vocabularies

# Ordered cheapest-to-dearest. A fare class is a *product*, not a price band.
FARE_CLASSES = ("ECONOMY_SAVER", "ECONOMY_FLEX", "PREMIUM_ECONOMY", "BUSINESS")
FARE_CLASS_RANK = {name: i for i, name in enumerate(FARE_CLASSES)}

# ------------------------------------------------------------------ lead-time

# Booking lead-time buckets. Codes sort lexicographically into chronological
# order so `ORDER BY lead_bucket` and `sorted()` both give the right sequence.
#
# The SIH problem statement specifies T+1/T+7/T+15/T+30/T+45 as anchor days.
# Buckets group those anchors into statistically stable groups while keeping
# fares within each group genuinely comparable.
LEAD_BUCKETS = (
    ("D00_03", 0, 3, "0–3 days"),
    ("D04_07", 4, 7, "4–7 days"),
    ("D08_14", 8, 14, "8–14 days"),
    ("D15_30", 15, 30, "15–30 days"),
    ("D31_PLUS", 31, None, "31+ days"),
)

LEAD_BUCKET_CODES = tuple(code for code, _, _, _ in LEAD_BUCKETS)
LEAD_BUCKET_LABELS = {code: label for code, _, _, label in LEAD_BUCKETS}
LEAD_BUCKET_RANK = {code: i for i, code in enumerate(LEAD_BUCKET_CODES)}

# Anchor lead days from the SIH problem statement [S1-S2].
PS_LEAD_ANCHORS = (1, 7, 15, 30, 45)

# Map each anchor to its bucket.
PS_LEAD_ANCHOR_BUCKETS = {}
for _anchor in PS_LEAD_ANCHORS:
    for _code, _low, _high, _ in LEAD_BUCKETS:
        if _high is None or _anchor <= _high:
            if _anchor >= _low:
                PS_LEAD_ANCHOR_BUCKETS[_anchor] = _code
                break


def lead_bucket(lead_days: int) -> str:
    """Map a booking lead time in days to its bucket code."""
    if lead_days < 0:
        raise ValueError(f"lead_days must be non-negative, got {lead_days}")
    for code, low, high, _ in LEAD_BUCKETS:
        if high is None or lead_days <= high:
            if lead_days >= low:
                return code
    return LEAD_BUCKET_CODES[-1]


def lead_bucket_label(code: str) -> str:
    return LEAD_BUCKET_LABELS.get(code, code)


# ------------------------------------------------------------------ price anatomy

# Monograph §4.2: total_payable = base_fare + airline_surcharge + statutory_taxes
#                                + airport_charges + mandatory_channel_fee.
# Optional ancillaries are excluded — they are separate consumption choices.
PRICE_COMPONENTS = (
    "base_fare",
    "airline_surcharge",
    "statutory_taxes",
    "airport_charges",
)

# Fare plausibility bounds (INR).
MIN_PLAUSIBLE_FARE = 500.0
MAX_PLAUSIBLE_FARE = 500_000.0

# Component reconciliation tolerance (INR).
RECONCILIATION_TOLERANCE = 2.0


# ------------------------------------------------------------------ route basket

# Prototype stratum labels; not calibrated to current DGCA passenger volumes.
# Direction is explicit — DEL-BOM and BOM-DEL are distinct products.
class RouteStratum(str, Enum):
    METRO_TRUNK = "METRO_TRUNK"
    LARGE_INTERREGIONAL = "LARGE_INTERREGIONAL"
    SHORT_HAUL_BUSINESS = "SHORT_HAUL_BUSINESS"
    REGIONAL = "REGIONAL"


# Prototype route basket with illustrative traffic-proportional weights.
# Production publication requires calibration against a current authoritative
# route-volume source; these are clearly labelled as prototype fallbacks.
ROUTE_BASKET = {
    # (origin, destination): (stratum, prototype_weight)
    # Metro trunk — highest passenger volume
    ("DEL", "BOM"): (RouteStratum.METRO_TRUNK, 0.14),
    ("BOM", "DEL"): (RouteStratum.METRO_TRUNK, 0.14),
    ("DEL", "BLR"): (RouteStratum.METRO_TRUNK, 0.10),
    ("BLR", "DEL"): (RouteStratum.METRO_TRUNK, 0.10),
    ("BOM", "BLR"): (RouteStratum.METRO_TRUNK, 0.06),
    ("BLR", "BOM"): (RouteStratum.METRO_TRUNK, 0.06),
    # Large inter-regional
    ("DEL", "CCU"): (RouteStratum.LARGE_INTERREGIONAL, 0.06),
    ("CCU", "DEL"): (RouteStratum.LARGE_INTERREGIONAL, 0.06),
    ("DEL", "HYD"): (RouteStratum.LARGE_INTERREGIONAL, 0.05),
    ("HYD", "DEL"): (RouteStratum.LARGE_INTERREGIONAL, 0.05),
    # Short-haul business
    ("BLR", "HYD"): (RouteStratum.SHORT_HAUL_BUSINESS, 0.04),
    ("HYD", "BLR"): (RouteStratum.SHORT_HAUL_BUSINESS, 0.04),
    # Regional / contestable
    ("DEL", "MAA"): (RouteStratum.REGIONAL, 0.05),
    ("MAA", "DEL"): (RouteStratum.REGIONAL, 0.05),
}

# Lead-bucket weights: equal in prototype per monograph §5.2.
LEAD_BUCKET_WEIGHTS = {code: 1.0 / len(LEAD_BUCKET_CODES) for code in LEAD_BUCKET_CODES}

# Fare-class weights: prototype equal weights.
FARE_CLASS_WEIGHTS = {fc: 1.0 / len(FARE_CLASSES) for fc in FARE_CLASSES}


def route_weight(origin: str, destination: str) -> float:
    """Return the prototype traffic weight for a route direction."""
    return ROUTE_BASKET.get((origin, destination), (None, 0.0))[1]


def cell_weight(obs: dict) -> float:
    """
    Composite cell weight = route_weight × lead_bucket_weight × fare_class_weight.
    Monograph §9.1: W[g] are fixed cell weights that sum to 1.
    """
    rw = route_weight(obs["origin"], obs["destination"])
    lw = LEAD_BUCKET_WEIGHTS.get(obs["lead_bucket"], 0.0)
    fw = FARE_CLASS_WEIGHTS.get(obs["fare_class"], 0.0)
    return rw * lw * fw


# ------------------------------------------------------------------ quality flags

# Monograph §22.4: coverage-based publication gates.
class QualityFlag(str, Enum):
    GREEN = "GREEN"    # Coverage >= 90%; publish normally
    AMBER = "AMBER"    # Coverage 80-90%; publish provisional with banner
    RED = "RED"        # Coverage < 80%; suppress headline
    REVISED = "REVISED"


def quality_flag(weight_coverage_pct: float) -> QualityFlag:
    if weight_coverage_pct >= 90.0:
        return QualityFlag.GREEN
    elif weight_coverage_pct >= 80.0:
        return QualityFlag.AMBER
    else:
        return QualityFlag.RED


# ------------------------------------------------------------------ missingness

# Monograph §8.2: every absence is reason-coded, never silently dropped.
class MissingReason(str, Enum):
    NO_SCHEDULE = "NO_SCHEDULE"        # No flight scheduled for that route/date
    SOLD_OUT = "SOLD_OUT"              # Service exists but no sellable offer
    CANCELLED = "CANCELLED"            # Flight withdrawn
    CAPTCHA_BLOCKED = "CAPTCHA_BLOCKED"  # Access control stopped collection
    SOURCE_DOWN = "SOURCE_DOWN"        # Transient network/server failure
    PARSE_ERROR = "PARSE_ERROR"        # Response received but schema broken
    QUALITY_MISMATCH = "QUALITY_MISMATCH"  # Offer differs in quality dimension


# ------------------------------------------------------------------ normalisation

def normalize_code(value: str) -> str:
    """Airport, carrier and fare-class codes are compared case-/space-insensitively."""
    return value.strip().upper()


def parse_iso_date(value: str) -> date:
    return datetime.strptime(value.strip(), "%Y-%m-%d").date()


def compute_lead_days(travel_date: date, quote_date: date) -> int:
    return (travel_date - quote_date).days


def normalize_fare(base_fare: float, airline_surcharge: float,
                   statutory_taxes: float, airport_charges: float) -> float:
    """
    Monograph §4.2: total_payable = base_fare + airline_surcharge +
    statutory_taxes + airport_charges.

    The index is computed on the all-inclusive fare a traveller actually pays.
    Optional ancillaries are excluded — they are separate consumption choices.
    """
    return round(base_fare + airline_surcharge + statutory_taxes + airport_charges, 2)


def normalize_fare_simple(base_fare: float, taxes_fees: float) -> float:
    """Backward-compatible 2-component normalization for CSV ingestion."""
    return round(base_fare + taxes_fees, 2)


def normalize_observation(
    origin: str,
    destination: str,
    airline: str,
    fare_class: str,
    travel_date: date,
    quote_date: date,
    base_fare: float,
    taxes_fees: float,
    airline_surcharge: float = 0.0,
    statutory_taxes: float | None = None,
    airport_charges: float | None = None,
) -> dict:
    """Turn validated raw fields into the canonical observation record."""
    lead_days = compute_lead_days(travel_date, quote_date)

    # If granular components are provided, use them. Otherwise split taxes_fees
    # into approximate components for backward compatibility.
    if statutory_taxes is not None and airport_charges is not None:
        st = statutory_taxes
        ac = airport_charges
        asc = airline_surcharge
        total = normalize_fare(base_fare, asc, st, ac)
    else:
        # Legacy 2-component split: approximate breakdown.
        asc = 0.0
        st = round(taxes_fees * 0.65, 2)   # ~65% statutory (GST + segment)
        ac = round(taxes_fees * 0.35, 2)    # ~35% airport (UDF + PSF + CUTE)
        total = normalize_fare_simple(base_fare, taxes_fees)

    return {
        "origin": normalize_code(origin),
        "destination": normalize_code(destination),
        "airline": normalize_code(airline),
        "fare_class": normalize_code(fare_class),
        "travel_date": travel_date.isoformat(),
        "quote_date": quote_date.isoformat(),
        "lead_days": lead_days,
        "lead_bucket": lead_bucket(lead_days),
        "base_fare": round(base_fare, 2),
        "airline_surcharge": round(asc, 2),
        "statutory_taxes": round(st, 2),
        "airport_charges": round(ac, 2),
        "taxes_fees": round(taxes_fees if statutory_taxes is None else asc + st + ac, 2),
        "total_fare": total,
    }


# ================================================================== comparability cell

# The five fields that make two fares comparable. Change this tuple and you
# have changed what the index measures.
CELL_FIELDS = ("origin", "destination", "airline", "fare_class", "lead_bucket")


def cell_key(obs: dict) -> tuple:
    """The comparability cell an observation belongs to."""
    return tuple(obs[field] for field in CELL_FIELDS)


def cell_label(key: tuple) -> str:
    origin, destination, airline, fare_class, bucket = key
    return f"{origin}-{destination} · {airline} · {fare_class} · {lead_bucket_label(bucket)}"


def route_of(obs: dict) -> str:
    return f"{obs['origin']}-{obs['destination']}"


# The dimensions an index can be broken down by.
GROUP_FIELDS = {
    "route": route_of,
    "airline": lambda o: o["airline"],
    "fare_class": lambda o: o["fare_class"],
    "lead_bucket": lambda o: o["lead_bucket"],
}
