import LiveFlights from './LiveFlights'
import { useEffect, useState } from 'react'
import { ArrowUpRight, ChevronRight, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, formatINR } from '../../api'
import { AIRPORTS, endpoints, fetchFareHistory, peakVulnerability, percent, pressure, type FareHistory, type MapFilters, type RouteModel, type Source } from './data'

function Spark({ values, labels, label }: { values: number[]; labels: string[]; label: string }) {
  if (!values.length) return <p className="atlas-muted">No series available for this selection.</p>
  const min = Math.min(...values), span = Math.max(...values) - min || 1
  const points = values.map((value, i) => [8 + i / Math.max(1, values.length - 1) * 274, 62 - (value - min) / span * 48])
  return <div className="atlas-spark"><svg viewBox="0 0 290 76" role="img" aria-label={label}>
    <path d="M8 63H282M8 35H282" stroke="#dae2dd" strokeDasharray="3 4"/>
    <path d={`M${points.map((p) => p.join(',')).join('L')} L${points.at(-1)?.[0]},70 L8,70Z`} fill="#3b8a7420"/>
    <polyline points={points.map((p) => p.join(',')).join(' ')} stroke="#26705e" strokeWidth="2" fill="none" strokeLinejoin="round"/>
    {points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={values.length > 15 ? 2 : 3} fill="#26705e"><title>{labels[index]}: {formatINR(values[index])}</title></circle>)}
  </svg><div className="atlas-spark-range"><span>{labels[0]}</span><span>{labels.length > 1 ? labels.at(-1) : 'Single observation date'}</span></div></div>
}

export default function RouteIntelligence({ model, filters, source, dataKey }: { model: RouteModel; filters: MapFilters; source: Source | null; dataKey: string }) {
  const [flightsOpen, setFlightsOpen] = useState(false)
  const [extra, setExtra] = useState<{ key: string; history: FareHistory | null; carriers: Awaited<ReturnType<typeof api.headToHead>>['airlines']; errors: string[] } | null>(null)
  const key = `${dataKey}:${model.route}:${source}`
  useEffect(() => {
    if (!source || !model.quote) return
    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    Promise.allSettled([
      fetchFareHistory(model.route, { airline: filters.airline, fareClass: filters.fareClass, leadBucket: filters.leadBucket }, source, controller.signal),
      api.headToHead(model.route, filters.fareClass || undefined, filters.leadBucket || undefined),
    ]).then(async ([history, carriers]) => {
      const confirmed = await api.analysisSource()
      if (cancelled || confirmed.active_analysis_source !== source) return
      setExtra({ key, history: history.status === 'fulfilled' ? history.value : null,
        carriers: carriers.status === 'fulfilled' ? carriers.value.airlines.filter((item) => !filters.airline || item.airline === filters.airline) : [],
        errors: [history.status === 'rejected' ? 'Fare history and provider provenance unavailable.' : '', carriers.status === 'rejected' ? 'Airline movement unavailable.' : ''].filter(Boolean),
      })
    }).catch(() => { if (!cancelled) setExtra({ key, history: null, carriers: [], errors: ['Source verification unavailable.'] }) })
    return () => { cancelled = true; clearTimeout(timeout); controller.abort() }
  }, [key, model.route, model.quote, source, filters.airline, filters.fareClass, filters.leadBucket])
  const detail = extra?.key === key ? extra : null
  const [origin, destination] = endpoints(model.route), quote = model.quote
  const score = peakVulnerability(model.signal?.vulnerability, filters.leadBucket)
  const latest = model.signal?.trends?.series.at(-1)
  const lead = model.signal?.trends?.lead_time_curve ?? []
  return <aside className="route-intelligence" aria-label="Selected route intelligence">
    <div className="atlas-panel-heading"><span>SELECTED ROUTE</span><ArrowUpRight size={17}/></div>
    <div className="atlas-route-title"><h3>{origin}<span>→</span>{destination}</h3><span style={{ color: pressure(model).color }} className="atlas-pressure">{model.signal?.trends?.series.length === 1 ? 'Baseline only' : pressure(model).label}</span></div>
    <p className="atlas-cities">{AIRPORTS[origin].city} to {AIRPORTS[destination].city}</p>
    {!quote ? <div className="atlas-no-route"><ShieldCheck size={28}/><h4>No matching observations</h4><p>Adjust your filters or add data in Admin.</p><Link to="/admin">Open data administration <ChevronRight size={14}/></Link></div> : <>
      <div className="atlas-primary-fare"><span>AVERAGE FARE</span><strong>{formatINR(quote.avg_fare)}</strong><small>{quote.observation_count.toLocaleString('en-IN')} observed quotes</small></div>
      <dl className="atlas-stat-grid"><div><dt>Median</dt><dd>{formatINR(quote.median_fare)}</dd></div><div><dt>Min / max</dt><dd>{formatINR(quote.min_fare)} / {formatINR(quote.max_fare)}</dd></div></dl>
      {source === 'live' && <p className="atlas-provider">Provider: {detail ? detail.history?.providers.join(', ') || 'Unverified' : 'Checking…'}</p>}
      {source === 'live' && <details className="atlas-disclosure atlas-flight-disclosure" open={flightsOpen} onToggle={event => setFlightsOpen(event.currentTarget.open)}>
        <summary>View flight quotes <span>{quote.observation_count.toLocaleString('en-IN')}</span></summary>
        {flightsOpen && <LiveFlights key={`${model.route}:${filters.airline}:${filters.fareClass}:${filters.leadBucket}`} route={model.route} filters={filters} dataKey={dataKey}/>}
      </details>}
      <details className="atlas-disclosure atlas-route-analysis">
        <summary>Route analysis</summary>
        <dl className="atlas-stat-grid"><div><dt>Latest APIx</dt><dd>{quote.apix_value?.toFixed(2) ?? '—'}</dd></div><div><dt>Index change</dt><dd>{percent(quote.change_pct)}</dd></div></dl>
        <p className="atlas-muted">Backend route index · selected filters.</p>
        {model.signal?.trends?.series.length === 1 && <p className="atlas-muted">One observation period. A fare trend is not established yet.</p>}
        <div className={`atlas-quality quality-${latest?.quality_flag?.toLowerCase() ?? 'unknown'}`}><ShieldCheck size={15}/><span>{latest ? latest.quality_flag.replaceAll('_', ' ') : model.signal ? 'Index coverage unavailable' : 'Checking coverage…'}{latest && ` · ${latest.coverage_pct.toFixed(0)}% coverage`}</span></div>
      <section className="atlas-detail-section"><div className="atlas-section-title"><h4>Fare trajectory</h4><span>INR · daily mean</span></div>{!detail ? <div className="atlas-mini-loading" aria-label="Loading fare trajectory"/> : <Spark values={detail.history?.series.map((p) => p.value) ?? []} labels={detail.history?.series.map((p) => p.date) ?? []} label="Daily average observed fare"/>}</section>
      <section className="atlas-detail-section"><div className="atlas-section-title"><h4>Booking horizon</h4><span>Mean fare by lead time</span></div><Spark values={lead.map((p) => p.avg_fare)} labels={lead.map((p) => p.label)} label="Lead-time fare curve"/></section>
      <section className="atlas-detail-section"><div className="atlas-section-title"><h4>Airline movement</h4><span>Index points</span></div>{detail?.carriers.length ? [...detail.carriers].sort((a, b) => Math.abs(b.index_change) - Math.abs(a.index_change)).slice(0, 3).map((carrier) => <div className="atlas-carrier" key={carrier.airline}><span>{carrier.airline}</span><span>{formatINR(carrier.avg_fare)}</span><b>{carrier.index_change > 0 ? '+' : ''}{carrier.index_change.toFixed(2)}</b></div>) : <p className="atlas-muted">{detail ? 'No airline movement available.' : 'Loading airline movement…'}</p>}<p className="atlas-muted">Unweighted Jevons · ranked by absolute change.</p></section>
      <section className="atlas-detail-section atlas-risk-pair"><div><span>COMPETITION PROXY</span><strong>{model.competition ? model.competition.hhi.toFixed(2) : '—'}</strong><p>{model.competition?.carrier_count ?? '—'} observed carriers · HHI</p></div><div><span>VULNERABILITY</span><strong>{score?.vulnerability_score.toFixed(1) ?? '—'}<small>/100</small></strong><p>{score ? `${score.vulnerability_label} · ${score.label}` : model.signal ? 'Unavailable' : 'Loading…'}</p></div></section>
      <p className="atlas-muted">HHI uses the whole active route, without map filters; observation shares are not market shares. Vulnerability is {filters.leadBucket ? 'the selected' : 'the peak'} booking-bucket heuristic, not a prediction.</p>
      <section className="atlas-detail-section"><div className="atlas-section-title"><h4>Alert evidence</h4><Link to="/spikes">Investigate <ArrowUpRight size={12}/></Link></div>{model.alerts === null ? <p className="atlas-muted">Alert evidence unavailable.</p> : <><p className="atlas-alert-count">{model.alerts.length} flagged observations</p>{model.alerts.slice(0, 2).map((alert) => <div className="atlas-alert" key={alert.observation_id}><b>{alert.severity} · {alert.airline}</b><span>{alert.quote_date} · {alert.direction} · {formatINR(alert.total_fare)}</span></div>)}<p className="atlas-muted">Existing detector results filtered to this cohort; alerts can include fare drops.</p></>}</section>
      </details>
      {[...(detail?.errors ?? []), ...(model.signal?.errors ?? [])].map((error) => <p role="status" className="atlas-error" key={error}>{error}</p>)}
    </>}
  </aside>
}
