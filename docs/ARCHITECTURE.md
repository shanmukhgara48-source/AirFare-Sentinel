# Technical Architecture — For SIH Judges

**APIx: India Airfare Price Index**

---

## System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (React 19)                        │
│                                                                     │
│  Overview │ Alerts │ Competition │ Vulnerability │ Fairness │ What-If │
│  Trends   │ Compare │ Admin       │ Methodology                         │
│                                                                     │
│  api.ts ─── typed fetch client ─── application endpoints           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / JSON
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     FastAPI (Python 3.12+)                          │
│                                                                     │
│  main.py ─── 26 API endpoints                                      │
│     │                                                               │
│     ├── engine/index.py ─── Laspeyres + Jevons index computation   │
│     ├── engine/anomaly.py ─── robust z-score spike detection        │
│     ├── engine/{competition,vulnerability,fairness,whatif}.py      │
│     ├── providers/ ─── demo + credential-gated Amadeus adapters    │
│     ├── ingestion/validate.py ─── named-rule row validator          │
│     ├── model.py ─── vocabularies, weights, normalisation          │
│     └── db/database.py ─── SQLite connection manager               │
│                                                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ SQL
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     SQLite (apix.db)                                │
│                                                                     │
│  observations ─── 23,558 rows (synthetic)                          │
│  route_weights ─── 14 directional routes                           │
│  analysis_state ─── one active provenance cohort                    │
│  ingestion_batches ─── upload history                              │
│  quarantined_rows ─── rejected rows with reason codes              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Layer responsibilities

### 1. Frontend (React + TypeScript + Tailwind + Recharts)

| File | Role |
|------|------|
| `api.ts` | Typed API client — every endpoint has a named method |
| `pages/Overview.tsx` | Single-page dashboard: 6 stat cards, dual-line chart, airline comparison, route table, lead-time chart, alerts, methodology explainer |
| `pages/Trends.tsx` | Filtered index series, booking curve, fare class breakdown |
| `pages/Compare.tsx` | Route-vs-route and airline-vs-airline comparison |
| `pages/Spikes.tsx` | Anomaly detection results with adjustable threshold |
| `pages/Competition.tsx` | Route Competition Monitor using an observation-share proxy |
| `pages/Vulnerability.tsx` | Within-cell residual-volatility scoring and filters |
| `pages/Fairness.tsx` | Like-for-like category indices with Unclassified fallback |
| `pages/Whatif.tsx` | Backend-derived uncalibrated scenario formula |
| `pages/Admin.tsx` | Data ingestion, active-source selection, observation browser, clear data |
| `pages/Methodology.tsx` | Full methodology explanation with formulas and worked example |
| `components/Layout.tsx` | Navigation, page container |
| `components/ui.tsx` | Reusable card, badge, table components |
| `components/chart.ts` | Shared chart colour palette |

**Design system:** IBM Plex fonts (Sans, Serif, Mono), teal/grey palette, responsive layout.

### 2. API layer (FastAPI)

26 endpoints organized into four groups:

**Dashboard endpoints** (read-only, no auth needed for demo):
- `GET /api/overview` — publication-gated basket indicator with index series
- `GET /api/filters` — available filter values
- `GET /api/trends` — filtered index with booking curve
- `GET /api/spikes` — anomaly detection with adjustable threshold
- `GET /api/competition` — route concentration monitoring
- `GET /api/vulnerability` — lead-time vulnerability scores
- `GET /api/events` — illustrative event calendar
- `GET /api/fairness` — policy-category comparison

**System endpoints:**
- `GET /api/health` — liveness check
- `GET /api/version` — operating mode plus stored-data provenance
- `GET /api/provider/status` — credential readiness and live-fetch gate

**Analysis endpoints:**
- `GET /api/compare`, `/api/head-to-head`, `/api/contributions`, `/api/sensitivity`
- `GET /api/whatif` — deterministic scenario calculation

**Admin endpoints** (would be auth-gated in production):
- `POST /api/admin/load-sample` — load bundled synthetic data
- `POST /api/admin/upload` — ingest a CSV file
- `GET/POST /api/admin/analysis-source` — inspect or switch the isolated provenance cohort
- `GET /api/admin/batches` — ingestion history
- `GET /api/admin/observations` — raw observation browser
- `DELETE /api/admin/data` — clear all data
- `POST /api/admin/live-fetch` — gated provider fetch
- `GET /api/admin/live-fetch/status` — current process fetch status
- `GET /api/export/observations.csv` — filtered CSV download

### 3. Computation engine

The computation engines are pure functions with no database dependency and are
testable in isolation:

**`engine/index.py`** — Index computation
- `compute_index_timeseries()` — daily or weekly Laspeyres headline + Jevons sensitivity
- `compute_group_index()` — breakdown by route, airline, fare class, or lead bucket
- `compute_contributions()` — which cells are driving the headline change
- `compute_head_to_head()` — airline-vs-airline stats on a specific route
- `sensitivity_weighted_vs_unweighted()` — divergence analysis
- `coverage_report()` — quality flag computation

**`engine/anomaly.py`** — Spike detection
- `detect_spikes()` — robust z-score on log-transformed fares
- Uses median + MAD (not mean + stddev) — resistant to the very outliers it's looking for
- Dual threshold: statistical (z > 3.5) AND economic (> 25% deviation)

Additional engines cover event context, competition, vulnerability, fairness,
and what-if scenarios. Vulnerability removes within-cell price levels before
aggregating residual volatility. Fairness compares category index movement with
basket index movement. What-If coefficients are explicitly uncalibrated.

### 4. Data model (`model.py`)

Single source of truth for all vocabularies, weights, and normalisation logic:
- Fare classes: `ECONOMY_SAVER`, `ECONOMY_FLEX`, `PREMIUM_ECONOMY`, `BUSINESS`
- Lead-time buckets: `D00_03`, `D04_07`, `D08_14`, `D15_30`, `D31_PLUS`
- 14-route basket with illustrative traffic-proportional prototype weights
- Equal carrier allocation within each route prevents observed carrier count
  from changing that route's published weight
- 4-component price anatomy: `base_fare + airline_surcharge + statutory_taxes + airport_charges`
- Quality flags: GREEN (≥90%), AMBER (80–90%), RED (<80%)
- Comparability cell definition: `(origin, destination, airline, fare_class, lead_bucket)`

### 5. Ingestion pipeline (`ingestion/validate.py`)

Rows follow a fixed validation sequence. Every row is either accepted or
quarantined with a named reason:

| Code | What it checks |
|------|---------------|
| `EMPTY_FILE` / `MISSING_COLUMNS` | File and required-column checks |
| `SCHEMA_ERROR` | Type and ISO-date parsing |
| `INVALID_AIRPORT_CODE` | 3-letter IATA format |
| `ORIGIN_EQUALS_DESTINATION` | Origin differs from destination |
| `INVALID_AIRLINE_CODE` | 2–3 character alphanumeric carrier code |
| `INVALID_FARE_CLASS` | Must be one of the 4 classes |
| `NON_POSITIVE_FARE` | Base fare positive and taxes non-negative |
| `FARE_OUT_OF_PLAUSIBLE_RANGE` | Total between ₹500 and ₹5,00,000 |
| `QUOTE_DATE_AFTER_TRAVEL_DATE` | Non-negative booking lead time |
| `COMPONENTS_DO_NOT_RECONCILE` | Aggregate fees, granular components, and supplied total agree (±₹2) |
| `DUPLICATE_KEY` / `DUPLICATE_OF_EXISTING_ROW` | Batch and database duplicate checks |

**Audit guarantee:** `accepted + quarantined = submitted`. Nothing is silently dropped.

### 6. Database (SQLite)

5 tables with CHECK constraints enforcing data integrity at the database level:

- `observations` — fare data with UNIQUE constraint preventing duplicates
- `route_weights` — traffic-proportional weights
- `ingestion_batches` — upload audit trail
- `quarantined_rows` — rejected rows with reason codes
- `analysis_state` — the one active demo/imported/live provenance cohort

Indexes on comparability cell fields, quote date, travel date, and lead bucket for query performance.

---

## Data flow

```
CSV file, sample data, or provider quote snapshot
    │
    ▼
┌─────────────────────┐
│  validate_rows()    │ ← named validation and reconciliation rules
│  accepted[]         │
│  quarantined[]      │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  _insert_observations() │ ← DB-level duplicate check
│  SQLite INSERT      │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  fetch_observations()   │ ← filtered SQL query + active-source isolation
└────────┬────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌──────────┐
│ index  │ │ anomaly  │
│ engine │ │ detector │
└───┬────┘ └────┬─────┘
    │           │
    ▼           ▼
┌─────────────────────┐
│  JSON response      │ → Frontend renders
└─────────────────────┘
```

---

## Key design choices

### Why SQLite, not PostgreSQL?

For a demo/prototype with 23,558 rows, SQLite is:
- Zero configuration — no server process to manage
- Portable — the entire database is one file (`apix.db`)
- Fast enough for the bundled dataset; latency is verified during the pre-demo smoke check

Production would move to PostgreSQL with TimescaleDB for time-series compression and concurrent access.

### Why no ORM?

Raw SQL is:
- Readable by anyone on the team (no SQLAlchemy knowledge needed)
- Auditable — judges can read the schema file and understand the data model
- Transparent — CHECK constraints are visible in `schema.sql`

### Why compute on every request, not cache?

With 23,558 rows, request-time computation remains practical for the local demo.
Caching would add complexity with little benefit at this scale. Production would
add Redis, materialized views, or scheduled pre-computation after benchmarking.

### Why pure functions in the engine?

`engine/index.py` and `engine/anomaly.py` take lists of dicts and return lists of dicts. No database dependency. This means:
- 468 tests plus 33 subtests run against an isolated temporary SQLite database
- The same functions work on CSV data (integration tests) and DB data (API)
- Easy to swap the storage layer without touching computation logic

### Why synthetic data?

- No scraping — no legal or ethical concerns
- Fictional carrier codes (SA1, BW2, NS3, CE9) — no invented price attached to a real airline
- Deterministic seed (26056) — results identical on every run
- Realistic distributions — fares follow log-normal patterns with lead-time sensitivity

---

## Tech stack summary

| Layer | Technology | Why |
|-------|-----------|-----|
| Backend runtime | Python 3.12+ | Ubiquitous, fast enough, NumPy not needed |
| Web framework | FastAPI 0.141 | Auto-docs, validation, type hints |
| Database | SQLite 3 | Zero-config, portable, sufficient for demo |
| Frontend framework | React 19 | Component model, ecosystem, team familiarity |
| Type system | TypeScript 6 | Catch API contract bugs at compile time |
| Build tool | Vite 8 | Fast HMR, ESM-native |
| Styling | Tailwind CSS 4 | Theme tokens and compact global styles |
| Charts | Recharts 3 | Declarative, responsive, React-native |
| Fonts | Local system stacks (IBM Plex preferred when installed) | No runtime font-network dependency |
| Testing | pytest | Simple, fast, no test framework dependencies |
