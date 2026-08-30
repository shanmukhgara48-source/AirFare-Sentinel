# How the Airfare Price Index Works
### Plain-language explanation for SIH judges

---

## The one-line version

> We track whether airfares are rising or falling by comparing today's fares to a
> starting point — but only comparing like with like, and weighting busy routes more
> heavily.

---

## Step by step

### Step 1: Define what "like with like" means

Not all fares are comparable. A last-minute business class ticket on Delhi-Mumbai
is a completely different product from an economy saver booked 45 days ahead on
Bangalore-Hyderabad. Comparing them would be meaningless.

So we group every fare into a **comparability cell** — five attributes that must
all match before two fares are compared:

```
Cell = (Origin, Destination, Airline, Fare Class, Booking Window)
```

**Example cell:** Delhi → Mumbai, on carrier SA1, Economy Saver, booked 15-30 days
before departure.

Only fares inside the same cell are ever compared to each other. This is the key
design decision — it prevents the index from confusing a shift in *what people are
booking* with a change in *what things cost*.

### Step 2: Set a starting point (base price)

For each cell, we take the geometric mean of all fares observed on the first day.
That becomes the cell's **reference price** (P₀). The index reads exactly **100**
on that day.

*Why geometric mean?* Because airfares are proportional — a ₹40,000 business fare
and a ₹3,000 economy fare should contribute equally as percentage moves, not as
rupee amounts. The geometric mean handles this naturally.

### Step 3: Compute how much each cell has moved

On any later day, we take the geometric mean of fares in that cell and divide by
the reference price. This gives us a **price relative**:

```
Price relative = Today's geometric mean fare ÷ Reference price
```

- If the relative is **1.10**, fares in this cell have risen 10%.
- If it is **0.95**, fares have fallen 5%.
- If it is **1.00**, no change.

### Step 4: Combine cells into a national index (weighted)

Now we need one number for the whole market. We use a **weighted average** of all
the price relatives.

**The headline formula (Laspeyres):**

```
APIx[today] = 100 × Σ (Weight[cell] × Price relative[cell])
```

The prototype uses **illustrative traffic-proportional route weights**. The
Delhi-Mumbai corridor carries 14% of the prototype basket in each direction so
the method demonstrates traffic-weighted aggregation. These are not current
official DGCA route shares; production publication requires current calibration.

This means a 10% rise on Delhi-Mumbai moves the headline index more than a 10%
rise on Bangalore-Hyderabad — which is correct, because it affects more passengers.

### Step 5: Publish a sensitivity check (unweighted)

Alongside the headline, we also compute an **unweighted index** using the geometric
mean of all cells equally:

```
Sensitivity[today] = 100 × geometric mean of all price relatives
```

When the two numbers diverge, it tells us something important:
- **Weighted rises, unweighted flat** → fares are rising specifically on high-traffic
  trunk routes.
- **Both rise together** → broad-based fare increase across the market.
- **Weighted flat, unweighted rises** → fares are rising on smaller routes but the
  big corridors are stable.

---

## A worked example (calculator-friendly)

Two cells, both on Delhi-Mumbai (weight 0.50 each after normalization):

| Cell | Day 1 fare | Day 2 fare | Relative |
|------|-----------|-----------|----------|
| Economy Saver, 15-30 days | ₹4,000 | ₹4,400 | 1.10 |
| Business, 15-30 days | ₹10,000 | ₹9,000 | 0.90 |

**Weighted headline:**
```
APIx = 100 × (0.50 × 1.10 + 0.50 × 0.90) = 100 × 1.00 = 100.00
```
→ "No overall change" — the +10% and -10% cancel when equally weighted.

**Unweighted Jevons:**
```
Sensitivity = 100 × √(1.10 × 0.90) = 100 × √0.99 = 99.50
```
→ Slightly below 100, because the geometric mean correctly reflects that a 10%
rise and 10% fall don't perfectly offset.

Both numbers are published. The 0.50-point gap is the **sensitivity divergence** —
it tells the analyst that the weighting scheme matters for this period.

---

## Key design choices (and why)

| Choice | Why |
|--------|-----|
| **5 lead-time buckets** (0-3, 4-7, 8-14, 15-30, 31+ days) | Booking lead time is a major driver of fare level. Without it, the index would partly track *when people book* rather than *what fares cost*. |
| **Geometric mean, not arithmetic** | A ₹40,000 fare and a ₹3,000 fare contribute equally as percentage moves. A doubling and a halving correctly offset. |
| **Prototype traffic weights** | Busy routes should count more. Current DGCA calibration is required before publication. |
| **No imputation of missing data** | If a cell has no observation, we don't guess — we just note smaller coverage. Inventing a price for an official statistic is worse than a smaller sample honestly reported. |
| **4-component price anatomy** | `total = base + surcharge + taxes + airport`. Supports component analysis when the source supplies those values; legacy two-component rows use a documented prototype split. |
| **Robust z-score for anomalies** | Uses median and MAD instead of mean and standard deviation. A single extreme fare can inflate a standard deviation enough to hide itself — it cannot move a median. |
| **Quality flags** (GREEN/AMBER/RED) | Coverage ≥90% = GREEN, 80-90% = AMBER, <80% = RED. These are explicit prototype publication gates. |

---

## How data flows through the system

```
  CSV / API feed
       │
       ▼
  ┌─────────────┐     quarantined rows
  │  VALIDATOR   │────────────────────► audit log
  │  (12 checks) │
  └──────┬───────┘
         │ clean observations
         ▼
  ┌─────────────┐
  │  NORMALIZER  │  base + surcharge + taxes + airport = total
  │  (4 components)│  lead_days → lead_bucket
  └──────┬───────┘
         │ normalized observations
         ▼
  ┌─────────────┐
  │  CELL ENGINE │  group by (route, airline, class, bucket)
  │              │  P₀ = geometric mean of first-day fares
  │              │  R[t] = geom_mean(today) / P₀
  └──────┬───────┘
         │ price relatives per cell
         ▼
  ┌─────────────────────────────────────────┐
  │              AGGREGATION                │
  │                                         │
  │  Weighted Laspeyres    Unweighted Jevons│
  │  (headline)            (sensitivity)    │
  │  100 × Σ W·R           100 × exp(mean   │
  │                         ln R)           │
  └──────┬──────────────────┬───────────────┘
         │                  │
         ▼                  ▼
  ┌─────────────┐   ┌──────────────┐
  │  QUALITY    │   │  ANOMALY     │
  │  FLAGS      │   │  DETECTOR    │
  │  G/A/R      │   │  robust z    │
  └─────────────┘   └──────────────┘
```

---

## Why this matters for India (SIH context)

1. **The SIH problem statement calls for a domestic-airfare index.** This
   prototype demonstrates a route, carrier, fare-class, and lead-time design.

2. **Traffic and fare observations solve different parts of the problem.** A
   production route basket could use a current authoritative traffic source;
   this prototype demonstrates the method with illustrative weights.

3. **Booking lead time is a major confound.** A naive average of airfares would
   show prices "rising" whenever travellers book later. The 5-bucket design
   reduces this mix effect by treating each bucket as a separate product.

4. **Four-component price anatomy supports policy analysis.** When a source
   supplies observed components, the system can separate base fare, surcharge,
   tax, and airport-charge movement. Legacy two-component rows use an illustrative
   split and must not be interpreted as observed component values.

5. **Reproducible and auditable.** Every rejected row is stored with its reason. The
   sample dataset is deterministic (seed 26056). Any judge can re-run the code and
   get identical results.

---

## What this is NOT

- **Not real market data.** Every fare in the demo is synthetic. Carriers are
  fictional.
- **Not transacted fares.** These are *offered* prices, not proof anyone paid them.
- **Not seasonally adjusted.** Festive and weekday effects are visible in the series,
  not removed from it.

---

## Summary for presentation

> "We built a price index for domestic airfares using the same statistical methods
> that national statistical offices use for consumer price indices. Every fare is
> compared only against the same route, airline, cabin class, and booking window.
> We aggregate using illustrative traffic weights so that trunk routes count
> proportionally, with current DGCA calibration required for production.
> The index reads 100 at the start — above 100 means fares have risen, below means
> they've fallen. We publish a sensitivity check alongside the headline so analysts
> can see whether the weighting changes the story. Missing data is never imputed,
> and every period reports its actual coverage with a traffic-light quality flag."
