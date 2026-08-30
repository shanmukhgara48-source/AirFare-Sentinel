import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  formatINR,
  type Batch,
  type IngestResult,
  type LiveFetchResult,
  type LiveFetchStatus,
  type ObservationRow,
} from '../api'
import { Button, Card, ErrorNote, Pill, StatTile } from '../components/ui'

const PAGE_SIZE = 25

function LiveFetchCard({
  status,
  liveResult,
  busy,
  onFetch,
}: {
  status: LiveFetchStatus | null
  liveResult: LiveFetchResult | null
  busy: string
  onFetch: (quick: boolean) => void
}) {
  const isConfigured = status?.live_provider_configured ?? false
  const isEnabled = status?.live_fetch_enabled ?? false
  const lastResult = liveResult ?? (status?.has_result ? status : null)

  return (
    <Card
      title="Live fare fetch"
      subtitle="Credential-gated provider ingestion; disabled while Demo Mode is active"
      action={
        isEnabled ? (
          <Pill tone="ok">Provider active: {status?.active_provider}</Pill>
        ) : isConfigured ? (
          <Pill tone="warn">Provider ready · Demo Mode</Pill>
        ) : (
          <Pill tone="warn">No live provider</Pill>
        )
      }
    >
      {isEnabled ? (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            Fetches fare quotes observed <strong>today</strong> for travel at T+1, T+7, T+15, T+30,
            and T+45. Each quote is a snapshot — not a guaranteed price or forecast.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => onFetch(false)} disabled={busy !== ''}>
              {busy === 'live' ? 'Fetching…' : 'Fetch all routes'}
            </Button>
            <Button variant="secondary" onClick={() => onFetch(true)} disabled={busy !== ''}>
              {busy === 'live' ? 'Fetching…' : 'Quick fetch (6 trunk routes)'}
            </Button>
          </div>
          {lastResult && 'fetched_at' in lastResult && (
            <div className="mt-5 space-y-3">
              <p className="text-[11.5px] text-muted">
                Last fetch: {(lastResult as LiveFetchResult).fetched_at} ·{' '}
                {(lastResult as LiveFetchResult).api_calls} API calls ·{' '}
                {(lastResult as LiveFetchResult).api_errors} errors
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatTile label="Raw quotes" value={String((lastResult as LiveFetchResult).raw_quotes)} />
                <StatTile label="Accepted" value={String((lastResult as LiveFetchResult).accepted_count)} />
                <StatTile
                  label="Quarantined"
                  value={String((lastResult as LiveFetchResult).quarantined_count)}
                  tone={(lastResult as LiveFetchResult).quarantined_count > 0 ? 'alert' : 'default'}
                />
              </div>
              {(lastResult as LiveFetchResult).fetch_errors?.length > 0 && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-muted">
                    {(lastResult as LiveFetchResult).fetch_errors.length} route error(s)
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted">
                    {(lastResult as LiveFetchResult).fetch_errors.map((e, i) => (
                      <li key={i}>{e.route} +{e.lead_days}d — {e.error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-muted">
            {isConfigured
              ? 'Provider credentials are ready, but live calls are disabled while Demo Mode is active.'
              : 'No live fare provider credentials are configured. To enable live ingestion later:'}
          </p>
          <ol className="list-decimal pl-5 text-[13px] leading-loose text-muted">
            <li>Register at <span className="font-mono text-[12px]">developers.amadeus.com</span> (free)</li>
            <li>Create an app and copy the client ID and secret</li>
            <li>Add to <span className="font-mono text-[12px]">backend/.env</span>: <span className="font-mono text-[12px]">AMADEUS_CLIENT_ID=… AMADEUS_CLIENT_SECRET=…</span></li>
            <li>Set <span className="font-mono text-[12px]">DEMO_MODE=false</span> only when live ingestion is intended</li>
            <li>Restart the backend server and verify provider status</li>
          </ol>
          <p className="text-[11.5px] text-muted">
            Current dashboard data remains unchanged until a live fetch succeeds. Demo data is always available as fallback.
          </p>
        </div>
      )}
    </Card>
  )
}

export default function Admin() {
  const [result, setResult] = useState<IngestResult | null>(null)
  const [liveResult, setLiveResult] = useState<LiveFetchResult | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveFetchStatus | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [rows, setRows] = useState<ObservationRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [providerError, setProviderError] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(
    async (targetPage: number) => {
      try {
        const [b, o] = await Promise.all([
          api.batches(),
          api.observations(PAGE_SIZE, targetPage * PAGE_SIZE),
        ])
        setBatches(b.batches)
        setRows(o.rows)
        setTotal(o.total)
        setError('')
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.batches(),
      api.observations(PAGE_SIZE, page * PAGE_SIZE),
    ])
      .then(([b, o]) => {
        if (cancelled) return
        setBatches(b.batches)
        setRows(o.rows)
        setTotal(o.total)
        setError('')
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => { cancelled = true }
  }, [page])

  useEffect(() => {
    api.liveFetchStatus()
      .then((status) => {
        setLiveStatus(status)
        setProviderError('')
      })
      .catch((e: Error) => setProviderError(`Provider status is unavailable: ${e.message}`))
  }, [])

  const run = async (label: string, fn: () => Promise<IngestResult | { message: string }>) => {
    setBusy(label)
    setError('')
    try {
      const res = await fn()
      setResult('accepted_count' in res ? res : null)
      if (page === 0) await refresh(0)
      else setPage(0)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const handleFile = (file?: File | null) => {
    if (!file) return
    run('upload', () => api.upload(file))
  }

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[26px] leading-tight">Data &amp; Ingestion</h1>
        <p className="mt-1 text-[13px] text-muted">
          Load the bundled sample, or upload your own fare CSV and see exactly what passed
          validation and what did not.
        </p>
      </header>

      {error && <ErrorNote message={error} />}
      {providerError && <ErrorNote message={providerError} />}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Load sample dataset" subtitle="Resets the database, then loads the bundled demo file">
          <p className="text-[13px] leading-relaxed text-muted">
            About 23,558 synthetic observations across 14 Indian routes, 4 fictional carriers, 5
            booking lead-time buckets and 4 fare classes — including two deliberately injected
            fare events, one surge and one promotional collapse, so the alert engine has
            meaningful signals to catch in both directions.
          </p>
          <div className="mt-4">
            <Button onClick={() => run('sample', api.loadSample)} disabled={busy !== ''}>
              {busy === 'sample' ? 'Loading…' : 'Load sample data'}
            </Button>
          </div>
        </Card>

        <Card title="Upload fare CSV" subtitle="Validated row by row — nothing is silently dropped">
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              handleFile(e.dataTransfer.files?.[0])
            }}
            onClick={() => fileInput.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed
              px-4 py-7 text-center transition-colors ${
                dragging ? 'border-accent bg-accent-soft' : 'border-line bg-ground/50 hover:border-accent/50'
              }`}
          >
            <div className="text-[13px] font-medium">
              {busy === 'upload' ? 'Validating…' : 'Drop a CSV here, or click to choose'}
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-muted">
              origin, destination, airline, travel_date, quote_date, fare_class, base_fare,
              taxes_fees — lead_days, lead_bucket and total_fare are derived on ingest
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <div className="mt-4 flex justify-between">
            <a href="/api/export/observations.csv" download>
              <Button variant="secondary">Download current data</Button>
            </a>
            <Button
              variant="danger"
              disabled={busy !== ''}
              onClick={() => {
                if (window.confirm('This will permanently delete all loaded data. Continue?'))
                  run('clear', api.clearData)
              }}
            >
              Clear all data
            </Button>
          </div>
        </Card>
      </div>

      <LiveFetchCard
        status={liveStatus}
        liveResult={liveResult}
        busy={busy}
        onFetch={async (quick) => {
          setBusy('live')
          setError('')
          try {
            const res = await api.liveFetch(quick)
            setLiveResult(res)
            setLiveStatus(await api.liveFetchStatus())
            if (page === 0) await refresh(0)
            else setPage(0)
          } catch (e) {
            setError((e as Error).message)
          } finally {
            setBusy('')
          }
        }}
      />

      {result && (
        <Card
          title="Validation report"
          subtitle={`${result.filename} · batch ${result.batch_id}`}
          action={
            <Pill tone={result.quarantined_count > 0 ? 'warn' : 'ok'}>
              {result.quarantined_count > 0 ? 'Completed with rejects' : 'All rows accepted'}
            </Pill>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <StatTile label="Accepted" value={result.accepted_count.toLocaleString()} />
            <StatTile
              label="Quarantined"
              value={result.quarantined_count.toLocaleString()}
              tone={result.quarantined_count > 0 ? 'alert' : 'default'}
            />
          </div>

          {result.quarantined.length > 0 && (
            <div className="mt-5">
              <h3 className="text-[12px] font-semibold">Rejected rows</h3>
              <p className="mt-1 text-[11.5px] text-muted">
                Each row is kept with a named reason — never dropped silently.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-[12px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                      <th className="pb-2 font-semibold">Reason</th>
                      <th className="pb-2 font-semibold">Row</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.quarantined.map((q, i) => (
                      <tr key={i} className="border-b border-line/60 last:border-0">
                        <td className="py-1.5 pr-4">
                          <Pill tone="alert">{q.reject_reason.split(':')[0]}</Pill>
                        </td>
                        <td className="py-1.5 font-mono text-[11px] text-muted">{q.raw_row}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card title="Ingestion history">
        {batches.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted">No batches loaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Batch</th>
                  <th className="pb-2 font-semibold">File</th>
                  <th className="pb-2 font-semibold">Loaded at</th>
                  <th className="pb-2 text-right font-semibold">Accepted</th>
                  <th className="pb-2 text-right font-semibold">Quarantined</th>
                  <th className="pb-2 text-right font-semibold">Live rows</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batch_id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 font-mono text-[11.5px]">{b.batch_id}</td>
                    <td className="py-2 text-muted">{b.filename}</td>
                    <td className="py-2 tnum text-muted">{b.uploaded_at}</td>
                    <td className="py-2 text-right tnum">{b.accepted_count.toLocaleString()}</td>
                    <td className="py-2 text-right tnum">
                      {b.quarantined_count > 0 ? (
                        <span className="text-alert">{b.quarantined_count}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </td>
                    <td className="py-2 text-right tnum text-muted">
                      {b.live_rows.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Observations"
        subtitle={`${total.toLocaleString()} rows in the database`}
        action={
          maxPage > 0 ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                ← Prev
              </Button>
              <span className="tnum text-[12px] text-muted">
                {page + 1} / {maxPage + 1}
              </span>
              <Button
                variant="secondary"
                disabled={page >= maxPage}
                onClick={() => setPage((current) => current + 1)}
              >
                Next →
              </Button>
            </div>
          ) : null
        }
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted">
            No observations. Load the sample dataset above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-[12.5px] [&_th]:px-3 [&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  <th className="pb-2 font-semibold">Route</th>
                  <th className="pb-2 font-semibold">Carrier</th>
                  <th className="pb-2 font-semibold">Source</th>
                  <th className="pb-2 font-semibold">Class</th>
                  <th className="pb-2 font-semibold">Quote date</th>
                  <th className="pb-2 font-semibold">Travel date</th>
                  <th className="pb-2 font-semibold">Lead bucket</th>
                  <th className="pb-2 text-right font-semibold">Base</th>
                  <th className="pb-2 text-right font-semibold">Taxes</th>
                  <th className="pb-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-ground/60">
                    <td className="py-2 font-mono text-[12px]">
                      {r.origin}-{r.destination}
                    </td>
                    <td className="py-2 font-mono text-[12px]">{r.airline}</td>
                    <td className="py-2 whitespace-nowrap">
                      <Pill tone={r.source_type === 'live' ? 'ok' : r.source_type === 'demo' ? 'warn' : 'neutral'}>
                        {r.source_type === 'demo'
                          ? 'Demo · synthetic'
                          : r.source_type === 'live'
                            ? `Live · ${r.provider ?? 'provider'}`
                            : 'Imported CSV'}
                      </Pill>
                    </td>
                    <td className="py-2 text-[11.5px] text-muted">
                      {r.fare_class.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 tnum text-muted">{r.quote_date}</td>
                    <td className="py-2 tnum text-muted">{r.travel_date}</td>
                    <td className="py-2 whitespace-nowrap font-mono text-[11.5px] text-muted">
                      {r.lead_bucket}
                    </td>
                    <td className="py-2 text-right tnum text-muted">{formatINR(r.base_fare)}</td>
                    <td className="py-2 text-right tnum text-muted">{formatINR(r.taxes_fees)}</td>
                    <td className="py-2 text-right tnum font-medium">{formatINR(r.total_fare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
