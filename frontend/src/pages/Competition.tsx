import { useEffect, useState } from 'react'
import { api, formatINR, type RouteCompetition } from '../api'
import { Card, EmptyState, ErrorNote, JudgePanel, Pill, Spinner, StatTile } from '../components/ui'
import { useJudgeMode } from '../context/judgeModeContext'

// ─── Tone helpers ─────────────────────────────────────────────────────────────

function statusTone(status: RouteCompetition['status']): 'ok' | 'warn' | 'alert' {
  if (status === 'Healthy') return 'ok'
  if (status === 'Watch') return 'warn'
  return 'alert'
}

function pressureTone(p: RouteCompetition['fare_pressure']): 'ok' | 'neutral' | 'alert' {
  if (p === 'Low') return 'ok'
  if (p === 'High') return 'alert'
  return 'neutral'
}

function HhiBar({ hhi }: { hhi: number }) {
  // 0 = fully competitive, 1 = monopoly
  const pct = Math.round(hhi * 100)
  const color =
    hhi >= 0.60 ? '#e05c3a' : hhi >= 0.35 ? '#d48a11' : '#2a9174'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
        <div style={{ width: `${pct}%`, background: color }} className="h-full rounded-full" />
      </div>
      <span className="tnum text-[11.5px] text-muted">{hhi.toFixed(3)}</span>
    </div>
  )
}

// ─── Route detail drawer ──────────────────────────────────────────────────────

function RouteDrawer({
  route,
  dataSource,
  onClose,
}: {
  route: RouteCompetition
  dataSource: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="competition-route-title"
        className="w-full max-w-[620px] rounded-lg border border-line bg-white shadow-xl"
      >
        <header className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 id="competition-route-title" className="font-serif text-[20px] font-semibold tracking-tight font-mono">
                {route.route}
              </h2>
              <Pill tone={statusTone(route.status)}>{route.status}</Pill>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              Competition concentration monitoring signal
            </p>
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
          {/* Key metrics grid */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
            {[
              { label: 'Active carriers', value: String(route.carrier_count) },
              { label: 'HHI (concentration)', value: route.hhi.toFixed(3) },
              { label: 'Dominant carrier', value: route.dominant_carrier, mono: true },
              { label: 'Dominant share', value: `${(route.dominant_share * 100).toFixed(1)}%` },
              { label: 'Avg fare', value: formatINR(route.avg_fare) },
              { label: 'Fare pressure', value: route.fare_pressure },
            ].map((m) => (
              <div key={m.label} className="bg-surface px-4 py-2.5">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">{m.label}</div>
                <div className={`mt-0.5 text-[13px] font-medium ${m.mono ? 'font-mono text-[12px]' : ''}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {/* Carrier share breakdown */}
          <div>
            <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
              Carrier presence ({route.observation_count.toLocaleString()} observations)
            </h3>
            <div className="space-y-1.5">
              {route.carriers.map((carrier) => {
                const isDominant = carrier === route.dominant_carrier
                return (
                  <div key={carrier} className="flex items-center gap-2">
                    <span className={`w-10 font-mono text-[12px] font-medium ${isDominant ? 'text-ink' : 'text-muted'}`}>
                      {carrier}
                    </span>
                    {isDominant && (
                      <Pill tone="accent">dominant</Pill>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* How status was derived */}
          <div className="rounded-md border border-line bg-ground/30 px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
              How this status was derived
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink">
              {route.status === 'Healthy' && (
                <>
                  This route has <strong>{route.carrier_count} active carriers</strong> and
                  an HHI of <strong>{route.hhi.toFixed(3)}</strong> — below the 0.35 watch
                  threshold. Fare observations are distributed across multiple carriers with
                  no single dominant player. Standard competitive conditions.
                </>
              )}
              {route.status === 'Watch' && (
                <>
                  This route has <strong>{route.carrier_count} active carrier{route.carrier_count !== 1 ? 's' : ''}</strong> and
                  an HHI of <strong>{route.hhi.toFixed(3)}</strong>.{' '}
                  {route.carrier_count === 2
                    ? 'A two-carrier market limits the scope for competitive price pressure.'
                    : 'The HHI is in the 0.35–0.60 range, suggesting one carrier holds a significant share.'}{' '}
                  Worth monitoring but not an immediate concentration signal.
                </>
              )}
              {route.status === 'High Risk' && (
                <>
                  This route has <strong>{route.carrier_count} active carrier{route.carrier_count !== 1 ? 's' : ''}</strong> and
                  an HHI of <strong>{route.hhi.toFixed(3)}</strong>.{' '}
                  {route.carrier_count === 1
                    ? 'A single carrier holds all observations on this route — a monopoly signal.'
                    : `The HHI of ${route.hhi.toFixed(3)} is at or above the 0.60 threshold, indicating strong concentration.`}{' '}
                  The dominant carrier (<strong>{route.dominant_carrier}</strong>) accounts
                  for <strong>{(route.dominant_share * 100).toFixed(1)}%</strong> of observations.
                  Analyst review recommended.
                </>
              )}
            </p>
          </div>

          <div className="rounded-md border border-[#f0dcbb] bg-[#fdf4e7] px-4 py-3">
            <p className="text-[11.5px] leading-relaxed text-warn/90">
              <strong>Monitoring signal only.</strong> HHI is computed on observation counts
              in the current dataset, not on actual market share or revenue.
              This is a concentration-risk proxy — not a legal or regulatory finding.
            </p>
          </div>
        </div>

        <footer className="border-t border-line px-6 py-3 text-[11px] text-muted">
          FarePulse Competition Monitor · {route.observation_count.toLocaleString()} observations · {dataSource}
        </footer>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Competition() {
  const [data, setData] = useState<import('../api').CompetitionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<RouteCompetition | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  useEffect(() => {
    let cancelled = false
    api
      .competition()
      .then((result) => { if (!cancelled) setData(result) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selected) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selected])

  const { judgeMode } = useJudgeMode()

  if (error) return <ErrorNote message={error} />

  const routes = data?.routes ?? []
  const summary = data?.summary ?? { healthy_count: 0, watch_count: 0, high_risk_count: 0, total_routes: 0 }

  const filtered = filterStatus === 'all'
    ? routes
    : routes.filter((r) => r.status === filterStatus)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[26px] leading-tight">Competition Heatmap</h1>
        <p className="mt-1 text-[13px] text-muted">
          Concentration-risk monitoring signals by route — not legal findings of anti-competitive behaviour.
        </p>
      </header>

      {/* ───────────────────────── JUDGE MODE ───────────────────────── */}
      {judgeMode && (
        <JudgePanel items={[
          {
            q: 'What happened?',
            a: data && !data.empty
              ? `Of ${summary.total_routes} monitored routes, ${summary.healthy_count} are Healthy (3+ carriers, HHI < 0.35), ${summary.watch_count} are under Watch, and ${summary.high_risk_count} are flagged High Risk. ${
                  summary.high_risk_count > 0
                    ? `The ${summary.high_risk_count} High Risk route${summary.high_risk_count !== 1 ? 's' : ''} ${summary.high_risk_count !== 1 ? 'have' : 'has'} either a single carrier or a concentration index (HHI) at or above 0.60.`
                    : 'No routes are in the High Risk zone under the current data.'
                }`
              : 'Loading competition data…',
          },
          {
            q: 'Why does it matter?',
            a: 'Routes with a single carrier, or where one carrier holds the majority of fare observations, face limited competitive price pressure. When those same routes also show elevated average fares (High fare pressure), the combination is the strongest signal in this dataset for an analyst to investigate. Note: this is a monitoring indicator — not a legal or regulatory finding.',
          },
          {
            q: 'How confident are we?',
            a: `The Herfindahl-Hirschman Index (HHI) is computed from fare observation counts in the current dataset (${data?.data_source ?? 'source unavailable'}) — not from actual revenue, capacity, or passenger shares, which are unavailable. Treat concentration signals as directional proxies. A route with 2 carriers and low fares (Watch status, Low pressure) may not require action; a route with 1 carrier and High fare pressure warrants closer scrutiny.`,
          },
          {
            q: 'What should an analyst do next?',
            a: `${
              data && !data.empty && summary.high_risk_count > 0
                ? `Click any High Risk row to open the detail view. Check whether that route also appears in the Fare Alerts page with CARRIER_SPECIFIC_SPIKE or LOW_COMPETITION_ROUTE reason codes — that combination is the highest-priority signal.`
                : 'Review Watch-status routes — particularly those with High fare pressure. These are worth monitoring even if they do not yet qualify as High Risk.'
            }`,
          },
        ]} />
      )}

      {/* Summary stat tiles */}
      {!loading && data && !data.empty && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatTile
            label="Total routes"
            value={summary.total_routes}
            hint="Routes in dataset"
          />
          <StatTile
            label="Healthy"
            value={summary.healthy_count}
            hint="3+ carriers, HHI < 0.35"
          />
          <StatTile
            label="Watch"
            value={summary.watch_count}
            hint="2 carriers or HHI 0.35–0.60"
            tone={summary.watch_count > 0 ? 'alert' : 'default'}
          />
          <StatTile
            label="High Risk"
            value={summary.high_risk_count}
            hint="1 carrier or HHI ≥ 0.60"
            tone={summary.high_risk_count > 0 ? 'alert' : 'default'}
          />
        </div>
      )}

      {/* How status is derived */}
      <Card title="How competition status is derived">
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-3 text-[13px] leading-relaxed text-muted">
            <p>
              For each route we count the number of <strong className="font-medium text-ink">distinct
              carriers</strong> that have priced a fare in the observation window, then compute
              the <strong className="font-medium text-ink">Herfindahl-Hirschman Index (HHI)</strong> — the
              sum of squared observation-share fractions.
            </p>
            <p>
              An HHI near <strong className="font-medium text-ink">0.25</strong> means four carriers
              each hold roughly 25% of fare observations (competitive). An HHI
              of <strong className="font-medium text-ink">1.0</strong> means a single carrier holds
              everything (monopoly signal). The metric is computed on observation counts in this
              dataset — not on actual revenue or passengers, which are unavailable.
            </p>
            <p>
              <strong className="font-medium text-ink">Fare pressure</strong> cross-checks concentration:
              we compare the route's average fare to the basket-wide median of route averages.
              A route that shows High Risk <em>and</em> High fare pressure is the combination
              that merits the most analyst scrutiny.
            </p>
            <p className="text-[12px]">
              These are statistical monitoring signals — not legal or regulatory determinations.
              The same route patterns appear in the Fare Alerts page as{' '}
              <span className="rounded bg-ground px-1.5 py-0.5 font-mono text-[10.5px]">LOW_COMPETITION_ROUTE</span>{' '}
              reason codes when individual fares are also statistically extreme.
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                status: 'Healthy' as const,
                rule: 'carrier_count ≥ 3 AND HHI < 0.35',
                desc: 'Multiple active carriers, no dominant player.',
              },
              {
                status: 'Watch' as const,
                rule: 'carrier_count = 2 OR HHI 0.35–0.60',
                desc: 'Limited competition or emerging concentration.',
              },
              {
                status: 'High Risk' as const,
                rule: 'carrier_count = 1 OR HHI ≥ 0.60',
                desc: 'Monopoly signal or strong concentration. Analyst review recommended.',
              },
            ].map((item) => (
              <div key={item.status} className="rounded-md border border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <Pill tone={statusTone(item.status)}>{item.status}</Pill>
                  <span className="font-mono text-[11px] text-muted">{item.rule}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Filter bar */}
      {!loading && data && !data.empty && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
            Filter
          </span>
          {(['all', 'Healthy', 'Watch', 'High Risk'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                filterStatus === s
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line bg-surface text-muted hover:bg-ground'
              }`}
            >
              {s === 'all' ? `All (${summary.total_routes})` : s}
            </button>
          ))}
        </div>
      )}

      {/* Heatmap table */}
      {loading ? (
        <Spinner />
      ) : !data || data.empty ? (
        <EmptyState
          title="No data loaded"
          body={data?.message ?? 'Go to the Admin page and load the sample dataset to see competition monitoring signals.'}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No routes match this filter"
          body="Try a different status filter."
        />
      ) : (
        <Card
          title="Route competition heatmap"
          subtitle="Click any row for a detailed breakdown — sorted by concentration risk"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Route</th>
                  <th className="pb-2 text-center font-semibold">Status</th>
                  <th className="pb-2 text-right font-semibold">Carriers</th>
                  <th className="pb-2 font-semibold">HHI (concentration)</th>
                  <th className="pb-2 font-semibold">Dominant</th>
                  <th className="pb-2 text-right font-semibold">Dom. share</th>
                  <th className="pb-2 text-right font-semibold">Avg fare</th>
                  <th className="pb-2 text-center font-semibold">Fare pressure</th>
                  <th className="pb-2 text-right font-semibold">Obs.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.route}
                    className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-ground/60"
                    onClick={() => setSelected(r)}
                  >
                    <td className="py-2.5 font-mono text-[12px] font-medium">{r.route}</td>
                    <td className="py-2.5 text-center">
                      <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                    </td>
                    <td className="py-2.5 text-right tnum font-medium">{r.carrier_count}</td>
                    <td className="py-2.5">
                      <HhiBar hhi={r.hhi} />
                    </td>
                    <td className="py-2.5 font-mono text-[12px] text-muted">{r.dominant_carrier}</td>
                    <td className="py-2.5 text-right tnum">
                      {(r.dominant_share * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 text-right tnum">{formatINR(r.avg_fare)}</td>
                    <td className="py-2.5 text-center">
                      <Pill tone={pressureTone(r.fare_pressure)}>{r.fare_pressure}</Pill>
                    </td>
                    <td className="py-2.5 text-right tnum text-muted">
                      {r.observation_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {selected && (
        <RouteDrawer
          route={selected}
          dataSource={data?.data_source ?? 'Dataset source unavailable'}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
