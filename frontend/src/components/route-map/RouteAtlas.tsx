import { useEffect, useRef, useState } from 'react'
import { Crosshair, Layers3, Map, Pause, Play, Radar, RefreshCw, SlidersHorizontal, Table2, Wallet } from 'lucide-react'
import { api, formatClass, formatINR } from '../../api'
import NetworkCoverage from './NetworkCoverage'
import IndiaRouteMap from './IndiaRouteMap'
import RouteIntelligence from './RouteIntelligence'
import { useRouteAtlas } from './useRouteAtlas'
import { CAPACITY_SOURCE, LEADING_AIRLINES, MAJOR_ROUTE_LIMIT, selectMajorRoutes } from './majorRoutes'
import { arc, isMappedRoute, COLORS, peakVulnerability, percent, pressure, ROUTES, SOURCE_LABELS, type MapView, type RouteCode, type RouteModel, type Source } from './data'
import './route-atlas.css'

const VIEWS = [{ key: 'map', label: 'Map', icon: Map }, { key: 'table', label: 'Table', icon: Table2 }, { key: 'risk', label: 'Risk', icon: Radar }, { key: 'cost', label: 'Cost', icon: Wallet }] as const

export default function RouteAtlas() {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [majorOnly, setMajorOnly] = useState(true)
  const [airline, setAirline] = useState(''), [fareClass, setFareClass] = useState(''), [leadBucket, setLeadBucket] = useState('')
  const [routeFilter, setRouteFilter] = useState(''), [selection, setSelected] = useState<RouteCode>('DEL-BOM')
  const [view, setView] = useState<MapView>('map'), [focused, setFocused] = useState(false), [scan, setScan] = useState(false)
  const [motion, setMotion] = useState(true), [reduced, setReduced] = useState(false), [visible, setVisible] = useState(true)
  const [hovered, setHovered] = useState<RouteCode | null>(null), [switching, setSwitching] = useState(false), [sourceError, setSourceError] = useState('')
  const root = useRef<HTMLElement>(null)
  const filters = { airline, fareClass, leadBucket }
  const { snapshot, signals, key, error, loading, refresh } = useRouteAtlas(filters, selection, majorOnly)
  const source = snapshot?.source.active_analysis_source ?? null
  const allRouteCodes = source === 'demo' ? [...ROUTES] : (snapshot?.options.routes ?? []).filter(isMappedRoute)
  const routeCodes = majorOnly ? selectMajorRoutes(allRouteCodes) : allRouteCodes
  const selected = routeCodes.includes(selection) ? selection : routeCodes[0] ?? 'DEL-BOM'
  const routes: RouteModel[] = routeCodes.map((route) => ({ route, quote: snapshot?.quotes.find((row) => row.group === route),
    alerts: snapshot?.alerts ? snapshot.alerts.filter((alert) => alert.route === route && (!airline || alert.airline === airline) && (!fareClass || alert.fare_class === fareClass) && (!leadBucket || alert.lead_bucket === leadBucket)) : null,
    competition: snapshot?.competition.find((row) => row.route === route), signal: signals[route],
  }))
  const activeRouteFilter = routeCodes.includes(routeFilter) ? routeFilter : ''
  const displayed = routes.filter((route) => !activeRouteFilter || route.route === activeRouteFilter)
  const model = routes.find((route) => route.route === selected) ?? { route: selected, alerts: null }
  const preview = routes.find((route) => route.route === hovered)
  const paused = !motion || reduced || !visible
  const routeSequence = activeRouteFilter || routeCodes.join(',')
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(preference.matches)
    update(); preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    let intersecting = true
    const update = () => setVisible(intersecting && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update() })
    if (root.current) observer.observe(root.current)
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
  useEffect(() => {
    if (!scan || paused || loading || switching || !routeSequence) return
    const sequence = routeSequence.split(',') as RouteCode[]
    const timer = window.setInterval(() => setSelected((current) => sequence[(sequence.indexOf(current) + 1) % sequence.length]), 4500)
    return () => clearInterval(timer)
  }, [scan, paused, routeSequence, loading, switching])
  const select = (route: RouteCode) => { setSelected(route); setScan(false); setHovered(null) }
  const switchSource = async (next: Source) => {
    setSwitching(true); setSourceError(''); setScan(false)
    try {
      await api.selectAnalysisSource(next)
      window.dispatchEvent(new Event('farepulse-data-changed'))
    } catch { setSourceError('Could not change the analysis source. Your current selection has been retained.') }
    finally { setSwitching(false) }
  }
  const changeScope = (next: boolean) => {
    setMajorOnly(next); setRouteFilter(''); setScan(false); setHovered(null)
    const nextRoutes = next ? selectMajorRoutes(allRouteCodes) : allRouteCodes
    if (!nextRoutes.includes(selection) && nextRoutes[0]) setSelected(nextRoutes[0])
  }
  return <section ref={root} className={`route-atlas ${paused ? 'atlas-paused' : ''}`} aria-label="India route observatory" aria-busy={loading || switching}>
    <header className="atlas-header"><div><h2>Explore routes</h2><p>{majorOnly ? 'Major connections. Select a path to see fares.' : 'Full observed network. Select a path to see fares.'}</p></div><div className="atlas-network-count"><strong>{displayed.length}<span>/{allRouteCodes.length}</span></strong><small>ROUTES SHOWN</small></div></header>
    <div className="atlas-search-bar">
      <label>Route<select aria-label="Map route" value={activeRouteFilter} onChange={(event) => { setRouteFilter(event.target.value); if (event.target.value) select(event.target.value as RouteCode) }}><option value="">{majorOnly ? 'Major' : 'All'} routes ({routeCodes.length})</option>{routeCodes.map((route) => <option key={route}>{route}</option>)}</select></label>
      <div className="atlas-network-scope" role="group" aria-label="Map network scope"><button aria-pressed={majorOnly} onClick={() => changeScope(true)}>Major routes</button><button aria-pressed={!majorOnly} onClick={() => changeScope(false)}>All routes</button></div>
      <button aria-expanded={filtersOpen} aria-controls="atlas-advanced-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={14}/>{filtersOpen ? 'Hide filters' : 'Filters'}{[airline, fareClass, leadBucket].some(Boolean) && <span>{[airline, fareClass, leadBucket].filter(Boolean).length}</span>}</button>
    </div>
    <div id="atlas-advanced-filters" className={`atlas-controls ${filtersOpen ? 'filters-open' : ''}`} hidden={!filtersOpen}>
      <label>Map airline<select aria-label="Map airline" value={airline} onChange={(event) => setAirline(event.target.value)}><option value="">All airlines</option><optgroup label="Leading Indian carriers">{Object.entries(LEADING_AIRLINES).filter(([code]) => snapshot?.options.airlines.includes(code)).map(([code, name]) => <option key={code} value={code}>{name} · {code}</option>)}</optgroup><optgroup label="Other observed airlines">{snapshot?.options.airlines.filter(code => !LEADING_AIRLINES[code]).map(code => <option key={code}>{code}</option>)}</optgroup></select></label>
      <label>Map fare class<select aria-label="Map fare class" value={fareClass} onChange={(event) => setFareClass(event.target.value)}><option value="">All classes</option>{snapshot?.options.fare_classes.map((item) => <option value={item} key={item}>{formatClass(item)}</option>)}</select></label>
      <label>Map lead time<select aria-label="Map lead time" value={leadBucket} onChange={(event) => setLeadBucket(event.target.value)}><option value="">All booking horizons</option>{snapshot?.options.lead_buckets.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label>
      <label className="atlas-source-filter"><Layers3 size={11}/> Analysis source<select aria-label="Map analysis source" value={source ?? ''} disabled={!snapshot || switching} onChange={(event) => void switchSource(event.target.value as Source)}>{!source && <option value="">No active source</option>}{(snapshot?.source.live_only ? ['live'] as const : ['demo', 'imported', 'live'] as const).map((item) => <option key={item} value={item} disabled={!snapshot?.source.available_analysis_sources.includes(item)}>{SOURCE_LABELS[item]}</option>)}</select></label>
    </div>
    <div className="atlas-source-strip"><span className={`atlas-source-dot source-${source ?? 'none'}`}/><strong>{switching ? 'Changing source…' : source ? SOURCE_LABELS[source] : loading ? 'Verifying source…' : 'Source unavailable'}</strong><span>{source === 'demo' ? 'Synthetic data' : source === 'live' ? 'Selected routes & dates only' : source === 'imported' ? 'Uploaded data' : 'Provenance unverified'}</span></div>
    {(error || sourceError) && <div className="atlas-error" role="alert">{error || sourceError}<button onClick={refresh}><RefreshCw size={13}/> Retry</button></div>}
    {!!snapshot?.errors.length && <p className="atlas-partial" role="status">{snapshot.errors.join(' ')}</p>}
    <div className="atlas-workspace">
      <div className="atlas-map-column">
        <div className="atlas-map-toolbar"><div className="atlas-view-switch" aria-label="Route visualization">{VIEWS.map(({ key, label, icon: Icon }) => <button key={key} aria-pressed={view === key} onClick={() => setView(key)}><Icon size={14}/>{label}</button>)}</div><div className="atlas-map-actions"><button aria-label="Focus" onClick={() => setFocused(!focused)} aria-pressed={focused} title="Dim unrelated routes"><Crosshair size={15}/><span>Focus</span></button><button aria-label="Scan" onClick={() => setScan(!scan)} aria-pressed={scan} disabled={reduced || !motion || !!routeFilter} title={reduced ? 'Scan disabled for reduced motion' : 'Cycle through routes every 4.5 seconds'}>{scan ? <Pause size={14}/> : <Play size={14}/>}<span>Scan</span></button></div></div>
        <div className="atlas-map-stage">
          {view === 'table' ? <div className="atlas-table-wrap"><table className="atlas-table"><caption>Directional routes · {source ? SOURCE_LABELS[source] : 'Source unavailable'}</caption><thead><tr><th>Route</th><th>Mean fare</th><th>APIx</th><th>Change</th><th>Obs.</th></tr></thead><tbody>{displayed.map((route) => <tr key={route.route} className={selected === route.route ? 'selected' : ''}><th><button onClick={() => select(route.route)} aria-pressed={selected === route.route}>{route.route.replace('-', ' → ')}</button></th><td>{route.quote ? formatINR(route.quote.avg_fare) : 'No data'}</td><td>{route.quote?.apix_value?.toFixed(2) ?? '—'}</td><td>{percent(route.quote?.change_pct)}</td><td>{route.quote?.observation_count.toLocaleString('en-IN') ?? '—'}</td></tr>)}</tbody></table></div> : <>
            <IndiaRouteMap routes={displayed} selected={selected} onSelect={select} onHover={setHovered} focused={focused} paused={paused} view={view} leadBucket={leadBucket}/>
            <div className="atlas-map-caption"><span>INDIA / {view === 'risk' ? 'RISK SIGNALS' : view === 'cost' ? 'OBSERVED FARES' : 'FARE PRESSURE'}</span></div>
            <div className="atlas-map-readout" aria-live="polite"><span>{selected.replace('-', ' → ')}</span><strong>{view === 'risk' ? `${peakVulnerability(model.signal?.vulnerability, leadBucket)?.vulnerability_score.toFixed(1) ?? '—'} /100` : model.quote ? formatINR(model.quote.avg_fare) : 'No observations'}</strong><small>{view === 'risk' ? 'Vulnerability · heuristic' : 'Average observed fare'}</small></div>
            {preview && <div className="atlas-hover-card" role="tooltip"><b>{preview.route.replace('-', ' → ')}</b><span>{preview.quote ? `${formatINR(preview.quote.avg_fare)} mean · ${percent(preview.quote.change_pct)}` : 'No matching observations'}</span><small>{preview.quote?.observation_count.toLocaleString('en-IN') ?? 0} observations · {source ?? 'unknown source'}</small><small>Select path for full evidence →</small></div>}
          </>}
          {(loading || switching) && <div className="atlas-loading" role="status"><Radar size={30}/><strong>{switching ? 'Changing analysis source' : 'Reading the route network'}</strong><span>Checking observations and provenance…</span></div>}
        </div>
        <div className="atlas-map-footer"><div className="atlas-legend">{(view === 'cost' ? [[COLORS.lower, '< ₹7k'], [COLORS.stable, '₹7–10k'], [COLORS.watch, '₹10–15k'], [COLORS.risk, '≥ ₹15k']] : view === 'risk' ? [[COLORS.stable, 'Lower signal'], [COLORS.watch, 'Watch'], [COLORS.risk, 'Escalation']] : [[COLORS.lower, 'Easing'], [COLORS.stable, 'Stable'], [COLORS.watch, 'Watch'], [COLORS.risk, 'Escalation']]).map(([color, label]) => <span key={label}><i style={{ background: color }}/>{label}</span>)}<span><i style={{ background: COLORS.missing }}/>Unavailable</span></div><button className="atlas-motion" onClick={() => setMotion(!motion)} disabled={reduced} aria-pressed={!paused}>{paused ? <Play size={12}/> : <Pause size={12}/>} {reduced ? 'Reduced motion' : motion ? 'Pause motion' : 'Resume motion'}</button></div>
        <details className="atlas-route-browser"><summary>Browse routes <span>{displayed.length}</span></summary><div className="atlas-route-rail" aria-label="Choose a basket route">{displayed.map((route) => <button key={route.route} onClick={() => select(route.route)} aria-pressed={selected === route.route}><svg viewBox="80 120 450 500" aria-hidden="true"><path d={arc(route.route).path} fill="none" stroke={pressure(route).color} strokeWidth="12"/></svg><span>{route.route.replace('-', ' → ')}<small>{route.quote ? formatINR(route.quote.avg_fare) : 'No data'}</small></span></button>)}</div></details>
      </div>
      {loading || switching ? <aside className="route-intelligence atlas-panel-loading"><div className="atlas-mini-loading"/><p>Preparing route intelligence…</p></aside> : <RouteIntelligence model={model} source={source} filters={filters} dataKey={key}/>}
    </div>
    {majorOnly && !loading && routeCodes.length === 0 && <p className="atlas-partial">No major-route snapshots in this source. Choose All routes to explore the available data.</p>}
    <details className="atlas-method-note"><summary>Map guide &amp; limitations</summary><p>Major routes shows up to {MAJOR_ROUTE_LIMIT} observed directions, prioritizing <a href={CAPACITY_SOURCE} target="_blank" rel="noreferrer">OAG’s September 2026 busiest domestic corridors</a>, then a curated major-hub shortlist. It is not an official top-30 passenger ranking. Both directions count separately. All routes restores the full network; no observations are removed.</p><p>The airline selector lists IndiGo, Air India, Air India Express, Akasa Air and SpiceJet first, based on the same report’s capacity data. Fare statistics include all observed airlines unless an airline filter is selected.</p><p>Fares use only the selected source and filters. Coverage is limited to observed routes and dates; this is not a complete flight schedule. Aircraft show direction, not real-time positions.</p><p>Pressure: amber for upward alerts or index growth above 2%; red for escalations. Risk: amber for alerts or vulnerability ≥25; red for escalations or scores ≥70. Cost colors use average INR fares. These are monitoring aids, not forecasts or official thresholds. Competition describes the whole route. Missing values stay unavailable.</p></details>
    {source === 'live' && <details className="atlas-method-note"><summary>Collection status</summary><NetworkCoverage onRefresh={refresh}/></details>}
  </section>
}
