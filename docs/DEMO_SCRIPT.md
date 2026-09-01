# Five-Minute Judge Demo

**FarePulse India · APIx · SIH 2026 PS 26056**

Before starting, open the Overview at 100% zoom and keep Judge Mode off. On an
empty database, click **Start Judge Demo** once; it loads the synthetic sample
and returns to the populated Overview. Do not quote fixed indicator or alert
values from memory; read the values currently shown on screen.

## 0:00-0:35 · Overview

**Show:** Overview header, mode/provenance labels, publication gate, coverage, and chart.

> FarePulse India measures whether comparable domestic airfares are moving, not
> whether the booking mix changed. This run uses a clearly labelled synthetic
> dataset with fictional carriers. Because current sample coverage is RED, the
> national headline is suppressed and the number is labelled Experimental Basket
> Indicator. The calculation is weighted Laspeyres;
> the second line is an unweighted sensitivity check. Coverage is published with
> every period, so missing data is visible rather than imputed.

Point out **Demo mode** and **Demo dataset · synthetic**. State that the route
weights are illustrative prototype weights pending current DGCA calibration.

## 0:35-1:25 · Fare Alerts And Case File

**Navigate:** Fare Alerts, then open one case file.

> An alert must pass two gates: a robust z-score on log fares and at least 25%
> deviation from its own comparability-cell median. Each case has deterministic
> severity, confidence, reason code, event-window context, and Passenger Exposure
> Proxy. The proxy has no passenger counts; these are triage indicators, not findings.

Show the observation count behind the baseline, formula evidence, recommended
analyst action, and the synthetic event label. Close the case file.

## 1:25-2:00 · Competition

**Navigate:** Competition and open one route.

> The Route Competition Monitor computes an HHI-like proxy from fare-observation shares because real
> passenger or revenue shares are not available in the demo. It cross-checks
> concentration with fare pressure and labels the result as a monitoring proxy,
> not a legal market-power conclusion.

Point to carrier count, dominant observation share, and the status explanation.

## 2:00-2:35 · Vulnerability

**Navigate:** Vulnerability.

> This score first removes each route-carrier-class cell's price level, then uses
> robust log-price residual volatility by lead window. It combines that with alert
> frequency and an explicit, team-defined urgency weight. Coverage confidence
> dampens small samples.

Select one route, show the recalculated values, then reset the filter.

## 2:35-3:10 · Fairness Lens

**Navigate:** Fairness Lens and open one populated category.

> The Fairness Lens compares each category's like-for-like index change with the
> basket index change, alongside alert rate and the exposure proxy. It does not
> measure fairness or infer discrimination. Routes outside
> the prototype mapping appear as Unclassified instead of being guessed into a
> category.

Mention that Tier-2 routes are absent from the bundled sample and the category
mapping is illustrative, not an official government classification.

## 3:10-3:50 · What-If Simulator

**Navigate:** What-If Simulator. Move demand to +20%, carriers to 1, then add
capacity.

> The simulator is deterministic scenario planning, not a forecast. The backend
> is the single calculation source. Demand, fuel, capacity, and carrier-count
> contributions are shown separately, and all coefficients are explicit
> team-defined, uncited, uncalibrated assumptions. They are not empirical estimates.

Show how capacity offsets upward pressure and point to the formula and disclaimer.

## 3:50-4:25 · Judge Mode

Turn **Judge Mode on** while still in the simulator, then revisit Fare Alerts or
Overview briefly.

> Judge Mode changes the explanation, not the calculation. It answers what
> happened, why it matters, how confident the signal is, and what an analyst
> should do next using the current screen values.

Keep it on for the final screen to show consistent behavior across routes.

## 4:25-5:00 · Admin And Provider Status

**Navigate:** Admin.

> The bundled sample loads locally and deterministically. Uploaded CSV rows are
> labelled Imported, never Live. Live provider support is credential-gated and
> also blocked while `DEMO_MODE=true`; credentials can be prepared without
> risking calls during judging. Every rejected row is quarantined with a named
> reason, and accepted plus quarantined always equals submitted.

Point to the provider card, ingestion batch, and observation count. Close with:

> Today this is a reproducible methodology prototype: synthetic by default, honest about its
> assumptions, and ready for a controlled provider switch when credentials and
> coverage are verified.

## Backup Answers

| Question | Answer |
|---|---|
| Is this live data? | No. The current run is Demo Mode with deterministic synthetic data. Live fetch requires credentials and `DEMO_MODE=false`. |
| Are the route weights official DGCA weights? | No. They are illustrative traffic-proportional prototype weights. Current DGCA calibration is required for publication. |
| Why not average fares? | A simple average confounds price movement with route, cabin, carrier, and booking-window mix. FarePulse compares like with like. |
| Why geometric mean? | Fare movement is proportional; the geometric mean treats ratios symmetrically and limits domination by high-priced cells. |
| Is HHI a legal conclusion? | No. It uses observation-count shares as a directional proxy because actual market shares are unavailable. |
| Is the What-If result evidence-based? | The formula is transparent, but its exact coefficients are team-defined, uncited, and uncalibrated. It is not a forecast or causal estimate. |
| Is Evidence Trail an immutable audit log? | No. It records method version, calculation ID, dataset hash, source batches, parameters, and time for reproducibility; it has no authenticated user/action history or tamper-evident ledger. |
| Can demo, imported, and live data mix? | They may coexist in storage, but analysis uses one explicitly active provenance cohort. Admin shows and switches the active source. |
| What happens offline? | After dependencies are installed, the bundled sample, dashboard assets, and calculations run locally. Live fetch is unavailable. |
| What if a provider fails? | The call reports isolated route errors; existing demo/imported data remains intact. |
