export interface IndexPoint {
  period: string
  apix_value: number
  apix_weighted: number
  apix_unweighted: number
  active_cells: number
  total_cells: number
  coverage_pct: number
  weight_coverage_pct: number
  quality_flag: 'GREEN' | 'AMBER' | 'RED'
  low_coverage: boolean
  observation_count: number
  sensitivity_value: number
}

export interface GroupRow {
  group: string
  label?: string
  apix_value: number
  delta: number
  change_pct: number
  cell_count: number
  observation_count: number
}

export interface Coverage {
  total_cells: number
  total_periods: number
  mean_coverage_pct: number
  mean_weight_coverage_pct: number
  complete_cells: number
  sparse_cells: { cell: string[]; periods_present: number; coverage_pct: number }[]
  quality_flag: 'GREEN' | 'AMBER' | 'RED'
}

export interface AuditMetadata {
  calculation_id: string
  calculation_version: string
  computed_at: string
  dataset_fingerprint_sha256: string
  observation_count: number
  source_types: string[]
  source_batch_ids: string[]
  quote_date_start: string | null
  quote_date_end: string | null
  parameters: Record<string, string | number | boolean>
  audit_scope: string
}

export interface LeadBucket {
  code: string
  label: string
}

export interface OverviewEvidence {
  data_source: string
  calculation_method: string
  formula: string
  baseline: string
  sensitivity_formula: string
  alert_formula: string
  alert_threshold: number
  alert_min_deviation_pct: number
  cell_definition: string
  weight_source: string
  audit: AuditMetadata
}

export interface Overview {
  empty: boolean
  message?: string
  indicator_name: string
  publication_status: 'SUPPRESSED' | 'PROVISIONAL' | 'PUBLISHABLE_PROTOTYPE'
  headline_publishable: boolean
  suppression_reason: string | null
  headline_index: number | null
  change_pct: number | null
  period_start: string | null
  period_end: string | null
  series: IndexPoint[]
  observation_count: number
  route_count: number
  airline_count: number
  spike_count: number
  median_fare: number
  coverage: Coverage
  top_routes: GroupRow[]
  top_airlines: GroupRow[]
  lead_buckets: GroupRow[]
  last_updated?: string
  evidence?: OverviewEvidence
}

export interface EventEntry {
  id: string
  name: string
  category: string
  category_label: string
  start_md: string
  end_md: string
  typical_surge_pct: number
  description: string
  routes_note: string
}

export type EventClassification =
  | 'Expected seasonal pressure'
  | 'Elevated beyond event baseline'
  | 'Unrelated to event window'

export interface Spike {
  observation_id: number
  route: string
  airline: string
  fare_class: string
  lead_bucket: string
  lead_bucket_label: string
  travel_date: string
  quote_date: string
  lead_days: number
  total_fare: number
  cell_median_fare: number
  cell_observations: number
  pct_above_median: number
  robust_z: number
  direction: 'spike' | 'drop'
  severity: 'Watch' | 'Review' | 'Escalate'
  confidence: 'Low' | 'Medium' | 'High'
  reason_code: string
  explanation: string
  recommended_action: string
  impact_score: number
  exposure_proxy: number
  source_batch_id: string | null
  source_type: 'demo' | 'imported' | 'live'
  provider: string | null
  source_label: string
  // Event sensitivity layer
  event_tag: string | null
  event_category: string | null
  event_category_label: string | null
  event_typical_surge_pct: number | null
  event_description: string | null
  event_window_label: string | null
  in_event_window: boolean
  event_classification: EventClassification
}

export const REASON_GLOSSARY: Record<string, string> = {
  LEAD_TIME_SURGE: 'Flagged observation is in the 0–3 day booking bucket; this is context, not a causal finding.',
  FESTIVAL_PATTERN: 'Travel date overlaps an approximate recurring demo event window; route relevance and causality are unverified.',
  CARRIER_SPECIFIC_SPIKE: 'Only one carrier on the route has a flag in the analysed dataset; same-period normality is not inferred.',
  LOW_COMPETITION_ROUTE: 'The analysed dataset contains ≤ 2 carriers on the route; collection coverage may affect this proxy.',
  ROUTE_LEVEL_SPIKE: 'More than one carrier on the route has a flag somewhere in the analysed dataset; simultaneity is not inferred.',
  FARE_DROP_OUTLIER: 'Fare is significantly below its cell median — possible promotional pricing or data error.',
  LOW_COVERAGE_WARNING: 'Cell has fewer than 15 observations; the statistical baseline may be unreliable.',
}

export interface Trends {
  empty: boolean
  series: IndexPoint[]
  lead_time_curve: {
    lead_bucket: string
    label: string
    avg_fare: number
    median_fare: number
    observation_count: number
  }[]
  fare_class_breakdown: {
    fare_class: string
    avg_fare: number
    median_fare: number
    observation_count: number
  }[]
  lead_bucket_index: GroupRow[]
  coverage: Coverage
  observation_count: number
}

export interface CompareRow {
  group: string
  avg_fare: number
  median_fare: number
  min_fare: number
  max_fare: number
  apix_value: number | null
  delta: number | null
  change_pct: number | null
  cell_count: number | null
  observation_count: number
  airline_count: number | null
  route_count: number | null
}

export interface FilterOptions {
  routes: string[]
  airlines: string[]
  fare_classes: string[]
  lead_buckets: LeadBucket[]
  source_types: string[]
  active_source_type: 'demo' | 'imported' | 'live' | null
  travel_date_min: string | null
  travel_date_max: string | null
}

export interface LiveFetchResult {
  batch_id: string
  provider: string
  quick_mode: boolean
  fetched_at: string
  api_calls: number
  api_errors: number
  raw_quotes: number
  accepted_count: number
  quarantined_count: number
  quarantined: { raw_row: string; reject_reason: string }[]
  fetch_errors: { route: string; lead_days: number; error: string }[]
  message: string
  data_notice: string
}

export interface LiveFetchStatus {
  has_result: boolean
  live_provider_configured: boolean
  live_fetch_enabled: boolean
  operating_mode: 'demo' | 'live' | 'demo_fallback'
  mode_label: string
  mode_notice: string
  active_live_provider: string | null
  configured_live_provider: string | null
  /** Backward-compatible aliases returned by older backends. */
  active_provider: string | null
  configured_provider?: string | null
  message?: string
  // When has_result is true, all LiveFetchResult fields are also present
  batch_id?: string
  provider?: string
  fetched_at?: string
  accepted_count?: number
  api_calls?: number
  api_errors?: number
}

export interface AnalysisSourceState {
  dataset_mode: 'empty' | 'demo' | 'live' | 'imported' | 'hybrid'
  dataset_label: string
  dataset_notice: string
  active_analysis_source: 'demo' | 'imported' | 'live' | null
  available_analysis_sources: ('demo' | 'imported' | 'live')[]
  source_isolation_notice: string
  stored_dataset: {
    dataset_mode: 'empty' | 'demo' | 'live' | 'imported' | 'hybrid'
    dataset_label: string
    dataset_notice: string
  }
}

export interface SystemVersion extends AnalysisSourceState {
  version: string
  project: string
  demo_mode: boolean
  operating_mode: 'demo' | 'live' | 'demo_fallback'
  mode_label: string
  mode_notice: string
  live_provider_configured: boolean
  configured_live_provider: string | null
}

export interface WhatIfProjection {
  demand_contribution: number
  fuel_contribution: number
  capacity_contribution: number
  competition_contribution: number
  projected_change_pct: number
  projected_apix: number
  impact_score: number
  exposure_proxy: number
  risk_level: 'Low' | 'Watch' | 'Review' | 'Escalate'
  explanation: string
  model_metadata: {
    model_status: string
    coefficient_basis: string
    citation_status: string
    valid_use: string
    invalid_uses: string[]
    coefficients: Record<string, number>
  }
}

export interface IngestResult {
  batch_id: string
  filename: string
  accepted_count: number
  quarantined_count: number
  quarantined: { raw_row: string; reject_reason: string }[]
  message: string
}

export interface Batch {
  batch_id: string
  uploaded_at: string
  filename: string
  accepted_count: number
  quarantined_count: number
  live_rows: number
}

export interface ObservationRow {
  id: number
  origin: string
  destination: string
  airline: string
  travel_date: string
  quote_date: string
  lead_days: number
  lead_bucket: string
  fare_class: string
  base_fare: number
  taxes_fees: number
  total_fare: number
  source_batch_id: string
  source_type: 'demo' | 'imported' | 'live'
  provider: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      const parsed = JSON.parse(body) as { detail?: string | { msg?: string }[] }
      if (typeof parsed.detail === 'string') detail = parsed.detail
      else if (Array.isArray(parsed.detail)) {
        detail = parsed.detail.map((item) => item.msg ?? 'Invalid request').join('; ')
      }
    } catch {
      // Preserve a plain-text response body when the server did not return JSON.
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json()
}

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v))
  })
  const str = search.toString()
  return str ? `?${str}` : ''
}

export const api = {
  version: () => request<SystemVersion>('/api/version'),
  whatif: (params: {
    demand_change_pct: number
    fuel_change_pct: number
    capacity_change_pct: number
    carriers: number
    baseline_apix: number
  }) => request<WhatIfProjection>(`/api/whatif${qs(params)}`),
  overview: (granularity: string) =>
    request<Overview>(`/api/overview${qs({ granularity })}`),
  filters: () => request<FilterOptions>('/api/filters'),
  trends: (params: Record<string, string | number | undefined>) =>
    request<Trends>(`/api/trends${qs(params)}`),
  compare: (params: Record<string, string | number | undefined>) =>
    request<{ empty: boolean; rows: CompareRow[] }>(`/api/compare${qs(params)}`),
  spikes: (threshold: number) =>
    request<{
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
    }>(`/api/spikes${qs({ threshold })}`),
  events: () =>
    request<{ demo_notice: string; events: EventEntry[] }>('/api/events'),
  loadSample: () => request<IngestResult>('/api/admin/load-sample', { method: 'POST' }),
  upload: (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<IngestResult>('/api/admin/upload', { method: 'POST', body })
  },
  batches: () => request<{ batches: Batch[] }>('/api/admin/batches'),
  observations: (limit: number, offset: number) =>
    request<{ total: number; rows: ObservationRow[] }>(
      `/api/admin/observations${qs({ limit, offset })}`,
    ),
  clearData: () => request<{ message: string }>('/api/admin/data', { method: 'DELETE' }),
  liveFetch: (quick: boolean) =>
    request<LiveFetchResult>(`/api/admin/live-fetch${qs({ quick: String(quick) })}`, { method: 'POST' }),
  liveFetchStatus: () => request<LiveFetchStatus>('/api/admin/live-fetch/status'),
  analysisSource: () => request<AnalysisSourceState>('/api/admin/analysis-source'),
  selectAnalysisSource: (sourceType: 'demo' | 'imported' | 'live') =>
    request<AnalysisSourceState>(`/api/admin/analysis-source${qs({ source_type: sourceType })}`, { method: 'POST' }),
  providerStatus: () =>
    request<{
      providers: { provider: string; configured: boolean; requires_credentials: boolean; message: string; setup_instructions?: string[] }[]
      live_provider_configured: boolean
      live_fetch_enabled: boolean
      live_data_available: boolean
      active_live_provider: string | null
      demo_fallback: boolean
    }>('/api/provider/status'),
  contributions: (granularity: string) =>
    request<{ empty: boolean; contributions: { route: string; airline: string; fare_class: string; lead_bucket: string; weight: number; contribution_pts: number }[] }>(
      `/api/contributions${qs({ granularity })}`,
    ),
  sensitivity: (granularity: string) =>
    request<{ empty: boolean; max_divergence_pts: number; mean_divergence_pts: number; warning: boolean; series: { period: string; weighted: number; unweighted: number; divergence: number }[] }>(
      `/api/sensitivity${qs({ granularity })}`,
    ),
  headToHead: (route: string, fareClass?: string, leadBucket?: string) =>
    request<{ empty: boolean; route: string; airlines: { airline: string; avg_fare: number; median_fare: number; min_fare: number; max_fare: number; observation_count: number; index_start: number; index_end: number; index_change: number }[] }>(
      `/api/head-to-head${qs({ route, fare_class: fareClass, lead_bucket: leadBucket })}`,
    ),
  competition: () => request<CompetitionData>('/api/competition'),
  vulnerability: (params?: Record<string, string | undefined>) =>
    request<VulnerabilityData>(`/api/vulnerability${qs(params ?? {})}`),
  fairness: () => request<FairnessData>('/api/fairness'),
}

export interface VulnerabilityBucket {
  lead_bucket: string
  label: string
  observation_count: number
  avg_fare: number
  median_fare: number
  fare_cv: number
  within_cell_count: number
  robust_log_sigma: number
  within_cell_relative_volatility: number
  alert_count: number
  alert_rate: number
  urgency_weight: number
  coverage_confidence: number
  vulnerability_score: number
  vulnerability_label: 'Stable' | 'Sensitive' | 'Vulnerable' | 'Critical'
  component_scores: {
    fare_deviation: number
    alert_frequency: number
    urgency: number
  }
}

export interface VulnerabilityData {
  empty: boolean
  message?: string
  observation_count?: number
  spike_count?: number
  most_vulnerable_bucket?: string | null
  least_vulnerable_bucket?: string | null
  buckets: VulnerabilityBucket[]
}

export interface RouteCompetition {
  route: string
  origin: string
  destination: string
  carrier_count: number
  carriers: string[]
  dominant_carrier: string
  dominant_share: number
  hhi: number
  avg_fare: number
  fare_pressure: 'Low' | 'Moderate' | 'High'
  status: 'Healthy' | 'Watch' | 'High Risk'
  observation_count: number
}

export interface CompetitionData {
  empty: boolean
  message?: string
  data_source?: string
  summary: {
    healthy_count: number
    watch_count: number
    high_risk_count: number
    total_routes: number
  }
  routes: RouteCompetition[]
}

export type FairnessPressure = 'Low' | 'Moderate' | 'High'
export type FairnessCategory =
  | 'Metro'
  | 'Business-heavy'
  | 'Tourism-heavy'
  | 'Connectivity-sensitive'
  | 'Tier-2'
  | 'Unclassified'

export interface FairnessCategoryRow {
  category: FairnessCategory
  description: string
  route_count: number
  observation_count: number
  avg_fare: number | null
  median_fare: number | null
  alert_count: number
  alert_rate: number | null
  avg_impact_score: number | null
  avg_exposure_proxy: number | null
  index_value: number | null
  index_change_pct: number | null
  relative_to_basket_pts: number | null
  index_period_start: string | null
  index_period_end: string | null
  index_quality_flag: 'GREEN' | 'AMBER' | 'RED' | null
  pressure_method?: string
  fare_pressure: FairnessPressure | null
  routes: string[]
}

export interface FairnessData {
  empty: boolean
  message?: string
  categories: FairnessCategoryRow[]
}

export const formatINR = (value: number | null | undefined) =>
  value == null ? '—' : `₹${Math.round(value).toLocaleString('en-IN')}`

export const formatClass = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
