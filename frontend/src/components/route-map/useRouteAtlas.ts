import { useCallback, useEffect, useState } from 'react'
import { api, type AnalysisSourceState, type CompareRow, type FilterOptions, type RouteCompetition, type Spike } from '../../api'
import { endpoints, isMappedRoute, ROUTES, type MapFilters, type RouteSignal } from './data'
import { selectMajorRoutes } from './majorRoutes'

type ProviderStatus = Awaited<ReturnType<typeof api.providerStatus>>
type Snapshot = {
  key: string; source: AnalysisSourceState; options: FilterOptions; provider: ProviderStatus | null
  quotes: CompareRow[]; alerts: Spike[] | null; competition: RouteCompetition[]; errors: string[]
}
type Signals = { key: string; routes: Record<string, RouteSignal> }

// Bounded background fan-out; stops scheduling stale requests when filters or
// the active source change. The map shell stays interactive while signals load.
async function pool<T, R>(items: readonly T[], work: (item: T) => Promise<R>, cancelled: () => boolean) {
  let next = 0
  const output: R[] = []
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length && !cancelled()) {
      const index = next++
      output[index] = await work(items[index])
    }
  }))
  return output
}

export function useRouteAtlas(filters: MapFilters, focusRoute: string, majorOnly = false) {
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [signals, setSignals] = useState<Signals | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const key = JSON.stringify([filters.airline, filters.fareClass, filters.leadBucket, revision])
  useEffect(() => {
    window.addEventListener('farepulse-data-changed', refresh)
    return () => window.removeEventListener('farepulse-data-changed', refresh)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const source = await api.analysisSource()
      const [options, comparisons, alerts, competition, provider] = await Promise.allSettled([
        api.filters(), api.compare({ dimension: 'route', airline: filters.airline, fare_class: filters.fareClass, lead_bucket: filters.leadBucket }),
        api.spikes(3.5), api.competition(), api.providerStatus(),
      ])
      if (cancelled) return
      if (options.status === 'rejected' || comparisons.status === 'rejected') throw new Error('Route data could not be loaded. Retry the connection.')
      const quotes = comparisons.value.rows
      const confirmed = await api.analysisSource()
      if (confirmed.active_analysis_source !== source.active_analysis_source || options.value.active_source_type !== source.active_analysis_source) throw new Error('Analysis source changed during loading. Refresh to inspect one consistent source.')
      if (cancelled) return
      const errors = [alerts.status === 'rejected' ? 'Alert data unavailable.' : '', competition.status === 'rejected' ? 'Competition context unavailable.' : '', provider.status === 'rejected' ? 'Provider readiness unavailable.' : ''].filter(Boolean)
      setSnapshot({ key, source, options: options.value, quotes,
        alerts: alerts.status === 'fulfilled' ? alerts.value.flagged : null,
        competition: competition.status === 'fulfilled' ? competition.value.routes : [],
        provider: provider.status === 'fulfilled' ? provider.value : null, errors,
      })

    }
    run().catch((error: Error) => { if (!cancelled) setFailure({ key, message: error.message }) })
    return () => { cancelled = true }
  }, [key, filters.airline, filters.fareClass, filters.leadBucket])

  useEffect(() => {
    if (snapshot?.key !== key) return
    let cancelled = false
    const available = snapshot.source.active_analysis_source === 'demo'
      ? [...ROUTES] : snapshot.options.routes.filter(isMappedRoute)
    const visible = majorOnly ? selectMajorRoutes(available) : available
    const route = visible.includes(focusRoute) ? focusRoute : visible[0]
    if (!route) return
    const [origin, destination] = endpoints(route)
    const params = { origin, destination, airline: filters.airline || undefined, fare_class: filters.fareClass || undefined }
    pool([route], async () => {
      const [trend, vulnerability] = await Promise.allSettled([
        api.trends({ ...params, lead_bucket: filters.leadBucket || undefined }), api.vulnerability(params),
      ])
      const after = await api.analysisSource()
      if (!cancelled && after.active_analysis_source === snapshot.source.active_analysis_source) {
        setSignals(previous => ({ key, routes: { ...(previous?.key === key ? previous.routes : {}), [route]: {
          trends: trend.status === 'fulfilled' ? trend.value : undefined,
          vulnerability: vulnerability.status === 'fulfilled' ? vulnerability.value.buckets : undefined,
          errors: [trend.status === 'rejected' ? 'Coverage unavailable.' : '', vulnerability.status === 'rejected' ? 'Vulnerability unavailable.' : ''].filter(Boolean),
        } } }))
      }
    }, () => cancelled).catch(() => {})
    return () => { cancelled = true }
  }, [snapshot, key, focusRoute, majorOnly, filters.airline, filters.fareClass, filters.leadBucket])

  return {
    snapshot: snapshot?.key === key && failure?.key !== key ? snapshot : null,
    signals: signals?.key === key ? signals.routes : {},
    error: failure?.key === key ? failure.message : '',
    loading: snapshot?.key !== key && failure?.key !== key,
    key, refresh,
  }
}
