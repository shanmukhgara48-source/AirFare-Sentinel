# India route observatory

The SVG map is bundled locally and requires no map service, tiles, API key, or runtime geographic requests.

Geographic context: Natural Earth 1:110m admin-0 countries, public-domain data from https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson. Terms: https://www.naturalearthdata.com/about/terms-of-use/. The bundled subset contains India and neighboring countries. Natural Earth's generalized boundary representation is geographic context, not an official boundary map. The interface explicitly labels this limitation.

Airport coordinates: OurAirports, via https://davidmegginson.github.io/ourairports-data/airports.csv, downloaded September 5, 2026. Data provenance: https://ourairports.com/data/. The catalog includes 116 Indian airports marked as having scheduled service and uses airport coordinates rather than city centroids. Catalog inclusion does not guarantee the provider can return fares for an airport.

`data.ts` projects both geometry and airports into one regional Mercator coordinate system. Each directed route has its own curved path; opposite directions bend to opposite sides. Aircraft show illustrative direction, never real aircraft tracking. Animation respects reduced motion, pauses outside the viewport and stops in hidden tabs.

## Analytical contracts

- Existing analysis-source, filters, comparison, trends, alerts, head-to-head, competition, vulnerability and provider-status APIs are reused. The live-only expansion adds network collection/status and itinerary-list endpoints, preserves distinct provider offers, and supports airline filtering on comparisons. Existing analytical formulas are unchanged.
- Source selection uses the existing global analysis-source control. Overview reloads its analytics on the existing data-change event. Data is hidden while filters or sources reload, and source state is checked before publishing request groups.
- Route, class, lead-time and airline filters use backend route comparisons; airline movement uses the existing head-to-head endpoint.
- Alert records are filtered after the existing detector runs. The detector is not recalculated by the map. HHI is whole-route context for the active source, independent of map filters, and is an observation-share proxy rather than market share.
- Vulnerability uses the existing backend bucket scores. With all lead times selected, the maximum bucket score is shown and its bucket identified; no aggregate score is invented.
- Daily mean fare history and actual observed provider names come from the existing active-source-isolated CSV export for the selected route and filters. CSV provenance is checked row by row; mixed-source exports are rejected. Daily means and fare displays retain two decimal places (paise). Configured provider names are never substituted for the provider recorded in observations.
- Missing data is unavailable, not zero. Pressure, cost and risk colors are documented team-defined display bands; they are not forecasts, official thresholds, or changes to calculated backend scores.
- Live rows are fare quote snapshots observed at fetch time. Final booking prices may differ. The persistent operating-mode ribbon separately distinguishes the ingestion gate from the source of analyzed observations.

## QA

Run `npm run build`, `npm run lint`, `node route-map-data-check.mjs` and `FAREPULSE_BASE_URL=http://127.0.0.1:5179 node route-map-check.mjs` in the frontend directory. Browser tests target an isolated preview database; existing `npm run smoke` clears/reloads its target database and must never target production.

Live route discovery now uses the stored active route list and a 116-airport OurAirports catalog. For dense networks, only selected airport labels are shown; route selection reveals city names. Deeper coverage and vulnerability queries run for selected routes, avoiding a nationwide fan-out on every page load. A single arc represents a direction; every stored itinerary on it is accessible in the paginated flight list.

The default **Major routes** view caps the map at 30 observed directions, prioritizing [OAG's September 2026 busy domestic corridors](https://www.oag.com/indian-aviation-data), then a curated major-hub shortlist in `majorRoutes.ts`. It is not an official top-30 passenger ranking. Both available directions stay together; missing reverse quotes are never invented, so the count can be below 30. **All routes** restores the full observed network. This display filter does not delete rows or change fare calculations. The leading Indian carrier names appear first in the airline selector; all carriers still contribute unless the visitor chooses an airline.
