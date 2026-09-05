# UI and operating-mode verification — 2026-09-05

## UI implementation

The existing dashboard now uses an aviation command-deck shell, a persistent
operating-mode strip, clearer navigation, refined typography, and light analytic
surfaces. Overview includes a shaded 3D aircraft mesh rendered on Canvas 2D,
a second aircraft, contrails, a perspective grid, and animated route paths.
The scene is explicitly illustrative, not aircraft tracking. Actual basket
metrics, provenance, publication warnings, filters, and evidence remain visible.

Motion can be paused, respects reduced-motion preferences, and stops when the
scene is off-screen or the document is hidden. No new runtime dependency was
introduced. All ten existing dashboard flows remain available. Backend code,
credentials, ingestion behavior, and operating-mode configuration were unchanged
by this UI work.

## Validation

- `npm --prefix frontend run build` — passed.
- `npm --prefix frontend run lint` — passed.
- Existing `npm run smoke` against an isolated preview — passed: all ten pages,
  filters, case files, drawers, Judge Mode, What-if sliders, mobile overflow,
  console errors, page errors, and API failures.
- `FAREPULSE_BASE_URL=http://127.0.0.1:5179 node frontend/aviation-check.mjs`
  — passed: animation pause/resume, reduced motion, demo/live/unavailable labels,
  sticky mode status, mobile/tablet/desktop overflow, and demo-gated Admin.
- Visually reviewed the desktop overview, the mobile overview and data cards,
  and mobile Admin, including a narrow 320px viewport.

Mode variants in the focused browser test used intercepted responses only;
no live fetch was issued and no actual environment mode was switched.

## Current installation

- **Current mode:** Demo.
- **Ignav key configured:** Yes; presence checked without printing its value.
- **Demo mode:** `true` in `backend/.env` and effective settings.
- **Configured live provider:** `ignav`.
- **Active live provider:** None.
- **Live fetch enabled:** No.
- **Stored live rows:** 0 rows with `source_type=live` and `provider=ignav` in the
  original database. It contains 23,558 demo observations.
- **Active analysis source:** `demo`.
- **Backend running:** No pre-existing backend was listening on the expected
  local ports. A separate demo QA backend was started on port 8011 using a copy
  of the database in `/tmp/airfare-ui-preview/preview.db`; the frontend preview
  uses port 5179. This is not the normal backend service or original database.
- **Overview dataset label:** Demo dataset (synthetic), not live quote snapshots.
- **Final verdict:** Credential-ready but demo-gated. `IGNAV_API_KEY` is
  configured, but `DEMO_MODE=true` blocks live fetch, so the site is not currently
  operating in live mode.

The original installation was inspected via `.env` presence flags, effective
settings, provider code, and read-only SQLite queries. The QA backend's read-only
`/api/version`, `/api/provider/status`, `/api/admin/live-fetch/status`,
`/api/admin/analysis-source`, and `/api/overview` endpoints corroborated those
settings: demo mode, Ignav configured, no active live provider, fetch disabled,
active source demo, and demo evidence in Overview.

This agrees with `LIVE_DATA_READINESS.md`. Its earlier successful Ignav search
was an isolated temporary-database test, not proof that this installation is
live. Credential presence alone does not satisfy the readiness checklist.
