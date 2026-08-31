import { useEffect, useState } from 'react'
import { api, formatClass, formatINR, REASON_GLOSSARY, type EventClassification, type Spike } from '../api'
import { Card, EmptyState, ErrorNote, Field, JudgePanel, Pill, Select, Spinner, StatTile, EvidenceTag } from '../components/ui'
import { useJudgeMode } from '../context/judgeModeContext'

function impactTone(score: number): 'escalate' | 'alert' | 'warn' | 'neutral' {
  if (score >= 75) return 'escalate'
  if (score >= 50) return 'alert'
  if (score >= 25) return 'warn'
  return 'neutral'
}

function severityTone(sev: string): 'escalate' | 'alert' | 'warn' | 'neutral' {
  if (sev === 'Escalate') return 'escalate'
  if (sev === 'Review')   return 'alert'
  if (sev === 'Watch')    return 'warn'
  return 'neutral'
}

function eventClassTone(c: EventClassification): 'warn' | 'alert' | 'neutral' {
  if (c === 'Expected seasonal pressure') return 'warn'
  if (c === 'Elevated beyond event baseline') return 'alert'
  return 'neutral'
}

function eventClassShort(c: EventClassification): string {
  if (c === 'Expected seasonal pressure') return 'Expected'
  if (c === 'Elevated beyond event baseline') return 'Elevated'
  return 'No event'
}

/* ─── Case File Modal ──────────────────────────────────────────────── */

function CaseFileModal({ spike, onClose }: { spike: Spike; onClose: () => void }) {
  const sevTone = { Watch: 'warn', Review: 'alert', Escalate: 'escalate' } as const
  const confTone = { Low: 'alert', Medium: 'warn', High: 'ok' } as const

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-file-title"
        className="w-full max-w-[680px] rounded-lg border border-line bg-white shadow-xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between border-b border-line px-6 py-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 id="case-file-title" className="font-serif text-[20px] font-semibold tracking-tight">
                FarePulse Case File
              </h2>
              <Pill tone={spike.direction === 'spike' ? 'alert' : 'ok'}>
                {spike.direction === 'spike' ? '▲ Spike' : '▼ Drop'}
              </Pill>
            </div>
            <p className="mt-1 text-[12px] font-mono text-muted">
              {spike.reason_code.replace(/_/g, ' ')}
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
          {/* Classification badges */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Severity</span>
              <Pill tone={sevTone[spike.severity]}>{spike.severity}</Pill>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Confidence</span>
              <Pill tone={confTone[spike.confidence]}>{spike.confidence}</Pill>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Robust z</span>
              <Pill tone={spike.direction === 'spike' ? 'alert' : 'ok'}>
                {spike.robust_z > 0 ? '+' : ''}{spike.robust_z.toFixed(1)}σ
              </Pill>
            </div>
          </div>

          {/* Reason code */}
          <div className="rounded-md border border-line bg-ground/30 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Reason</span>
              <span className="font-mono text-[12px] font-medium text-ink">{spike.reason_code}</span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              {REASON_GLOSSARY[spike.reason_code] ?? 'No description available.'}
            </p>
          </div>

          {/* Observation details */}
          <div className="rounded-md border border-line">
            <div className="border-b border-line bg-ground/50 px-4 py-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                Observation details
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              <Detail label="Route" value={spike.route} mono />
              <Detail label="Carrier" value={spike.airline} mono />
              <Detail label="Fare class" value={formatClass(spike.fare_class)} />
              <Detail label="Lead time" value={spike.lead_bucket_label} />
              <Detail label="Travel date" value={spike.travel_date} mono />
              <Detail label="Quote date" value={spike.quote_date} mono />
            </div>
          </div>

          {/* Fare comparison */}
          <div className="rounded-md border border-line">
            <div className="border-b border-line bg-ground/50 px-4 py-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                Fare comparison
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              <Detail
                label="Observed fare"
                value={formatINR(spike.total_fare)}
                highlight={spike.direction === 'spike' ? 'alert' : 'ok'}
              />
              <Detail label="Cell median" value={formatINR(spike.cell_median_fare)} />
              <Detail
                label="Deviation"
                value={`${spike.pct_above_median > 0 ? '+' : ''}${spike.pct_above_median.toFixed(1)}%`}
                highlight={spike.direction === 'spike' ? 'alert' : 'ok'}
              />
              <Detail label="Cell observations" value={String(spike.cell_observations)} />
              <Detail label="Lead days" value={`${spike.lead_days} days before departure`} />
              <Detail label="Direction" value={spike.direction === 'spike' ? 'Price surge' : 'Price collapse'} />
            </div>
          </div>

          {/* Explanation */}
          <div className="rounded-md border border-line bg-ground/30 px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
              Plain-English explanation
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink">
              {spike.explanation}
            </p>
          </div>

          {/* Event sensitivity layer */}
          <div className={`rounded-md border px-5 py-4 ${
            spike.in_event_window
              ? 'border-[#f0dcbb] bg-[#fdf4e7]'
              : 'border-line bg-ground/30'
          }`}>
            <div className="flex items-center gap-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                Event sensitivity
              </h3>
              <Pill tone={eventClassTone(spike.event_classification)}>
                {eventClassShort(spike.event_classification)}
              </Pill>
              <span className="rounded border border-[#f0dcbb] bg-[#fdf4e7] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-warn">
                Demo data
              </span>
            </div>

            {spike.in_event_window ? (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Event</div>
                    <div className="mt-0.5 font-medium text-ink">{spike.event_tag}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Category</div>
                    <div className="mt-0.5 text-ink">{spike.event_category_label}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Window</div>
                    <div className="mt-0.5 font-mono text-[11px] text-ink">{spike.event_window_label}</div>
                  </div>
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">Typical uplift</div>
                    <div className="mt-0.5 text-ink">~{spike.event_typical_surge_pct}%</div>
                  </div>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  {spike.event_classification === 'Expected seasonal pressure'
                    ? `This deviation (${spike.pct_above_median > 0 ? '+' : ''}${spike.pct_above_median.toFixed(1)}%) is within the range typically associated with ${spike.event_tag} (approx. ${spike.event_typical_surge_pct}% uplift). The fare movement is associated with the event window and may not require further investigation.`
                    : `This deviation (${spike.pct_above_median > 0 ? '+' : ''}${spike.pct_above_median.toFixed(1)}%) is substantially above the typical ${spike.event_tag} uplift of ~${spike.event_typical_surge_pct}%. While the event window may contribute to elevated demand, the magnitude requires monitoring.`
                  }
                </p>
                <p className="text-[11px] text-muted/70">{spike.event_description}</p>
              </div>
            ) : (
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                Travel date {spike.travel_date} falls outside all identified event windows.
                The reason code ({spike.reason_code}) is the primary signal for this anomaly.
              </p>
            )}
          </div>

          {/* Recommended action */}
          <div className="rounded-md border border-accent/30 bg-accent-soft/40 px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-accent">
              Recommended analyst action
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink">
              {spike.recommended_action}
            </p>
          </div>

          {/* Passenger Impact Score */}
          <div className="rounded-md border border-line bg-ground/30 px-5 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                  Passenger Impact Score
                </h3>
                <p className="mt-0.5 text-[11.5px] text-muted leading-relaxed">
                  Decision-support indicator — not an exact passenger count.
                </p>
              </div>
              <Pill tone={impactTone(spike.impact_score)}>
                {spike.impact_score} / 100
              </Pill>
            </div>
            <p className="mt-2 text-[11px] font-mono text-muted/80">
              route weight × (deviation / 25) × lead urgency × severity × confidence
            </p>
          </div>

          {/* Evidence Trail */}
          <div className="rounded-md border border-line bg-ground/30 px-5 py-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
              Evidence Trail
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { label: 'Observation ID', value: String(spike.observation_id ?? '—') },
                { label: 'Data source', value: spike.source_label },
                { label: 'Provider', value: spike.provider ?? 'Not applicable' },
                { label: 'Cell definition', value: 'route × airline × fare class × lead-time bucket' },
                { label: 'Detection formula', value: 'robust_z = 0.6745 × (ln(fare) − median(ln fare)) / MAD', mono: true },
                { label: 'Threshold', value: 'Robust z > 3.5 AND ≥ 25% from cell median' },
                { label: 'Cell size', value: `${spike.cell_observations} observations (confidence: ${spike.confidence})` },
                { label: 'Quote date', value: spike.quote_date },
                { label: 'Travel date', value: spike.travel_date },
                { label: 'Calculation method', value: 'Median and MAD on log fares — outlier-resistant baseline' },
                { label: 'Reason assignment', value: '7 deterministic rules, evaluated in priority order' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                    {item.label}
                  </div>
                  <div
                    className={`mt-0.5 ${
                      (item as { mono?: boolean }).mono
                        ? 'font-mono text-[10.5px] text-ink break-all'
                        : 'text-[12px] text-ink'
                    }`}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="border-t border-line px-6 py-3 text-[11px] text-muted">
          FarePulse · Anomaly ID {spike.observation_id ?? '—'} · {spike.source_label}
        </footer>
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  highlight?: 'alert' | 'ok'
}) {
  return (
    <div className="bg-surface px-4 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">{label}</div>
      <div
        className={`mt-0.5 text-[13px] font-medium ${mono ? 'font-mono text-[12px]' : ''} ${
          highlight === 'alert' ? 'text-alert' : highlight === 'ok' ? 'text-ok' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

/* ─── Main Page ────────────────────────────────────────────────────── */

export default function Spikes() {
  const [data, setData] = useState<{
    threshold: number
    flagged_count: number
    scanned_count: number
    event_window_count: number
    flagged: Spike[]
    last_updated?: string
    evidence?: {
      data_source: string
      algorithm: string
      formula: string
      threshold: number
      min_deviation_pct: number
      cell_definition: string
      min_cell_observations: number
      reason_codes: number
      confidence_bands: string
    }
  } | null>(null)
  const [threshold, setThreshold] = useState('3.5')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSpike, setSelectedSpike] = useState<Spike | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .spikes(Number(threshold))
      .then((result) => { if (!cancelled) setData(result) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [threshold])

  // Close modal on Escape
  useEffect(() => {
    if (!selectedSpike) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedSpike(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedSpike])

  const { judgeMode } = useJudgeMode()

  if (error) return <ErrorNote message={error} />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-serif text-[26px] leading-tight tracking-tight">Fare Alerts</h1>
            <span className="rounded border border-[#f4d3c2] bg-[#fdf0ea] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-alert">
              Analyst Queue
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Observations whose fare is statistically out of line with their own comparability cell.
            Click any row to open a full case file.
          </p>
        </div>
        {data && data.flagged_count > 0 && (
          <div className="flex items-center gap-3 text-[12px]">
            <span className="flex items-center gap-1.5 text-alert font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-alert animate-pulse"/>
              {data.flagged_count} flagged
            </span>
            <span className="text-muted">of {data.scanned_count.toLocaleString()} scanned</span>
          </div>
        )}
      </header>

      {/* ───────────────────────── JUDGE MODE ───────────────────────── */}
      {judgeMode && (
        <JudgePanel items={[
          {
            q: 'What happened?',
            a: data
              ? `${data.flagged_count} of ${data.scanned_count.toLocaleString()} observed fares were flagged as statistically unusual at the current sensitivity setting (robust z-score > ${data.threshold}, deviation ≥ 25% from the cell median). ${data.event_window_count > 0 ? `${data.event_window_count} of these fall within a known event window (festival or holiday period).` : 'None fall within a known festival or holiday window.'}`
              : 'Scanning observations for statistically unusual fares…',
          },
          {
            q: 'Why does it matter?',
            a: 'Each flagged fare was compared only against fares in its own comparability cell — same route, carrier, cabin class and booking window. A fare that appears here is not just expensive; it is expensive relative to what that exact product normally costs. These are the observations most likely to affect passengers who have limited ability to switch.',
          },
          {
            q: 'How confident are we?',
            a: `Confidence is rated by cell size: High (≥ 30 observations in the cell), Medium (15–29), Low (< 15). Low-confidence alerts should be treated as signals to investigate, not confirmed findings — a thin cell can produce a high z-score from noise. The reason code is assigned by deterministic, priority-ordered rules — no machine learning involved.`,
          },
          {
            q: 'What should an analyst do next?',
            a: `Open the Case File on any "Escalate" or "Review" severity row. Check whether the anomaly is CARRIER_SPECIFIC_SPIKE (one carrier, others normal — warrants carrier query) or ROUTE_LEVEL_SPIKE (all carriers elevated — suggests market-wide pressure). If the fare is within an event window and classified "Expected", no immediate action is needed — file for trend monitoring.`,
          },
        ]} />
      )}

      <Card title="How a fare gets flagged">
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="space-y-3 text-[13px] leading-relaxed text-muted">
            <p>
              Each observation is compared only against fares for the{' '}
              <strong className="font-medium text-ink">same route, carrier, fare class and
              booking lead time</strong> — so an expensive last-minute seat is never flagged just
              for being last-minute.
            </p>
            <p>
              Within that cell we take a{' '}
              <strong className="font-medium text-ink">robust z-score</strong> on log fares, using
              the median and median absolute deviation rather than mean and standard deviation. A
              single extreme fare would inflate a standard deviation enough to hide itself; it
              cannot distort a median.
            </p>
            <p>
              A fare is flagged only when it clears{' '}
              <strong className="font-medium text-ink">both</strong> tests: a robust z beyond the
              threshold, <em>and</em> at least a 25% deviation from its cell median. The second
              test keeps out moves that are statistically detectable but too small to matter.
            </p>
            <p className="text-[12px]">
              No machine learning, nothing unexplainable — every flag can be recomputed by hand
              from the numbers in the table below. Click <strong className="font-medium text-ink">View Case File</strong> on
              any row for a full audit-ready breakdown.
            </p>
          </div>

          <div className="space-y-4">
            <Field label="Sensitivity (robust z)">
              <Select
                value={threshold}
                onChange={(value) => {
                  setLoading(true)
                  setError('')
                  setThreshold(value)
                }}
                options={[
                  { value: '2.5', label: '2.5 — more sensitive' },
                  { value: '3.5', label: '3.5 — default' },
                  { value: '5', label: '5.0 — only extremes' },
                ]}
              />
            </Field>
            {data && (
              <>
                <StatTile
                  label="Flagged"
                  value={data.flagged_count}
                  tone={data.flagged_count > 0 ? 'alert' : 'default'}
                  hint={`of ${data.scanned_count.toLocaleString()} observations scanned`}
                />
                <StatTile
                  label="In event window"
                  value={data.event_window_count ?? 0}
                  tone={(data.event_window_count ?? 0) > 0 ? 'alert' : 'default'}
                  hint="travel date overlaps a demo event (see Demo data label)"
                />
                {data.evidence && (
                  <EvidenceTag
                    label="Detection method — Evidence Trail"
                    items={[
                      { label: 'Data source', value: data.evidence.data_source },
                      { label: 'Observations scanned', value: data.scanned_count.toLocaleString() },
                      { label: 'Algorithm', value: data.evidence.algorithm },
                      { label: 'Formula', value: data.evidence.formula, mono: true },
                      { label: 'Threshold', value: `Robust z > ${data.evidence.threshold}` },
                      { label: 'Min deviation', value: `≥ ${data.evidence.min_deviation_pct}% from cell median` },
                      { label: 'Cell definition', value: data.evidence.cell_definition },
                      { label: 'Min cell size', value: `${data.evidence.min_cell_observations} observations` },
                      { label: 'Reason codes', value: `${data.evidence.reason_codes} deterministic rules, priority-ordered` },
                      { label: 'Confidence bands', value: data.evidence.confidence_bands },
                      { label: 'Last updated', value: data.last_updated ?? 'N/A' },
                    ]}
                  />
                )}
              </>
            )}
            <div className="rounded-md border border-line bg-ground/50 px-3.5 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
                Passenger Impact Score
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                Each alert carries a 0–100 score combining route traffic weight,
                fare deviation, booking urgency, severity, and confidence.
                A decision-support indicator — not an exact passenger count.
              </p>
              <p className="mt-1.5 font-mono text-[10.5px] text-muted/70">
                weight% × (dev/25) × urgency × severity × confidence
              </p>
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : !data || data.flagged.length === 0 ? (
        <EmptyState
          title="No unusual fares at this sensitivity"
          body="Every observation sits within the normal range for its own route, carrier, class and lead time. Lower the threshold to look harder."
        />
      ) : (
        <Card
          title="Flagged observations"
          subtitle="Most extreme first — click any row for a full case file with event context"
          action={<Pill tone="alert">{data.flagged_count} flagged</Pill>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Route</th>
                  <th className="pb-2 font-semibold">Carrier</th>
                  <th className="pb-2 font-semibold">Class</th>
                  <th className="pb-2 text-right font-semibold">Fare</th>
                  <th className="pb-2 text-right font-semibold">Deviation</th>
                  <th className="pb-2 font-semibold">Reason</th>
                  <th className="pb-2 font-semibold">Event context</th>
                  <th className="pb-2 text-center font-semibold">Severity</th>
                  <th className="pb-2 text-right font-semibold">Robust z</th>
                  <th className="pb-2 text-right font-semibold">Impact</th>
                  <th className="pb-2 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {data.flagged.map((s, i) => (
                  <tr
                    key={s.observation_id ?? i}
                    className="border-b border-line/60 last:border-0 hover:bg-ground/60 cursor-pointer"
                    onClick={() => setSelectedSpike(s)}
                  >
                    <td className="py-2 font-mono text-[12px] font-medium">{s.route}</td>
                    <td className="py-2 font-mono text-[12px]">{s.airline}</td>
                    <td className="py-2 text-muted">{formatClass(s.fare_class)}</td>
                    <td className={`py-2 text-right tnum font-medium ${s.direction === 'spike' ? 'text-alert' : 'text-ok'}`}>
                      {formatINR(s.total_fare)}
                    </td>
                    <td className="py-2 text-right tnum font-medium">
                      {s.pct_above_median > 0 ? '+' : ''}
                      {Number(s.pct_above_median).toFixed(1)}%
                    </td>
                    <td className="py-2">
                      <span className="whitespace-nowrap rounded bg-ground px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                        {s.reason_code}
                      </span>
                    </td>
                    <td className="py-2">
                      {s.in_event_window ? (
                        <div className="space-y-0.5">
                          <div className="truncate max-w-[140px] text-[11.5px] font-medium text-ink" title={s.event_tag ?? ''}>
                            {s.event_tag}
                          </div>
                          <Pill tone={eventClassTone(s.event_classification)}>
                            {eventClassShort(s.event_classification)}
                          </Pill>
                        </div>
                      ) : (
                        <span className="text-[11.5px] text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      <Pill tone={severityTone(s.severity)}>
                        {s.severity}
                      </Pill>
                    </td>
                    <td className="py-2 text-right">
                      <Pill tone={s.direction === 'spike' ? 'alert' : 'ok'}>
                        {s.robust_z > 0 ? '+' : ''}
                        {Number(s.robust_z).toFixed(1)}
                      </Pill>
                    </td>
                    <td className="py-2 text-right">
                      <Pill tone={impactTone(s.impact_score)}>
                        {s.impact_score}
                      </Pill>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedSpike(s) }}
                        className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent-soft transition-colors"
                      >
                        Case File
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data && data.flagged.length > 0 && (
        <Card title="Reason code glossary" subtitle="Deterministic rules — no ML, no black boxes">
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(REASON_GLOSSARY).map(([code, desc]) => (
              <div key={code} className="rounded-md border border-line/60 px-3.5 py-2.5">
                <span className="font-mono text-[11px] font-medium text-ink">{code}</span>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {selectedSpike && (
        <CaseFileModal spike={selectedSpike} onClose={() => setSelectedSpike(null)} />
      )}
    </div>
  )
}
