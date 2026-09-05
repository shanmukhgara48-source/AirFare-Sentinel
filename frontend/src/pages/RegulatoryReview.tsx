import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, Download, FileSearch, RefreshCw } from 'lucide-react'
import { formatClass, formatINR, type Spike } from '../api'
import { reviewApi, type ActionCheck, type CaseStatus, type ReviewCaseDetail, type ReviewQueue } from '../review-api'
import { Button, Card, ErrorNote, Field, Pill, Select, Spinner, StatTile } from '../components/ui'
import './regulatory-review.css'

const tone = (severity: string) => severity === 'Escalate' ? 'escalate' : severity === 'Review' ? 'alert' : 'warn'
const sourceLabel = (source: string | null) => source === 'demo' ? 'Demo · synthetic' : source === 'imported' ? 'Imported · verify source' : source === 'live' ? 'Live · quote snapshots' : 'No active source'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="review-fact"><dt>{label}</dt><dd>{children}</dd></div>
}

function CaseDetail({ item, statuses, onSaved }: {
  item: ReviewCaseDetail; statuses: CaseStatus[]; onSaved: (item: ReviewCaseDetail) => void
}) {
  const [status, setStatus] = useState(item.status)
  const [checks, setChecks] = useState(item.checklist)
  const [notes, setNotes] = useState(item.analyst_notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const completed = checks.filter(check => check.done).length
  const dirty = status !== item.status || notes !== item.analyst_notes || JSON.stringify(checks) !== JSON.stringify(item.checklist)
  const changeCheck = (id: string, change: Partial<ActionCheck>) => setChecks(current => current.map(check => check.id === id ? { ...check, ...change } : check))
  const save = async () => {
    setBusy(true); setError('')
    try { onSaved(await reviewApi.update(item, status, checks, notes)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save case') }
    finally { setBusy(false) }
  }
  const download = async (kind: 'evidence' | 'json' | 'csv') => {
    setBusy(true); setError('')
    try { await reviewApi.download(item, kind) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not download case') }
    finally { setBusy(false) }
  }
  return <article className="space-y-5" data-testid="regulatory-case-detail">
    <Card title={`${item.route} · ${item.airline}`} subtitle={`Case ${item.case_id} · Created ${new Date(item.created_at).toLocaleString()}`}
      action={<div className="flex flex-wrap gap-2"><Pill tone={tone(item.severity)}>{item.severity}</Pill><Pill>{item.status}</Pill></div>}>
      <p className="review-eyebrow">Tariff anomaly · requires regulatory review</p>
      <p className="mt-2 text-[13px] leading-relaxed">{item.alert.explanation}</p>
      <p className="mt-2 text-[12px] text-muted">Reason: {item.alert.reason_code.replaceAll('_', ' ')} · Robust z {item.alert.robust_z.toFixed(2)} · {item.alert.cell_observations} baseline observations · {item.alert.confidence} confidence</p>
      <dl className="review-facts mt-5">
        <Fact label="Observed fare">{formatINR(item.observed_fare)}</Fact>
        <Fact label="Baseline median">{formatINR(item.baseline_median_fare)}</Fact>
        <Fact label="Above baseline">+{item.percent_above_baseline.toFixed(1)}%</Fact>
        <Fact label="Travel date">{item.travel_date}</Fact><Fact label="Quote date">{item.quote_date}</Fact>
        <Fact label="Lead bucket">{item.lead_bucket}</Fact><Fact label="Fare class">{formatClass(item.fare_class)}</Fact>
        <Fact label="Source type">{sourceLabel(item.source_type)}</Fact><Fact label="Provider">{item.provider ?? 'Not recorded'}</Fact>
      </dl>
      <p className="mt-3 text-[12px] leading-relaxed text-muted">{item.baseline_basis}</p>
    </Card>

    <Card title="Peer airline comparison" subtitle={item.peer_comparison_basis}>
      {item.peer_airline_comparison.length ? <div className="overflow-x-auto"><table className="review-table">
        <thead><tr><th>Airline</th><th>Median fare</th><th>Observed vs peer</th><th>Quotes</th><th>Source / provider</th></tr></thead>
        <tbody>{item.peer_airline_comparison.map(peer => <tr key={peer.airline}>
          <td>{peer.airline}</td><td>{formatINR(peer.median_fare)}</td><td>{peer.percent_above_peer > 0 ? '+' : ''}{peer.percent_above_peer}%</td>
          <td>{peer.observation_count}</td><td>{peer.source_type} / {peer.providers.join(', ')}</td>
        </tr>)}</tbody></table></div> : <p className="text-[13px] text-muted">No matched peer quotes available. Record this evidence gap and seek comparable quotes before drawing conclusions.</p>}
    </Card>

    <Card title="Government action checklist" subtitle="Monitor → verify → compare → seek clarification → consider escalation. Record evidence references or explain what remains unavailable."
      action={<Pill tone={completed === 8 ? 'ok' : 'warn'}>{completed} / 8 documented</Pill>}>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="sr-only">Case evidence checks</legend>
        {checks.map((check, index) => <div key={check.id} className={`review-check ${check.done ? 'is-done' : ''}`}>
          <label className="review-check-label"><input type="checkbox" checked={check.done} onChange={e => changeCheck(check.id, { done: e.target.checked })} />
            <span>{index + 1}. {check.label}</span></label>
          <p>{check.guidance}</p>
          <label className="block"><span className="sr-only">{check.label} — evidence notes</span>
            <textarea aria-label={`${check.label} — evidence notes`} value={check.notes} maxLength={4000} rows={2}
              placeholder="Evidence reference, dated findings, or reason evidence is unavailable…"
              onChange={e => changeCheck(check.id, { notes: e.target.value })} /></label>
        </div>)}
        <div className="review-save-grid">
          <Field label="Case status"><Select value={status} onChange={value => setStatus(value as CaseStatus)} options={statuses.map(value => ({ value, label: value }))} /></Field>
          <Field label="Analyst notes / closure reason"><textarea rows={3} maxLength={10000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Record unresolved questions, follow-up or closure rationale." /></Field>
        </div>
        <p className="text-[12px] text-muted">Recommended Escalation requires all eight checks with notes. Marking a check records an analyst assertion. Severity alone does not escalate a case or contact an authority.</p>
        {error && <div role="alert"><ErrorNote message={error} /></div>}
        <div className="flex flex-wrap items-center gap-3"><Button onClick={save} disabled={busy || !dirty}>{busy ? 'Working…' : 'Save review'}</Button>
          <span className="text-[12px] text-muted" role="status">{dirty ? 'Unsaved changes' : `Saved · version ${item.version}`}</span></div>
      </fieldset>
    </Card>

    <Card title="Evidence pack & case exports" subtitle="Downloads include the saved case version. Save your review before exporting.">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => download('evidence')} disabled={busy || dirty}><Download size={14} /> Generate evidence pack</Button>
        <Button variant="secondary" onClick={() => download('json')} disabled={busy || dirty}>Case summary · JSON</Button>
        <Button variant="secondary" onClick={() => download('csv')} disabled={busy || dirty}>Case summary · CSV</Button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted">Includes the normalized quote, baseline observations, matched peers, source provenance, checklist, local history and draft routing summary. Quote snapshots require original-source verification.</p>
      <details className="review-disclosure mt-4"><summary>AirSewa / CPGRAMS-ready draft</summary>
        <p className="mt-3 text-[12px] text-muted">Review and supplement this draft before manual grievance routing. Synthetic demo cases are exercises. No complaint or airline request is sent by this app.</p>
        <pre className="review-draft">{item.grievance_routing_summary}</pre>
      </details>
    </Card>

    <Card title="Evidence & audit metadata" subtitle="Frozen at case creation; workflow edits append a local version history.">
      <dl className="review-facts">
        <Fact label="Observation ID">{item.observation_id}</Fact><Fact label="Source batch">{String(item.quote_snapshot.source_batch_id)}</Fact>
        <Fact label="Recorded at">{String(item.quote_snapshot.created_at ?? 'Not recorded')}</Fact>
        <Fact label="Offer / flight">{String(item.quote_snapshot.offer_id ?? item.quote_snapshot.flight_number ?? 'Not recorded')}</Fact>
        <Fact label="Offer expiry">{String(item.quote_snapshot.offer_expiry ?? 'Not recorded')}</Fact>
        <Fact label="Price status">{String(item.quote_snapshot.price_status ?? 'Not recorded')}</Fact>
        <Fact label="Method version">{item.audit.calculation_version}</Fact><Fact label="Calculation ID">{item.audit.calculation_id}</Fact>
        <Fact label="Evidence SHA-256">{item.snapshot_sha256}</Fact>
      </dl>
      <ul className="mt-4 list-disc space-y-1 pl-4 text-[12px] leading-relaxed text-muted">{item.evidence_limitations.map(text => <li key={text}>{text}</li>)}</ul>
      <details className="review-disclosure mt-4"><summary>Case history · {item.history.length} entries</summary>
        <ol className="mt-3 space-y-3">{item.history.map(entry => <li key={entry.version} className="border-l-2 border-line pl-3 text-[12px]">
          <strong>v{entry.version} · {entry.action}</strong><p className="mt-1 text-muted">{new Date(entry.recorded_at).toLocaleString()} · {entry.actor}</p>
          <details className="mt-1"><summary>Changes</summary><pre className="review-draft">{JSON.stringify(entry.changes, null, 2)}</pre></details>
        </li>)}</ol>
      </details>
    </Card>
  </article>
}

export default function RegulatoryReview() {
  const [params, setParams] = useSearchParams()
  const caseId = params.get('case')
  const caseSource = params.get('source')
  const [queueResult, setQueueResult] = useState<{ key: string; data: ReviewQueue | null; error: string } | null>(null)
  const [detailResult, setDetailResult] = useState<{ key: string; data: ReviewCaseDetail | null; error: string } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')

  const queueKey = `${refresh}:${offset}`
  const queue = queueResult?.key === queueKey ? queueResult.data : null
  const loading = queueResult?.key !== queueKey
  const detailKey = `${caseId}:${caseSource}:${refresh}`
  const sourceMatches = !!queue?.source_type && caseSource === queue.source_type
  const selected = sourceMatches && detailResult?.key === detailKey ? detailResult.data : null
  const detailLoading = !!caseId && sourceMatches && detailResult?.key !== detailKey
  const visibleError = error || (queueResult?.key === queueKey ? queueResult.error : '')
    || (caseId && queue && !sourceMatches ? 'This case link belongs to another source. Select a case from the active source queue.' : '')
    || (detailResult?.key === detailKey ? detailResult.error : '')

  useEffect(() => {
    let cancelled = false
    reviewApi.queue(offset).then(data => { if (!cancelled) setQueueResult({ key: queueKey, data, error: '' }) })
      .catch(err => { if (!cancelled) setQueueResult({ key: queueKey, data: null, error: err.message }) })
    return () => { cancelled = true }
  }, [queueKey, offset])

  useEffect(() => {
    const changed = () => { setParams({}); setOffset(0); setError(''); setRefresh(n => n + 1) }
    window.addEventListener('farepulse-data-changed', changed)
    return () => window.removeEventListener('farepulse-data-changed', changed)
  }, [setParams])

  const activeSource = queue?.source_type
  useEffect(() => {
    let cancelled = false
    if (!caseId || !activeSource || caseSource !== activeSource) return
    reviewApi.get(caseId, activeSource).then(data => { if (!cancelled) setDetailResult({ key: detailKey, data, error: '' }) })
      .catch(err => { if (!cancelled) setDetailResult({ key: detailKey, data: null, error: err.message }) })
    return () => { cancelled = true }
  }, [caseId, caseSource, activeSource, detailKey])

  const create = async (alert: Spike) => {
    setCreating(alert.observation_id); setError('')
    try {
      const item = await reviewApi.create(alert.observation_id, alert.source_type)
      setParams({ case: item.case_id, source: item.source_type }); setOffset(0); setRefresh(n => n + 1)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create case') }
    finally { setCreating(null) }
  }
  const cases = queue?.cases.filter(item => (!statusFilter || item.status === statusFilter) && (!severityFilter || item.severity === severityFilter)) ?? []
  return <div className="regulatory-review space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="review-eyebrow"><ClipboardCheck size={14} /> Analyst workspace</p>
        <h1 className="mt-2 font-serif text-[28px] tracking-tight">Regulatory Review</h1>
        <p className="mt-1 text-[13px] text-muted">Case Workflow · Monitor, verify, compare, seek clarification, escalate.</p></div>
      <div className="flex items-center gap-3"><Pill>{sourceLabel(queue?.source_type ?? null)}</Pill>
        <Button variant="secondary" onClick={() => { setError(''); setRefresh(n => n + 1) }} disabled={loading || creating !== null}><RefreshCw size={14} /> Refresh queue</Button></div>
    </header>
    <div className="review-notice" role="note"><FileSearch size={21} aria-hidden /><div><strong>Decision support, not a legal finding.</strong>
      <p>{queue?.notice.replace('Decision support, not a legal finding. ', '') ?? 'A tariff anomaly indicates a possible excessive fare requiring verification. Severity is an app priority, not a DGCA determination.'}</p></div></div>
    {visibleError && <div role="alert"><ErrorNote message={visibleError} /></div>}
    {loading ? <Spinner /> : queue && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Active review cases" value={queue.cases.filter(item => item.status !== 'Closed').length} hint="Saved within the active source" />
        <StatTile label="Severe alerts awaiting cases" value={queue.severe_alert_count} hint="Review and Escalate · upward anomalies" tone="alert" />
        <StatTile label="Recommended escalation" value={queue.cases.filter(item => item.status === 'Recommended Escalation').length} hint="Analyst recommendation · no automatic referral" tone="warn" />
      </div>
      <details className="review-disclosure review-policy"><summary>India's review approach & source references</summary>
        <p className="mt-3 text-[13px] leading-relaxed">{queue.policy.summary}</p>
        <p className="mt-2 text-[12px] text-muted">App priorities: Watch for an eligible upward anomaly; Review at robust z ≥ 5 or ≥ 50% above baseline; Escalate at robust z ≥ 7 or ≥ 100%. Every case must first exceed robust z 3.5 and be at least 25% above baseline, with eight or more observations. These are prototype thresholds, not legal limits.</p>
        <ul className="mt-3 space-y-1 text-[12px]">{queue.policy.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></li>)}</ul>
        <p className="mt-2 text-[11px] text-muted">Research reviewed {queue.policy.reviewed_on}. Source-specific cases and evidence remain separate. Admin data reset clears cases and history.</p>
      </details>
      <Card title="Case register" subtitle="Select a saved case to review evidence and record next steps. Severity and workflow status are separate.">
        <div className="mb-4 grid gap-3 sm:grid-cols-2"><Field label="Filter by status"><Select value={statusFilter} onChange={setStatusFilter} allLabel="All statuses" options={queue.statuses.map(value => ({ value, label: value }))} /></Field>
          <Field label="Filter by severity"><Select value={severityFilter} onChange={setSeverityFilter} allLabel="All severities" options={['Watch', 'Review', 'Escalate'].map(value => ({ value, label: value }))} /></Field></div>
        {cases.length ? <div className="overflow-x-auto"><table className="review-table"><thead><tr><th>Route / airline</th><th>Travel date</th><th>Above baseline</th><th>Severity</th><th>Status</th><th>Case</th></tr></thead>
          <tbody>{cases.map(item => <tr key={item.case_id} className={caseId === item.case_id ? 'is-selected' : ''}>
            <td><strong>{item.route}</strong><small>{item.airline} · {item.provider ?? 'Provider not recorded'}</small></td><td>{item.travel_date}</td>
            <td>+{item.percent_above_baseline}%</td><td><Pill tone={tone(item.severity)}>{item.severity}</Pill></td><td>{item.status}</td>
            <td><Link to={`?${new URLSearchParams({ case: item.case_id, source: item.source_type })}`} className="review-link">Open case</Link></td>
          </tr>)}</tbody></table></div> : <p className="text-[13px] text-muted">{queue.cases.length ? 'No cases match these filters.' : 'No cases yet for this source. Create one from an upward fare alert below.'}</p>}
      </Card>
      {!caseId && <Card title="Alerts awaiting review cases" subtitle="Upward anomalies at the standard threshold. Each action preserves the current evidence and creates a New Alert case.">
        {!queue.alerts.length ? <p className="text-[13px] text-muted">{queue.source_type ? 'No eligible alerts on this page. Live data may need more comparable quote history to establish a baseline.' : 'No data loaded. Load a demo, import observations or fetch live quotes from Admin.'} <Link className="review-link" to="/admin">Open Admin</Link></p> :
          <div className="space-y-3">{queue.alerts.map(alert => <div key={alert.observation_id} className="review-alert-row">
            <div><div className="flex flex-wrap items-center gap-2"><strong>{alert.route} · {alert.airline}</strong><Pill tone={tone(alert.severity)}>{alert.severity}</Pill></div>
              <p>{alert.travel_date} · {formatClass(alert.fare_class)} · {alert.lead_bucket} · {sourceLabel(alert.source_type)}</p>
              <p><strong>{formatINR(alert.total_fare)}</strong> · +{alert.pct_above_median}% above {formatINR(alert.cell_median_fare)} baseline · {alert.reason_code.replaceAll('_', ' ')}</p></div>
            <Button variant="secondary" onClick={() => create(alert)} disabled={creating !== null}>{creating === alert.observation_id ? 'Creating…' : 'Create review case'}</Button>
          </div>)}</div>}
        {queue.eligible_alert_count > 30 && <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 30))}>Previous alerts</Button>
          <span className="text-[12px]">{offset + 1}–{Math.min(offset + 30, queue.eligible_alert_count)} of {queue.eligible_alert_count}</span>
          <Button variant="secondary" disabled={offset + 30 >= queue.eligible_alert_count} onClick={() => setOffset(n => n + 30)}>Next alerts</Button></div>}
      </Card>}
      {caseId && <div><Link to="/review" className="review-link">← Back to alert queue</Link></div>}
      {detailLoading && <Spinner />}
      {selected && <CaseDetail key={`${selected.case_id}:${selected.version}`} item={selected} statuses={queue.statuses} onSaved={item => {
        setDetailResult({ key: detailKey, data: item, error: '' })
        setQueueResult(current => current?.data ? { ...current, data: { ...current.data, cases: current.data.cases.map(entry => entry.case_id === item.case_id ? {
          ...item, reason_code: item.alert.reason_code, why_flagged: item.alert.explanation,
        } : entry) } } : current)
      }} />}
    </>}
  </div>
}
