import { useEffect, useState } from 'react'
import { api, formatINR } from '../../api'
import { endpoints, type MapFilters } from './data'

export default function LiveFlights({ route, filters, dataKey }: { route: string; filters: MapFilters; dataKey: string }) {
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<{ key: string; data: Awaited<ReturnType<typeof api.liveItineraries>> } | null>(null)
  const [failure, setFailure] = useState('')
  const key = JSON.stringify([route, filters.airline, filters.fareClass, filters.leadBucket, page, dataKey])
  useEffect(() => {
    let cancelled = false
    const [origin, destination] = endpoints(route)
    api.liveItineraries({ origin, destination, airline: filters.airline, fare_class: filters.fareClass, lead_bucket: filters.leadBucket, offset: page * 10, limit: 10 })
      .then(data => { if (!cancelled) { setResult({ key, data }); setFailure('') } })
      .catch(() => { if (!cancelled) setFailure('Individual live quotes are temporarily unavailable.') })
    return () => { cancelled = true }
  }, [key, route, filters.airline, filters.fareClass, filters.leadBucket, page])
  const current = result?.key === key ? result.data : null
  return <section className="atlas-detail-section live-flight-list" aria-label="Individual live flight quotes">
    <div className="atlas-section-title"><h4>Individual flight quotes</h4><span>{current?.total ?? '…'} itineraries</span></div>
    <p className="atlas-muted">One adult · economy · INR · prices may change.</p>
    {failure && <p role="status" className="atlas-error">{failure}</p>}
    {!current && !failure && <div className="atlas-mini-loading"/>}
    {current?.rows.map(row => <article key={row.id} className="live-flight-row"><div><strong>{row.flight_number || row.airline}</strong><b>{formatINR(row.total_fare)}</b></div><p>{row.departure_time?.replace('T', ' ') || row.travel_date}{row.arrival_time && ` → ${row.arrival_time.slice(11, 16)}`} · local time</p><small>{row.provider} · {row.price_status === 'verified' ? 'Provider-verified quote' : row.price_status === 'unverified' ? 'Unverified price hint' : 'Verification status unavailable'}</small><small>Observed {row.created_at} UTC</small></article>)}
    {current && current.total === 0 && <p className="atlas-muted">No live itineraries match this selection.</p>}
    {(page > 0 || (current?.total ?? 0) > 10) && <div className="live-flight-pages"><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1} / {Math.ceil((current?.total ?? 0) / 10) || '…'}</span><button disabled={!current || (page + 1) * 10 >= current.total} onClick={() => setPage(value => value + 1)}>Next flights</button></div>}
    <p className="atlas-muted">Tax breakdowns are estimates, not an airline invoice.</p>
  </section>
}
