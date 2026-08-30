import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  api,
  formatINR,
  type FairnessCategoryRow,
  type FairnessData,
} from '../api'
import { Card, EmptyState, ErrorNote, JudgePanel, Spinner, StatTile, Pill } from '../components/ui'
import { axisProps, gridProps, tooltipProps } from '../components/chart'
import { useJudgeMode } from '../context/judgeModeContext'

// ─── Colour helpers ───────────────────────────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
  'Metro':                  '#0b6e6e',
  'Business-heavy':         '#6952a8',
  'Tourism-heavy':          '#2a9174',
  'Connectivity-sensitive': '#d48a11',
  'Tier-2':                 '#b45309',
  'Unclassified':           '#64748b',
}

const PRESSURE_TONE: Record<string, 'ok' | 'warn' | 'alert' | 'neutral'> = {
  Low:      'ok',
  Moderate: 'neutral',
  High:     'alert',
}

function pressureTone(p: string | null): 'ok' | 'warn' | 'alert' | 'neutral' {
  return p ? (PRESSURE_TONE[p] ?? 'neutral') : 'neutral'
}

// ─── Mini progress bar ────────────────────────────────────────────────────────

function RateBar({ rate, color }: { rate: number; color: string }) {
  const pct = Math.min(100, Math.round(rate * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
        <div style={{ width: `${pct}%`, background: color }} className="h-full rounded-full" />
      </div>
      <span className="tnum text-[11.5px] text-muted">{(rate * 100).toFixed(1)}%</span>
    </div>
  )
}

// ─── Category detail drawer ───────────────────────────────────────────────────

function CategoryDrawer({
  row,
  onClose,
}: {
  row: FairnessCategoryRow
  onClose: () => void
}) {
  const color = CAT_COLOR[row.category] ?? '#666'
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
      <div className="w-full max-w-[640px] rounded-lg border border-line bg-white shadow-xl">
        <header className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: color }}
              />
              <h2 className="font-serif text-[20px] font-semibold tracking-tight">
                {row.category}
              </h2>
              {row.fare_pressure && (
                <Pill tone={pressureTone(row.fare_pressure)}>
                  {row.fare_pressure} fare pressure
                </Pill>
              )}
            </div>
            <p className="mt-1 text-[12px] text-muted">Route category fare pressure signal</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 rounded-md p-1.5 text-muted hover:bg-ground hover:text-ink transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="space-y-5 p-6">
          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
            {[
              { label: 'Routes in category', value: String(row.route_count) },
              { label: 'Observations', value: row.observation_count.toLocaleString('en-IN') },
              { label: 'Average fare', value: formatINR(row.avg_fare) },
              { label: 'Median fare', value: formatINR(row.median_fare) },
              { label: 'Fare spikes', value: String(row.alert_count) },
              {
                label: 'Alert rate',
                value: row.alert_rate != null ? `${(row.alert_rate * 100).toFixed(1)}%` : '—',
              },
            ].map((m) => (
              <div key={m.label} className="bg-surface px-4 py-2.5">
                <div className="text-[10.5px] uppercase tracking-[0.08em] text-muted">{m.label}</div>
                <div className="mt-0.5 font-mono text-[14px] font-semibold text-ink">{m.value}</div>
              </div>
            ))}
          </div>

          {/* Description */}
          <div>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
              Why this category matters
            </div>
            <p className="text-[13px] leading-relaxed text-ink">{row.description}</p>
          </div>

          {/* Routes list */}
          {row.routes.length > 0 && (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                Routes in this category ({row.routes.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.routes.map((r) => (
                  <span
                    key={r}
                    className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-[12px] text-ink"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}

          {row.observation_count === 0 && (
            <div className="rounded-md border border-line bg-ground px-4 py-3 text-[12px] leading-relaxed text-muted">
              No observations for this category in the current dataset.
            </div>
          )}

          {/* Avg impact score */}
          {row.avg_impact_score != null && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                Average passenger impact score (spikes only)
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    style={{
                      width: `${Math.min(100, row.avg_impact_score)}%`,
                      background: color,
                    }}
                    className="h-full rounded-full"
                  />
                </div>
                <span className="tnum w-10 text-right font-mono text-[13px] font-semibold text-ink">
                  {row.avg_impact_score.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="rounded-md border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-[11.5px] leading-relaxed text-[#1e40af]">
            <strong>Monitoring signal only.</strong> Differences in fare pressure across route
            categories may reflect legitimate demand and supply dynamics.  This view does not
            imply discrimination or wrongdoing by any carrier.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Fairness() {
  const { judgeMode } = useJudgeMode()
  const [data, setData] = useState<FairnessData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FairnessCategoryRow | null>(null)
  const [chartMetric, setChartMetric] = useState<'avg_fare' | 'alert_rate' | 'avg_impact_score'>(
    'avg_fare',
  )

  useEffect(() => {
    api.fairness().then(setData).catch((e) => setError(e.message))
  }, [])

  if (error) return <ErrorNote message={error} />
  if (!data) return <Spinner label="Loading fairness data" />
  if (data.empty)
    return (
      <EmptyState
        title="No data loaded"
        body={data.message ?? 'Go to the Admin page and load the sample dataset.'}
      />
    )

  const cats = data.categories

  // Summary counts
  const policyCategories = cats.filter((c) => c.category !== 'Unclassified')
  const policyWithData = policyCategories.filter((c) => c.observation_count > 0)
  const observationTotal = cats.reduce((total, c) => total + c.observation_count, 0)
  const highPressure = policyCategories.filter((c) => c.fare_pressure === 'High').length
  const highestAlert = policyWithData.reduce(
    (best, c) => (c.alert_rate != null && (best == null || c.alert_rate > best.alert_rate!))
      ? c : best,
    null as FairnessCategoryRow | null,
  )

  // Chart data — only categories with observations, sorted by metric
  const metricLabel: Record<typeof chartMetric, string> = {
    avg_fare: 'Average fare (₹)',
    alert_rate: 'Alert rate (%)',
    avg_impact_score: 'Avg impact score',
  }
  const chartData = cats
    .filter((c) => c.observation_count > 0)
    .map((c) => ({
      name: c.category.replace('Connectivity-sensitive', 'Connectivity'),
      value:
        chartMetric === 'alert_rate'
          ? Number(((c.alert_rate ?? 0) * 100).toFixed(2))
          : chartMetric === 'avg_fare'
          ? c.avg_fare ?? 0
          : c.avg_impact_score ?? 0,
      category: c.category,
    }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-serif text-[26px] font-semibold tracking-tight text-ink">
          Fairness Lens
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          Route category fare pressure — a public-interest monitoring view
        </p>
      </div>

      {/* Judge Mode panel */}
      {judgeMode && (
        <JudgePanel
          items={[
            {
              q: 'What happened?',
              a: `${policyWithData.length} of ${policyCategories.length} policy categories have data. ${highPressure > 0 ? `${highPressure} ${highPressure === 1 ? 'category has' : 'categories have'} High fare pressure.` : 'No categories show High fare pressure.'} ${highestAlert ? `Highest alert rate is in ${highestAlert.category} routes (${((highestAlert.alert_rate ?? 0) * 100).toFixed(1)}%).` : ''}`,
            },
            {
              q: 'Why does it matter?',
              a: 'Different traveller types bear different fare burdens. Connectivity-sensitive routes — where air is the only practical option — are most vulnerable to elevated fares. An elevated alert rate in those corridors warrants closer scrutiny than the same rate on competitive Metro routes.',
            },
            {
              q: 'How confident are we?',
              a: `Metrics are computed from the same ${observationTotal.toLocaleString()} observations that power the headline index. Tier-2 routes have no observations in this dataset. All figures are monitoring signals — not findings of unfair pricing.`,
            },
            {
              q: 'What should an analyst do next?',
              a: `Open any category row for a detailed breakdown. Focus on rows combining High fare pressure with a high alert rate — that combination most warrants investigation. Compare Connectivity-sensitive and Metro categories to assess whether less-competitive corridors are carrying disproportionate fare pressure.`,
            },
          ]}
        />
      )}

      {/* Summary stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Policy categories" value={String(policyCategories.length)} />
        <StatTile label="Policy categories with data" value={String(policyWithData.length)} />
        <StatTile
          label="High fare-pressure categories"
          value={String(highPressure)}
          tone={highPressure > 0 ? 'alert' : 'default'}
        />
        <StatTile
          label="Highest alert rate"
          value={
            highestAlert?.alert_rate != null
              ? `${(highestAlert.alert_rate * 100).toFixed(1)}%`
              : '—'
          }
          hint={highestAlert?.category ?? ''}
        />
      </div>

      {/* Chart */}
      <Card title="Category comparison">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[11.5px] text-muted">Show:</span>
          {(
            [
              ['avg_fare', 'Average fare'],
              ['alert_rate', 'Alert rate'],
              ['avg_impact_score', 'Avg impact score'],
            ] as [typeof chartMetric, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setChartMetric(key)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                chartMetric === key
                  ? 'bg-accent-soft text-accent'
                  : 'bg-ground text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="name" {...axisProps} tick={{ ...axisProps.tick, fontSize: 11 }} />
            <YAxis
              {...axisProps}
              tickFormatter={(v) =>
                chartMetric === 'avg_fare'
                  ? `₹${(v / 1000).toFixed(0)}k`
                  : String(v)
              }
              width={52}
            />
            <Tooltip
              {...tooltipProps}
              formatter={(value) => {
                const v = Number(value)
                return [
                  chartMetric === 'avg_fare'
                    ? formatINR(v)
                    : chartMetric === 'alert_rate'
                    ? `${v.toFixed(2)}%`
                    : v.toFixed(1),
                  metricLabel[chartMetric],
                ]
              }}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={64}>
              {chartData.map((d) => (
                <Cell key={d.category} fill={CAT_COLOR[d.category] ?? '#888'} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Category table */}
      <Card title="Fare pressure by route category">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                {[
                  'Category', 'Routes', 'Observations', 'Avg fare',
                  'Alert rate', 'Avg impact score', 'Fare pressure', '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted first:pl-0 last:pr-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cats.map((row) => {
                const color = CAT_COLOR[row.category] ?? '#888'
                const empty = row.observation_count === 0
                return (
                  <tr
                    key={row.category}
                    className={`border-b border-line last:border-0 ${
                      empty ? 'opacity-40' : 'cursor-pointer hover:bg-ground'
                    }`}
                    onClick={() => !empty && setSelected(row)}
                  >
                    {/* Category name */}
                    <td className="py-2.5 pl-0 pr-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        <span className="font-medium text-ink">{row.category}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 tnum text-ink">{row.route_count}</td>
                    <td className="px-3 py-2.5 tnum text-ink">
                      {row.observation_count.toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2.5 tnum text-ink">{formatINR(row.avg_fare)}</td>
                    <td className="px-3 py-2.5">
                      {row.alert_rate != null ? (
                        <RateBar rate={row.alert_rate} color={color} />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 tnum text-ink">
                      {row.avg_impact_score != null ? row.avg_impact_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.fare_pressure ? (
                        <Pill tone={pressureTone(row.fare_pressure)}>{row.fare_pressure}</Pill>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 pr-0 text-right">
                      {!empty && (
                        <span className="text-[11px] text-accent hover:underline">Details</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Policy context */}
      <Card title="Why this matters for public policy">
        <div className="space-y-3 text-[13px] leading-relaxed text-ink">
          <p>
            A national airfare index captures the aggregate price level — but aggregate figures
            can obscure distributional effects.  If fare pressure is concentrated on
            connectivity-sensitive routes, passengers who depend on air travel for essential
            trips bear a disproportionate burden relative to leisure or corporate travellers on
            trunk routes with abundant alternatives.
          </p>
          <p>
            The Fairness Lens is a first-pass monitoring signal.  It flags categories where
            average fares, alert rates, or passenger impact scores deviate from the basket-wide
            pattern, prompting deeper analyst investigation rather than automated conclusions.
          </p>
          <p>
            Observed differences may reflect{' '}
            <strong>legitimate demand and supply dynamics</strong> — tourism peaks, corporate
            travel patterns, or limited aircraft capacity on thin routes.  No inference of
            discrimination or wrongdoing is made.  The view is intended to help MoSPI and DGCA
            prioritise which corridors warrant closer monitoring.
          </p>
        </div>

        {/* Tier-2 note */}
        <div className="mt-4 rounded-md border border-line bg-ground px-4 py-3 text-[12px] leading-relaxed text-muted">
          <strong className="text-ink">Tier-2 routes not in demo dataset.</strong> The synthetic
          sample covers only 7 metro city-pairs.  In a production deployment with real GDS or
          airline data, routes serving regional centres (Bhopal, Raipur, Srinagar, Imphal, etc.)
          would appear in the Tier-2 category — typically the highest-priority monitoring segment
          due to low carrier counts and limited passenger alternatives.
        </div>

        <div className="mt-3 rounded-md border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-[11.5px] leading-relaxed text-[#1e40af]">
          <strong>Prototype category notice.</strong> Bundled route assignments are illustrative,
          not an official government classification. Imported or live routes outside the mapping
          remain visible as Unclassified until reviewed.
        </div>
      </Card>

      {/* Drawer */}
      {selected && (
        <CategoryDrawer row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
