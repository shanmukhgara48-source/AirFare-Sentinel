import { Card, JudgePanel, Pill } from '../components/ui'
import { useJudgeMode } from '../context/judgeModeContext'

export default function Methodology() {
  const { judgeMode } = useJudgeMode()
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[26px] leading-tight">Methodology</h1>
        <p className="mt-1 text-[13px] text-muted">
          How the index is built, what it can support, and what it deliberately does not claim.
        </p>
      </header>

      {judgeMode && (
        <JudgePanel items={[
          {
            q: 'What is the core method?',
            a: 'Fares are compared within like-for-like cells, combined geometrically within each cell, then aggregated with fixed illustrative route weights. The headline is a Laspeyres-type index and the unweighted Jevons series is a sensitivity check.',
          },
          {
            q: 'Why is it explainable?',
            a: 'Every formula, threshold, vocabulary, route weight, and quality gate is explicit in source and documented here. No model training or opaque score is required to reproduce an output.',
          },
          {
            q: 'What is still provisional?',
            a: 'The bundled observations are synthetic, route weights are prototype assumptions pending current DGCA calibration, event uplift estimates are illustrative, and offered fares are not transaction prices.',
          },
          {
            q: 'What changes in live mode?',
            a: 'Only ingestion provenance changes. With credentials and Demo Mode disabled, provider quote snapshots pass through the same validation and calculations; the formulas do not change.',
          },
        ]} />
      )}

      <Card title="The comparability cell" subtitle="What we consider like-for-like">
        <p className="text-[13px] leading-relaxed text-muted">
          Every observation belongs to exactly one cell, defined by five attributes:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {['Origin', 'Destination', 'Carrier', 'Fare class', 'Lead-time bucket'].map((d) => (
            <Pill key={d} tone="accent">
              {d}
            </Pill>
          ))}
        </div>
        <Formula>DEL → BOM · SA1 · ECONOMY_SAVER · booked 15–30 days out</Formula>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          Booking lead time is in the key because it is a major driver of fare level.
          Pooling a one-day-out fare with a 45-day-out fare would compare two different products,
          and the resulting index would track the <em>booking mix</em> rather than the price level.
          Direction matters too — DEL→BOM and BOM→DEL are separate cells.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Lead time is grouped into five buckets rather than used as an exact day count. Each exact
          day would be its own thin, unstable group; the buckets keep each group large enough to be
          statistically stable while staying narrow enough that fares inside it are genuinely
          comparable. Boundaries are inclusive at both ends.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                <th className="pb-2 font-semibold">Bucket</th>
                <th className="pb-2 font-semibold">Lead days</th>
                <th className="pb-2 font-semibold">What it captures</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['0–3 days', '0 to 3', 'Last-minute; the highest and most volatile fares'],
                ['4–7 days', '4 to 7', 'Late booking'],
                ['8–14 days', '8 to 14', 'The elbow of the booking curve'],
                ['15–30 days', '15 to 30', 'Standard advance purchase'],
                ['31+ days', '31 and above', 'Early booking; the lowest and steadiest fares'],
              ].map(([label, days, note]) => (
                <tr key={label} className="border-b border-line/60 last:border-0">
                  <td className="py-2 font-medium">{label}</td>
                  <td className="py-2 tnum text-muted">{days}</td>
                  <td className="py-2 text-muted">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          The sample dataset has 14 directional routes × 4 carriers × 4 fare classes × 5 buckets ={' '}
          <strong className="font-medium text-ink">1,120 cells</strong>.
        </p>
      </Card>

      <Card title="Route basket and weights" subtitle="Illustrative traffic-proportional prototype weights, fixed for the index window">
        <div className="space-y-3 text-[13px] leading-relaxed text-muted">
          <p>
            Not all routes should count equally. The DEL–BOM corridor carries far more
            passengers than BLR–HYD. The index weights each cell by its route's share of
            illustrative traffic proportions, so trunk routes carry more of the headline number.
            Production publication would calibrate these weights against current DGCA data.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Stratum</th>
                  <th className="pb-2 font-semibold">Routes</th>
                  <th className="pb-2 text-right font-semibold">Weight each</th>
                  <th className="pb-2 text-right font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Metro trunk', 'DEL↔BOM, DEL↔BLR, BOM↔BLR', '6–14%', '60%'],
                  ['Large inter-regional', 'DEL↔CCU, DEL↔HYD', '5–6%', '22%'],
                  ['Short-haul business', 'BLR↔HYD', '4%', '8%'],
                  ['Regional', 'DEL↔MAA', '5%', '10%'],
                ].map(([stratum, routes, weight, subtotal]) => (
                  <tr key={stratum} className="border-b border-line/60 last:border-0">
                    <td className="py-2 font-medium">{stratum}</td>
                    <td className="py-2 text-muted">{routes}</td>
                    <td className="py-2 text-right tnum">{weight}</td>
                    <td className="py-2 text-right tnum font-medium">{subtotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Weights are <strong className="font-medium text-ink">fixed</strong> for the
            index window — they do not change as prices change. This is the Laspeyres
            property: the index measures pure price change, not a mixture of price change and
            traffic change. Each route's weight is allocated equally across its observed
            carriers so routes with more carrier coverage do not gain extra headline influence.
          </p>
        </div>
      </Card>

      <Card title="Price anatomy" subtitle="Four-component fare breakdown (monograph §4.2)">
        <div className="space-y-3 text-[13px] leading-relaxed text-muted">
          <p>
            Each fare is decomposed into four compulsory components. The <strong className="font-medium text-ink">total fare</strong> —
            the sum of all four — is the price the index tracks.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {['Base fare (~55%)', 'Airline surcharge (~8%)', 'Statutory taxes (~22%)', 'Airport charges (~15%)'].map((c) => (
              <Pill key={c} tone="accent">{c}</Pill>
            ))}
          </div>
          <Formula>total_fare = base_fare + airline_surcharge + statutory_taxes + airport_charges</Formula>
          <p>
            This decomposition matters because it lets analysts see <em>what</em> is driving a
            price change. If fares rise 8% but all of it comes from a fuel surcharge increase, the
            policy response is different than if base fares rose.
          </p>
          <p>
            When ingesting legacy data that only has base_fare + taxes_fees (two components), the
            system estimates the split using explicit prototype proportions. Those estimated components
            are illustrative, not observed tax or surcharge amounts. This is backward-compatible — older
            CSVs still work.
          </p>
        </div>
      </Card>

      <Card title="Index formula" subtitle="Two-stage aggregation: Jevons within cells, Laspeyres across cells">
        <div className="space-y-4 text-[13px] leading-relaxed text-muted">
          <p className="rounded-md border border-accent/25 bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-ink">
            <strong className="font-medium">In one sentence:</strong> we compare every fare only
            against past fares for the same route, carrier, cabin and booking window, compute a
            geometric mean within each cell, then combine cells using prototype traffic weights so that
            busy trunk routes carry more of the headline number.
          </p>

          <div>
            <div className="text-[12px] font-medium text-ink">1. Reference price (geometric mean)</div>
            <p className="mt-1">
              Each cell's reference price <Mono>P₀</Mono> is the <strong className="font-medium text-ink">geometric mean</strong> of
              fares in that cell on the first day it appears in the data. The geometric mean (not
              arithmetic) is used because fares are log-normally distributed — the geometric mean
              resists outlier contamination and is consistent with the Jevons form used inside each cell.
            </p>
          </div>

          <div>
            <div className="text-[12px] font-medium text-ink">2. Price relative (Jevons elementary aggregate)</div>
            <p className="mt-1">
              For period <Mono>t</Mono>, each cell's relative is the geometric mean of fares in that
              period divided by its reference price:
            </p>
            <Formula>R[cell, t] = geometric_mean(fares in period t) ÷ P₀[cell]</Formula>
            <p className="mt-1">
              The geometric mean is used rather than the arithmetic mean because fare movements are
              proportional: a doubling and a halving should offset, which is true of a geometric
              mean and not of an arithmetic one. It also means no cell can dominate just for being
              expensive.
            </p>
          </div>

          <div>
            <div className="text-[12px] font-medium text-ink">3. Weighted aggregation (Laspeyres headline)</div>
            <p className="mt-1">
              The <strong className="font-medium text-ink">headline index</strong> uses a weighted
              Laspeyres aggregation — each cell carries a fixed illustrative traffic weight for
              that route:
            </p>
            <Formula>APIx[t] = 100 × Σ ( W[cell] / ΣW ) × R[cell, t]</Formula>
            <p className="mt-1">
              Weights come from a route basket of 14 directional domestic routes (7 city pairs ×
              both directions), stratified into metro trunks, large inter-regional, short-haul
              business, and regional routes. The DEL–BOM trunk, for example, carries 14% of the
              prototype basket in each direction. This is a modelling assumption, not a current
              official route-share estimate.
            </p>
          </div>

          <div>
            <div className="text-[12px] font-medium text-ink">4. Sensitivity series (unweighted Jevons)</div>
            <p className="mt-1">
              Alongside the headline, an <strong className="font-medium text-ink">unweighted
              Jevons</strong> index is computed — the geometric mean of all active cells' relatives,
              each counting equally:
            </p>
            <Formula>Jevons[t] = 100 × exp( mean( ln R[cell, t] ) )</Formula>
            <p className="mt-1">
              When the two lines diverge, it means price movements on high-traffic routes differ
              from the rest of the market. If the weighted line rises but the unweighted stays flat,
              fares are rising on trunk routes specifically — which affects more passengers but not
              the market broadly.
            </p>
          </div>

          <div>
            <div className="text-[12px] font-medium text-ink">5. Missing data</div>
            <p className="mt-1">
              A cell with no observation in a period is simply absent from that period's
              aggregation. Its last price is never carried forward and never imputed silently —
              carrying a stale airfare forward would invent a price that nobody was ever offered.
            </p>
            <p className="mt-2">
              The cost is that the basket changes composition between periods, so
              every period reports what it actually observed. Coverage is scored with a quality flag:
            </p>
            <div className="mt-2 flex gap-3">
              <span className="rounded bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">GREEN ≥ 90%</span>
              <span className="rounded bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">AMBER 80–90%</span>
              <span className="rounded bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">RED &lt; 80%</span>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Worked example: two cells, two methods"
        subtitle="Small enough to check on a calculator — this is the whole method"
      >
        <div className="space-y-4 text-[13px] leading-relaxed text-muted">
          <p>
            Suppose two cells on the DEL–BOM trunk route (weight 0.14 each). Day 1 is the
            base. On day 2, the saver cell rose 10% and the business cell fell 10%.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Cell</th>
                  <th className="pb-2 text-right font-semibold">Day 1 (P₀)</th>
                  <th className="pb-2 text-right font-semibold">Day 2</th>
                  <th className="pb-2 text-right font-semibold">Relative</th>
                  <th className="pb-2 text-right font-semibold">Weight</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line/60">
                  <td className="py-2">DEL–BOM · SA1 · Saver · 15–30d</td>
                  <td className="py-2 text-right tnum">₹4,000</td>
                  <td className="py-2 text-right tnum">₹4,400</td>
                  <td className="py-2 text-right tnum text-alert">1.10</td>
                  <td className="py-2 text-right tnum">0.50</td>
                </tr>
                <tr>
                  <td className="py-2">DEL–BOM · SA1 · Business · 15–30d</td>
                  <td className="py-2 text-right tnum">₹10,000</td>
                  <td className="py-2 text-right tnum">₹9,000</td>
                  <td className="py-2 text-right tnum text-ok">0.90</td>
                  <td className="py-2 text-right tnum">0.50</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="text-[12px] font-medium text-ink">Weighted Laspeyres (headline)</div>
          <Formula>APIx[day 2] = 100 × (0.50 × 1.10 + 0.50 × 0.90) = 100 × 1.00 = 100.00</Formula>
          <p>
            The weighted average says "no overall change" — because the route-traffic-proportional
            weights give each cell equal say and the moves cancel arithmetically.
          </p>

          <div className="text-[12px] font-medium text-ink">Unweighted Jevons (sensitivity)</div>
          <Formula>Jevons[day 2] = 100 × √(1.10 × 0.90) = 100 × √0.99 = 99.50</Formula>
          <p>
            The geometric mean reads 99.50 — slightly <em>below</em> 100. This is correct: a 10%
            rise followed by a 10% fall does not get you back to where you started. The divergence
            between 100.00 (weighted) and 99.50 (unweighted) is the sensitivity gap — publishing
            both lets an analyst see whether weighting changes the story.
          </p>

          <p className="text-[12px]">
            This example is a test in the repository (<Mono>tests/test_index.py</Mono>), along with
            75 others covering weighted aggregation, bucket boundaries, quality flags, contributions,
            and every ingest rejection reason.
          </p>
        </div>
      </Card>

      <Card title="Fare alerts" subtitle="Rule-based, reproducible by hand">
        <div className="space-y-3 text-[13px] leading-relaxed text-muted">
          <p>
            Within each cell, fares are scored with a robust z-score on the log scale, using the
            median and median absolute deviation (MAD):
          </p>
          <Formula>robust_z = 0.6745 × ( ln(fare) − median(ln fare) ) ÷ MAD</Formula>
          <p>
            The median and MAD are used instead of the mean and standard deviation because a single
            extreme fare inflates a standard deviation enough to conceal itself, but cannot move a
            median. A fare is flagged only when <strong className="font-medium text-ink">both</strong>{' '}
            its robust z exceeds the threshold (3.5 by default) and it deviates at least 25% from
            its cell median — statistical significance alone would surface moves too small to be
            worth an analyst's attention.
          </p>
          <p>
            Cells with fewer than eight observations, or with no price dispersion at all, are
            reported as unscoreable rather than assigned a fabricated score — the alternative is
            manufacturing a z-score out of a handful of points of noise.
          </p>
        </div>
      </Card>

      <Card title="What this MVP does not claim" subtitle="Stated plainly, because it matters">
        <ul className="space-y-2.5 text-[13px] leading-relaxed text-muted">
          {[
            ['Demo data.', 'Every fare in the bundled dataset is generated. Carriers are fictional so no invented price is attached to a real airline. Provider quote snapshots are labelled live only after a credentialed fetch succeeds.'],
            ['Offered, not transacted.', 'The data model represents advertised or offered fares. An index of offered prices is not an index of what passengers actually paid.'],
            ['Prototype route basket.', 'Route weights are illustrative traffic proportions across 7 city pairs (14 directional routes), not current official DGCA weights. Production would calibrate them against the full current DGCA route report.'],
            ['Per-cell reference base.', 'Each cell is based against its own first day in the data rather than one fixed national reference period — a simplification that keeps the index computable when cells enter and leave the panel at different times.'],
            ['Open-ended top bucket.', 'The 31+ day bucket has no upper limit, so it is the least internally homogeneous of the five. A production system with a longer collection horizon would split it into 31–60, 61–90 and 91+.'],
            ['No seasonal adjustment.', 'The series is raw. Festive and weekday effects are visible in it, not removed from it.'],
          ].map(([term, body]) => (
            <li key={term} className="flex gap-2.5">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
              <span>
                <strong className="font-medium text-ink">{term}</strong> {body}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Evidence & Audit Trail" subtitle="How every published number can be verified">
        <div className="space-y-4 text-[13px] leading-relaxed text-muted">
          <p>
            Every metric this dashboard publishes derives from a deterministic, reproducible formula.
            The table below maps each output to its data source, formula, and test coverage — so any
            analyst or regulator can trace a number back to raw observations without depending on
            this application.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-[12px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Metric</th>
                  <th className="pb-2 font-semibold">Data source</th>
                  <th className="pb-2 font-semibold">Formula / Method</th>
                  <th className="pb-2 font-semibold">Test coverage</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    metric: 'Publication-gated basket indicator',
                    source: 'observations table',
                    formula: 'APIx[t] = 100 × Σ (W[cell]/ΣW) × R[cell,t]',
                    test: 'test_index.py — weighted aggregation',
                  },
                  {
                    metric: 'Sensitivity index (Jevons)',
                    source: 'observations table',
                    formula: 'Jevons[t] = 100 × exp(mean(ln R[cell,t]))',
                    test: 'test_index.py — unweighted Jevons',
                  },
                  {
                    metric: 'Fare alert (spike/drop)',
                    source: 'observations table',
                    formula: 'robust_z = 0.6745 × (ln(fare) − median) / MAD; flagged if |z|>3.5 AND |dev|≥25%',
                    test: 'test_anomaly.py — extreme fare detection',
                  },
                  {
                    metric: 'Passenger Exposure Proxy',
                    source: 'spike result + route basket',
                    formula: 'route_weight% × (dev/25) × urgency × severity × confidence',
                    test: 'test_anomaly.py — proxy range and monotonicity',
                  },
                  {
                    metric: 'Panel coverage %',
                    source: 'observations table',
                    formula: 'mean(observed_days / total_days) per cell, quality flag at 80/90% thresholds',
                    test: 'test_index.py — coverage report',
                  },
                  {
                    metric: 'Route competition observation-share proxy',
                    source: 'observations table',
                    formula: 'HHI = Σ (carrier_share²); status: Healthy <0.35, Watch 0.35–0.60, High Risk ≥0.60',
                    test: 'test_competition.py',
                  },
                  {
                    metric: 'Vulnerability score',
                    source: 'observations + spikes',
                    formula: 'weighted(within-cell robust log-residual volatility/0.20, alert_rate/0.1, urgency_weight) × coverage_confidence',
                    test: 'test_vulnerability.py',
                  },
                  {
                    metric: 'Fairness Lens category signal',
                    source: 'category-specific matched cells',
                    formula: 'category index change − basket index change; ±2 pp prototype bands',
                    test: 'test_fairness.py — like-for-like index comparison',
                  },
                ].map((row) => (
                  <tr key={row.metric} className="border-b border-line/60 last:border-0">
                    <td className="py-2 font-medium text-ink">{row.metric}</td>
                    <td className="py-2 font-mono text-[11px] text-muted">{row.source}</td>
                    <td className="py-2 font-mono text-[11px] text-ink">{row.formula}</td>
                    <td className="py-2 text-[11px] text-muted">{row.test}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px]">
            All engine functions are unit-tested. The test suite includes worked numerical examples
            — e.g., <Mono>test_index.py::test_two_cell_worked_example</Mono> replicates the
            calculation from the worked example above, verifiable with a calculator.
          </p>
          <div className="rounded-md border border-line bg-ground/50 px-4 py-3 text-[12px]">
            <strong className="font-medium text-ink">How to audit a specific metric:</strong>{' '}
            Open the Fare Alerts page, click any row, and expand the{' '}
            <strong className="font-medium text-ink">Evidence Trail</strong> section at the bottom
            of the Case File. It lists the observation ID, cell definition, formula applied,
            detection threshold, cell size, calculation ID, methodology version, dataset SHA-256,
            and source batch used for that alert. This is reproducible calculation provenance,
            not an immutable user/action audit log. The same
            data is available on the Overview page via the{' '}
            <em>Evidence Trail</em> button below the stat cards.
          </div>
        </div>
      </Card>

      <Card title="Data sourcing" subtitle="How real feeds would be added">
        <div className="space-y-3 text-[13px] leading-relaxed text-muted">
          <p>
            This MVP reads the bundled/generated CSV, validated CSV imports, and credential-gated
            provider quote snapshots. No website is scraped and no access control is circumvented.
            Provider support is operationally unverified until credentials are configured and a
            successful fetch stores rows with live provenance.
          </p>
          <p>
            Ingestion sits behind one seam: everything downstream consumes validated observation
            rows, never a file. Each analysis uses one explicit provenance cohort (demo, imported,
            or live), so those sources cannot silently form a hybrid time series. A licensed airline,
            NDC, or GDS adapter must emit the same validated row shape.
          </p>
        </div>
      </Card>
    </div>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ground px-1.5 py-0.5 font-mono text-[12px] text-ink">
      {children}
    </code>
  )
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-line bg-ground px-4 py-3 font-mono text-[12.5px] text-ink">
      {children}
    </div>
  )
}
