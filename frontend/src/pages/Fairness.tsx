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
  type FairnessCategoryRow,
  type FairnessData,
} from '../api'
import { Card, EmptyState, ErrorNote, JudgePanel, Spinner, StatTile, Pill } from '../components/ui'
import { axisProps, gridProps, tooltipProps } from '../components/chart'
import { useDialogFocus } from '../components/useDialogFocus'
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

// ─── Category detail drawer ───────────────────────────────────────────────────

function CategoryDrawer({
  row,
  onClose,
}: {
  row: FairnessCategoryRow
  onClose: () => void
}) {
  const color = CAT_COLOR[row.category] ?? '#666'
  const dialogRef = useDialogFocus<HTMLDivElement>()
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fairness-category-title"
        tabIndex={-1}
        className="w-full max-w-[640px] rounded-lg border border-line bg-white shadow-xl"
      >
        <header className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: color }}
              />
              <h2 id="fairness-category-title" className="font-serif text-[20px] font-semibold tracking-tight">
                {row.category}
              </h2>
              {row.fare_pressure && (
                <Pill tone={pressureTone(row.fare_pressure)}>
                  {row.fare_pressure} relative index pressure
                </Pill>
              )}
            </div>
            <p className="mt-1 text-[12px] text-muted">Like-for-like category index signal</p>
          </div>
          <button
            type="button"
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
              { label: 'Category index', value: row.index_value?.toFixed(2) ?? '—' },
              { label: 'Index change', value: row.index_change_pct != null ? `${row.index_change_pct >= 0 ? '+' : ''}${row.index_change_pct.toFixed(2)}%` : '—' },
              { label: 'Vs basket', value: row.relative_to_basket_pts != null ? `${row.relative_to_basket_pts >= 0 ? '+' : ''}${row.relative_to_basket_pts.toFixed(2)} pp` : '—' },
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

          {row.observation_count > 0 && !row.index_weighting_complete && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-[11.5px] leading-relaxed text-amber-900">
              No relative pressure band is assigned because this category includes
              cells without reviewed prototype route weights.
            </div>
          )}

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

          {/* Avg exposure proxy */}
          {row.avg_exposure_proxy != null && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                Average passenger exposure proxy (spikes only)
              </div>
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <div
                    style={{
                      width: `${Math.min(100, row.avg_exposure_proxy)}%`,
                      background: color,
                    }}
                    className="h-full rounded-full"
                  />
                </div>
                <span className="tnum w-10 text-right font-mono text-[13px] font-semibold text-ink">
                  {row.avg_exposure_proxy.toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="rounded-md border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-[11.5px] leading-relaxed text-[#1e40af]">
            <strong>Monitoring signal only.</strong> Differences in fare pressure across route
            categories compare like-for-like category index movement with basket index movement.
            The ±2 point bands are prototype thresholds. This view does not measure fairness,
            discrimination, passenger welfare, or wrongdoing by any carrier.
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
  const [chartMetric, setChartMetric] = useState<'index_change_pct' | 'alert_rate' | 'avg_exposure_proxy'>(
    'index_change_pct',
  )

  useEffect(() => {
    let cancelled = false
    api.fairness()
      .then((result) => { if (!cancelled) setData(result) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selected) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selected])

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
    index_change_pct: 'Category index change (%)',
    alert_rate: 'Alert rate (%)',
    avg_exposure_proxy: 'Avg exposure proxy',
  }
  const chartData = cats
    .filter((c) => c.observation_count > 0 && c[chartMetric] != null)
    .map((c) => ({
      name: c.category.replace('Connectivity-sensitive', 'Connectivity'),
      value:
        chartMetric === 'alert_rate'
          ? Number(((c.alert_rate ?? 0) * 100).toFixed(2))
          : chartMetric === 'index_change_pct'
          ? c.index_change_pct ?? 0
          : c.avg_exposure_proxy ?? 0,
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
          Like-for-like route-category index comparison — not a finding of fairness or harm
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
              a: 'The lens compares movement in category-specific matched-cell indices, not raw price levels. A higher relative signal means a category index rose faster than the basket; it does not establish passenger burden or unfairness.',
            },
            {
              q: 'How confident are we?',
              a: `Metrics use ${observationTotal.toLocaleString()} observations and the same cell-relative index method as the basket. Category assignments and ±2 point pressure bands are illustrative. Tier-2 has no observations.`,
            },
            {
              q: 'What should an analyst do next?',
              a: `Open a category row and verify its index period, coverage flag, route membership, and alerts. Treat a High signal as a prioritisation cue for further data collection, not a fairness conclusion.`,
            },
          ]}
        />
      )}

      {/* Summary stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Policy categories" value={String(policyCategories.length)} />
        <StatTile label="Policy categories with data" value={String(policyWithData.length)} />
        <StatTile
          label="High relative-signal categories"
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
              ['index_change_pct', 'Index change'],
              ['alert_rate', 'Alert rate'],
              ['avg_exposure_proxy', 'Avg exposure proxy'],
            ] as [typeof chartMetric, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setChartMetric(key)}
              aria-pressed={chartMetric === key}
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
                chartMetric === 'index_change_pct' || chartMetric === 'alert_rate'
                  ? `${v}%`
                  : String(v)
              }
              width={52}
            />
            <Tooltip
              {...tooltipProps}
              formatter={(value) => {
                const v = Number(value)
                return [
                  chartMetric === 'index_change_pct' || chartMetric === 'alert_rate'
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
      <Card title="Relative index pressure by route category" subtitle="High/Low compares category index change with basket index change using ±2 percentage-point prototype bands">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                {[
                  'Category', 'Routes', 'Observations', 'Index change',
                  'Vs basket', 'Avg exposure proxy', 'Relative pressure', '',
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
                      empty ? 'opacity-40' : 'hover:bg-ground'
                    }`}
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
                    <td className="px-3 py-2.5 tnum text-ink">
                      {row.index_change_pct != null ? `${row.index_change_pct >= 0 ? '+' : ''}${row.index_change_pct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.relative_to_basket_pts != null
                        ? `${row.relative_to_basket_pts >= 0 ? '+' : ''}${row.relative_to_basket_pts.toFixed(2)} pp`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 tnum text-ink">
                      {row.avg_exposure_proxy != null ? row.avg_exposure_proxy.toFixed(1) : '—'}
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
                        <button
                          type="button"
                          className="text-[11px] font-medium text-accent hover:underline"
                          onClick={() => setSelected(row)}
                          aria-label={`Open details for ${row.category}`}
                        >
                          Details
                        </button>
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
            A basket indicator can obscure differences in how matched fare indices move across
            route categories. This view makes those differences visible without comparing the raw
            price level of inherently different products.
          </p>
          <p>
            The Fairness Lens is a first-pass monitoring signal.  It flags categories where
            category index change, alert rates, or exposure proxies deviate from the basket-wide
            pattern, prompting deeper analyst investigation rather than automated conclusions.
          </p>
          <p>
            Observed differences can have many explanations that this dataset does not measure,
            including demand mix, schedules, capacity, or event timing. No inference of
            discrimination or wrongdoing is made. The view only prioritises questions for
            follow-up with authoritative route and passenger evidence.
          </p>
        </div>

        {/* Tier-2 note */}
        <div className="mt-4 rounded-md border border-line bg-ground px-4 py-3 text-[12px] leading-relaxed text-muted">
          <strong className="text-ink">Tier-2 routes not in demo dataset.</strong> The synthetic
          sample covers only 7 city-pairs. Routes serving regional centres can be assigned only
          after a reviewed classification is supplied. The prototype does not assume their
          carrier availability, transport alternatives, or monitoring priority.
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
