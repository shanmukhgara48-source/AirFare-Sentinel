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
import { api, formatClass, formatINR, type CompareRow, type FilterOptions } from '../api'
import { Card, Delta, EmptyState, ErrorNote, Field, JudgePanel, Select, Spinner } from '../components/ui'
import { axisProps, chartNumber, gridProps, tooltipProps } from '../components/chart'
import { useJudgeMode } from '../context/judgeModeContext'

export default function Compare() {
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [result, setResult] = useState<{
    key: string
    rows: CompareRow[]
    error: string
  } | null>(null)
  const [dimension, setDimension] = useState<'route' | 'airline'>('route')
  const [fareClass, setFareClass] = useState('')
  const [leadBucket, setLeadBucket] = useState('')
  const [optionsError, setOptionsError] = useState('')
  const { judgeMode } = useJudgeMode()

  useEffect(() => {
    let cancelled = false
    api.filters()
      .then((result) => { if (!cancelled) setOptions(result) })
      .catch((e: Error) => { if (!cancelled) setOptionsError(e.message) })
    return () => { cancelled = true }
  }, [])

  const queryKey = [dimension, fareClass, leadBucket].join('|')

  useEffect(() => {
    let cancelled = false
    api
      .compare({
        dimension,
        fare_class: fareClass || undefined,
        lead_bucket: leadBucket || undefined,
      })
      .then((r) => {
        if (!cancelled) setResult({ key: queryKey, rows: r.rows ?? [], error: '' })
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ key: queryKey, rows: [], error: e.message })
      })
    return () => { cancelled = true }
  }, [queryKey, dimension, fareClass, leadBucket])

  const activeResult = result?.key === queryKey ? result : null
  const rows = activeResult?.rows ?? []
  const loading = activeResult === null
  const error = optionsError || activeResult?.error || ''
  if (error) return <ErrorNote message={error} />

  const label = dimension === 'route' ? 'Route' : 'Carrier'
  const highestFare = rows[0]
  const hasUnsupportedWeighting = rows.some((row) => !row.weighting_complete)
  const largestMove = rows.reduce<CompareRow | null>(
    (best, row) => !best || Math.abs(row.delta ?? 0) > Math.abs(best.delta ?? 0) ? row : best,
    null,
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[26px] leading-tight">Comparisons</h1>
        <p className="mt-1 text-[13px] text-muted">
          Rank routes or carriers by fare level and by how their own index has moved.
        </p>
      </header>

      {judgeMode && (
        <JudgePanel items={[
          {
            q: 'What does this view show?',
            a: loading
              ? `Loading the current ${label.toLowerCase()} comparison.`
              : `${rows.length} ${label.toLowerCase()}${rows.length === 1 ? '' : 's'} match the current filters. ${highestFare ? `${highestFare.group} has the highest observed average fare at ${formatINR(highestFare.avg_fare)}.` : 'No comparable rows are available.'}`,
          },
          {
            q: 'What moved most?',
            a: largestMove && largestMove.delta != null
              ? `${largestMove.group} has the largest absolute within-group index move (${largestMove.delta > 0 ? '+' : ''}${largestMove.delta.toFixed(2)} points). Each group is rebased to its own starting value of 100.`
              : 'There is not enough time-series coverage to identify a largest move.',
          },
          {
            q: 'How should this be read?',
            a: 'Average fare levels compare the current observation mix; index changes compare like-for-like cells over time. A high average fare is not, by itself, evidence of an unusual increase.',
          },
          {
            q: 'What should a judge verify?',
            a: 'Change the fare class or booking lead-time filter and confirm that the ranking, chart, and observation counts update together without changing the underlying data.',
          },
        ]} />
      )}

      <Card title="View">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Compare by">
            <Select
              value={dimension}
              onChange={(v) => setDimension(v as 'route' | 'airline')}
              options={[
                { value: 'route', label: 'Route' },
                { value: 'airline', label: 'Carrier' },
              ]}
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
        </div>
      </Card>

      {!loading && hasUnsupportedWeighting && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-900">
          One or more groups have no complete prototype weighting. Their index
          movement is exploratory; use average-fare columns only as descriptive
          levels and do not treat this ranking as a weighted national comparison.
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing to compare"
          body="No observations match this fare class and lead-time combination."
        />
      ) : (
        <>
          <Card
            title={`Average fare by ${label.toLowerCase()}`}
            subtitle="Bars are shaded by how each group's index moved — orange rose, green eased"
          >
            <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 34)}>
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 0, right: 20, left: 4, bottom: 0 }}
              >
                <CartesianGrid {...gridProps} horizontal={false} />
                <XAxis
                  type="number"
                  {...axisProps}
                  tickFormatter={(v: number) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <YAxis type="category" dataKey="group" {...axisProps} width={78} />
                <Tooltip {...tooltipProps} formatter={(value: unknown) => [formatINR(chartNumber(value)), 'Avg fare']} />
                <Bar dataKey="avg_fare" radius={[0, 3, 3, 0]} barSize={18}>
                  {rows.map((r) => (
                    <Cell key={r.group} fill={(r.delta ?? 0) > 0 ? '#c2410c' : '#0b6e6e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title={`${label} detail`} subtitle="Sorted by average fare, highest first">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                    <th className="pb-2 font-semibold">{label}</th>
                    <th className="pb-2 text-right font-semibold">Avg fare</th>
                    <th className="pb-2 text-right font-semibold">Median</th>
                    <th className="pb-2 text-right font-semibold">Min</th>
                    <th className="pb-2 text-right font-semibold">Max</th>
                    <th className="pb-2 text-right font-semibold">Index</th>
                    <th className="pb-2 text-right font-semibold">Change</th>
                    <th className="pb-2 text-right font-semibold">
                      {dimension === 'route' ? 'Carriers' : 'Routes'}
                    </th>
                    <th className="pb-2 text-right font-semibold">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.group}
                      className="border-b border-line/60 last:border-0 hover:bg-ground/60"
                    >
                      <td className="py-2 font-mono text-[12px] font-medium">{r.group}</td>
                      <td className="py-2 text-right tnum">{formatINR(r.avg_fare)}</td>
                      <td className="py-2 text-right tnum text-muted">
                        {formatINR(r.median_fare)}
                      </td>
                      <td className="py-2 text-right tnum text-muted">{formatINR(r.min_fare)}</td>
                      <td className="py-2 text-right tnum text-muted">{formatINR(r.max_fare)}</td>
                      <td className="py-2 text-right tnum">{r.apix_value?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 text-right">
                        <Delta value={r.delta} />
                      </td>
                      <td className="py-2 text-right tnum text-muted">
                        {r.airline_count ?? r.route_count ?? '—'}
                      </td>
                      <td className="py-2 text-right tnum text-muted">
                        {r.observation_count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
