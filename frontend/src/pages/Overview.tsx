import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
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
  formatClass,
  formatINR,
  type CompareRow,
  type EventEntry,
  type FilterOptions,
  type Overview as OverviewData,
  type Spike,
  type Trends,
} from '../api'
import { axisProps, chartLabel, chartNumber, gridProps, tooltipProps } from '../components/chart'
import {
  Button,
  Card,
  DateInput,
  Delta,
  EmptyState,
  ErrorNote,
  EvidenceTag,
  Field,
  JudgePanel,
  Pill,
  Select,
  Spinner,
  StatTile,
} from '../components/ui'
import { useJudgeMode } from '../context/judgeModeContext'

function DataSourceBadge({ sourceTypes }: { sourceTypes: string[] }) {
  const hasLive = sourceTypes.includes('live')
  const hasDemo = sourceTypes.includes('demo')
  const hasImported = sourceTypes.includes('imported')
  const isHybrid = sourceTypes.filter((source) => ['demo', 'live', 'imported'].includes(source)).length > 1

  if (isHybrid) {
    return (
      <span title={`Stored provenance: ${sourceTypes.join(', ')}`} className="rounded border border-accent/40 bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
        Hybrid dataset
      </span>
    )
  }
  if (hasLive) {
    return (
      <span className="rounded border border-green-500/40 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
        Live quote snapshots
      </span>
    )
  }
  if (hasImported) {
    return (
      <span className="rounded border border-[#b8c4d2] bg-ground px-2 py-0.5 text-[11px] font-semibold text-muted">
        Imported dataset
      </span>
    )
  }
  return (
    <span className="rounded border border-[#f0dcbb] bg-[#fdf4e7] px-2 py-0.5 text-[11px] font-semibold text-warn">
      {hasDemo ? 'Demo dataset · synthetic' : 'Source unavailable'}
    </span>
  )
}

export default function Overview() {
  const { judgeMode } = useJudgeMode()
  const [data, setData] = useState<OverviewData | null>(null)
  const [filterOpts, setFilterOpts] = useState<FilterOptions | null>(null)
  const [spikeData, setSpikeData] = useState<{ flagged: Spike[]; flagged_count: number; scanned_count: number } | null>(null)
  const [airlineRows, setAirlineRows] = useState<CompareRow[]>([])
  const [routeRows, setRouteRows] = useState<CompareRow[]>([])
  const [eventCalendar, setEventCalendar] = useState<EventEntry[]>([])
  const [eventError, setEventError] = useState('')
  const [filteredTrends, setFilteredTrends] = useState<{
    key: string
    data: Trends | null
    error: string
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [startingDemo, setStartingDemo] = useState(false)

  // Filters
  const [granularity, setGranularity] = useState('day')
  const [route, setRoute] = useState('')
  const [airline, setAirline] = useState('')
  const [fareClass, setFareClass] = useState('')
  const [leadBucket, setLeadBucket] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const hasFilters = !!(route || airline || fareClass || leadBucket || dateFrom || dateTo)
  const filterKey = [granularity, route, airline, fareClass, leadBucket, dateFrom, dateTo].join('|')

  // Fetch national overview + filters + spikes + compare data
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.overview(granularity),
      api.filters(),
      api.spikes(3.5),
      api.compare({ dimension: 'airline', fare_class: fareClass || undefined, lead_bucket: leadBucket || undefined }),
      api.compare({ dimension: 'route', fare_class: fareClass || undefined, lead_bucket: leadBucket || undefined }),
    ])
      .then(([overview, filters, spikes, airlines, routes]) => {
        if (cancelled) return
        setData(overview)
        setFilterOpts(filters)
        setSpikeData(spikes)
        setAirlineRows(airlines.rows || [])
        setRouteRows(routes.rows || [])
        setError('')
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [granularity, fareClass, leadBucket])

  // Fetch event calendar once (illustrative demo data)
  useEffect(() => {
    let cancelled = false
    api.events()
      .then((r) => {
        if (cancelled) return
        setEventCalendar(r.events)
        setEventError('')
      })
      .catch((e: Error) => {
        if (!cancelled) setEventError(`Event context is unavailable: ${e.message}`)
      })
    return () => { cancelled = true }
  }, [])

  // Fetch filtered trends when filters are active
  useEffect(() => {
    if (!hasFilters) return
    let cancelled = false
    const params: Record<string, string | number | undefined> = { granularity }
    if (route) {
      const [o, d] = route.split('-')
      params.origin = o
      params.destination = d
    }
    if (airline) params.airline = airline
    if (fareClass) params.fare_class = fareClass
    if (leadBucket) params.lead_bucket = leadBucket
    if (dateFrom) params.travel_date_from = dateFrom
    if (dateTo) params.travel_date_to = dateTo

    api.trends(params)
      .then((result) => {
        if (!cancelled) setFilteredTrends({ key: filterKey, data: result, error: '' })
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setFilteredTrends({
            key: filterKey,
            data: null,
            error: `Filtered chart data is unavailable: ${e.message}`,
          })
        }
      })
    return () => { cancelled = true }
  }, [granularity, route, airline, fareClass, leadBucket, dateFrom, dateTo, hasFilters, filterKey])

  function resetFilters() {
    setRoute('')
    setAirline('')
    setFareClass('')
    setLeadBucket('')
    setDateFrom('')
    setDateTo('')
  }

  async function startJudgeDemo() {
    setStartingDemo(true)
    setError('')
    try {
      await api.loadSample()
      window.location.reload()
    } catch (e) {
      setStartingDemo(false)
      setError(e instanceof Error ? e.message : 'Unable to start the judge demo.')
    }
  }

  if (loading) return <Spinner />
  if (error) return <ErrorNote message={error} />
  if (!data || data.empty)
    return (
      <EmptyState
        title="No data loaded yet"
        body="Load the bundled sample dataset — about 23,000 synthetic fare observations across 14 routes and 4 fictional carriers — to populate every screen."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={startJudgeDemo} disabled={startingDemo}>
              {startingDemo ? 'Starting demo…' : 'Start Judge Demo'}
            </Button>
            <Link to="/admin">
              <Button variant="secondary">Open Data &amp; Ingestion</Button>
            </Link>
          </div>
        }
      />
    )

  const rising = (data.change_pct ?? 0) > 0
  const activeFilteredTrends = hasFilters && filteredTrends?.key === filterKey
    ? filteredTrends
    : null
  const chartSeries = hasFilters ? (activeFilteredTrends?.data?.series ?? []) : data.series
  const chartLoading = hasFilters && activeFilteredTrends === null
  const chartError = activeFilteredTrends?.error ?? ''
  const qf = data.coverage.quality_flag

  return (
    <div className="space-y-5">
      {/* ───────────────────────── HEADER ───────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-[26px] leading-tight tracking-tight">{data.indicator_name}</h1>
            <DataSourceBadge sourceTypes={filterOpts?.source_types?.length ? filterOpts.source_types : []} />
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            <span className="font-mono text-[12px]">{data.period_start}</span>
            {' '}to{' '}
            <span className="font-mono text-[12px]">{data.period_end}</span>
            {' '}·{' '}{data.observation_count.toLocaleString()} observations
            {' '}·{' '}{data.route_count} routes
            {' '}·{' '}{data.airline_count} carriers
          </p>
          {data.last_updated && (
            <p className="mt-0.5 text-[11.5px] text-muted">
              Last updated: <span className="font-mono text-[11px]">{data.last_updated}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1 rounded-md border border-line bg-surface p-1">
            {[
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
            ].map((g) => (
              <button
                key={g.value}
                onClick={() => setGranularity(g.value)}
                className={`rounded px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  granularity === g.value ? 'bg-accent-soft text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {data.suppression_reason && (
        <div
          data-testid="publication-gate"
          className={`rounded-lg border px-4 py-3 text-[12.5px] leading-relaxed ${
            data.publication_status === 'SUPPRESSED'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <strong>{data.publication_status === 'SUPPRESSED' ? 'Publication gate enforced.' : 'Provisional publication.'}</strong>{' '}
          {data.suppression_reason}
        </div>
      )}

      {/* ───────────────────────── JUDGE MODE ───────────────────────── */}
      {judgeMode && (
        <JudgePanel items={[
          {
            q: 'What happened?',
            a: `The ${data.indicator_name.toLowerCase()} is ${data.headline_index?.toFixed(2) ?? '—'} — the matched fare basket is ${
              (data.change_pct ?? 0) > 0
                ? `${(data.change_pct ?? 0).toFixed(2)}% higher`
                : (data.change_pct ?? 0) < 0
                ? `${Math.abs(data.change_pct ?? 0).toFixed(2)}% lower`
                : 'unchanged'
            } than at the start of the observation window (${data.period_start} to ${data.period_end}). ${
              data.spike_count > 0
                ? `${data.spike_count} individual fare observation${data.spike_count !== 1 ? 's were' : ' was'} flagged as statistically unusual.`
                : 'No individual fare anomalies were detected at the current threshold.'
            }`,
          },
          {
            q: 'Why does it matter?',
            a: `A value above 100 means matched fares in the observed basket are higher than their cell baselines. It does not measure what an average traveller paid. The calculation uses ${data.observation_count.toLocaleString()} observed or generated quotes across ${data.route_count} routes and ${data.airline_count} carriers.`,
          },
          {
            q: 'How confident are we?',
            a: `Panel coverage is ${data.coverage.mean_coverage_pct}% — quality flag: ${qf}. ${
              qf === 'GREEN'
                ? 'Over 90% of comparability cells reported data; the index is well-supported.'
                : qf === 'AMBER'
                ? '80–90% coverage — some cells are sparse; treat the headline as indicative.'
                : 'Below 80% coverage — the national headline is suppressed and only an experimental basket value is shown.'
            } ${data.coverage.total_cells} cells observed across ${data.coverage.total_periods} periods.`,
          },
          {
            q: 'What should an analyst do next?',
            a: `${
              data.spike_count > 0
                ? `Open the Fare Alerts page to investigate the ${data.spike_count} flagged observation${data.spike_count !== 1 ? 's' : ''}. Prioritise "Escalate" severity rows. `
                : 'No immediate action from alerts. '
            }${
              rising
                ? 'The index is rising — check whether this is broad-market or specific to a few routes/carriers using the filters on this page.'
                : 'The index is stable or falling — check whether any routes are bucking the trend upward using route-level filters.'
            }`,
          },
        ]} />
      )}

      {/* ───────────────────────── FILTERS ───────────────────────── */}
      {filterOpts && (
        <Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
            <Field label="Route">
              <Select
                value={route}
                onChange={setRoute}
                allLabel="All routes"
                options={filterOpts.routes.map((r) => ({ value: r, label: r }))}
              />
            </Field>
            <Field label="Airline">
              <Select
                value={airline}
                onChange={setAirline}
                allLabel="All carriers"
                options={filterOpts.airlines.map((a) => ({ value: a, label: a }))}
              />
            </Field>
            <Field label="Fare class">
              <Select
                value={fareClass}
                onChange={setFareClass}
                allLabel="All classes"
                options={filterOpts.fare_classes.map((c) => ({ value: c, label: formatClass(c) }))}
              />
            </Field>
            <Field label="Lead time">
              <Select
                value={leadBucket}
                onChange={setLeadBucket}
                allLabel="All buckets"
                options={filterOpts.lead_buckets.map((b) => ({ value: b.code, label: b.label }))}
              />
            </Field>
            <Field label="Date from">
              <DateInput
                value={dateFrom}
                onChange={setDateFrom}
                min={filterOpts.travel_date_min ?? undefined}
                max={dateTo || (filterOpts.travel_date_max ?? undefined)}
              />
            </Field>
            <Field label="Date to">
              <DateInput
                value={dateTo}
                onChange={setDateTo}
                min={dateFrom || (filterOpts.travel_date_min ?? undefined)}
                max={filterOpts.travel_date_max ?? undefined}
              />
            </Field>
            <div className="flex items-end">
              <Button variant="secondary" onClick={resetFilters} disabled={!hasFilters}>
                Reset
              </Button>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Filters active — chart shows filtered data; stat cards show national totals
            </div>
          )}
        </Card>
      )}

      {/* ───────────────────────── STAT CARDS ───────────────────────── */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label={data.headline_publishable ? 'Prototype index' : 'Experimental indicator'}
          value={data.headline_index?.toFixed(2) ?? '—'}
          hint={`Base = 100 · ${data.period_start}`}
        />
        <StatTile
          label="Index change"
          value={
            data.change_pct != null ? (
              <span className={rising ? 'text-alert' : 'text-ok'}>
                {rising ? '+' : ''}{data.change_pct.toFixed(2)}%
              </span>
            ) : '—'
          }
          tone={data.change_pct != null && rising ? 'alert' : data.change_pct != null && !rising ? 'ok' : 'default'}
          hint={rising ? 'Fares rose over window' : 'Fares eased over window'}
        />
        <StatTile
          label="Active alerts"
          value={data.spike_count}
          tone={data.spike_count > 0 ? 'alert' : 'ok'}
          hint={data.spike_count > 0 ? 'Flagged as unusual' : 'No anomalies detected'}
        />
        <StatTile
          label="Median fare"
          value={formatINR(data.median_fare)}
          hint="Across all observations"
        />
        <StatTile
          label="Route coverage"
          value={`${data.route_count}`}
          hint={`${data.airline_count} carriers · ${data.observation_count.toLocaleString()} obs.`}
        />
        <StatTile
          label="Data quality"
          value={
            <span className={qf === 'GREEN' ? 'text-ok' : qf === 'AMBER' ? 'text-warn' : 'text-alert'}>
              {qf}
            </span>
          }
          tone={qf === 'GREEN' ? 'ok' : qf === 'AMBER' ? 'warn' : 'alert'}
          hint={`${data.coverage.mean_coverage_pct}% panel coverage · ${data.coverage.total_cells} cells`}
        />
      </div>

      {/* ───────────────────────── EVIDENCE TRAIL (overview metrics) ───────────────────────── */}
      {data.evidence && (
        <div className="flex items-start gap-3">
          <EvidenceTag
            label="Overview metrics — Evidence Trail"
            items={[
              { label: 'Data source', value: data.evidence.data_source },
              { label: 'Observations', value: data.observation_count.toLocaleString() },
              { label: 'Date range', value: `${data.period_start} to ${data.period_end}` },
              { label: 'Headline method', value: data.evidence.calculation_method },
              { label: 'Formula', value: data.evidence.formula, mono: true },
              { label: 'Baseline', value: data.evidence.baseline },
              { label: 'Sensitivity formula', value: data.evidence.sensitivity_formula, mono: true },
              { label: 'Weight source', value: data.evidence.weight_source },
              { label: 'Cell definition', value: data.evidence.cell_definition },
              { label: 'Coverage', value: `${data.coverage.mean_coverage_pct}% cell coverage · quality ${qf} · ${data.coverage.total_cells} cells` },
              { label: 'Publication status', value: `${data.publication_status}${data.suppression_reason ? ` · ${data.suppression_reason}` : ''}` },
              { label: 'Calculation ID', value: data.evidence.audit.calculation_id, mono: true },
              { label: 'Method version', value: data.evidence.audit.calculation_version, mono: true },
              { label: 'Dataset SHA-256', value: data.evidence.audit.dataset_fingerprint_sha256, mono: true },
              { label: 'Source batches', value: data.evidence.audit.source_batch_ids.join(', ') || 'None', mono: true },
              { label: 'Audit scope', value: data.evidence.audit.audit_scope },
              { label: 'Last updated', value: data.last_updated ?? 'N/A' },
            ]}
          />
        </div>
      )}

      {/* ───────────────────────── INDEX CHART ───────────────────────── */}
      <Card
        title={
          hasFilters
            ? 'Filtered index movement'
            : rising
              ? 'Index movement — fares are trending upward'
              : 'Index movement — fares are stable or easing'
        }
        subtitle={
          hasFilters
            ? 'Filtered view · Weighted Laspeyres headline vs Jevons sensitivity · Values above 100 indicate fares higher than start of window'
            : 'Weighted Laspeyres headline (solid) vs Jevons sensitivity check (dashed) · Above 100 = fares higher than start of period'
        }
        action={
          <div className="flex items-center gap-2">
            {hasFilters && <Pill tone="warn">Filtered</Pill>}
            <Pill tone="accent">Base 100</Pill>
          </div>
        }
      >
        {chartError ? (
          <ErrorNote message={chartError} />
        ) : chartLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <Spinner label="Loading filtered chart" />
          </div>
        ) : chartSeries.length === 0 ? (
          <p className="flex h-[300px] items-center justify-center text-[13px] text-muted">
            No observations match the selected filters.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartSeries} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="apixFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0b6e6e" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#0b6e6e" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="period" {...axisProps} minTickGap={28} />
            <YAxis
              {...axisProps}
              domain={['dataMin - 0.5', 'dataMax + 0.5']}
              width={54}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip
              {...tooltipProps}
              formatter={(value: unknown, name: unknown) => [
                chartNumber(value).toFixed(2),
                chartLabel(name) === 'apix_weighted' ? 'Weighted (headline)' : 'Unweighted (sensitivity)',
              ]}
            />
            <Area
              type="monotone"
              dataKey="apix_weighted"
              stroke="#0b6e6e"
              strokeWidth={2}
              fill="url(#apixFill)"
              dot={false}
              activeDot={{ r: 4, fill: '#0b6e6e' }}
            />
            <Area
              type="monotone"
              dataKey="apix_unweighted"
              stroke="#b45309"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="none"
              dot={false}
              activeDot={{ r: 3, fill: '#b45309' }}
            />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {!chartError && !chartLoading && chartSeries.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 bg-accent" /> Weighted Laspeyres (headline)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 border-b border-dashed border-warn" /> Unweighted Jevons
              (sensitivity)
            </span>
          </div>
        )}
      </Card>

      {/* ───────────────────── AIRLINE COMPARISON + ROUTE TABLE ───────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Airline bar chart */}
        <Card
          title="Airline comparison"
          subtitle="Average fare and index change by carrier"
          action={
            <Link to="/compare" className="text-[11.5px] font-medium text-accent hover:underline">
              Full comparison &rarr;
            </Link>
          }
        >
          {airlineRows.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={Math.max(160, airlineRows.length * 36)}>
                <BarChart
                  data={airlineRows}
                  layout="vertical"
                  margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
                >
                  <CartesianGrid {...gridProps} horizontal={false} />
                  <XAxis type="number" {...axisProps} tickFormatter={(v: number) => formatINR(v)} />
                  <YAxis type="category" dataKey="group" {...axisProps} width={50} />
                  <Tooltip
                    {...tooltipProps}
                    formatter={(value: unknown) => [formatINR(chartNumber(value)), 'Avg fare']}
                  />
                  <Bar dataKey="avg_fare" radius={[0, 3, 3, 0]} barSize={17}>
                    {airlineRows.map((r) => (
                      <Cell
                        key={r.group}
                        fill={(r.delta ?? 0) > 0 ? '#c2410c' : '#0b6e6e'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="mt-3 w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.09em] text-muted">
                    <th className="pb-1.5 font-semibold">Carrier</th>
                    <th className="pb-1.5 text-right font-semibold">Avg</th>
                    <th className="pb-1.5 text-right font-semibold">Median</th>
                    <th className="pb-1.5 text-right font-semibold">Change</th>
                    <th className="pb-1.5 text-right font-semibold">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {airlineRows.map((r) => (
                    <tr key={r.group} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 font-mono text-[11.5px]">{r.group}</td>
                      <td className="py-1.5 text-right tnum">{formatINR(r.avg_fare)}</td>
                      <td className="py-1.5 text-right tnum">{formatINR(r.median_fare)}</td>
                      <td className="py-1.5 text-right">
                        <Delta value={r.delta} />
                      </td>
                      <td className="py-1.5 text-right tnum text-muted">
                        {r.observation_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="py-8 text-center text-[13px] text-muted">No airline data available</p>
          )}
        </Card>

        {/* Route-level fares table */}
        <Card
          title="Route-level fares"
          subtitle="Average fare, index, and change by route"
          action={
            <Link to="/compare" className="text-[11.5px] font-medium text-accent hover:underline">
              Full comparison &rarr;
            </Link>
          }
        >
          {routeRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.09em] text-muted">
                    <th className="pb-1.5 font-semibold">Route</th>
                    <th className="pb-1.5 text-right font-semibold">Avg fare</th>
                    <th className="pb-1.5 text-right font-semibold">Median</th>
                    <th className="pb-1.5 text-right font-semibold">Min</th>
                    <th className="pb-1.5 text-right font-semibold">Max</th>
                    <th className="pb-1.5 text-right font-semibold">Index</th>
                    <th className="pb-1.5 text-right font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {routeRows.map((r) => (
                    <tr key={r.group} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 font-mono text-[11.5px] font-medium">{r.group}</td>
                      <td className="py-1.5 text-right tnum">{formatINR(r.avg_fare)}</td>
                      <td className="py-1.5 text-right tnum">{formatINR(r.median_fare)}</td>
                      <td className="py-1.5 text-right tnum text-muted">{formatINR(r.min_fare)}</td>
                      <td className="py-1.5 text-right tnum text-muted">{formatINR(r.max_fare)}</td>
                      <td className="py-1.5 text-right tnum">
                        {r.apix_value != null ? r.apix_value.toFixed(2) : '—'}
                      </td>
                      <td className="py-1.5 text-right">
                        <Delta value={r.delta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-[13px] text-muted">No route data available</p>
          )}
        </Card>
      </div>

      {/* ───────────────────── LEAD-TIME INDEX ───────────────────── */}
      <Card
        title="Index by booking lead time"
        subtitle="Each bucket indexed independently — where in the booking window fares are moving"
      >
        <ResponsiveContainer width="100%" height={220}>
          <BarChart
            data={data.lead_buckets}
            margin={{ top: 6, right: 8, left: 4, bottom: 4 }}
          >
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis
              {...axisProps}
              width={54}
              domain={[0, 'dataMax + 4']}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <Tooltip
              {...tooltipProps}
              formatter={(value: unknown) => [chartNumber(value).toFixed(2), 'Index']}
              labelFormatter={(label: unknown) => `Booked ${chartLabel(label)} before departure`}
            />
            <Bar dataKey="apix_value" radius={[3, 3, 0, 0]} barSize={54}>
              {data.lead_buckets.map((b) => (
                <Cell key={b.group} fill={b.delta > 0 ? '#c2410c' : '#0b6e6e'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          A bucket above 100 means fares booked that far ahead have risen since the start of the
          window. Reading the buckets separately is what distinguishes a genuine price rise from
          travellers simply booking later.
        </p>
      </Card>

      {/* ───────────────────── FARE ALERTS ───────────────────── */}
      <Card
        title="Fare alerts"
        subtitle={`${spikeData?.flagged_count ?? 0} observations flagged as abnormal (robust z-score > 3.5)`}
        action={
          <Link to="/spikes" className="text-[11.5px] font-medium text-accent hover:underline">
            View all alerts &rarr;
          </Link>
        }
      >
        {data.evidence && (
          <div className="mb-4">
            <EvidenceTag
              label="Alert detection — Evidence Trail"
              items={[
                { label: 'Formula', value: data.evidence.alert_formula, mono: true },
                { label: 'Threshold', value: `Robust z > ${data.evidence.alert_threshold}` },
                { label: 'Min deviation', value: `≥ ${data.evidence.alert_min_deviation_pct}% from cell median` },
                { label: 'Cell definition', value: data.evidence.cell_definition },
                { label: 'Observations scanned', value: (spikeData?.scanned_count ?? data.observation_count).toLocaleString() },
                { label: 'Alerts found', value: String(spikeData?.flagged_count ?? data.spike_count) },
                { label: 'Last updated', value: data.last_updated ?? 'N/A' },
              ]}
            />
          </div>
        )}
        {spikeData && spikeData.flagged.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-1.5 font-semibold">Route</th>
                  <th className="pb-1.5 font-semibold">Carrier</th>
                  <th className="pb-1.5 font-semibold">Class</th>
                  <th className="pb-1.5 font-semibold">Lead time</th>
                  <th className="pb-1.5 text-right font-semibold">Fare</th>
                  <th className="pb-1.5 text-right font-semibold">Deviation</th>
                  <th className="pb-1.5 text-right font-semibold">Z-score</th>
                  <th className="pb-1.5 text-right font-semibold">Exposure proxy</th>
                </tr>
              </thead>
              <tbody>
                {spikeData.flagged.slice(0, 8).map((s, i) => (
                  <tr
                    key={i}
                    className="border-b border-line/60 last:border-0"
                  >
                    <td className="py-1.5 font-mono text-[11.5px] font-medium">{s.route}</td>
                    <td className="py-1.5 font-mono text-[11.5px]">{s.airline}</td>
                    <td className="py-1.5 text-muted">{formatClass(s.fare_class)}</td>
                    <td className="py-1.5 text-muted">{s.lead_bucket_label}</td>
                    <td className="py-1.5 text-right tnum font-medium">{formatINR(s.total_fare)}</td>
                    <td className="py-1.5 text-right">
                      <span
                        className={`tnum font-medium ${
                          s.direction === 'spike' ? 'text-alert' : 'text-ok'
                        }`}
                      >
                        {s.pct_above_median > 0 ? '+' : ''}
                        {s.pct_above_median.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <Pill tone={s.direction === 'spike' ? 'alert' : 'ok'}>
                        {s.direction === 'spike' ? '▲' : '▼'} {Math.abs(s.robust_z).toFixed(1)}
                      </Pill>
                    </td>
                    <td className="py-1.5 text-right">
                      <Pill tone={s.exposure_proxy >= 61 ? 'alert' : s.exposure_proxy >= 31 ? 'warn' : 'neutral'}>
                        {s.exposure_proxy}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-[13px] text-muted">
            No fare anomalies detected at the current threshold.
          </p>
        )}
      </Card>

      {/* ───────────────────── EVENT CALENDAR ───────────────────── */}
      {eventError ? (
        <Card title="Event sensitivity calendar" subtitle="Illustrative context layer">
          <ErrorNote message={eventError} />
        </Card>
      ) : eventCalendar.length > 0 && (
        <Card
          title="Event sensitivity calendar"
          subtitle="Fare alerts are tagged with these event windows in the Fare Alerts page"
          action={
            <span className="rounded border border-[#f0dcbb] bg-[#fdf4e7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-warn">
              Demo data
            </span>
          }
        >
          <div className="mb-3 rounded-md border border-[#f0dcbb] bg-[#fdf4e7] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-warn/90">
            All event dates and typical-surge estimates are illustrative demo data derived from public
            holiday calendars. They use approximate MM-DD ranges that repeat annually. Do not use for
            regulatory or commercial purposes.
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {eventCalendar.map((ev) => {
              const categoryColors: Record<string, string> = {
                festival: 'text-alert border-[#f4d3c2] bg-[#fdf0ea]',
                national_holiday: 'text-accent border-[#bcdedc] bg-accent-soft',
                long_weekend: 'text-warn border-[#f0dcbb] bg-[#fdf4e7]',
                school_vacation: 'text-ok border-[#c3e4cf] bg-[#eaf6ee]',
                city_event: 'text-muted border-line bg-ground',
              }
              const cls = categoryColors[ev.category] ?? 'text-muted border-line bg-ground'
              return (
                <div key={ev.id} className={`rounded-md border px-3.5 py-2.5 ${cls}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[12px] font-semibold leading-snug">{ev.name}</div>
                    <span className="shrink-0 font-mono text-[10px] opacity-70">
                      {ev.start_md}–{ev.end_md}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] font-medium opacity-70">{ev.category_label}</div>
                  <div className="mt-1 text-[11px] leading-relaxed opacity-80">{ev.description}</div>
                  <div className="mt-1.5 text-[10.5px] opacity-60">
                    Typical uplift: ~{ev.typical_surge_pct}%
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ───────────────────── HOW THE INDEX WORKS ───────────────────── */}
      <Card
        title="How the index is calculated"
        subtitle="Weighted Laspeyres formula with Jevons elementary aggregates, base = 100"
        action={
          <Link to="/method" className="text-[11.5px] font-medium text-accent hover:underline">
            Full methodology &rarr;
          </Link>
        }
      >
        <div className="space-y-4">
          <p className="rounded-md border border-accent/25 bg-accent-soft px-4 py-3 text-[13px] leading-relaxed text-ink">
            <strong className="font-medium">In one sentence:</strong> we compare every fare only
            against past fares for the same route, carrier, cabin and booking window, compute a
            geometric mean within each cell, then combine cells using illustrative traffic weights so that
            busy trunk routes carry more of the headline number.
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                step: '1',
                title: 'Group',
                desc: 'Every fare into a comparability cell: route × airline × class × lead-time bucket',
              },
              {
                step: '2',
                title: 'Reference',
                desc: 'Geometric mean of first-day fares in each cell becomes the base price (P₀)',
              },
              {
                step: '3',
                title: 'Relative',
                desc: "Today's geometric mean ÷ reference price = the cell's price relative",
              },
              {
                step: '4',
                title: 'Weight',
                desc: 'Illustrative traffic weights — DEL-BOM carries 14% of the prototype basket',
              },
              {
                step: '5',
                title: 'Aggregate',
                desc: 'Weighted sum of relatives: APIx = 100 × Σ W × R',
              },
            ].map((s) => (
              <div key={s.step} className="rounded-md border border-line bg-ground px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                    {s.step}
                  </span>
                  <span className="text-[12px] font-semibold text-ink">{s.title}</span>
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-md border border-line bg-ground px-4 py-3 font-mono text-[12.5px] text-ink">
            APIx[t] = 100 × Σ ( W[cell] / ΣW ) × R[cell, t] &nbsp;&nbsp;|&nbsp;&nbsp; Sensitivity:
            Jevons[t] = 100 × exp( mean( ln R[cell, t] ) )
          </div>

          <div className="flex flex-wrap gap-3 text-[11.5px]">
            <Pill tone="ok">GREEN ≥ 90% coverage</Pill>
            <Pill tone="warn">AMBER 80–90%</Pill>
            <Pill tone="alert">RED &lt; 80%</Pill>
            <span className="flex items-center gap-1 text-muted">
              — publication quality gate per monograph §22.4
            </span>
          </div>
        </div>
      </Card>
    </div>
  )
}
