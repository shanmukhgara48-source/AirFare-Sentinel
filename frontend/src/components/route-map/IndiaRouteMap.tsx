import { useEffect, useRef } from 'react'
import geography from './geography.json'
import { AIRPORTS, arc, endpoints, project, routeColor, type MapView, type RouteCode, type RouteModel } from './data'

function polygonPath(coordinates: number[][][][] | number[][][], multi: boolean) {
  const polygons = multi ? coordinates as number[][][][] : [coordinates as number[][][]]
  return polygons.map((polygon) => polygon.map((ring) => ring.map(([lon, lat], index) => `${index ? 'L' : 'M'}${project(lon, lat).join(',')}`).join(' ') + 'Z').join(' ')).join(' ')
}
const land = geography.map((country) => ({ name: country.name, path: polygonPath(country.geometry.coordinates, country.geometry.type === 'MultiPolygon') }))

export default function IndiaRouteMap({ routes, selected, onSelect, onHover, focused, paused, view, leadBucket }: {
  routes: RouteModel[]; selected: RouteCode; onSelect: (route: RouteCode) => void; onHover: (route: RouteCode | null) => void
  focused: boolean; paused: boolean; view: MapView; leadBucket: string
}) {
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => { if (paused) svg.current?.pauseAnimations(); else svg.current?.unpauseAnimations() }, [paused])
  const activeAirports = endpoints(selected)
  return <svg ref={svg} className="india-route-map" viewBox="0 0 720 640" aria-label="Interactive India airfare route map. Select a flight path to inspect its data.">
    <defs>
      <linearGradient id="atlas-land" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#294749"/><stop offset="1" stopColor="#112c35"/></linearGradient>
      <radialGradient id="atlas-glow"><stop stopColor="#86debf" stopOpacity=".18"/><stop offset="1" stopColor="#86debf" stopOpacity="0"/></radialGradient>
      <pattern id="atlas-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#7bcbb9" strokeOpacity=".065"/></pattern>
      <linearGradient id="airframe"><stop stopColor="#fff"/><stop offset=".45" stopColor="#e4fff8"/><stop offset="1" stopColor="#79a7a7"/></linearGradient>
    </defs>
    <rect width="720" height="640" fill="url(#atlas-grid)"/>
    <ellipse cx="310" cy="320" rx="310" ry="310" fill="url(#atlas-glow)"/>
    <g className="atlas-land" aria-hidden="true">{land.map((country) => <path key={country.name} d={country.path} fill={country.name === 'India' ? 'url(#atlas-land)' : '#122932'} stroke={country.name === 'India' ? '#75968a' : '#29404a'} strokeWidth={country.name === 'India' ? 1.3 : .7}/>)}</g>
    <g className="atlas-radar" aria-hidden="true"><circle cx="300" cy="322" r="140"/><circle cx="300" cy="322" r="240"/><path d="M300 45V590M40 322H600"/></g>
    <text x="135" y="446" className="atlas-ocean">ARABIAN SEA</text><text x="465" y="448" className="atlas-ocean">BAY OF BENGAL</text>
    <text x="340" y="265" className="atlas-country">I N D I A</text>
    {routes.map((route) => {
      const active = route.route === selected, path = arc(route.route).path
      const color = routeColor(route, view, leadBucket)
      return <g key={route.route} className={`atlas-route ${active ? 'selected' : ''}`} opacity={focused && !active ? .07 : active ? 1 : routes.length > 40 ? .25 : .65}>
        {active && <path d={path} fill="none" stroke={color} strokeWidth="12" opacity=".10"/>}
        <path d={path} fill="none" stroke={color} strokeWidth={active ? 2.8 : route.quote && Math.abs(route.quote.change_pct ?? 0) > 2 ? 1.8 : 1.1} strokeDasharray={route.quote ? undefined : '4 7'}/>
        {active && route.quote && <path d={path} className="atlas-route-trail" fill="none" stroke="#efffdf" strokeWidth="1.3" strokeDasharray="4 24" opacity=".7" pointerEvents="none" aria-hidden="true"/>}
        <path d={path} className="atlas-route-hit" role="button" tabIndex={0} aria-label={`Inspect ${route.route}`} aria-pressed={active}
          onClick={() => onSelect(route.route)} onFocus={() => onHover(route.route)} onBlur={() => onHover(null)} onMouseEnter={() => onHover(route.route)} onMouseLeave={() => onHover(null)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(route.route) } }}/>
        {active && <g pointerEvents="none" aria-hidden="true">
          <path d="M14 0 Q12 -2 5 -2 L-4 -12 -7 -12 -3 -2 -10 -2 -14 -6 -16 -6 -14 0 -16 6 -14 6 -10 2 -3 2 -7 12 -4 12 5 2 Q12 2 14 0Z" fill="url(#airframe)" stroke="#c6fff1" strokeWidth=".4" className="atlas-aircraft"/>
          <animateMotion dur="7s" repeatCount="indefinite" path={path} rotate="auto"/>
        </g>}
      </g>
    })}
    {Object.entries(AIRPORTS).filter(([code]) => routes.some(route => endpoints(route.route).includes(code))).map(([code, airport]) => {
      const [x, y] = project(airport.lon, airport.lat), active = activeAirports.includes(code as typeof activeAirports[number])
      return <g key={code} transform={`translate(${x},${y})`} className={`atlas-airport ${active ? 'active' : ''}`} aria-hidden="true" pointerEvents="none">
        <circle r={active ? 13 : 8} fill="#76d4bc" opacity={active ? .13 : .05}/><circle r="4" fill={active ? '#bef5e5' : '#6a9999'} stroke="#112831" strokeWidth="2"/>
        <g opacity={active || routes.length <= 20 || (routes.length <= 30 && ['DEL', 'BOM', 'BLR', 'CCU', 'HYD', 'MAA'].includes(code)) ? 1 : 0} transform={`translate(${airport.label.join(',')})`}><text className="atlas-airport-code">{code}</text><text y="14" className="atlas-airport-city">{airport.city}</text></g>
      </g>
    })}
    <g transform="translate(654 66)" aria-hidden="true"><path d="M0 22V-12L-5 -3M0 -12L5 -3" stroke="#87a9a5" fill="none"/><text x="-4" y="-23" className="atlas-ocean">N</text></g>
    <text x="30" y="619" className="atlas-map-note">SCHEMATIC ROUTES · GEOGRAPHIC CONTEXT, NOT OFFICIAL BOUNDARIES</text>
  </svg>
}
