# FarePulse India

**APIx India Airfare Price Index · SIH 2026 · Problem Statement 26056 · MoSPI**

FarePulse India is a policy-analytics dashboard for monitoring domestic airfare
movement. It computes a transparent weighted Laspeyres index with Jevons
elementary aggregates, detects unusual fare observations, and exposes
competition, vulnerability, fairness, and scenario-planning views.

The safe default is **Demo Mode**. The bundled 23,558-row dataset is synthetic,
deterministic (`seed=26056`), and uses fictional carrier codes. No website is
scraped, and no bundled value is presented as a real airline fare.

## Quick Start

Prerequisites: Python 3.12+, Node.js 20+, and npm.

```bash
# Terminal 1
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

```bash
# Terminal 2
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, go to **Admin**, and choose **Load sample data**.
The same action is available by API:

```bash
curl -X POST http://localhost:8000/api/admin/load-sample
```

This resets the demo database and loads 23,558 validated synthetic observations
across 14 directional routes, 4 fictional carriers, 4 fare classes, and 5
booking lead-time buckets.

## Operating Modes And Provenance

Operating mode and stored-data provenance are reported separately:

| Label | Meaning |
|---|---|
| **Demo mode** | `DEMO_MODE=true`; external provider calls are blocked |
| **Live ingestion enabled** | `DEMO_MODE=false` and provider credentials are configured |
| **Demo fallback** | Live mode was requested but no live provider is usable |
| **Demo dataset** | Stored rows came from the deterministic bundled sample |
| **Imported dataset** | Stored rows came from a user-uploaded CSV; this is not claimed as live |
| **Live quote snapshots** | Stored rows came from a successful provider call |
| **Hybrid dataset** | More than one provenance type is present |

To prepare live ingestion without enabling it, add credentials to
`backend/.env` and leave `DEMO_MODE=true`. When the team is ready to switch:

```dotenv
AMADEUS_CLIENT_ID=...
AMADEUS_CLIENT_SECRET=...
DEMO_MODE=false
```

Restart the backend, then verify:

```bash
curl http://localhost:8000/api/provider/status
curl http://localhost:8000/api/version
```

Only proceed when `live_fetch_enabled` is `true`. Provider readiness is not a
live-data claim: `live_data_available` becomes `true` only after stored rows
carry live provenance. The Amadeus test environment
has limited Indian domestic coverage; live results are quote snapshots, not
transaction prices or forecasts. Demo data remains available as fallback.

## Dashboard

The React application contains 10 routes:

| Page | Judge-facing purpose |
|---|---|
| Overview | Headline index, provenance, coverage, filters, routes, carriers, events |
| Fare Alerts | Robust anomaly queue and auditable case files |
| Competition | Observation-share HHI proxy and fare-pressure cross-check |
| Vulnerability | Explainable lead-time vulnerability score |
| Fairness Lens | Policy-category comparison with unknown routes kept Unclassified |
| What-If Simulator | Deterministic scenario model; explicitly not a forecast |
| Trends | Filtered index, booking curve, and fare-class analysis |
| Compare | Route and carrier rankings |
| Methodology | Formula, assumptions, quality gates, and limitations |
| Admin | Demo load, CSV import, provider status, history, and observations |

Judge Mode adds a consistent plain-English summary on all 10 routes. It uses
the current screen values where applicable and never changes calculations.

## API Surface

The FastAPI backend exposes 24 application endpoints:

| Group | Endpoints |
|---|---|
| System | `GET /api/health`, `GET /api/version`, `GET /api/provider/status` |
| Dashboard | `GET /api/filters`, `GET /api/overview`, `GET /api/trends`, `GET /api/spikes`, `GET /api/competition`, `GET /api/vulnerability`, `GET /api/events`, `GET /api/fairness` |
| Analysis | `GET /api/compare`, `GET /api/contributions`, `GET /api/sensitivity`, `GET /api/head-to-head`, `GET /api/whatif` |
| Data | `POST /api/admin/load-sample`, `POST /api/admin/upload`, `GET /api/admin/batches`, `GET /api/admin/observations`, `DELETE /api/admin/data`, `POST /api/admin/live-fetch`, `GET /api/admin/live-fetch/status`, `GET /api/export/observations.csv` |

Interactive OpenAPI documentation is available at `http://localhost:8000/docs`.

## Methodology Boundaries

- The headline uses weighted Laspeyres aggregation over like-for-like cells.
- The sensitivity series uses an unweighted Jevons aggregate.
- A cell is `route × carrier × fare class × lead-time bucket`.
- Prototype route weights are illustrative traffic proportions, not current
  official DGCA weights. Production publication requires current calibration.
- Each route weight is divided equally across its observed carriers so carrier
  coverage cannot silently multiply a route's headline influence.
- Missing cells are not imputed; coverage and quality flags remain visible.
- Alerts require both a robust z-score threshold and a 25% material deviation.
- Competition, passenger impact, vulnerability, fairness, and what-if outputs
  are monitoring indicators, not legal findings, forecasts, or official statistics.

See [Formula Explained](docs/FORMULA_EXPLAINED.md),
[Data Dictionary](docs/DATA_DICTIONARY.md), and
[Limitations](docs/LIMITATIONS.md) for the complete explanation.

## Verification

```bash
cd backend
source .venv/bin/activate
python -m pytest tests -q
```

```bash
cd frontend
npm run lint
npm run build
```

Current verified baseline: **463 tests and 33 subtests pass**, frontend lint is
warning-free, and the production build completes without chunk-size warnings.
Tests use an isolated temporary SQLite database and do not overwrite the demo
database.

## Project Layout

```text
backend/app/
  main.py           API contracts and ingestion endpoints
  engine/           index, anomaly, event, competition, vulnerability,
                    fairness, and what-if calculations
  providers/        demo and credential-gated Amadeus adapters
  ingestion/        CSV/live validation and provider orchestration
  db/               SQLite schema and connection management
backend/tests/       14 focused test modules plus isolated test configuration
frontend/src/
  pages/             10 route-level screens
  components/        shared layout, controls, evidence, and chart helpers
  context/           Judge Mode state
docs/                architecture, method, demo, limitations, and QA guides
```
