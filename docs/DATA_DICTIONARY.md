# APIx Data Dictionary

India Airfare Price Index — SIH 2026, Problem Statement 26056 (MoSPI).

> **All bundled data is synthetic.** Carrier codes are fictional so no invented price
> is ever attached to a real airline. Nothing in this repository is an official
> statistical release.

---

## 1. The unit of observation

One row = **one fare, for one carrier, on one route, in one fare class, seen on one
day, for one departure date.**

That is deliberately narrow. A fare is not a property of a flight — the same seat on
the same flight has a different price depending on the day you look. So the
observation date (`quote_date`) is part of the identity of the row, not metadata
about it.

**Natural key:** `(origin, destination, airline, fare_class, travel_date, quote_date)`
— enforced by a `UNIQUE` constraint on the `observations` table.

---

## 2. Table: `observations`

| Column | Type | Source | Description |
|---|---|---|---|
| `id` | INTEGER | generated | Surrogate primary key. |
| `origin` | TEXT | supplied | 3-letter IATA airport code, uppercased. `DEL`. |
| `destination` | TEXT | supplied | 3-letter IATA airport code, uppercased. `BOM`. |
| `airline` | TEXT | supplied | Carrier code, uppercased. Fictional in the sample: `SA1`, `BW2`, `NS3`, `CE9`. |
| `travel_date` | TEXT | supplied | ISO `YYYY-MM-DD`. The date of the flight. |
| `quote_date` | TEXT | supplied | ISO `YYYY-MM-DD`. The date the fare was observed. |
| `lead_days` | INTEGER | **derived** | `travel_date − quote_date`, in days. Never negative. |
| `lead_bucket` | TEXT | **derived** | The lead-time bucket `lead_days` falls into. See §4. |
| `fare_class` | TEXT | supplied | One of the four values in §3. |
| `base_fare` | REAL | supplied | Carrier's own base fare component, INR. |
| `airline_surcharge` | REAL | supplied/estimated | Carrier fuel/operational surcharge, INR. |
| `statutory_taxes` | REAL | supplied/estimated | GST + passenger service fee, INR. |
| `airport_charges` | REAL | supplied/estimated | UDF + PSF + CUTE charges, INR. |
| `taxes_fees` | REAL | supplied | Sum of non-base components (backward compat), INR. |
| `total_fare` | REAL | **derived** | Sum of all four price components. **This is the price the index is computed on.** |
| `source_batch_id` | TEXT | generated | The ingestion batch this row arrived in. |
| `created_at` | TEXT | generated | Ingest timestamp. |
| `source_type` | TEXT | generated | Provenance class: `demo`, `imported`, or `live`. |
| `provider` | TEXT | supplied/generated | Provider name for live rows, `demo` for bundled rows, otherwise NULL. |
| `flight_number` | TEXT | supplied | Provider flight reference when available. |
| `offer_id` | TEXT | supplied | Provider offer reference when available. |
| `offer_expiry` | TEXT | supplied | Provider offer expiry timestamp when available. |

### Price anatomy (monograph §4.2)

The fare is decomposed into four compulsory components:

```
total_fare = base_fare + airline_surcharge + statutory_taxes + airport_charges
```

| Component | Prototype estimated share | What it covers |
|---|---|---|
| `base_fare` | ~55% | Carrier's own fare |
| `airline_surcharge` | ~8% | Fuel surcharge, operational surcharge |
| `statutory_taxes` | ~22% | GST, passenger service fee |
| `airport_charges` | ~15% | UDF, PSF, CUTE |

These percentages are transparent fallback assumptions for legacy two-component
rows. They are not current statutory rates or observed component shares.

When ingesting legacy data that only provides `base_fare` + `taxes_fees`, the system
estimates the component split using explicit prototype proportions. This is
backward compatible, but the estimated components must not be presented as observed.

### Why the index uses `total_fare`, not `base_fare`

Carriers split the same headline price differently between the fare component and
statutory charges. An index built on `base_fare` would track tax policy and each
carrier's accounting conventions as much as it tracks price. Adding the components
back together gives the number a traveller actually pays, which is the only figure
comparable across carriers.

---

## 3. Fare classes

A fare class is a **product**, not a price band. Two carriers' `ECONOMY_SAVER` are
comparable to each other; `ECONOMY_SAVER` and `BUSINESS` never are.

| Code | Meaning |
|---|---|
| `ECONOMY_SAVER` | Restricted economy: lowest price, change and refund penalties. |
| `ECONOMY_FLEX` | Economy with free or low-cost changes. |
| `PREMIUM_ECONOMY` | Separate premium economy cabin. |
| `BUSINESS` | Business cabin. |

Rows carrying any other value are quarantined as `INVALID_FARE_CLASS`.

---

## 4. Lead-time buckets

Airfares are priced off how close to departure you book. A 2-day-out fare and a
40-day-out fare are different products even on the same flight, so lead time must be
part of what makes two fares comparable.

Raw `lead_days` is too fine to group on — each exact day would be its own thin,
unstable group. Buckets keep each group large enough to be statistically stable while
staying narrow enough that fares inside it are genuinely comparable.

| Code | Lead days | Label | Character |
|---|---|---|---|
| `D00_03` | 0–3 | 0–3 days | Last-minute; highest and most volatile fares. |
| `D04_07` | 4–7 | 4–7 days | Late booking. |
| `D08_14` | 8–14 | 8–14 days | The elbow of the booking curve. |
| `D15_30` | 15–30 | 15–30 days | Standard advance purchase. |
| `D31_PLUS` | 31+ | 31+ days | Early booking; lowest and most stable fares. |

**Boundaries are inclusive at both ends.** `lead_days = 3` is `D00_03`;
`lead_days = 4` is `D04_07`. Every non-negative lead time lands in exactly one
bucket, and the top bucket is open-ended upward.

**SIH problem statement anchors:** T+1, T+7, T+15, T+30, T+45 map to buckets
D00_03, D04_07, D15_30, D15_30, D31_PLUS respectively.

**Codes sort lexicographically into booking order**, so `ORDER BY lead_bucket` in SQL
and `sorted()` in Python both produce the right sequence without a lookup table.

---

## 5. The comparability cell

The **cell** is the central concept. It is the smallest group of observations treated
as like-for-like, and every number the system produces is built on it:

```
cell = (origin, destination, airline, fare_class, lead_bucket)
```

Two fares are compared to each other if and only if they share all five. This is
defined once, in `app.model.CELL_FIELDS`; change that tuple and you have changed what
the index measures, and nothing else needs to change with it.

What this buys, concretely:

- The index cannot mistake **a change in the booking mix for a change in price.** If
  travellers shift toward last-minute booking, the average fare paid rises — but each
  cell is unchanged, so the index correctly reports no price rise.
- The anomaly detector cannot flag **an expensive last-minute seat for being
  last-minute** — it is scored against other last-minute seats on the same route.
- Route direction matters: `DEL-BOM` and `BOM-DEL` are priced independently and are
  separate cells.

The sample dataset yields 14 routes × 4 carriers × 4 classes × 5 buckets = **1,120 cells.**

---

## 6. Route basket and weights (monograph §5)

### Table: `route_weights`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | Surrogate primary key. |
| `origin` | TEXT | IATA code. |
| `destination` | TEXT | IATA code. |
| `stratum` | TEXT | Route classification: `METRO_TRUNK`, `LARGE_INTERREGIONAL`, `SHORT_HAUL_BUSINESS`, `REGIONAL`. |
| `weight` | REAL | Illustrative traffic-proportional prototype weight; not a current official DGCA share. |
| `source` | TEXT | Weight source identifier. |
| `effective_from` | TEXT | ISO date, start of weight validity. |
| `effective_to` | TEXT | ISO date, end of weight validity (NULL = open). |

### Route basket (prototype)

| Stratum | Routes | Weight each | Subtotal |
|---|---|---|---|
| Metro trunk | DEL↔BOM, DEL↔BLR, BOM↔BLR | 6–14% | 60% |
| Large inter-regional | DEL↔CCU, DEL↔HYD | 5–6% | 22% |
| Short-haul business | BLR↔HYD | 4% | 8% |
| Regional | DEL↔MAA | 5% | 10% |

Weights are **fixed** for the index window (Laspeyres property). They sum to 1.0.
The cell weight is the product of three dimensions:

```
cell_weight = route_weight × fare_class_weight × lead_bucket_weight
```

Unknown routes receive zero weight in the weighted headline index but still
participate in the unweighted Jevons sensitivity series.

### Route strata

| Stratum | Character | Example routes |
|---|---|---|
| `METRO_TRUNK` | High-volume corridors between Tier-1 metros. Highest weight. | DEL↔BOM, DEL↔BLR, BOM↔BLR |
| `LARGE_INTERREGIONAL` | Busy routes connecting metros to secondary hubs. | DEL↔CCU, DEL↔HYD |
| `SHORT_HAUL_BUSINESS` | Short routes with high business-traveller share. | BLR↔HYD |
| `REGIONAL` | Routes connecting metros to regional capitals. | DEL↔MAA |

Strata are used for weight calibration and reporting — the index engine does not
treat strata differently beyond their assigned weights.

---

## 7. Fare normalisation

Applied in order, at ingest, in `app/model.py` and `app/ingestion/validate.py`.

| Step | Rule |
|---|---|
| Code casing | `origin`, `destination`, `airline`, `fare_class` are trimmed and uppercased. |
| Date parsing | Strict ISO `YYYY-MM-DD`. Anything else is `SCHEMA_ERROR`. |
| Total fare | `total_fare = base_fare + airline_surcharge + statutory_taxes + airport_charges`. |
| Lead time | `lead_days = travel_date − quote_date`; `lead_bucket` derived from it. |
| Plausibility | `total_fare` must be within ₹500 – ₹500,000. Outside that is almost always a units error, not a price. |
| Reconciliation | If the source supplies its own `total_fare`, it must match the components to within ₹1. |

### Rejection reasons

Every rejected row is stored in `quarantined_rows` with its original text and a named
reason. **Rows submitted always equals rows accepted plus rows quarantined** — nothing
is ever silently dropped, which is what makes an ingest auditable.

| Reason | Meaning |
|---|---|
| `EMPTY_FILE` | No parseable header. |
| `MISSING_COLUMNS` | A required column is absent — rejects the file, not each row. |
| `SCHEMA_ERROR` | A field could not be parsed to its type. |
| `INVALID_AIRPORT_CODE` | Not three alphabetic characters. |
| `ORIGIN_EQUALS_DESTINATION` | Not a route. |
| `INVALID_FARE_CLASS` | Outside the controlled vocabulary. |
| `NON_POSITIVE_FARE` | `base_fare ≤ 0` or `taxes_fees < 0`. |
| `FARE_OUT_OF_PLAUSIBLE_RANGE` | Outside ₹500 – ₹500,000. |
| `QUOTE_DATE_AFTER_TRAVEL_DATE` | Negative lead time — a fare quoted after departure. |
| `COMPONENTS_DO_NOT_RECONCILE` | Supplied total disagrees with the components by more than ₹1. |
| `DUPLICATE_KEY` | The natural key appears twice in the same file. |
| `DUPLICATE_OF_EXISTING_ROW` | The natural key is already in the database. |

---

## 8. Missing data

**Policy: a cell that reports nothing in a period is absent from that period. It is
never carried forward and never imputed.**

Carrying a stale price forward would make the index look stable precisely when the
data got worse, and imputing one would put a number we invented into an official
statistic. Both are worse than a smaller sample honestly reported.

The cost of that choice is that the basket changes composition between periods, so
every period reports what it actually observed:

| Field | Meaning |
|---|---|
| `active_cells` | Cells that reported in this period. |
| `total_cells` | Cells in the known universe (cells that have a base price at all). |
| `coverage_pct` | `100 × active_cells / total_cells`. |
| `weight_coverage_pct` | Sum of weights of active cells / sum of all cell weights × 100. |
| `quality_flag` | GREEN (≥90%), AMBER (80–90%), RED (<80%). Publication gate per monograph §22.4. |

### Missing data reason codes (production infrastructure)

The `MissingReason` enum in `app/model.py` defines why a cell may be absent. These
are not recorded in the MVP's database but are defined for production use:

| Code | Meaning |
|---|---|
| `NO_SCHEDULE` | No flight scheduled on this route/date. |
| `SOLD_OUT` | Flight exists but no inventory in this fare class. |
| `CANCELLED` | Flight cancelled by the carrier. |
| `CAPTCHA_BLOCKED` | Data collection blocked by anti-bot measures. |
| `SOURCE_DOWN` | The data source was unavailable during collection. |
| `PARSE_ERROR` | Data was collected but could not be parsed. |
| `QUALITY_MISMATCH` | Data was collected but failed quality checks. |

---

## 9. Quality flags (monograph §22.4)

| Flag | Coverage | Meaning |
|---|---|---|
| **GREEN** | ≥ 90% | Full publication — reliable period. |
| **AMBER** | 80–90% | Publish with advisory — coverage is thinning. |
| **RED** | < 80% | Caution — index may not be representative. |

Quality flags are computed per period and at the panel level.

---

## 10. Index formulas

### Headline: Weighted Laspeyres

```
APIx[t] = 100 × Σ (W[c] / ΣW) × R[c,t]
```

Where `W[c]` is the fixed cell weight and `R[c,t]` is the price relative of cell `c`
in period `t`.

### Sensitivity: Unweighted Jevons

```
Jevons[t] = 100 × exp( mean( ln R[c,t] for all active cells ) )
```

Geometric mean — every cell counts equally. Published alongside the headline so
analysts can see whether weighting changes the story.

### Reference price

```
P₀[c] = geometric_mean( fares in cell c on its first observed period )
```

Geometric mean, not arithmetic, for consistency with the Jevons form.

### Spike detection (robust z-score)

```
robust_z = 0.6745 × ( ln(fare) − median(ln fare) ) / MAD
```

Flagged when: `|robust_z| > threshold (default 3.5)` AND `|deviation| > 25%`.

---

## 11. CSV interchange format

Ingest accepts a compact source format. Export returns the full stored schema,
including derived fields and provenance, preceded by a one-line source disclaimer.

**Required columns** (in any order):

```
origin,destination,airline,travel_date,quote_date,fare_class,base_fare,taxes_fees
```

**Optional columns:** `airline_surcharge`, `statutory_taxes`, `airport_charges`,
`total_fare`.

When the optional four-component columns are provided, the full price anatomy is
recorded. When only `base_fare` + `taxes_fees` is given, the system estimates the
component split using the documented prototype proportions.

Example:

```csv
origin,destination,airline,travel_date,quote_date,fare_class,base_fare,taxes_fees,airline_surcharge,statutory_taxes,airport_charges
DEL,BOM,SA1,2026-09-20,2026-09-01,ECONOMY_SAVER,4000.00,840.00,320.00,352.00,168.00
HYD,BLR,CE9,2026-09-25,2026-09-18,BUSINESS,31200.50,6552.11,2496.04,4362.07,2090.45
```

---

## 12. The bundled sample dataset

Generated by `app/seed/generate_sample_data.py` with a fixed random seed (`26056`), so
it is byte-identical on every run and the demo never changes underneath you.

| Property | Value |
|---|---|
| Rows | 23,558 |
| Observation window | 2026-09-01 to 2026-09-30 (30 days) |
| Departure window | 2026-09-01 to 2026-11-29 |
| Routes | 14 directional (7 city pairs × both directions) |
| Carriers | 4, all fictional (SA1, BW2, NS3, CE9) |
| Fare classes | 4 |
| Lead buckets | 5 |
| Comparability cells | 1,120 |

The generator reproduces four effects a real airfare panel shows:

1. **A booking curve** — fares climb steeply inside the last two weeks.
2. **A class ladder** — saver < flex < premium economy < business.
3. **A seasonal bump** — a festive-week surge over 17–27 October, plus a weekend
   travel premium.
4. **Two injected fare events** for anomaly detection:
   - a **surge**: `HYD-BLR` on `CE9`, fares ×3.4 on quote dates 18–20 September;
   - a **promotional collapse**: `BOM-BLR` on `BW2`, fares ×0.42 on 24–25 September.

---

## 13. Path to real data

The model is deliberately source-agnostic: nothing above assumes where a fare came
from. The included Amadeus adapter and the CSV path both populate the same
`observations` table through the same validator. Additional licensed airline, GDS,
or NDC adapters can use that contract without changing the index engine.

**No scraping.** Everything bundled here is generated. The MVP does not, and must
not, acquire fares by any means that violates a provider's terms of service.
