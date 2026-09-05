import './route-atlas.css'
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { AIRPORTS } from './data'

export default function NetworkCoverage({ controls = false, onRefresh }: { controls?: boolean; onRefresh?: () => void }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.networkStatus>> | null>(null)
  const [error, setError] = useState('')
  const [origin, setOrigin] = useState('DEL'), [destination, setDestination] = useState('BOM'), [days, setDays] = useState(7)
  useEffect(() => {
    let cancelled = false, previousAccepted = -1
    let lastRefresh = 0
    const poll = async () => {
      try {
        const next = await api.networkStatus()
        if (cancelled) return
        setStatus(next); setError('')
        if (next.accepted !== previousAccepted && Date.now() - lastRefresh > 15000) {
          if (previousAccepted !== -1) onRefresh?.()
          previousAccepted = next.accepted; lastRefresh = Date.now()
        }
      } catch { if (!cancelled) setError('Network fetch status is temporarily unavailable.') }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [onRefresh])
  const start = async (scope: 'india' | 'route' | 'failed') => {
    try { setError(''); setStatus(await api.startNetwork({ scope, lead_days: days, origin, destination })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to start live search.') }
  }
  return <div className="network-coverage" aria-label="Live network coverage">
    <div><strong>Live India network</strong><span>{status?.state === 'running' ? `Fetching ${status.completed} / ${status.total} route searches` : status?.state === 'complete' ? `Search complete · ${status.completed} routes checked` : status?.state === 'blocked' ? 'Provider account blocked further searches' : 'Live snapshots only'}</span></div>
    {status && status.total > 0 && <><progress value={status.completed} max={status.total}/><p>{status.accepted.toLocaleString('en-IN')} new itineraries stored · {status.empty_routes} routes returned no fares · {status.errors} errors · travel {status.departure_date}</p></>}
    {controls && <><p>Search 234 planned directions across a catalog of 116 Indian airports, or choose any airport pair. This checks availability; it does not establish a complete national flight schedule. Maximum 1,000 returned offers per route; each search uses provider quota.</p><div className="network-search-controls"><label>Origin<select value={origin} onChange={e=>setOrigin(e.target.value)}>{Object.entries(AIRPORTS).map(([code,a])=><option key={code} value={code}>{code} · {a.city}</option>)}</select></label><label>Destination<select value={destination} onChange={e=>setDestination(e.target.value)}>{Object.entries(AIRPORTS).map(([code,a])=><option key={code} value={code}>{code} · {a.city}</option>)}</select></label><label>Travel in days<input type="number" min="1" max="330" value={days} onChange={e=>setDays(Number(e.target.value))}/></label></div><div className="network-search-buttons"><button disabled={status?.state==='running' || origin===destination || days<1 || days>330} onClick={()=>void start('route')}>Fetch selected route</button><button disabled={status?.state==='running' || days<1 || days>330} onClick={()=>void start('india')}>Fetch nationwide network</button>{!!status?.errors && <button disabled={status.state === 'running'} onClick={() => void start('failed')}>Retry failed routes</button>}</div></>}
    {error && <p role="status">{error}</p>}
  </div>
}
