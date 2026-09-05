# Live Data Readiness

FarePulse is ready for provider credentials, but it must not be described as
live until a real provider request has returned valid rows and those rows are
the active analytical source.

## Credential contract

Ignav is the preferred live provider. It uses backend-only `IGNAV_API_KEY` and
optional `IGNAV_BASE_URL` (default `https://ignav.com/api`). The registry selects
Ignav first when configured. Amadeus remains available when Ignav is not
configured; upstream failures do not silently switch providers.

Amadeus uses two backend credentials:

- `AMADEUS_CLIENT_ID`
- `AMADEUS_CLIENT_SECRET`

Never put any provider credential in frontend files or any `VITE_*` variable. Vite embeds
`VITE_*` values in browser JavaScript. Keep the provider credentials in
`backend/.env` or a deployment secret manager.

## Local activation

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `IGNAV_API_KEY` in the ignored backend `.env` or backend secret manager.
3. Keep `IGNAV_BASE_URL=https://ignav.com/api`. For the Amadeus fallback, set
   both Amadeus variables and use the existing Amadeus base URL configuration.
4. Set `DEMO_MODE=false`.
5. Set `CORS_ORIGINS` to the exact frontend origins. Do not use `*`.
6. Start the backend with `python -m uvicorn app.main:app --reload` from
   `backend/`.
7. Start or build the frontend normally.

Startup fails with a clear, non-secret-bearing error if credentials are
partial, live mode has no credentials, CORS is empty or wildcarded, the remote
provider URL is insecure, or the upload limit is invalid.

`DEMO_MODE=true` works with no credentials or with Ignav credentials prepared;
it blocks the Admin live fetch endpoint even when the key is present.
`DEMO_MODE=false` requires an Ignav key or a complete Amadeus credential pair.
Provider readiness reports credential presence and enabled state, never the key.

## Ignav request and normalization contract

The backend calls [Ignav one-way search](https://ignav.com/docs/one-way) using
`POST /api/fares/one-way`, `X-Api-Key` authentication, `cabin_class="economy"`,
and `market="IN"`. The [market setting](https://ignav.com/docs/markets) requests
Indian locale and INR; there are no separate currency/locale parameters in
this endpoint. Non-INR responses are discarded rather than relabeled or converted.
`max_offers` is applied locally. The nationwide search keeps up to 1,000 returned
itineraries per route instead of the legacy basket adapter default of ten.
Admin requests one adult. The interface displays individual provider totals to
two decimal places and retains the provider price-verification status.

One complete itinerary produces one row, including connecting flights. The
first segment's marketing carrier supplies the airline code; segment flight
numbers are joined for provenance. `ignav_id` becomes `offer_id`. The documented
[response](https://ignav.com/docs/response-format) has no offer expiry, so
`offer_expiry` is null. Its total price is preserved, including for direct
provider calls requesting multiple adults; Admin always uses one adult for
comparable analysis. Economy maps to the app's `ECONOMY_SAVER` bucket, without
asserting a specific airline's branded fare rules.

Ignav currently returns total prices without an itemized fare breakdown. The
following **provider-normalization approximation** reconciles to that total:

- `base_fare = round(total_fare * 0.75, 2)`
- `taxes_fees = round(total_fare - base_fare, 2)`
- `airline_surcharge = 0.0`
- `statutory_taxes = round(taxes_fees * 0.65, 2)`
- `airport_charges = round(taxes_fees - statutory_taxes, 2)`

These components are estimates, not an airline tax invoice or official
government data. Live rows are **live fare quote snapshots observed at fetch
time**, not guaranteed final fares, paid transaction prices, or forecasts.
Ignav's price verification status is not a guarantee of bookability.

Malformed individual itineraries (including missing prices) are safely skipped.
The existing Admin ingestion path passes all normalized rows through
`validate_live_quotes` before storage; implausible values and duplicate cells
are quarantined there. Raw quote counts refer to normalized rows, not all
upstream itineraries. Live uniqueness is scoped to provider and itinerary identity, so distinct flights
from one airline on the same date are retained. Identical offers in the same
observation day are rejected; demo/import natural-key behavior is unchanged.

Missing credentials raise `ProviderNotConfiguredError`; authentication,
rate-limit, transport, upstream, and malformed-envelope failures raise safe
`ProviderError` messages without upstream bodies or keys. Redirects are blocked
to avoid forwarding authentication headers. Neither startup nor status checks
make paid provider calls. Quick fetch makes 30 searches (6 routes × 5 lead dates).

Ignav also advertises [an MCP entry point](https://ignav.com/mcp). AirFare
Sentinel uses the REST API directly; no MCP client or frontend key is needed.

## Frontend/backend hosting

For same-origin hosting, leave `VITE_API_ORIGIN` blank and route `/api` to the
backend at the web server or platform layer.

For separate origins, set `VITE_API_ORIGIN` before `npm run build` to the public
backend origin, without a trailing slash or `/api`. Add the frontend origin to
the backend `CORS_ORIGINS` list. `VITE_API_ORIGIN` is public configuration and
must never contain provider credentials.

For local development or `npm run preview`, `FAREPULSE_API_URL` can override the
proxy target; it defaults to `http://localhost:8000`.

## Acceptance gate before saying "live"

Confirm all of the following in Admin:

- Demo Mode is off.
- Provider status says credentials are configured but does not expose them.
- A provider fetch completes without an authentication or schema error.
- At least one valid Ignav observation is stored with `source_type=live` and
  `provider=ignav`.
- The active analytical source is Live and contains no demo/import rows.
- Ingestion history distinguishes stored rows, accepted rows, and quarantines.
- Overview and exports identify the live source explicitly.

If the provider returns zero valid rows, fails, or only produces quarantined
rows, remain in not-fetched/error state and do not present the dashboard as
live.

## Rollback

Set `LIVE_ONLY=false` and `DEMO_MODE=true`, switch `FAREPULSE_DB_PATH` to a separate
demo database to preserve the live archive, restart the backend, and load the deterministic sample
from Admin. This disables provider calls and restores an honestly labelled
synthetic demo path. It does not relabel provider observations as demo data.
Loading the sample uses the existing dataset reset workflow. If retaining
stored live/imported rows is desired, select the existing demo analysis source
instead of loading the sample. Setting demo mode alone blocks live fetch but
does not change the active analysis source. Credentials may remain prepared.

## Boundary

This checklist makes the provider integration ready for credentialed testing.
Public production deployment still requires authentication/authorization for
Admin endpoints, TLS and secret-manager configuration, monitoring, backups,
rate limiting, provider terms review, and operational ownership.

## Initial integration verification (2026-09-05, before live-only activation)

- Backend: `cd backend && .venv/bin/python -m pytest -q` — 547 tests and
  33 subtests passed. Includes mocked Ignav request/response, error, credential,
  registry, demo gate, Admin storage, demo/CSV import, and source-isolation tests.
- Frontend: `cd frontend && npm run build && npm run lint` — both passed.
- One credentialed DEL–BOM search at T+7 using the real provider and existing
  ingestion path in a temporary database: 1 successful API call, 0 API errors,
  10 normalized quotes, 1 stored live/ignav row, 9 quarantined rows. Active
  analysis source became live. This verifies a snapshot, not ongoing coverage.
- The secret scan found no supplied key in tracked source, new implementation
  files, or frontend build output. Local credentials remain in the ignored
  backend `.env` with owner-only permissions; local `DEMO_MODE=true` is retained.


## Live-only India deployment (2026-09-05)

The local site at port 5179 now connects to the backend at port 8000 with
`DEMO_MODE=false`, `LIVE_ONLY=true`, and a separate ignored live database.
The original demo database is retained separately and excluded from live analysis.
`LIVE_ONLY=true` forces the active analytical source to `live`, including when it
has no rows; there is no demo fallback. Demo loading, CSV ingestion and switches
to demo/import analysis are rejected in this mode. Disable LIVE_ONLY and restart
to restore those existing workflows in a separate demo/import deployment.

The airport catalog contains 116 Indian airports marked as having scheduled
service in OurAirports (downloaded September 5, 2026). The default national search
plan has 234 directed airport pairs: the original basket plus each other catalog
airport and its nearest basket hub in both directions. A planned pair is a search
target, not evidence that a flight operates. Any two catalog airports can also be
searched from Admin. This is **not exhaustive airline or national schedule coverage**.

`POST /api/admin/network-fetch` starts a background collection with four concurrent
requests. `scope=india|basket|route|failed`, `lead_days` (1–330, default 7), and
`max_offers` (1–1,000) control the run. Route scope additionally requires origin
and destination. `GET /api/admin/network-fetch/status` reports per-route outcomes,
empty responses and errors. Account/billing/rate-limit failures stop new work.
Completed reports survive a backend restart; interrupted jobs are identified and
are not automatically resumed. Each request uses the provider account's quota.

`GET /api/network` reports actual stored coverage. `/api/live-itineraries` exposes
paginated individual flight quote totals, numbers, dates, observation timestamps
and provider verification status. The map discovers every stored route present in
the bundled airport catalog, rather than limiting live data to the 14-route basket.
Route statistics continue to use the existing backend calculations. Unsupported
basket weights remain unavailable; no new authoritative weights are invented.

The first activation pass checked 234 pairs for September 12, 2026 and stored
1,384 valid Ignav itineraries across 129 routes. There were 66 empty responses and
39 failed searches; failed searches were retried once. After one retry, the activation contains **1,496 provider-verified INR quotes
across 142 routes and 73 observed airports**, all from Ignav, with 71 empty routes
and 21 unresolved route errors. No raw upstream errors or credentials are
exposed. Inspect the live coverage endpoint for subsequent/current counts. No synthetic history
was manufactured. Index history requires observations collected on additional dates.

Validation: **551 backend tests and 33 subtests passed** after the final changes.
Frontend build and lint, the original dashboard smoke suite, and read-only live
UI checks passed. Demo regression tests run on separate temporary databases,
never the live database. See `frontend/live-network-check.mjs` for read-only live
provenance, individual fare precision, expanded map, and responsive-page checks.
