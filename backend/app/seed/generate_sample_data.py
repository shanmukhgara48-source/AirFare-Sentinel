"""
Generates the bundled demo dataset.

Everything here is SYNTHETIC. Carriers are fictional so no invented price is
ever attached to a real airline. The generator reproduces five effects a real
airfare panel shows:

  * a booking curve   — fares climb steeply inside the last two weeks
  * a class ladder    — saver < flex < premium economy < business
  * a seasonal bump   — a festive-week surge in late October, plus weekend travel
  * price component anatomy — realistic split into base, surcharge, taxes, airport
  * two injected fare events — one surge, one promotional collapse

Route basket aligned with monograph §5.1: DGCA traffic-stratified prototype.
Lead-time anchors include T+1, T+7, T+15, T+30, T+45 per problem statement.

Run: python -m app.seed.generate_sample_data
"""
import csv
import math
import random
from datetime import date, timedelta
from pathlib import Path

from app.model import LEAD_BUCKETS, ROUTE_BASKET, RouteStratum

OUT_PATH = Path(__file__).resolve().parent / "sample_airfares.csv"

random.seed(26056)  # deterministic

# Fictional carriers: Skyline Air, BlueWing, NorthStar, Coastal Express.
AIRLINES = ["SA1", "BW2", "NS3", "CE9"]
AIRLINE_MULTIPLIER = {"SA1": 1.0, "BW2": 0.92, "NS3": 1.12, "CE9": 0.86}

# Route base prices (INR) — derived from illustrative economy fares on these
# city pairs, adjusted for route distance and competition intensity.
ROUTES = [
    # Metro trunk
    ("DEL", "BOM", 4200),
    ("BOM", "DEL", 4300),
    ("DEL", "BLR", 5100),
    ("BLR", "DEL", 5000),
    ("BOM", "BLR", 3400),
    ("BLR", "BOM", 3500),
    # Large inter-regional
    ("DEL", "CCU", 4800),
    ("CCU", "DEL", 4700),
    ("DEL", "HYD", 4600),
    ("HYD", "DEL", 4500),
    # Short-haul business
    ("BLR", "HYD", 2800),
    ("HYD", "BLR", 2900),
    # Regional
    ("DEL", "MAA", 5400),
    ("MAA", "DEL", 5300),
]

FARE_CLASS_MULTIPLIER = {
    "ECONOMY_SAVER": 1.0,
    "ECONOMY_FLEX": 1.35,
    "PREMIUM_ECONOMY": 2.1,
    "BUSINESS": 3.8,
}

# Draw one fare from each lead-time bucket on each observation day.
BUCKET_DRAW_RANGES = {
    code: (low, high if high is not None else 60)
    for code, low, high, _ in LEAD_BUCKETS
}

QUOTE_START = date(2026, 9, 1)
QUOTE_DAYS = 30

# Price component shares — monograph §4.2 and §25.3.
# Based on typical Indian domestic fare anatomy:
#   base_fare:         ~55% of total (carrier revenue)
#   airline_surcharge:  ~8% (fuel surcharge, convenience fee)
#   statutory_taxes:   ~22% (GST 5% + passenger service fee + segment fee)
#   airport_charges:   ~15% (UDF + PSF + CUTE charges)
COMPONENT_SHARES = {
    "base_fare": 0.55,
    "airline_surcharge": 0.08,
    "statutory_taxes": 0.22,
    "airport_charges": 0.15,
}

# --- injected fare events -------------------------------------------------
# Capacity crunch: HYD-BLR fares with Coastal Express roughly triple for three days.
SURGE = {
    "route": ("HYD", "BLR"),
    "airline": "CE9",
    "quote_dates": (date(2026, 9, 18), date(2026, 9, 20)),
    "multiplier": 3.4,
}

# Promotional sale: BOM-BLR with BlueWing drops to 42% of normal.
PROMO = {
    "route": ("BOM", "BLR"),
    "airline": "BW2",
    "quote_dates": (date(2026, 9, 24), date(2026, 9, 25)),
    "multiplier": 0.42,
}


def lead_time_multiplier(lead_days: int) -> float:
    """Fares rise steeply as departure approaches."""
    return 1.0 + 0.9 * math.exp(-lead_days / 14.0)


def seasonal_multiplier(travel_date: date) -> float:
    """Festive bump in late October, and a milder weekend-travel premium."""
    if date(2026, 10, 17) <= travel_date <= date(2026, 10, 27):
        return 1.18
    if travel_date.weekday() in (4, 6):
        return 1.08
    return 1.0


def _event_multiplier(event: dict, origin: str, destination: str,
                      airline: str, quote_date: date) -> float:
    start, end = event["quote_dates"]
    if ((origin, destination) == event["route"]
            and airline == event["airline"]
            and start <= quote_date <= end):
        return event["multiplier"]
    return 1.0


def generate() -> list[dict]:
    rows = []

    for day_offset in range(QUOTE_DAYS):
        quote_date = QUOTE_START + timedelta(days=day_offset)

        for origin, destination, base_price in ROUTES:
            for airline in AIRLINES:
                # Not every carrier has inventory on every route every day (~10% missing).
                if random.random() < 0.10:
                    continue

                event_mult = (
                    _event_multiplier(SURGE, origin, destination, airline, quote_date)
                    * _event_multiplier(PROMO, origin, destination, airline, quote_date)
                )

                for low, high in BUCKET_DRAW_RANGES.values():
                    lead = random.randint(low, high)
                    travel_date = quote_date + timedelta(days=lead)

                    for fare_class, class_mult in FARE_CLASS_MULTIPLIER.items():
                        # Premium cabins not always offered.
                        if fare_class in ("PREMIUM_ECONOMY", "BUSINESS") and random.random() < 0.4:
                            continue

                        price = (
                            base_price
                            * class_mult
                            * AIRLINE_MULTIPLIER[airline]
                            * lead_time_multiplier(lead)
                            * seasonal_multiplier(travel_date)
                            * random.uniform(0.94, 1.06)
                            * event_mult
                        )

                        total = round(price, 2)

                        # Split into 4 components per monograph §4.2.
                        bf = round(total * COMPONENT_SHARES["base_fare"], 2)
                        asc = round(total * COMPONENT_SHARES["airline_surcharge"], 2)
                        st = round(total * COMPONENT_SHARES["statutory_taxes"], 2)
                        ac = max(0.0, round(total - bf - asc - st, 2))  # remainder to airport, clamped

                        taxes_fees = round(asc + st + ac, 2)

                        rows.append({
                            "origin": origin,
                            "destination": destination,
                            "airline": airline,
                            "travel_date": travel_date.isoformat(),
                            "quote_date": quote_date.isoformat(),
                            "fare_class": fare_class,
                            "base_fare": bf,
                            "airline_surcharge": asc,
                            "statutory_taxes": st,
                            "airport_charges": ac,
                            "taxes_fees": taxes_fees,
                            "total_fare": total,
                        })

    return rows


def main() -> None:
    rows = generate()
    with OUT_PATH.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
