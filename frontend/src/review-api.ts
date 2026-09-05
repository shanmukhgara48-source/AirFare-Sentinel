import { apiUrl, qs, type AuditMetadata, type Spike } from './api'

export type SourceType = 'demo' | 'imported' | 'live'
export type CaseStatus = 'New Alert' | 'Evidence Pending' | 'Analyst Review' | 'Airline Clarification Needed' | 'Monitoring' | 'Recommended Escalation' | 'Closed'
export interface ActionCheck { id: string; label: string; guidance: string; done: boolean; notes: string }
export interface PeerComparison {
  airline: string; median_fare: number; observation_count: number; percent_above_peer: number
  source_type: SourceType; providers: string[]; observation_ids: number[]
}
export interface PolicyBasis { reviewed_on: string; summary: string; sources: { title: string; url: string }[] }
export interface ReviewCase {
  case_id: string; observation_id: number; route: string; airline: string; travel_date: string; quote_date: string
  lead_bucket: string; fare_class: string; observed_fare: number; baseline_median_fare: number
  percent_above_baseline: number; currency: string; peer_airline_comparison: PeerComparison[]
  source_type: SourceType; provider: string | null; source_label: string; severity: Spike['severity']; status: CaseStatus
  created_at: string; updated_at: string; version: number; snapshot_sha256: string; audit: AuditMetadata
  decision_support_notice: string; reason_code: string; why_flagged: string
  checklist: ActionCheck[]; analyst_notes: string; baseline_basis: string; peer_comparison_basis: string
  evidence_limitations: string[]
}
export interface ReviewCaseDetail extends Omit<ReviewCase, 'reason_code' | 'why_flagged'> {
  alert: Spike; quote_snapshot: Record<string, string | number | null>; policy_basis: PolicyBasis
  grievance_routing_summary: string
  history: { version: number; recorded_at: string; action: string; actor: string; changes: Record<string, unknown> }[]
}
export interface ReviewQueue {
  source_type: SourceType | null; cases: ReviewCase[]; alerts: Spike[]; eligible_alert_count: number
  severe_alert_count: number; statuses: CaseStatus[]; notice: string; policy: PolicyBasis
}
async function reviewRequest(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(apiUrl(`/api/review${path}`), { ...init, signal: AbortSignal.timeout(20000) })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Review request failed (${response.status}). Check the entered fields and try again.`)
  }
  return response
}
const jsonBody = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const casePath = (id: string, source: SourceType, suffix = '') => `/cases/${encodeURIComponent(id)}${suffix}${qs({ source_type: source })}`
export const reviewApi = {
  queue: (offset = 0): Promise<ReviewQueue> => reviewRequest(`/queue${qs({ offset })}`).then(r => r.json()),
  create: (observation_id: number, source_type: SourceType): Promise<ReviewCaseDetail> =>
    reviewRequest('/cases', { method: 'POST', ...jsonBody({ observation_id, source_type }) }).then(r => r.json()),
  get: (id: string, source: SourceType): Promise<ReviewCaseDetail> => reviewRequest(casePath(id, source)).then(r => r.json()),
  update: (item: ReviewCaseDetail, status: CaseStatus, checks: ActionCheck[], analyst_notes: string): Promise<ReviewCaseDetail> =>
    reviewRequest(casePath(item.case_id, item.source_type), { method: 'PATCH', ...jsonBody({
      expected_version: item.version, status, checklist: checks.map(({ id, done, notes }) => ({ id, done, notes })), analyst_notes,
    }) }).then(r => r.json()),
  download: async (item: ReviewCaseDetail, kind: 'evidence' | 'json' | 'csv') => {
    const path = kind === 'evidence' ? casePath(item.case_id, item.source_type, '/evidence')
      : `${casePath(item.case_id, item.source_type, '/export')}&format=${kind}`
    const response = await reviewRequest(path)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${item.case_id}-${kind === 'evidence' ? 'evidence.json' : `summary.${kind}`}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
