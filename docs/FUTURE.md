# Future Improvements — Beyond the MVP

**APIx: India Airfare Price Index**

---

## Priority 1 — Production data pipeline

| Improvement | What changes | Impact |
|------------|-------------|--------|
| **Licensed fare coverage** | The Amadeus adapter proves the provider contract. Add production credentials and adapters for licensed airline, GDS, or NDC feeds with broader Indian domestic coverage. | Moves from a synthetic demonstration to a representative real-world index |
| **Scheduled collection** | Add a cron job or workflow runner to collect fares at fixed times daily. Collection is currently manual through sample load, CSV upload, or the credential-gated provider action. | Continuous, unattended operation |
| **PostgreSQL + TimescaleDB** | Replace SQLite with PostgreSQL for concurrent access; TimescaleDB for time-series compression and retention policies. | Handles millions of rows, multi-user access |
| **Redis cache** | Cache computed index series with TTL. It is currently recomputed on every request, which is acceptable at demo scale but will not scale to very large panels. | Predictable dashboard latency at production scale |

---

## Priority 2 — Statistical enhancements

| Improvement | What changes | Impact |
|------------|-------------|--------|
| **Seasonal adjustment** | Apply X-13ARIMA-SEATS to remove festive spikes, weekday/weekend effects, and holiday surges. Currently the series is raw. | Cleaner trend signal for policymakers |
| **Chain linking** | Annual base-year rotation with splice. Currently fixed base period — index drifts if the basket changes. | Long-run comparability across years |
| **Superlative index** | Add Törnqvist or Fisher ideal alongside the Laspeyres headline and unweighted Jevons sensitivity. | Broader substitution-bias sensitivity analysis |
| **Imputation (careful)** | If a cell is missing for one period but present before and after, carry forward with a flag. Currently we report the gap but don't estimate. | Higher coverage, but must be transparent |
| **Confidence intervals** | Bootstrap standard errors on the headline index. Currently a point estimate with no uncertainty measure. | Lets users know when changes are statistically significant |

---

## Priority 3 — Dashboard and UX

| Improvement | What changes | Impact |
|------------|-------------|--------|
| **Interactive map** | India map with route arcs coloured by index change. Click a route to drill in. | Visual impact for presentations |
| **PDF/Excel export** | One-click report generation with charts, tables, and methodology summary. Currently CSV export only. | Publication-ready output for MoSPI |
| **Notification system** | Email or SMS alerts when a spike is detected or coverage drops below threshold. | Proactive monitoring without checking the dashboard |
| **Multi-language** | Hindi and regional language support for labels and methodology text. | Accessibility for wider government use |
| **Dark mode** | Theme toggle. Currently light theme only. | User preference |
| **Accessibility audit** | WCAG 2.1 AA compliance — screen reader support, keyboard navigation, colour contrast. | Government accessibility requirements |

---

## Priority 4 — Governance and operations

| Improvement | What changes | Impact |
|------------|-------------|--------|
| **Authentication** | MoSPI SSO or OAuth2 for admin endpoints. The demo restricts browser origins through CORS but has no authentication or authorization; the backend labels this as a production deployment boundary. | Production security |
| **Role-based access** | Separate analyst (read-only) and admin (data management) roles. | Prevent accidental data deletion |
| **Audit logging** | Log all admin actions (who loaded data, who cleared the database, when). | Compliance and accountability |
| **Publication workflow** | Draft → review → approve → publish pipeline for index releases. | Official statistical release process |
| **Data retention policy** | Automatic archival of observations older than N years. | Storage management at scale |
| **Rate limiting** | Throttle API requests to prevent abuse. | Production hardening |

---

## Priority 5 — Analytics extensions

| Improvement | What changes | Impact |
|------------|-------------|--------|
| **Forecasting** | ARIMA or Prophet model to project the index 7/30 days ahead. | Forward-looking indicator for policy |
| **Elasticity estimation** | Correlate fare changes with DGCA passenger traffic changes. | Demand sensitivity analysis |
| **Competition calibration** | Replace the current observation-share HHI proxy with scheduled-seat or passenger market shares from an authoritative source. | Makes route concentration suitable for policy interpretation |
| **Regional sub-indices** | North/South/East/West regional headline indices weighted by traffic. | Regional policy analysis |
| **International benchmarking** | Compare Indian airfare trends with international indices (if available). | Cross-country context |

---

## What we deliberately left out of the MVP

These are not missing features — they are conscious scope decisions:

1. **Bundled real airline data** — Attaching synthetic prices to real airline names would be misleading. Fictional carriers keep the default demo honest. A credential-gated Amadeus adapter is available, but live calls remain disabled in Demo Mode.

2. **Scraping** — No website is scraped and no access control is circumvented. Production data comes from licensed feeds.

3. **Authentication** — Demo-only. Adding auth would slow the demo without demonstrating statistical methodology.

4. **Seasonal adjustment** — The raw series shows festive effects honestly rather than hiding them behind a statistical filter that judges can't inspect.

5. **Imputation** — We report gaps rather than inventing prices. This is a deliberate methodological choice, not a limitation.
