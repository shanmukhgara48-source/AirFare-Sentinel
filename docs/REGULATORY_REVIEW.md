# Regulatory Review / Case Workflow

AirFare Sentinel provides decision support for tariff anomalies and possible excessive fares. It does not establish overcharging, a Rule 135 violation, or a regulatory finding. This is a prototype analyst workflow inspired by India's review approach, not an official DGCA system or prescribed government procedure.

## Using the workflow

1. Open **Regulatory Review** (`/review`) in the navigation. The queue explicitly identifies the active demo, imported or live source.
2. Select **Create review case** for an upward anomaly. Alternatively, use the same action inside a **Fare Alerts → Case File** dialog. Repeat creation returns the existing case rather than duplicating it.
3. Review the frozen quote, baseline, reason for flagging, peer comparison and provenance. Severity is separate from case status.
4. Record evidence references and findings in the eight government action checks: quote, declared range, peers, event/disruption/festival context, capacity/cancellations, airline explanation, grievance draft and unresolved DGCA review recommendation. If evidence is unavailable, record that explicitly.
5. Save the status and notes. Available statuses are **New Alert**, **Evidence Pending**, **Analyst Review**, **Airline Clarification Needed**, **Monitoring**, **Recommended Escalation**, and **Closed**.
6. Generate a JSON evidence pack or download a case summary as JSON/CSV. Save edits first. Review and supplement the AirSewa/CPGRAMS draft before manual routing; demo drafts are marked synthetic exercises.

Completed checks require notes. Recommended Escalation requires all eight checks to be documented. Closing requires an analyst note explaining the outcome. The checklist records analyst assertions; it does not validate external evidence or send messages, complaints, requests or referrals.

## Classification and comparability

The existing robust-log-fare detector is reused without changing dashboard behavior. Case creation uses the standard threshold: positive robust z **> 3.5**, fare **≥ 25% above the median**, and at least **8** observations in the comparable cell. A zero MAD or inadequate history produces no case. Downward outliers and normal observations cannot create excessive-fare review cases. Changing the Fare Alerts sensitivity does not change the case eligibility threshold.

| Priority | App classification for an eligible upward anomaly |
|---|---|
| Watch | Below the Review and Escalate thresholds |
| Review | Robust z ≥ 5 **or** deviation ≥ 50% |
| Escalate | Robust z ≥ 7 **or** deviation ≥ 100%; takes precedence |

These are prototype triage thresholds, not statutory fare limits. Escalate severity does not automatically produce Recommended Escalation status.

The baseline is the median observed total fare within the same **source type × route × airline × fare class × lead bucket**, across available dates, including the flagged observation. It is not an airline's published tariff range or a legal ceiling. The case freezes the source observations and explains limitations of comparing different market periods.

Peer comparisons require the same source type, route, travel date, quote date, fare class and lead bucket, and a different airline. They retain provider and observation references. Missing matches remain missing; other dates/classes/source cohorts are never substituted. Intraday timing, baggage/refund conditions and other product equivalence still require manual verification.

## Persistence and evidence

SQLite tables `regulatory_cases` and `regulatory_case_history` are created by the normal additive schema initialization. Existing observations remain intact. A case is unique per source type and observation ID. New imports/fetches and source switching preserve cases; switching sources changes visibility. Live-only mode exposes only live cases.

Cases freeze normalized quote fields (including batch, source, provider and available offer/flight metadata), baseline observations, matched peers, detection explanation and calculation audit metadata. New data does not rewrite the saved evidence. The evidence pack contains the frozen snapshot, SHA-256 fingerprints, workflow history, checklist, notes, policy references and draft grievance summary. Hashes use canonical JSON (`sort_keys=True`, ASCII escaping, compact separators); exclude `snapshot_sha256` from the frozen snapshot or `pack_sha256` from the pack when recomputing that hash.

The app stores a normalized observation, not an original provider response, screenshot or ticket. Declared tariff ranges, disruptions, festivals, capacity/cancellation evidence and airline responses are not automatically obtained. These gaps are disclosed in the page and exports. No demo event window is promoted into verified live context.

Workflow updates use optimistic version checks and append local before/after history. Stale updates return HTTP 409 instead of silently overwriting changes. History identifies a local analyst session; there is no authenticated individual identity, certified chain of custody or tamper-proof audit. The existing deployment authentication boundary still applies.

**Admin clear-data and load-sample reset cases and history along with observations.** Admin copy discloses this behavior. Export relevant case files before resetting data.

## API

| Method | Endpoint | Behavior |
|---|---|---|
| GET | `/api/review/queue?offset=0&limit=30` | Active-source cases and paginated eligible upward alerts; includes policy references |
| POST | `/api/review/cases` | Body: `observation_id`, `source_type`; 201 new / 200 existing |
| GET | `/api/review/cases/{id}?source_type=demo` | Frozen evidence, current workflow, history and routing draft |
| PATCH | `/api/review/cases/{id}?source_type=demo` | Required `expected_version`; optional `status`, `analyst_notes`, `checklist` updates (`id`, `done`, `notes`) |
| GET | `/api/review/cases/{id}/evidence?source_type=demo` | Download a complete JSON evidence pack |
| GET | `/api/review/cases/{id}/export?source_type=demo&format=json` | JSON or CSV case summary download |

Case operations require an explicit source matching the active cohort. Another source's case ID returns 404; stale-source requests return 409. Source/provider/severity/evidence cannot be overridden by the update API. CSV structured fields are JSON-encoded; potentially executable top-level text cells are escaped.

## Research basis

Official sources checked on **5 September 2026**:

- Fares are normally market-driven; Rule 135 addresses tariff establishment, display and DGCA directions when the authority is satisfied under sub-rule (4). [MoCA / PIB, 21 July 2022](https://www.pib.gov.in/Pressreleaseshare.aspx?PRID=1843408).
- TMU monitors selected routes using airline websites and compares against published ranges. [Rajya Sabha, 3 February 2025](https://sansad.in/getFile/annex/267/AU28_eFPaIZ.pdf?source=pqars).
- Random-route monitoring and capacity measures during festivals and disruptions support checking the context before escalation. [Rajya Sabha, 1 December 2025](https://sansad.in/getFile/annex/269/AU27_gR0KjL.pdf?source=pqars).
- Airline grievance mechanisms, AirSewa and CPGRAMS provide passenger complaint routes. [Lok Sabha, 6 February 2025](https://sansad.in/getFile/loksabhaquestions/annex/184/AU570_Vf37gf.pdf?source=pqals).
- Intervention during the December 2025 operational disruption illustrates a time-specific government response. This historical example is not encoded as a permanent fare cap. [MoCA / PIB, 6 December 2025](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2199755).

## Verification

Backend regression tests:

```bash
cd backend
.venv/bin/python -m pytest tests/test_regulatory.py -q
.venv/bin/python -m pytest tests -q
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

The dedicated Playwright suite resets its target dataset. Start a separate demo backend with `FAREPULSE_DB_PATH` set to a temporary database, `DEMO_MODE=true`, `LIVE_ONLY=false` and empty provider credentials. Start Vite with `FAREPULSE_API_URL` pointing at that test backend, then run:

```bash
cd frontend
FAREPULSE_BASE_URL=http://127.0.0.1:5183 FAREPULSE_TEST_ALLOW_RESET=1 npm run test:review
```

The suite checks alert-to-case creation, reload persistence, documented escalation, all three download types, case creation from the existing alert modal, browser errors and mobile overflow. Screenshots/downloads default to `/private/tmp/airfare-review-qa` (override `FAREPULSE_TEST_OUTPUT`). Run the existing `npm run test:interaction` against an isolated demo instance for dashboard regression coverage.
