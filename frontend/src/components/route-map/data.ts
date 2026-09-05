import airportCatalog from './airports.json'
import { apiUrl, qs, type CompareRow, type RouteCompetition, type Spike, type Trends, type VulnerabilityBucket } from '../../api'

export type Source = 'demo' | 'imported' | 'live'
export type MapView = 'map' | 'table' | 'risk' | 'cost'
export type MapFilters = { airline: string; fareClass: string; leadBucket: string }
export type AirportCode = string
// OurAirports coordinates, bundled at build time. See MAP_DATA.md.
const CORE_AIRPORTS: Record<AirportCode, { city: string; lat: number; lon: number; label: [number, number] }> = {
  DEL: { city: 'Delhi', lat: 28.55563, lon: 77.09519, label: [-21, -21] },
  BOM: { city: 'Mumbai', lat: 19.088699, lon: 72.867897, label: [-65, 5] },
  BLR: { city: 'Bengaluru', lat: 13.1979, lon: 77.706299, label: [-76, 18] },
  CCU: { city: 'Kolkata', lat: 22.654012, lon: 88.44765, label: [19, 3] },
  HYD: { city: 'Hyderabad', lat: 17.231318, lon: 78.429855, label: [23, -9] },
  MAA: { city: 'Chennai', lat: 12.990005, lon: 80.169296, label: [25, 25] },
}
export const AIRPORTS: Record<string, { city: string; lat: number; lon: number; label: [number, number] }> = { ...Object.fromEntries(Object.entries(airportCatalog).map(([code, airport]) => [code, { ...airport, label: [10, -10] as [number, number] }])), ...CORE_AIRPORTS }
export const isMappedRoute = (route: string) => route.split('-').length === 2 && route.split('-').every(code => !!AIRPORTS[code])
export const ROUTES = ['DEL-BOM', 'BOM-DEL', 'DEL-BLR', 'BLR-DEL', 'BOM-BLR', 'BLR-BOM', 'DEL-CCU', 'CCU-DEL', 'DEL-HYD', 'HYD-DEL', 'BLR-HYD', 'HYD-BLR', 'DEL-MAA', 'MAA-DEL'] as const
export type RouteCode = string
export const SOURCE_LABELS = { demo: 'Demo dataset · synthetic', imported: 'Imported observations', live: 'Live fare quote snapshots' }
export const COLORS = { stable: '#70d4bd', lower: '#77bddf', watch: '#e5b56e', risk: '#f58978', missing: '#708593' }
export const percent = (value: number | null | undefined) => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
export const endpoints = (route: string) => route.split('-') as [AirportCode, AirportCode]

export type RouteSignal = { trends?: Trends; vulnerability?: VulnerabilityBucket[]; errors: string[] }
export type RouteModel = {
  route: RouteCode
  quote?: CompareRow
  alerts: Spike[] | null
  competition?: RouteCompetition
  signal?: RouteSignal
}

export function peakVulnerability(buckets: VulnerabilityBucket[] | undefined, leadBucket: string) {
  return buckets?.filter((bucket) => !leadBucket || bucket.lead_bucket === leadBucket)
    .reduce<VulnerabilityBucket | undefined>((peak, bucket) => !peak || bucket.vulnerability_score > peak.vulnerability_score ? bucket : peak, undefined)
}

// Visual prioritisation only; never changes a backend score or risk calculation.
export function pressure(route: RouteModel): { color: string; label: string } {
  if (!route.quote) return { color: COLORS.missing, label: 'No observations' }
  if (route.alerts?.some((alert) => alert.direction === 'spike' && alert.severity === 'Escalate')) return { color: COLORS.risk, label: 'Escalation' }
  if (route.alerts?.some((alert) => alert.direction === 'spike') || (route.quote.change_pct ?? 0) > 2) return { color: COLORS.watch, label: 'Watch' }
  if (route.quote.change_pct != null && route.quote.change_pct < 0) return { color: COLORS.lower, label: 'Easing' }
  return { color: route.quote.change_pct == null ? COLORS.missing : COLORS.stable, label: route.quote.change_pct == null ? 'Index unavailable' : 'Stable' }
}

export function routeColor(route: RouteModel, view: MapView, leadBucket: string) {
  if (!route.quote) return COLORS.missing
  if (view === 'cost') {
    const fare = route.quote.avg_fare
    return fare >= 15000 ? COLORS.risk : fare >= 10000 ? COLORS.watch : fare >= 7000 ? COLORS.stable : COLORS.lower
  }
  if (view === 'risk') {
    const score = peakVulnerability(route.signal?.vulnerability, leadBucket)?.vulnerability_score
    if (route.alerts?.some((alert) => alert.severity === 'Escalate') || (score != null && score >= 70)) return COLORS.risk
    if ((route.alerts?.length ?? 0) > 0 || (score != null && score >= 25)) return COLORS.watch
    if (route.alerts === null || score == null) return COLORS.missing
    return COLORS.stable
  }
  return pressure(route).color
}

// Regional Mercator projection, shared by country geometry, airport points,
// paths and mini-maps. The map is geographic context, not official boundaries.
export function project(lon: number, lat: number): [number, number] {
  const mercator = (value: number) => Math.log(Math.tan(Math.PI / 4 + value * Math.PI / 360)) * 180 / Math.PI
  return [75 + (lon - 66) * 18, 32 + (mercator(37) - mercator(lat)) * 16.4]
}
export function arc(route: string) {
  const [origin, destination] = endpoints(route)
  const from = AIRPORTS[origin], to = AIRPORTS[destination]
  const [x1, y1] = project(from.lon, from.lat), [x2, y2] = project(to.lon, to.lat)
  const length = Math.hypot(x2 - x1, y2 - y1)
  const bend = Math.min(74, Math.max(24, length * 0.23))
  const cx = (x1 + x2) / 2 - (y2 - y1) / length * bend
  const cy = (y1 + y2) / 2 + (x2 - x1) / length * bend
  return { path: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, midpoint: [(x1 + 2 * cx + x2) / 4, (y1 + 2 * cy + y2) / 4] as [number, number] }
}

/** RFC 4180 parser for the app's existing source-isolated CSV export. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++ } else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(field); field = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ''
    } else field += char
  }
  if (quoted) throw new Error('Route export is malformed.')
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

export type FareHistory = { series: { date: string; value: number }[]; providers: string[]; count: number }
export function summarizeExport(text: string, expectedSource: Source): FareHistory {
  const [header = [], ...rows] = parseCsv(text)
  const sourceIndex = header.indexOf('source_type'), providerIndex = header.indexOf('provider')
  const priceIndex = header.indexOf('total_fare'), dateIndex = header.indexOf('quote_date')
  if (sourceIndex < 0 || priceIndex < 0 || dateIndex < 0) throw new Error('Route export is malformed.')
  const byDate = new Map<string, { sum: number; count: number }>()
  const providers = new Set<string>()
  let count = 0
  for (const row of rows) {
    if (row[sourceIndex] !== expectedSource) throw new Error('Analysis source changed. Refresh route intelligence.')
    const price = Number(row[priceIndex]), date = row[dateIndex]
    if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) continue
    const point = byDate.get(date) ?? { sum: 0, count: 0 }
    byDate.set(date, { sum: point.sum + price, count: point.count + 1 })
    if (row[providerIndex]) providers.add(row[providerIndex])
    count++
  }
  return { providers: [...providers], count, series: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, point]) => ({ date, value: Math.round(point.sum / point.count * 100) / 100 })) }
}

export async function fetchFareHistory(route: string, filters: MapFilters, source: Source, signal: AbortSignal) {
  const [origin, destination] = endpoints(route)
  const response = await fetch(apiUrl(`/api/export/observations.csv${qs({ origin, destination, airline: filters.airline, fare_class: filters.fareClass, lead_bucket: filters.leadBucket })}`), { signal })
  if (!response.ok) throw new Error('Route fare history is unavailable.')
  return summarizeExport(await response.text(), source)
}
