# FarePulse India

**Airfare basket-monitoring prototype · SIH 2026 · MoSPI Problem Statement 26056**

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

Open `http://localhost:5173`. If the database is empty, the Overview presents a
one-click **Start Judge Demo** action that loads the sample and returns to the
populated app. The same action is available in Admin and by API:

```bash
curl -X POST http://localhost:8000/api/admin/load-sample
```

This resets the demo database and loads 23,558 validated synthetic observations
across 14 directional routes, 4 fictional carriers, 4 fare classes, and 5
booking lead-time buckets.

## Regulatory Review

Open **Regulatory Review** to convert upward fare alerts into persistent review
cases, document the government action checklist, and download evidence packs or
JSON/CSV summaries. Cases preserve quote, baseline and peer evidence within the
active demo/imported/live source. Severity is a triage priority; all outputs are
**decision support, not a legal finding**. Airline clarification and AirSewa/CPGRAMS
routing remain manual. Admin resets also clear review cases and history.

See [workflow, research sources, API and tests](docs/REGULATORY_REVIEW.md).

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
| **Hybrid stored data** | More than one provenance type is stored; analysis still uses one explicitly active source |

Demo, imported, and live rows may coexist in storage, but analysis endpoints do
not combine them. Loading/importing/fetching selects that provenance cohort as
active. Admin can switch among stored cohorts, and `/api/version` reports both
the active analysis source and the overall stored state.

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
carry live provenance. The Amadeus test environment has limited Indian domestic
coverage; live results are Flight Offers Search snapshots, not transaction
prices or forecasts. Production display or purchase flows would additionally
re-confirm an offer through Flight Offers Price. Demo data remains available as
fallback.

## Dashboard

The React application contains 10 routes:

| Page | Judge-facing purpose |
|---|---|
| Overview | Publication-gated basket indicator, provenance, coverage, filters, routes, carriers, events |
| Fare Alerts | Robust anomaly queue and reproducible case files |
| Competition | Observation-share competition proxy and fare-pressure cross-check |
| Vulnerability | Within-cell residual volatility, alert frequency, and explicit urgency assumptions |
| Fairness Lens | Like-for-like category indices with unknown routes kept Unclassified |
| What-If Simulator | Uncalibrated deterministic scenario formula; explicitly not a forecast |
| Trends | Filtered index, booking curve, and fare-class analysis |
| Compare | Route and carrier rankings |
| Methodology | Formula, assumptions, quality gates, and limitations |
| Admin | Demo load, CSV import, provider status, history, and observations |

Judge Mode adds a consistent plain-English summary on all 10 routes. It uses
the current screen values where applicable and never changes calculations.

## API Surface

The FastAPI backend exposes 26 application endpoints:

| Group | Endpoints |
|---|---|
| System | `GET /api/health`, `GET /api/version`, `GET /api/provider/status` |
| Dashboard | `GET /api/filters`, `GET /api/overview`, `GET /api/trends`, `GET /api/spikes`, `GET /api/competition`, `GET /api/vulnerability`, `GET /api/events`, `GET /api/fairness` |
| Analysis | `GET /api/compare`, `GET /api/contributions`, `GET /api/sensitivity`, `GET /api/head-to-head`, `GET /api/whatif` |
| Data | `POST /api/admin/load-sample`, `POST /api/admin/upload`, `GET/POST /api/admin/analysis-source`, `GET /api/admin/batches`, `GET /api/admin/observations`, `DELETE /api/admin/data`, `POST /api/admin/live-fetch`, `GET /api/admin/live-fetch/status`, `GET /api/export/observations.csv` |

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
- RED coverage suppresses a national headline and labels the numeric result
  **Experimental Basket Indicator** with the reason shown in the UI/API.
- Alerts require both a robust z-score threshold and a 25% material deviation.
- Competition uses observation shares, not market shares. Passenger Exposure
  Proxy contains no passenger counts. Vulnerability uses within-cell log-price
  residuals rather than pooled raw fares. Fairness compares category index
  movement with basket index movement.
- What-If coefficients are team-defined, uncited, and uncalibrated; the output
  is not a forecast, causal estimate, passenger-impact estimate, or policy result.

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

Record the exact output from these commands before each judging session rather
than relying on a stale count in documentation. Tests use an isolated temporary
SQLite database and do not overwrite the demo database.

## Project Layout

```text
backend/app/
  main.py           API contracts and ingestion endpoints
  engine/           index, anomaly, event, competition, vulnerability,
                    fairness, and what-if calculations
  providers/        demo and credential-gated Amadeus adapters
  ingestion/        CSV/live validation and provider orchestration
  db/               SQLite schema and connection management
backend/tests/       focused test modules plus isolated test configuration
frontend/src/
  pages/             10 route-level screens
  components/        shared layout, controls, evidence, and chart helpers
  context/           Judge Mode state
docs/                architecture, method, demo, limitations, and QA guides
```

## Method references

- [MoSPI CPI technical note](https://www.mospi.gov.in/sites/default/files/press_release/CPI%20Technical%20Note%20on%20Imputation.pdf)
  for elementary aggregation and higher-level weighting context.
- [IMF Consumer Price Index Manual](https://www.imf.org/en/Data/Statistics/cpi-manual)
  for CPI construction principles and elementary-index choices.
- [Competition Commission of India FAQ](https://www.cci.gov.in/images/whatsnew/en/faq-english-compressed-31020221664785663.pdf)
  for the definition of HHI from market shares; FarePulse deliberately labels
  its observation-share calculation as a proxy.
- [Amadeus Self-Service API FAQ](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/)
  for the distinction between Flight Offers Search and offer-price confirmation.
