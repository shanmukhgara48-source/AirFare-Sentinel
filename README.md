# AirFare Sentinel

**Airfare monitoring and regulatory review prototype · SIH 2026 · MoSPI Problem Statement 26056**

AirFare Sentinel is a policy-analytics dashboard for monitoring domestic airfare
movement. It computes a transparent weighted Laspeyres index with Jevons
elementary aggregates, detects unusual fare observations, maps route coverage,
and turns tariff anomalies into documented review cases. Competition,
vulnerability, fairness, and scenario-planning views support analyst review.

The app provides **decision support, not a legal finding**. A flagged quote may
indicate a **possible excessive fare** or **tariff anomaly** that requires
verification; it does not establish overcharging or a Rule 135 violation.
Some internal API names, database filenames and environment variables retain
the earlier FarePulse/APIx naming for compatibility.

The safe default is **Demo Mode**. The bundled 23,558-row dataset is synthetic,
deterministic (`seed=26056`), and uses fictional carrier codes. No website is
scraped, and no bundled value is presented as a real airline fare.

## Quick Start

Prerequisites: Python 3.12+, Node.js 22.12+, and npm.

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

Open [the local dashboard](http://localhost:5173). With the default
`DEMO_MODE=true` and `LIVE_ONLY=false` configuration and an empty database, the Overview presents a
one-click **Start Judge Demo** action that loads the sample and returns to the
populated app. The same action is available in Admin and by API:

```bash
curl -X POST http://localhost:8000/api/admin/load-sample
```

This resets the configured database, including review cases and their history,
and loads 23,558 validated synthetic observations
across 14 directional routes, 4 fictional carriers, 4 fare classes, and 5
booking lead-time buckets.

## Regulatory Review / Case Workflow

Open **Regulatory Review** at `/review`, or select **Create review case** inside
a **Fare Alerts → Case File** dialog. The workflow follows:
**monitor → verify → compare → seek clarification → consider escalation**.

1. Create a case from an eligible upward fare alert. Repeating the action opens
   the existing case instead of creating a duplicate.
2. Review why it was flagged, its frozen quote and baseline, matched peer
   airlines, source provenance and evidence limitations.
3. Document the government action checklist, choose a status, and save the review.
4. Download a JSON evidence pack or a case summary as JSON/CSV. Review the
   AirSewa/CPGRAMS-ready draft before manual grievance routing.

Each case includes route, airline, travel date, quote date, lead bucket, fare
class, observed INR fare, baseline median, percent above baseline, peer airline
comparison, `source_type`, provider, available offer/flight references, batch
metadata, calculation metadata, SHA-256 fingerprints and local version history.

### Severity and status

Case creation requires an upward robust z-score **> 3.5**, a fare **at least 25%
above the cell median**, and **at least 8 comparable observations** with non-zero
median absolute deviation. Normal fares, downward outliers and insufficient
history do not generate cases. Changing the Fare Alerts sensitivity does not
change this case threshold.

| Severity | Priority for an eligible upward anomaly |
|---|---|
| Watch | Below the Review and Escalate thresholds |
| Review | Robust z ≥ 5 **or** fare ≥ 50% above baseline |
| Escalate | Robust z ≥ 7 **or** fare ≥ 100% above baseline; takes precedence |

These are app triage priorities, not statutory fare limits. Severity is separate
from the case status: **New Alert**, **Evidence Pending**, **Analyst Review**,
**Airline Clarification Needed**, **Monitoring**, **Recommended Escalation**, or
**Closed**. Escalate severity does not automatically escalate or refer a case.

### Government action checklist

- Verify the quote snapshot.
- Compare against the airline's declared fare range.
- Compare peer airlines.
- Check event, disruption and festival context.
- Check capacity and cancellation indicators.
- Request an airline explanation and record its response or non-response.
- Prepare an AirSewa/CPGRAMS-ready summary.
- Recommend DGCA review if unresolved.

Completed checks require evidence notes or an explanation of unavailable
evidence. Recommended Escalation requires all eight checks to be documented;
closing a case requires an analyst note. These are analyst assertions, and the
app does not send airline requests, complaints or regulatory referrals.

### Evidence and source boundaries

The statistical baseline is not an airline's declared tariff range or a legal
ceiling. Peer comparisons match source type, route, travel date, quote date,
fare class and lead bucket across different airlines. Missing peers remain
explicitly unavailable; other source cohorts are never substituted.

Cases preserve normalized quote, baseline and peer evidence at creation, so
later imports or fetches do not rewrite it. Original provider responses,
screenshots, declared fare ranges, event/capacity evidence and airline responses
require separate verification. Local history and hashes support traceability,
not certified custody or a tamper-proof audit.

Demo, imported and live cases remain separate. Switching the active source
changes visibility while preserving saved cases. Demo drafts are marked as
synthetic exercises. **Admin clear-data and load-sample actions clear cases and
case history along with observations.** Export case files before a reset.

The research basis covers normally market-driven fares, Rule 135 fare display,
TMU selected/random-route monitoring, intervention during abnormal surges or
passenger hardship, grievance routing, and possible DGCA directions under
Rule 135(4). Official references were checked on **5 September 2026**; this
prototype checklist is not an official government procedure. See the
[workflow guide and cited research](docs/REGULATORY_REVIEW.md#research-basis).

## Operating Modes And Provenance

Operating mode and stored-data provenance are reported separately:

| Label | Meaning |
|---|---|
| **Demo mode** | `DEMO_MODE=true`; external provider calls are blocked |
| **Live ingestion enabled** | `DEMO_MODE=false` and provider credentials are configured |
| **Live-only deployment** | `LIVE_ONLY=true` requires `DEMO_MODE=false`; analysis and review cases use only live data |
| **Demo dataset** | Stored rows came from the deterministic bundled sample |
| **Imported dataset** | Stored rows came from a user-uploaded CSV; this is not claimed as live |
| **Live quote snapshots** | Stored rows came from a successful provider call |
| **Hybrid stored data** | More than one provenance type is stored; analysis still uses one explicitly active source |

Demo, imported, and live rows may coexist in storage, but analysis endpoints do
not combine them. Loading/importing/fetching selects that provenance cohort as
active. Admin can switch among stored cohorts, and `/api/version` reports both
the active analysis source and the overall stored state.

Ignav is the preferred configured live provider. Amadeus is selected when Ignav
is not configured; provider failures do not silently switch to another provider
or to synthetic data. Live mode without valid configuration fails at startup.

To prepare ingestion, copy `backend/.env.example` to the ignored `backend/.env`,
set backend-only credentials, and leave `DEMO_MODE=true` until ready. An Ignav
configuration for live ingestion is:

```dotenv
IGNAV_API_KEY=your_backend_only_key
DEMO_MODE=false
LIVE_ONLY=false
```

Alternatively, leave Ignav unconfigured and set both `AMADEUS_CLIENT_ID` and
`AMADEUS_CLIENT_SECRET`. Never put provider credentials in frontend files or
`VITE_*` variables. Restart the backend, then verify:

```bash
curl http://localhost:8000/api/provider/status
curl http://localhost:8000/api/version
```

Only proceed when `live_fetch_enabled` is `true`. Provider readiness is not a
live-data claim: stored rows must carry live provenance and live must be the
active analytical source before interpreting the dashboard as live.

Live data represents quote snapshots at fetch time, not guaranteed final fares,
paid transaction prices or forecasts. Ignav fare components are normalization
estimates; its observed total is retained. The Amadeus test environment has
limited Indian domestic coverage. Sparse live history may not support a basket
index or an anomaly baseline; the app does not manufacture synthetic history.

For a live-only deployment, set `LIVE_ONLY=true` with `DEMO_MODE=false`, and use
a separate `FAREPULSE_DB_PATH` to preserve any demo/imported archive. Live-only
mode blocks sample loading, CSV imports and selection of demo/imported sources,
including when no live quotes have been collected.

Admin supports network collection and individual-route searches. Route
Observatory shows stored coverage and individual live itineraries. Planned
search routes are not proof of an operating service, and coverage is not a
complete national flight schedule or aircraft tracking feed.

For separate frontend/backend origins, configure public `VITE_API_ORIGIN` before
building and list the frontend origin in backend `CORS_ORIGINS`. For local Vite
development/preview, `FAREPULSE_API_URL` overrides the backend proxy target.
See [Live Data Readiness](docs/LIVE_DATA_READINESS.md) for provider setup,
normalization, collection and deployment details.

## Dashboard

The React application contains 12 pages:

| Page | Judge-facing purpose |
|---|---|
| Overview | Publication-gated basket indicator, provenance, coverage, filters, routes, carriers, events |
| Route Observatory | Interactive India route map, stored network coverage and individual fare snapshots |
| Fare Alerts | Robust anomaly queue, reproducible case files and review-case creation |
| Regulatory Review | Persistent cases, government action checklist, evidence packs and JSON/CSV exports |
| Competition | Observation-share competition proxy and fare-pressure cross-check |
| Vulnerability | Within-cell residual volatility, alert frequency, and explicit urgency assumptions |
| Fairness Lens | Like-for-like category indices with unknown routes kept Unclassified |
| What-If Simulator | Uncalibrated deterministic scenario formula; explicitly not a forecast |
| Trends | Filtered index, booking curve, and fare-class analysis |
| Compare | Route and carrier rankings |
| Methodology | Formula, assumptions, quality gates, and limitations |
| Admin | Mode-aware sample/CSV ingestion, provider and network collection, source selection, history and observations |

Judge Mode adds plain-English summaries to the original ten analytical and
administration pages. It uses current screen values where applicable and never
changes calculations. Route Observatory and Regulatory Review provide their
own context and evidence guidance.

## API Surface

The FastAPI backend exposes the following application endpoints:

| Group | Endpoints |
|---|---|
| System | `GET /api/health`, `GET /api/version`, `GET /api/provider/status` |
| Dashboard | `GET /api/filters`, `GET /api/overview`, `GET /api/trends`, `GET /api/spikes`, `GET /api/competition`, `GET /api/vulnerability`, `GET /api/events`, `GET /api/fairness` |
| Analysis | `GET /api/compare`, `GET /api/contributions`, `GET /api/sensitivity`, `GET /api/head-to-head`, `GET /api/whatif` |
| Data | `POST /api/admin/load-sample`, `POST /api/admin/upload`, `GET/POST /api/admin/analysis-source`, `GET /api/admin/batches`, `GET /api/admin/observations`, `DELETE /api/admin/data`, `POST /api/admin/live-fetch`, `GET /api/admin/live-fetch/status`, `GET /api/export/observations.csv` |
| Network | `GET /api/network`, `POST /api/admin/network-fetch`, `GET /api/admin/network-fetch/status`, `GET /api/live-itineraries` |
| Regulatory review | `GET /api/review/queue`, `POST /api/review/cases`, `GET/PATCH /api/review/cases/{case_id}`, `GET /api/review/cases/{case_id}/evidence`, `GET /api/review/cases/{case_id}/export` |

Case creation accepts `observation_id` and `source_type`. Case reads, updates
and downloads require a `source_type` matching the active cohort. Updates use
`expected_version` to prevent stale edits; case-summary exports accept
`format=json` or `format=csv`. See the [review API guide](docs/REGULATORY_REVIEW.md#api).

Interactive [OpenAPI documentation](http://localhost:8000/docs) includes the
complete request schemas.

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
python -m pip install pytest
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

For focused workflow coverage, run from `backend/`:

```bash
python -m pytest tests/test_regulatory.py -q
```

This covers creation and duplicate handling, severity boundaries, evidence
fingerprints, frozen snapshots, matched/missing peers, workflow validation,
stale edits, JSON/CSV output, source isolation and live-only behavior.

Browser suites reset their target dataset. Use a separate demo backend with a
temporary `FAREPULSE_DB_PATH`, `DEMO_MODE=true`, `LIVE_ONLY=false` and empty
provider credentials. Start Vite on a separate port with `FAREPULSE_API_URL`
pointing to that test backend, then run from `frontend/`:

```bash
npx playwright install chromium
FAREPULSE_BASE_URL=http://127.0.0.1:5183 npm run test:interaction
FAREPULSE_BASE_URL=http://127.0.0.1:5183 FAREPULSE_TEST_ALLOW_RESET=1 npm run test:review
```

The first suite checks the original dashboard flows. The review suite checks
alert conversion, persisted status/checklist changes, documented escalation,
all three downloads, existing alert-modal integration and mobile layout.
Both check browser errors. See [review verification](docs/REGULATORY_REVIEW.md#verification)
for setup and artifact locations.

## Project Layout

```text
backend/app/
  main.py           API contracts and ingestion endpoints
  api/              shared queries and regulatory review API
  audit.py          reproducible calculation metadata
  national.py       network collection, coverage and live itineraries
  engine/           index, anomaly, event, competition, vulnerability,
                    fairness, what-if and regulatory evidence logic
  providers/        demo and credential-gated Ignav/Amadeus adapters
  ingestion/        CSV/live validation and provider orchestration
  db/               SQLite schema and connection management
backend/tests/       focused test modules plus isolated test configuration
frontend/src/
  pages/             12 route-level screens
  components/        shared layout, controls, route map, evidence and charts
  context/           Judge Mode state
  review-api.ts      typed review requests and download handling
frontend/review-check.mjs  regulatory workflow browser suite
docs/                architecture, method, demo, limitations, and QA guides
```

## Method references

- [MoSPI CPI technical note](https://www.mospi.gov.in/sites/default/files/press_release/CPI%20Technical%20Note%20on%20Imputation.pdf)
  for elementary aggregation and higher-level weighting context.
- [IMF Consumer Price Index Manual](https://www.imf.org/en/Data/Statistics/cpi-manual)
  for CPI construction principles and elementary-index choices.
- [Competition Commission of India FAQ](https://www.cci.gov.in/images/whatsnew/en/faq-english-compressed-31020221664785663.pdf)
  for the definition of HHI from market shares; AirFare Sentinel labels
  its observation-share calculation as a proxy.
- [Amadeus Self-Service API FAQ](https://admin.developers.amadeus.com/self-service/apis-docs/guides/developer-guides/faq/)
  for the distinction between Flight Offers Search and offer-price confirmation.
- [Regulatory review research](docs/REGULATORY_REVIEW.md#research-basis)
  for official MoCA/PIB and Parliamentary sources on Rule 135, monitoring,
  intervention and passenger grievance routing.
