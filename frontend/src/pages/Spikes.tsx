import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { reviewApi } from '../review-api'
import { api, formatClass, formatINR, REASON_GLOSSARY, type AuditMetadata, type EventClassification, type Spike } from '../api'
import { Card, EmptyState, ErrorNote, Field, JudgePanel, Pill, Select, Spinner, StatTile, EvidenceTag } from '../components/ui'
import { useDialogFocus } from '../components/useDialogFocus'
import { useJudgeMode } from '../context/judgeModeContext'

function exposureTone(score: number): 'escalate' | 'alert' | 'warn' | 'neutral' {
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

function CaseFileModal({
  spike,
  threshold,
  audit,
  onClose,
}: {
  spike: Spike
  threshold: number
  audit?: AuditMetadata
  onClose: () => void
}) {
  const sevTone = { Watch: 'warn', Review: 'alert', Escalate: 'escalate' } as const
  const confTone = { Low: 'alert', Medium: 'warn', High: 'ok' } as const
  const dialogRef = useDialogFocus<HTMLDivElement>()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const createReview = async () => {
    setCreating(true); setCreateError('')
    try {
      const item = await reviewApi.create(spike.observation_id, spike.source_type)
      navigate(`/review?${new URLSearchParams({ case: item.case_id, source: item.source_type })}`)
    } catch (err) { setCreateError(err instanceof Error ? err.message : 'Could not create review case') }
    finally { setCreating(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]">
      <div
        ref={dialogRef}
        role="dialog"
        data-testid="case-file-dialog"
        aria-modal="true"
        aria-labelledby="case-file-title"
        tabIndex={-1}
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
          <div className="rounded-md border border-accent/30 bg-accent-soft/40 p-4 text-[12px]">
            <strong>Decision support, not a legal finding.</strong>
            <p className="mt-1 leading-relaxed">A tariff anomaly may indicate a possible excessive fare; verification and airline clarification are required. Severity does not establish a Rule 135 violation.</p>
            {spike.direction === 'spike' && <button onClick={createReview} disabled={creating}
              className="mt-3 rounded-md bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50">
              {creating ? 'Creating…' : 'Create review case'}
            </button>}
            {createError && <p role="alert" className="mt-2 text-alert">{createError}</p>}
          </div>
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
                {spike.robust_z > 0 ? '+' : ''}{spike.robust_z.toFixed(1)} rz
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
                    ? `This deviation (${spike.pct_above_median > 0 ? '+' : ''}${spike.pct_above_median.toFixed(1)}%) falls within the demo window's illustrative uplift range for ${spike.event_tag}. This overlap does not establish that the event caused the fare.`
                    : `This deviation (${spike.pct_above_median > 0 ? '+' : ''}${spike.pct_above_median.toFixed(1)}%) exceeds the demo window's illustrative uplift of ~${spike.event_typical_surge_pct}%. The overlap is context only; route relevance and causality remain unverified.`
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

          {/* Passenger Exposure Proxy */}
          <div className="rounded-md border border-line bg-ground/30 px-5 py-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">
                  Passenger Exposure Proxy
                </h3>
                <p className="mt-0.5 text-[11.5px] text-muted leading-relaxed">
                  Uncalibrated prioritisation proxy — no passenger counts, bookings, or measured harm.
                </p>
              </div>
              <Pill tone={spike.exposure_proxy_available ? exposureTone(spike.exposure_proxy) : 'neutral'}>
                {spike.exposure_proxy_available ? `${spike.exposure_proxy} / 100` : 'N/A'}
              </Pill>
            </div>
            <p className="mt-2 text-[11px] font-mono text-muted/80">
              {spike.exposure_proxy_available
                ? 'route weight × (deviation / 25) × lead urgency × severity × confidence'
                : 'Unavailable: this route has no reviewed prototype route weight.'}
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
                { label: 'Source batch', value: spike.source_batch_id ?? 'Not recorded' },
                { label: 'Data source', value: spike.source_label },
                { label: 'Provider', value: spike.provider ?? 'Not applicable' },
                { label: 'Cell definition', value: 'route × airline × fare class × lead-time bucket' },
                { label: 'Detection formula', value: 'robust_z = 0.6745 × (ln(fare) − median(ln fare)) / MAD', mono: true },
                { label: 'Threshold', value: `Robust z > ${threshold} AND ≥ 25% from cell median` },
                { label: 'Cell size', value: `${spike.cell_observations} observations (confidence: ${spike.confidence})` },
                { label: 'Quote date', value: spike.quote_date },
                { label: 'Travel date', value: spike.travel_date },
                { label: 'Calculation method', value: 'Median and MAD on log fares — outlier-resistant baseline' },
                { label: 'Reason assignment', value: '7 deterministic rules, evaluated in priority order' },
                ...(audit ? [
                  { label: 'Calculation ID', value: audit.calculation_id, mono: true },
                  { label: 'Method version', value: audit.calculation_version, mono: true },
                  { label: 'Dataset SHA-256', value: audit.dataset_fingerprint_sha256, mono: true },
                  { label: 'Audit scope', value: audit.audit_scope },
                ] : []),
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
      audit: AuditMetadata
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
              ? `${data.flagged_count} of ${data.scanned_count.toLocaleString()} observed fares were flagged as statistically unusual at the current sensitivity setting (robust z-score > ${data.threshold}, deviation ≥ 25% from the cell median). ${data.event_window_count > 0 ? `${data.event_window_count} of these overlap a team-authored illustrative event window.` : 'None overlap an illustrative event window.'}`
              : 'Scanning observations for statistically unusual fares…',
          },
          {
            q: 'Why does it matter?',
            a: 'Each flagged fare was compared only against fares in its own comparability cell — same route, carrier, cabin class and booking window. A flag means the observation is unusual relative to that cell baseline. It does not prove consumer harm or explain the cause.',
          },
          {
            q: 'How confident are we?',
            a: `Confidence is rated by cell size: High (≥ 30 observations in the cell), Medium (15–29), Low (< 15). Low-confidence alerts should be treated as signals to investigate, not confirmed findings — a thin cell can produce a high z-score from noise. The reason code is assigned by deterministic, priority-ordered rules — no machine learning involved.`,
          },
          {
            q: 'What should an analyst do next?',
            a: `Open the Case File on any "Escalate" or "Review" severity row. Treat reason codes as deterministic context labels, not causal diagnoses. Cross-check the exact quote date with an independent source before contacting a carrier or drawing a market-wide conclusion.`,
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
              any row for a reproducible calculation breakdown.
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
                      { label: 'Calculation ID', value: data.evidence.audit.calculation_id, mono: true },
                      { label: 'Method version', value: data.evidence.audit.calculation_version, mono: true },
                      { label: 'Dataset SHA-256', value: data.evidence.audit.dataset_fingerprint_sha256, mono: true },
                      { label: 'Source batches', value: data.evidence.audit.source_batch_ids.join(', ') || 'None', mono: true },
                      { label: 'Audit scope', value: data.evidence.audit.audit_scope },
                      { label: 'Calculated at', value: data.evidence.audit.computed_at },
                    ]}
                  />
                )}
              </>
            )}
            <div className="rounded-md border border-line bg-ground/50 px-3.5 py-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
                Passenger Exposure Proxy
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
                Each alert carries a 0–100 prioritisation proxy combining an illustrative
                route weight, fare deviation, booking urgency, severity, and confidence.
                It contains no passenger counts, bookings, or measured consumer harm.
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
                  <th className="pb-2 text-right font-semibold">Exposure proxy</th>
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
                      <Pill tone={s.exposure_proxy_available ? exposureTone(s.exposure_proxy) : 'neutral'}>
                        {s.exposure_proxy_available ? s.exposure_proxy : 'N/A'}
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
        <CaseFileModal
          spike={selectedSpike}
          threshold={data?.threshold ?? Number(threshold)}
          audit={data?.evidence?.audit}
          onClose={() => setSelectedSpike(null)}
        />
      )}
    </div>
  )
}
