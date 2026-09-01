import { useEffect, useState } from 'react'
import { api } from '../api'
import { Card, ErrorNote, JudgePanel, Pill, Spinner } from '../components/ui'
import { useJudgeMode } from '../context/judgeModeContext'

// ─── Explicit prototype assumptions (calculation runs in the backend) ───────

const DEMAND_ELASTICITY   =  0.60
const FUEL_PASSTHROUGH    =  0.35
const CAPACITY_ELASTICITY = -0.50
const COMPETITION_SCALE   = 15.0
const BASELINE_CARRIERS   = 4

interface Scenario {
  demand: number     // -50 to +50 %
  fuel: number       // -50 to +50 %
  capacity: number   // -50 to +50 %
  carriers: number   // 1–8
  baselineApix: number
}

interface Projection {
  demandContrib: number
  fuelContrib: number
  capacityContrib: number
  competitionContrib: number
  projectedChange: number
  projectedApix: number
  exposureProxy: number
  risk: 'Low' | 'Watch' | 'Review' | 'Escalate'
  explanation: string
  modelMetadata: {
    model_status: string
    coefficient_basis: string
    citation_status: string
    valid_use: string
    invalid_uses: string[]
  }
}

// ─── Tone helpers ─────────────────────────────────────────────────────────────

const RISK_TONE: Record<string, 'ok' | 'warn' | 'alert' | 'escalate'> = {
  Low:      'ok',
  Watch:    'warn',
  Review:   'alert',
  Escalate: 'escalate',
}

const RISK_DESC: Record<string, string> = {
  Low:      'Small output under the prototype magnitude bands.',
  Watch:    'Moderate output under the prototype magnitude bands.',
  Review:   'Large output under the prototype magnitude bands.',
  Escalate: 'Very large output under the prototype magnitude bands.',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  note,
  neutral = 0,
  higherIsPressure = true,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format: (v: number) => string
  note?: string
  neutral?: number
  higherIsPressure?: boolean
}) {
  const pressure = (value - neutral) * (higherIsPressure ? 1 : -1)
  const valueColor = pressure === 0 ? 'text-muted' : pressure > 0 ? 'text-alert' : 'text-[#2a9174]'
  const accentColor = pressure > 0 ? '#e05c3a' : pressure < 0 ? '#2a9174' : '#94a3b8'

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="text-[12.5px] font-medium text-ink">{label}</label>
        <span
          className={`tnum text-[13px] font-semibold ${valueColor}`}
        >
          {format(value)}
        </span>
      </div>
      <input
        aria-label={label}
        data-testid={`whatif-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent cursor-pointer"
        style={{ accentColor }}
      />
      <div className="flex justify-between text-[10px] text-muted">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      {note && <p className="text-[11px] text-muted">{note}</p>}
    </div>
  )
}

function ContribRow({
  label,
  value,
  maxAbs,
  color,
}: {
  label: string
  value: number
  maxAbs: number
  color?: string
}) {
  const isPos = value >= 0
  const barPct = maxAbs > 0 ? Math.abs(value / maxAbs) * 44 : 0 // max 44% each side

  return (
    <tr className="border-b border-line last:border-0">
      <td className="w-[140px] py-2 pr-3 text-[12px] text-ink">{label}</td>
      <td className="w-[80px] py-2 pr-4 text-right tnum text-[12.5px] font-semibold">
        <span style={{ color: isPos ? '#c0392b' : '#2a9174' }}>
          {isPos ? '+' : ''}
          {value.toFixed(1)} pp
        </span>
      </td>
      <td className="py-2">
        {/* Diverging bar — center at 50% */}
        <div className="relative h-5 w-full min-w-[160px]">
          <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
          <div
            className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm opacity-80"
            style={{
              background: color ?? (isPos ? '#e05c3a' : '#2a9174'),
              left: isPos ? '50%' : `calc(50% - ${barPct}%)`,
              width: `${barPct}%`,
            }}
          />
        </div>
      </td>
    </tr>
  )
}

function ExposureBar({ score }: { score: number }) {
  const color =
    score >= 75 ? '#e05c3a' : score >= 45 ? '#d48a11' : score >= 20 ? '#0b6e6e' : '#2a9174'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted">
        <span>Scenario exposure proxy</span>
        <span className="tnum font-semibold text-ink">{score.toFixed(1)} / 100</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div
          style={{ width: `${score}%`, background: color }}
          className="h-full rounded-full transition-all duration-150"
        />
      </div>
    </div>
  )
}

// ─── Default scenario ─────────────────────────────────────────────────────────

const DEFAULT_SCENARIO: Scenario = {
  demand: 0,
  fuel: 0,
  capacity: 0,
  carriers: BASELINE_CARRIERS,
  baselineApix: 100,
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Whatif() {
  const [s, setS] = useState<Scenario>(DEFAULT_SCENARIO)
  const [showFormula, setShowFormula] = useState(false)
  const [defaultBaseline, setDefaultBaseline] = useState(DEFAULT_SCENARIO.baselineApix)
  const [projection, setProjection] = useState<{ key: string; value: Projection } | null>(null)
  const [error, setError] = useState('')
  const { judgeMode } = useJudgeMode()

  const scenarioKey = [s.demand, s.fuel, s.capacity, s.carriers, s.baselineApix].join('|')

  useEffect(() => {
    let cancelled = false
    api.overview('day').then((overview) => {
      if (cancelled || overview.empty || overview.headline_index == null) return
      setDefaultBaseline(overview.headline_index)
      setS((current) => current.baselineApix === DEFAULT_SCENARIO.baselineApix
        ? { ...current, baselineApix: overview.headline_index as number }
        : current)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.whatif({
      demand_change_pct: s.demand,
      fuel_change_pct: s.fuel,
      capacity_change_pct: s.capacity,
      carriers: s.carriers,
      baseline_apix: s.baselineApix,
    }).then((result) => {
      if (cancelled) return
      setProjection({
        key: scenarioKey,
        value: {
          demandContrib: result.demand_contribution,
          fuelContrib: result.fuel_contribution,
          capacityContrib: result.capacity_contribution,
          competitionContrib: result.competition_contribution,
          projectedChange: result.projected_change_pct,
          projectedApix: result.projected_apix,
          exposureProxy: result.exposure_proxy,
          risk: result.risk_level,
          explanation: result.explanation,
          modelMetadata: result.model_metadata,
        },
      })
      setError('')
    }).catch((e: Error) => {
      if (!cancelled) {
        setError(e.message)
      }
    })
    return () => { cancelled = true }
  }, [s, scenarioKey])

  const p = projection?.value ?? null
  if (!p) return error ? <ErrorNote message={error} /> : <Spinner label="Loading scenario model" />
  const showingPendingResult = projection?.key !== scenarioKey

  const allContribs = [
    Math.abs(p.demandContrib),
    Math.abs(p.fuelContrib),
    Math.abs(p.capacityContrib),
    Math.abs(p.competitionContrib),
    Math.abs(p.projectedChange),
  ]
  const maxAbs = Math.max(...allContribs, 1)

  function set(key: keyof Scenario) {
    return (v: number) => setS((prev) => ({ ...prev, [key]: v }))
  }

  const changeSign = p.projectedChange >= 0 ? '+' : ''

  // Identify the largest absolute driver for Judge Mode
  const drivers = [
    { name: 'passenger demand', value: p.demandContrib },
    { name: 'fuel costs', value: p.fuelContrib },
    { name: 'seat capacity', value: p.capacityContrib },
    { name: 'carrier competition', value: p.competitionContrib },
  ]
  const dominantDriver = drivers.reduce((a, b) => Math.abs(b.value) > Math.abs(a.value) ? b : a)

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-serif text-[26px] font-semibold tracking-tight text-ink">
              What-If Simulator
            </h1>
            <span className="rounded border border-[#f0dcbb] bg-[#fdf4e7] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-warn">
              Scenario planning tool
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            Explore a transparent formula using uncalibrated assumptions; this is not a forecast.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-2.5 text-[12px]">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted mb-0.5">Baseline</div>
          <span className="font-serif text-[18px] font-semibold text-ink tnum">{s.baselineApix.toFixed(2)}</span>
          <span className="text-muted ml-1.5">index</span>
        </div>
      </header>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[11.5px] leading-relaxed text-amber-900">
        <strong>Uncalibrated illustrative model.</strong> {p.modelMetadata.coefficient_basis}{' '}
        {p.modelMetadata.citation_status} Valid use: {p.modelMetadata.valid_use}
      </div>

      {error && <ErrorNote message={`Scenario recalculation failed: ${error}`} />}

      {/* ───────────────────────── JUDGE MODE ───────────────────────── */}
      {judgeMode && !showingPendingResult && (
        <JudgePanel items={[
          {
            q: 'What happened?',
            a: `Under this input set, the illustrative formula outputs ${changeSign}${p.projectedChange.toFixed(2)}% (from ${s.baselineApix.toFixed(2)} to ${p.projectedApix.toFixed(2)}). The ${p.risk} label is a team-defined magnitude band, not an empirical risk estimate.`,
          },
          {
            q: 'Why does it matter?',
            a: `Within the formula, the largest numerical contribution is ${dominantDriver.name} (${dominantDriver.value >= 0 ? '+' : ''}${dominantDriver.value.toFixed(1)} percentage points). That identifies sensitivity to an assumption; it does not identify a real-world cause or policy effect.`,
          },
          {
            q: 'How confident are we?',
            a: `Confidence is not estimated. The coefficients and magnitude bands are team-defined, uncalibrated assumptions with no claimed empirical source for these exact values. The exposure proxy (${p.exposureProxy.toFixed(0)}/100) is only |output| × 3 and contains no passenger data.`,
          },
          {
            q: 'What should an analyst do next?',
            a: `${
              Math.abs(p.projectedChange) < 0.5
                ? 'The scenario factors largely offset each other. Try varying individual inputs to understand which lever has the most effect — hold three constant and move one.'
                : `Vary one input at a time and record sensitivity. Do not use the output operationally until coefficients are cited, estimated on an appropriate dataset, and validated out of sample.`
            }`,
          },
        ]} />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* ── Left: inputs ──────────────────────────────────────────────── */}
        <div className="space-y-5">
          <Card title="Market factor inputs">
            <div className="space-y-6">
              <Slider
                label="Passenger demand change"
                value={s.demand}
                min={-50} max={50}
                onChange={set('demand')}
                format={(v) => (v >= 0 ? `+${v}%` : `${v}%`)}
                note="Formula assumption: +1% demand contributes +0.60 percentage points"
              />
              <Slider
                label="Jet fuel cost change"
                value={s.fuel}
                min={-50} max={50}
                onChange={set('fuel')}
                format={(v) => (v >= 0 ? `+${v}%` : `${v}%`)}
                note="Formula assumption: +1% fuel cost contributes +0.35 percentage points"
              />
              <Slider
                label="Seat capacity change"
                value={s.capacity}
                min={-50} max={50}
                onChange={set('capacity')}
                format={(v) => (v >= 0 ? `+${v}%` : `${v}%`)}
                note="Formula assumption: +1% capacity contributes −0.50 percentage points"
                higherIsPressure={false}
              />
              <Slider
                label="Active carriers in market"
                value={s.carriers}
                min={1} max={8} step={1}
                onChange={set('carriers')}
                format={(v) =>
                  v === BASELINE_CARRIERS
                    ? `${v} (baseline)`
                    : v === 1
                    ? '1 (monopoly)'
                    : String(v)
                }
                note={`Formula assumption: ${BASELINE_CARRIERS}-carrier baseline with a team-defined logarithmic adjustment.`}
                neutral={BASELINE_CARRIERS}
                higherIsPressure={false}
              />
              <Slider
                label="Baseline APIx value"
                value={s.baselineApix}
                min={80} max={130} step={0.01}
                onChange={set('baselineApix')}
                format={(v) => v.toFixed(2)}
                note={`Starting index level before applying the scenario (current dataset default: ${defaultBaseline.toFixed(2)})`}
              />
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                onClick={() => setS({ ...DEFAULT_SCENARIO, baselineApix: defaultBaseline })}
                className="rounded-md border border-line px-3 py-1.5 text-[12px] font-medium text-muted hover:bg-ground hover:text-ink transition-colors"
              >
                Reset to defaults
              </button>
              <span className="text-[11.5px] text-muted">
                {showingPendingResult ? 'Recalculating… controls remain available.' : 'Values update automatically — no submit needed.'}
              </span>
            </div>
          </Card>

          {/* Formula card */}
          <Card title="Formula transparency">
            <button
              onClick={() => setShowFormula((v) => !v)}
              className="flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
            >
              {showFormula ? '▲ Hide formula' : '▼ Show formula'}
            </button>

            {showFormula && (
              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-line bg-ground p-4 font-mono text-[11.5px] leading-relaxed text-ink">
                  <div className="text-muted">{'/* Projected index change */'}</div>
                  <div className="mt-1">
                    APIx Δ% = (0.60 × demand%) + (0.35 × fuel%) + (−0.50 × capacity%)
                  </div>
                  <div className="ml-9">+ 15 × ln(4 / max(1, carriers))</div>
                  <div className="mt-3 text-muted">{'/* With current inputs */'}</div>
                  <div className="mt-1">
                    = ({DEMAND_ELASTICITY} × {s.demand}%)
                    {' '}+ ({FUEL_PASSTHROUGH} × {s.fuel}%)
                    {' '}+ ({CAPACITY_ELASTICITY} × {s.capacity}%)
                  </div>
                  <div className="ml-5">
                    + {COMPETITION_SCALE} × ln({BASELINE_CARRIERS} / {Math.max(1, s.carriers)})
                  </div>
                  <div className="mt-1 border-t border-line pt-1">
                    = {p.demandContrib.toFixed(2)} + {p.fuelContrib.toFixed(2)} + {p.capacityContrib.toFixed(2)} + {p.competitionContrib.toFixed(2)}
                  </div>
                  <div className="font-semibold">
                    = {changeSign}{p.projectedChange.toFixed(2)} pp
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11.5px]">
                  {[
                    ['0.60', 'Demand elasticity', 'Illustrative prototype assumption: higher demand creates upward fare pressure.'],
                    ['0.35', 'Fuel pass-through', 'Illustrative prototype assumption for the share of fuel-cost movement passed into fares.'],
                    ['−0.50', 'Capacity elasticity', 'Illustrative prototype assumption: more seats reduce fare pressure.'],
                    ['15 × ln(4/n)', 'Competition adj.', 'Explicit log-scale prototype assumption calibrated to a four-carrier baseline.'],
                  ].map(([coeff, name, desc]) => (
                    <div key={name} className="rounded-md border border-line p-3">
                      <div className="font-mono text-[12px] font-semibold text-accent">{coeff}</div>
                      <div className="mt-0.5 text-[11px] font-medium text-ink">{name}</div>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-muted">{desc}</p>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] leading-relaxed text-muted">
                  Exposure proxy = min(100, |Δ%| × 3). It is a display scale with no passenger data.
                  Magnitude bands: &lt;5% Low · 5–15% Watch · 15–30% Review · ≥30% Escalate.
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* ── Right: outputs ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Hero: big projected change number */}
          <div
            className="rounded-lg overflow-hidden border"
            style={{
              borderColor: p.projectedChange > 0 ? '#f4d3c2' : p.projectedChange < 0 ? '#86efac' : '#dde3ec',
              background: p.projectedChange > 0
                ? 'linear-gradient(135deg, #fff5f0 0%, #fff 60%)'
                : p.projectedChange < 0
                ? 'linear-gradient(135deg, #f0fdf4 0%, #fff 60%)'
                : '#fff',
            }}
          >
            <div className="px-6 pt-5 pb-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted mb-2">
                Projected index change
              </div>
              <div
                data-testid="whatif-projected-change"
                className="font-serif text-[52px] font-semibold leading-none tnum"
                style={{
                  color: p.projectedChange > 0 ? '#c2410c' : p.projectedChange < 0 ? '#15803d' : '#8ca0b5',
                }}
              >
                {changeSign}{p.projectedChange.toFixed(2)}
                <span className="text-[28px] font-normal">%</span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-[12.5px]">
                <span className="text-muted">FarePulse →</span>
                <span className="font-mono font-semibold text-ink">{p.projectedApix.toFixed(2)}</span>
                <span className="text-muted text-[11px]">from {s.baselineApix.toFixed(2)}</span>
              </div>
            </div>
            <div
              className="px-6 py-2.5 border-t flex items-center justify-between"
              style={{ borderColor: 'rgba(0,0,0,0.05)', background: 'rgba(0,0,0,0.015)' }}
            >
              <span className="text-[11px] font-medium text-muted">
                {showingPendingResult ? 'Recalculating inputs…' : 'Illustrative output'}
              </span>
              <Pill tone={RISK_TONE[p.risk]}>
                {p.risk}
              </Pill>
            </div>
          </div>

          {/* Risk description */}
          <div className="rounded-lg border border-line bg-surface px-5 py-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted mb-1.5">
              Prototype magnitude band
            </div>
            <p className="text-[13px] leading-relaxed text-ink font-medium">
              {RISK_DESC[p.risk]}
            </p>
          </div>

          {/* Exposure proxy */}
          <div className="rounded-lg border border-line bg-surface px-5 py-4">
            <ExposureBar score={p.exposureProxy} />
            <p className="mt-2 text-[11px] text-muted">
              Defined as min(100, |formula output| × 3). No passenger counts or harm data.
            </p>
          </div>

          {/* Plain-English explanation */}
          <div className="rounded-lg border border-accent/20 bg-accent-soft/30 px-5 py-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent mb-2">
              Formula explanation
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink">
              {p.explanation}
            </p>
          </div>

          {/* Disclaimer */}
          <div className="rounded-md border border-[#dbeafe] bg-[#eff6ff] px-4 py-3 text-[11px] leading-relaxed text-[#1e40af]">
            <strong>Scenario planning tool only.</strong> Exact coefficients are team-defined,
            uncited, and uncalibrated. Results do not predict real fares, estimate passenger harm,
            establish causality, or support enforcement decisions.
          </div>
        </div>
      </div>

      {/* Contribution breakdown */}
      <Card title="Factor contribution breakdown">
        <p className="mb-4 text-[12px] text-muted">
          Each bar shows how much that factor adds or removes from the projected index change.
          Red bars increase pressure; green bars relieve it.
        </p>
        <table className="w-full">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="pb-2 pr-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Factor</th>
              <th className="pb-2 pr-4 text-right text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Contribution</th>
              <th className="pb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                <div className="relative">
                  <span className="absolute left-1/2 -translate-x-1/2 text-muted">0</span>
                  &nbsp;
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <ContribRow label="Demand change"   value={p.demandContrib}      maxAbs={maxAbs} />
            <ContribRow label="Fuel cost"        value={p.fuelContrib}        maxAbs={maxAbs} />
            <ContribRow label="Seat capacity"    value={p.capacityContrib}    maxAbs={maxAbs} />
            <ContribRow label="Competition"      value={p.competitionContrib} maxAbs={maxAbs} />
            <ContribRow
              label="Total"
              value={p.projectedChange}
              maxAbs={maxAbs}
              color={p.projectedChange >= 0 ? '#6952a8' : '#0b6e6e'}
            />
          </tbody>
        </table>
        <div className="mt-3 flex justify-center gap-6 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#e05c3a]/80" />
            Upward pressure
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#2a9174]/80" />
            Fare relief
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-[#6952a8]/80" />
            Net change
          </span>
        </div>
      </Card>
    </div>
  )
}
