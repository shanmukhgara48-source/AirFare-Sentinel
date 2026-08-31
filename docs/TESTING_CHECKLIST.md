# Pre-Demo Testing Checklist

Run this checklist before the event and again after any environment change.
Complete the five-minute path three times without reloading the page.

## Automated Gate

```bash
cd backend
source .venv/bin/activate
python -m pytest tests -q
```

- [ ] `463 passed, 33 subtests passed`
- [ ] No warnings or failures
- [ ] The test run does not change `backend/apix.db` (tests use a temporary DB)

```bash
cd frontend
npm run lint
npm run build
```

- [ ] Lint exits with no warnings
- [ ] Build exits successfully with no chunk-size warning

## Startup And Data

```bash
# backend/
python -m uvicorn app.main:app --port 8000

# frontend/
npm run dev
```

- [ ] `GET /api/health` returns `{"status":"ok"}`
- [ ] `GET /api/version` reports `operating_mode: demo`
- [ ] `GET /api/provider/status` reports `live_fetch_enabled: false`
- [ ] `live_data_available` remains false until live-provenance rows are stored
- [ ] Header shows **Demo mode**
- [ ] Admin provider card is disabled and explains the future switch
- [ ] Load sample data reports 23,558 accepted and 0 quarantined
- [ ] Header/Overview show **Demo dataset (synthetic)** provenance

With both servers running, execute `npm run smoke` from `frontend/`; it must
visit all 10 routes in Judge Mode without console warnings, page exceptions, or
failed API responses.

## Five-Minute Path

- [ ] Overview: headline, six stat tiles, chart, route/carrier sections, and event disclaimer render
- [ ] Fare Alerts: rows render; changing threshold completes cleanly
- [ ] Case File: opens, scrolls, closes by button and Escape, and shows evidence
- [ ] Competition: route table/heatmap and detail drawer render
- [ ] Vulnerability: all five lead buckets render and filters recalculate
- [ ] Fairness Lens: categories render; Tier-2 limitation and Unclassified policy are visible
- [ ] What-If: current headline baseline loads; sliders update backend-derived output
- [ ] Judge Mode: toggle remains consistent and a panel renders on all 10 routes
- [ ] Admin: provider status, ingestion history, observations, and pagination render

## Runtime And Responsive Checks

- [ ] No browser console errors, React warnings, failed API calls, or unhandled rejections
- [ ] Every page has a useful loading state
- [ ] Clear data produces intentional empty states on all pages
- [ ] Stop the backend temporarily; pages show readable errors, not raw JSON or a crash
- [ ] Restart backend and reload sample data; all pages recover
- [ ] Desktop viewport: no overlapping labels, clipped charts, or card misalignment
- [ ] Mobile viewport: header fits, horizontal navigation scrolls, tables remain scrollable
- [ ] Projector/target display at 100% zoom has readable contrast
- [ ] Judge Mode panels do not overflow on desktop or mobile

## Provenance Checks

- [ ] Bundled sample rows export with **Demo dataset (synthetic)** notice
- [ ] A test CSV upload is labelled **Imported dataset**, never Live
- [ ] Hybrid is shown only when multiple source types are actually stored
- [ ] No screen calls synthetic event dates or prototype weights official/current data
- [ ] No real airline claim appears while using fictional sample carriers

## Live Switch Checklist

Do this only when the team deliberately enables live mode.

- [ ] Add `AMADEUS_CLIENT_ID` and `AMADEUS_CLIENT_SECRET` to `backend/.env`
- [ ] Keep `DEMO_MODE=true`, restart, and confirm provider credentials are detected but calls remain disabled
- [ ] Set `DEMO_MODE=false`, restart, and confirm `live_fetch_enabled: true`
- [ ] Run **Quick fetch** first
- [ ] Confirm API errors, accepted rows, quarantine count, provider name, and timestamps
- [ ] Confirm stored provenance becomes Live or Hybrid only after a successful fetch
- [ ] Confirm Amadeus test-environment coverage limitation remains visible
- [ ] Return to `DEMO_MODE=true` immediately if provider coverage or stability is inadequate

## Recovery

| Symptom | Recovery |
|---|---|
| Port in use | Identify the existing process with `lsof -nP -iTCP:8000 -sTCP:LISTEN`; do not kill an unknown process blindly |
| Frontend cannot reach API | Confirm backend is on port 8000 and Vite proxy is active |
| Empty dashboard | `curl -X POST http://localhost:8000/api/admin/load-sample` |
| Provider unavailable | Keep Demo Mode; verify credentials and `/api/provider/status` after the event |
