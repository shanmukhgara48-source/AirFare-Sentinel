import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, formatClass, formatINR, qs, type FilterOptions, type Trends as TrendsData } from '../api'
import {
  Button,
  Card,
  DateInput,
  EmptyState,
  ErrorNote,
  Field,
  JudgePanel,
  Select,
  Spinner,
} from '../components/ui'
import { axisProps, chartLabel, chartNumber, gridProps, tooltipProps } from '../components/chart'
import { useJudgeMode } from '../context/judgeModeContext'

export default function Trends() {
  const { judgeMode } = useJudgeMode()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [result, setResult] = useState<{
    key: string
    data: TrendsData | null
    error: string
  } | null>(null)
  const [optionsError, setOptionsError] = useState('')

  const [route, setRoute] = useState('')
  const [airline, setAirline] = useState('')
  const [fareClass, setFareClass] = useState('')
  const [leadBucket, setLeadBucket] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [granularity, setGranularity] = useState('day')

  useEffect(() => {
    api.filters().then(setOptions).catch((e: Error) => setOptionsError(e.message))
  }, [])

  const [origin, destination] = route ? route.split('-') : ['', '']
  const queryKey = [granularity, route, airline, fareClass, leadBucket, dateFrom, dateTo].join('|')

  useEffect(() => {
    let cancelled = false
    api
      .trends({
        granularity,
        origin: origin || undefined,
        destination: destination || undefined,
        airline: airline || undefined,
        fare_class: fareClass || undefined,
        lead_bucket: leadBucket || undefined,
        travel_date_from: dateFrom || undefined,
        travel_date_to: dateTo || undefined,
      })
      .then((data) => {
        if (!cancelled) setResult({ key: queryKey, data, error: '' })
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ key: queryKey, data: null, error: e.message })
      })
    return () => { cancelled = true }
  }, [queryKey, granularity, origin, destination, airline, fareClass, leadBucket, dateFrom, dateTo])

  const activeResult = result?.key === queryKey ? result : null
  const data = activeResult?.data ?? null
  const error = optionsError || activeResult?.error || ''
  const loading = activeResult === null

  const reset = () => {
    setRoute('')
    setAirline('')
    setFareClass('')
    setLeadBucket('')
    setDateFrom('')
    setDateTo('')
  }

  const exportUrl = `/api/export/observations.csv${qs({
    origin: origin || undefined,
    destination: destination || undefined,
    airline: airline || undefined,
    fare_class: fareClass || undefined,
    lead_bucket: leadBucket || undefined,
  })}`

  if (error) return <ErrorNote message={error} />

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[26px] leading-tight">Fare Trends</h1>
        <p className="mt-1 text-[13px] text-muted">
          Slice the current dataset by route, carrier, booking lead time, travel date and fare class.
        </p>
      </header>

      {judgeMode && (
        <JudgePanel items={[
          {
            q: 'What is selected?',
            a: loading
              ? 'Loading the current filter selection.'
              : data && !data.empty
                ? `${data.observation_count.toLocaleString()} observations match the current filters, producing ${data.series.length} ${granularity === 'week' ? 'weekly' : 'daily'} index points.`
                : 'No observations match the current filters.',
          },
          {
            q: 'What does the line mean?',
            a: 'The filtered index is recomputed from like-for-like route, carrier, fare-class, and lead-time cells. A value above 100 means those comparable fares are above their own starting level.',
          },
          {
            q: 'How is missing data handled?',
            a: data && !data.empty
              ? `Missing cells are not imputed. Current panel quality is ${data.coverage.quality_flag}, with ${data.coverage.mean_coverage_pct}% mean cell coverage.`
              : 'Missing cells are excluded rather than filled with invented fares; coverage is shown once data is available.',
          },
          {
            q: 'What should an analyst do next?',
            a: 'Use the booking curve and fare-class breakdown to distinguish a broad price move from a change concentrated in one booking window or product class.',
          },
        ]} />
      )}

      <Card
        title="Filters"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset}>
              Reset
            </Button>
            <a href={exportUrl} download>
              <Button variant="secondary">Export CSV</Button>
            </a>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Field label="Route">
            <Select
              value={route}
              onChange={setRoute}
              allLabel="All routes"
              options={(options?.routes ?? []).map((r) => ({ value: r, label: r }))}
            />
          </Field>
          <Field label="Carrier">
            <Select
              value={airline}
              onChange={setAirline}
              allLabel="All carriers"
              options={(options?.airlines ?? []).map((a) => ({ value: a, label: a }))}
            />
          </Field>
          <Field label="Fare class">
            <Select
              value={fareClass}
              onChange={setFareClass}
              allLabel="All classes"
              options={(options?.fare_classes ?? []).map((c) => ({
                value: c,
                label: formatClass(c),
              }))}
            />
          </Field>
          <Field label="Booking lead time">
            <Select
              value={leadBucket}
              onChange={setLeadBucket}
              allLabel="All lead times"
              options={(options?.lead_buckets ?? []).map((b) => ({
                value: b.code,
                label: b.label,
              }))}
            />
          </Field>
          <Field label="Travel from">
            <DateInput
              value={dateFrom}
              onChange={setDateFrom}
              min={options?.travel_date_min ?? undefined}
              max={options?.travel_date_max ?? undefined}
            />
          </Field>
          <Field label="Travel to">
            <DateInput
              value={dateTo}
              onChange={setDateTo}
              min={options?.travel_date_min ?? undefined}
              max={options?.travel_date_max ?? undefined}
            />
          </Field>
          <Field label="Granularity">
            <Select
              value={granularity}
              onChange={setGranularity}
              options={[
                { value: 'day', label: 'Daily' },
                { value: 'week', label: 'Weekly' },
              ]}
            />
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : !data || data.empty ? (
        <EmptyState
          title="No observations match these filters"
          body="This combination of route, carrier, class and lead time has no rows in the current dataset. Widen or reset the filters."
          action={<Button onClick={reset}>Reset filters</Button>}
        />
      ) : (
        <>
          <p className="text-[12.5px] text-muted">
            {data.observation_count.toLocaleString()} observations in the current selection.
          </p>

          <Card
            title="Index for this selection"
            subtitle="Recomputed over only the cells matching your filters"
          >
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.series} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="period" {...axisProps} minTickGap={28} />
                <YAxis
                  {...axisProps}
                  domain={['dataMin - 0.5', 'dataMax + 0.5']}
                  width={54}
                  tickFormatter={(v: number) => v.toFixed(1)}
                />
                <Tooltip {...tooltipProps} formatter={(value: unknown) => [chartNumber(value).toFixed(2), 'Index']} />
                <Line
                  type="monotone"
                  dataKey="apix_value"
                  stroke="#0b6e6e"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              title="Booking curve"
              subtitle="Average fare by how far ahead of departure the fare was observed"
            >
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={data.lead_time_curve}
                  margin={{ top: 6, right: 8, left: 4, bottom: 4 }}
                >
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis
                    {...axisProps}
                    width={62}
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    {...tooltipProps}
                    formatter={(value: unknown, name: unknown) => [
                      formatINR(chartNumber(value)),
                      chartLabel(name) === 'avg_fare' ? 'Average' : 'Median',
                    ]}
                    labelFormatter={(label: unknown) => `Booked ${chartLabel(label)} before departure`}
                  />
                  <Bar dataKey="avg_fare" fill="#b45309" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="median_fare" fill="#e0b080" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                Fares climb steeply inside the last two weeks — the classic booking curve. Each
                bucket is a separate comparability group, so the index never mistakes a shift in
                when people book for a change in price.
              </p>
            </Card>

            <Card title="Fare class comparison" subtitle="Average and median fare by cabin product">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={data.fare_class_breakdown}
                  margin={{ top: 6, right: 8, left: 4, bottom: 4 }}
                >
                  <CartesianGrid {...gridProps} />
                  <XAxis
                    dataKey="fare_class"
                    {...axisProps}
                    tickFormatter={(v: string) =>
                      v.replace('ECONOMY_', 'ECO ').replace('PREMIUM_ECONOMY', 'PREM ECO')
                    }
                  />
                  <YAxis
                    {...axisProps}
                    width={62}
                    tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    {...tooltipProps}
                    formatter={(value: unknown, name: unknown) => [
                      formatINR(chartNumber(value)),
                      chartLabel(name) === 'avg_fare' ? 'Average' : 'Median',
                    ]}
                    labelFormatter={(label: unknown) => formatClass(chartLabel(label))}
                  />
                  <Bar dataKey="avg_fare" fill="#0b6e6e" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="median_fare" fill="#8fc4c2" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 flex gap-4 text-[11.5px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Average
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#8fc4c2]" /> Median
                </span>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
