# Our Solution — For SIH Judges

**APIx: India Airfare Price Index**

---

## The one-sentence version

> We built a price index for domestic airfares using the same statistical
> methods that national statistical offices use for consumer price indices —
> comparing only like with like, using illustrative traffic weights, and
> detecting anomalies without being fooled by booking-mix effects.

---

## How it works (5 key ideas)

### 1. The comparability cell

Every fare is grouped into a **cell** defined by five attributes:

```
Cell = (Origin, Destination, Airline, Fare Class, Booking Lead Time)
```

Two fares are compared if and only if they share all five. This prevents
the index from confusing a change in *what people book* with a change in
*what things cost*.

**Example:** Delhi→Mumbai, on carrier SA1, Economy Saver, booked 15-30
days before departure. Only other fares matching all five attributes are
compared.

### 2. Geometric mean (Jevons formula)

Within each cell, we use a **geometric mean** — the standard for elementary
aggregates in consumer price indices worldwide.

Why not arithmetic mean? Because fare movements are proportional. A ₹40,000
business fare and a ₹3,000 economy fare should contribute equally as
percentage moves, not as rupee amounts. The geometric mean does this
naturally.

### 3. Prototype traffic weights (Laspeyres aggregation)

Cells are combined into a prototype basket using **fixed illustrative traffic
weights**. The Delhi-Mumbai corridor carries 14% of the prototype basket. These
are modelling assumptions, not current official DGCA route shares; production
publication requires calibration with current traffic data.
Each route's fixed weight is allocated equally across its observed carriers so
routes with broader carrier coverage do not gain extra influence.

```
APIx[t] = 100 × Σ (Weight[cell] × Price Relative[cell])
```

The indicator reads 100 at the start. Above 100 = matched basket fares have
risen. Below 100 = they have fallen. A national label is not published under
RED coverage.

### 4. Dual publication (weighted + unweighted)

We publish **two lines** on every chart:
- **Weighted Laspeyres** (publication-gated indicator) — reflects the prototype traffic-weight assumptions
- **Unweighted Jevons** (sensitivity) — treats every cell equally

When they diverge, it tells us whether price movements are concentrated on
high-traffic trunk routes or spread across the market. This is a built-in
robustness check.

### 5. Honest missing data

If a cell has no observation in a period, we **do not impute or carry
forward**. We report the coverage gap and flag it:
- **GREEN** (≥90% coverage) — reliable
- **AMBER** (80-90%) — publish with advisory
- **RED** (<80%) — suppress the national headline; show only an Experimental Basket Indicator with the reason

---

## What we built (concrete deliverables)

### Data model
- **23,558** synthetic fare observations
- **14** directional routes (7 city pairs × both directions)
- **4** fictional carriers, **4** fare classes, **5** lead-time buckets
- **1,120** comparability cells
- **4-component price anatomy:** base + surcharge + taxes + airport charges
- **Named validation rules** with explicit rejection reasons

### Index engine
- Weighted Laspeyres headline + unweighted Jevons sensitivity
- Geometric mean reference prices (per cell)
- Daily and weekly granularity
- Contribution decomposition (which cells are driving the change)
- Route, airline, fare class, and lead-time group indices

### Anomaly detection
- Robust z-score on log-transformed fares
- Median + MAD (not mean + stddev) — outlier-resistant
- Dual threshold: statistical (z > 3.5) AND economic (> 25% deviation)
- Within-cell only — a last-minute fare is never flagged for being expensive

### Dashboard
- Single-page Overview with 6 stat cards, dual-line chart, filters, airline
  comparison, route table, alert panel, and methodology explanation
- 9 additional routes: Trends, Compare, Fare Alerts, Competition,
  Vulnerability, Fairness Lens, What-If, Admin, and Methodology
- Responsive design (mobile + desktop)
- Professional design system (IBM Plex fonts, teal/grey palette)

### Quality assurance
- **A focused automated backend suite** covering engines, ingestion, APIs, provenance, and demo safety
- 5 statistical properties verified: identity, proportionality,
  commensurability, permutation invariance, weight conservation
- Full integration test: generate → validate → index → spikes → contributions
- Deterministic sample data (fixed seed 26056) — results identical on every run

---

## What makes this solution different

| Aspect | Naive approach | Our approach |
|--------|---------------|--------------|
| Booking lead time | Ignored — mixing 1-day and 45-day fares | 5 buckets, each a separate product |
| Aggregation | Arithmetic mean | Geometric mean (Jevons) — proportional moves |
| Weighting | Equal | Illustrative traffic-proportional prototype (Laspeyres) |
| Missing data | Carry forward or impute | Never — report gap honestly |
| Anomaly detection | Mean + stddev | Median + MAD (outlier-resistant) |
| Price anatomy | Lump sum | 4 components (base, surcharge, taxes, airport) |
| Transparency | Black box | Reproducible by hand; focused engine and API tests verify |

---

## Alignment with the problem statement

| PS Requirement | How we address it |
|----------------|-------------------|
| Price index for domestic airfares | Publication-gated weighted Laspeyres prototype, base = 100 |
| T+1, T+7, T+15, T+30, T+45 anchors | 5 lead-time buckets covering all anchors |
| Route-level analysis | 14 directional routes with independent indices |
| Airline-level comparison | Per-carrier index + head-to-head comparison |
| Anomaly detection | Robust z-score with dual threshold |
| International statistical standards | Jevons + Laspeyres, quality flags, no imputation |
