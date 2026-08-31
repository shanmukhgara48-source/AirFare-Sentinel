import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api, type SystemVersion } from '../api'
import { useJudgeMode } from '../context/judgeModeContext'

// ─── Tiny inline SVG helper ────────────────────────────────────────────────────
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

const ICONS: Record<string, ReactNode> = {
  overview: <Svg><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Svg>,
  alert:    <Svg><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></Svg>,
  bar:      <Svg><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></Svg>,
  shield:   <Svg><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></Svg>,
  scale:    <Svg><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 4 12 8 17"/><polyline points="16 7 20 12 16 17"/></Svg>,
  sliders:  <Svg><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></Svg>,
  pulse:    <Svg><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></Svg>,
  compare:  <Svg><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></Svg>,
  book:     <Svg><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></Svg>,
  gear:     <Svg><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></Svg>,
}

// ─── Nav data ──────────────────────────────────────────────────────────────────
const NAV_MAIN = [
  { to: '/', end: true,  label: 'Overview',          desc: 'National index · command view',   icon: 'overview' },
  { to: '/spikes',       label: 'Fare Alerts',        desc: 'Analyst queue · case files',      icon: 'alert'    },
  { to: '/competition',  label: 'Competition',         desc: 'HHI concentration risk',          icon: 'bar'      },
  { to: '/vulnerability',label: 'Vulnerability',       desc: 'Lead-time fare pressure',         icon: 'shield'   },
  { to: '/fairness',     label: 'Fairness Lens',       desc: 'Fare equity by category',         icon: 'scale'    },
  { to: '/whatif',       label: 'What-If Simulator',   desc: 'Scenario planning tool',          icon: 'sliders'  },
] as const

const NAV_VIEWS = [
  { to: '/trends',  label: 'Trends',  desc: 'Time-series analysis',    icon: 'pulse'   },
  { to: '/compare', label: 'Compare', desc: 'Route & airline rankings', icon: 'compare' },
] as const

const NAV_SYS = [
  { to: '/method', label: 'Methodology', desc: 'Index formulas & definitions', icon: 'book' },
  { to: '/admin',  label: 'Admin',       desc: 'Data ingestion & inspection',  icon: 'gear' },
] as const

type NavEntry = { to: string; end?: true; label: string; desc: string; icon: string }

// ─── Sidebar nav item ──────────────────────────────────────────────────────────
function NavItem({ to, end, label, desc, icon }: NavEntry) {
  return (
    <NavLink to={to} end={end} className="block rounded-md overflow-hidden">
      {({ isActive }) => (
        <div
          className="flex items-start gap-2.5 py-[9px] transition-colors"
          style={{
            paddingLeft: isActive ? '10px' : '12px',
            paddingRight: '12px',
            background: isActive ? 'rgba(34,211,238,0.08)' : undefined,
            borderLeft: isActive ? '2px solid #22d3ee' : '2px solid transparent',
          }}
          onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
          onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '' }}
        >
          <span className="mt-[1px] shrink-0" style={{ color: isActive ? '#22d3ee' : '#3d5a78' }}>
            {ICONS[icon]}
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-medium leading-tight" style={{ color: isActive ? '#dceeff' : '#7d9bb5' }}>
              {label}
            </div>
            <div className="mt-[2px] text-[10.5px] leading-tight truncate" style={{ color: isActive ? 'rgba(220,238,255,0.4)' : '#2e4a62' }}>
              {desc}
            </div>
          </div>
        </div>
      )}
    </NavLink>
  )
}

function NavGroup({ label, items }: { label: string; items: readonly NavEntry[] }) {
  return (
    <div className="mb-1">
      <div className="px-3 pb-1 pt-[18px] text-[9px] font-bold tracking-[0.14em] uppercase" style={{ color: '#253d55' }}>
        {label}
      </div>
      {items.map((item) => <NavItem key={item.to} {...item} />)}
    </div>
  )
}

// ─── Layout ────────────────────────────────────────────────────────────────────
export default function Layout() {
  const { judgeMode, toggleJudgeMode } = useJudgeMode()
  const [system, setSystem] = useState<SystemVersion | null>(null)
  const [systemStatus, setSystemStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    api.version()
      .then((version) => {
        if (cancelled) return
        setSystem(version)
        setSystemStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setSystem(null)
        setSystemStatus('error')
      })
    return () => { cancelled = true }
  }, [])

  const allNavFlat: readonly NavEntry[] = [...NAV_MAIN, ...NAV_VIEWS, ...NAV_SYS]
  const modeColor = systemStatus === 'error'
    ? '#f87171'
    : system?.operating_mode === 'live'
      ? '#4ade80'
      : system?.operating_mode === 'demo_fallback'
        ? '#f59e0b'
        : '#22d3ee'
  const modeLabel = system?.mode_label
    ?? (systemStatus === 'error' ? 'Status unavailable' : 'Checking mode')
  const datasetLabel = system?.dataset_label
    ?? (systemStatus === 'error' ? 'Dataset status unavailable' : 'Checking dataset provenance')
  const datasetNotice = system?.dataset_notice
    ?? (systemStatus === 'error'
      ? 'The API status endpoint could not be reached; no live-data claim is being made.'
      : 'Dataset provenance is loading.')
  const modeNotice = system?.mode_notice
    ?? (systemStatus === 'error' ? 'The API status endpoint could not be reached.' : undefined)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f0f3f7' }}>

      {/* ── Top command bar ──────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-stretch shrink-0"
        style={{ background: '#0c1a2e', borderBottom: '1px solid #182d45', height: '48px' }}
      >
        {/* Brand block */}
        <div
          className="flex w-[156px] shrink-0 items-center gap-2 px-3 sm:w-[220px] sm:gap-2.5 sm:px-4"
          style={{ borderRight: '1px solid #182d45' }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-label="FarePulse">
            <circle cx="12" cy="12" r="9" stroke="#22d3ee" strokeWidth="1.5" strokeOpacity="0.3"/>
            <polyline points="5 12 8 12 10 7.5 14 16.5 16 12 19 12"
              stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div>
            <div style={{ color: '#dceeff', fontSize: '13px', fontWeight: '600', letterSpacing: '0', lineHeight: '1.15' }}>
              FarePulse India
            </div>
            <div style={{ color: '#2e4a62', fontSize: '9px', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: '1', marginTop: '1px' }}>
              Command Center
            </div>
          </div>
        </div>

        {/* Status strip */}
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 sm:gap-5 sm:px-5">
          {/* Mode badge */}
          <span title={modeNotice} style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            background: 'rgba(34,211,238,0.08)',
            border: '1px solid rgba(34,211,238,0.2)',
            borderRadius: '3px', padding: '3px 8px',
          }}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: modeColor, display: 'inline-block', flexShrink: 0 }}/>
            <span style={{ color: modeColor, fontSize: '10px', fontWeight: '600', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {modeLabel}
            </span>
          </span>

          <div className="hidden sm:flex items-center gap-2" style={{ color: '#3d5a78', fontSize: '11px' }}>
            <span style={{ width: '1px', height: '14px', background: '#182d45', display: 'inline-block' }}/>
            <span>{datasetLabel}</span>
          </div>

          {/* Right section */}
          <div className="flex items-center gap-3 ml-auto shrink-0">
            <span className="hidden md:inline" style={{ color: '#253d55', fontSize: '10.5px', letterSpacing: '0.04em' }}>
              SIH 2026 · PS 26056
            </span>

            <button
              onClick={toggleJudgeMode}
              title="Toggle Judge Mode — plain-English explanations on every screen"
              className="flex items-center gap-1.5 transition-all"
              style={{
                background: judgeMode ? 'rgba(105,82,168,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${judgeMode ? 'rgba(105,82,168,0.45)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: '4px', padding: '4px 10px',
                cursor: 'pointer',
                color: judgeMode ? '#c4b5fd' : '#4d6a85',
                fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <span className="hidden sm:inline">Judge Mode</span>
              <span style={{
                background: judgeMode ? '#6952a8' : 'rgba(255,255,255,0.06)',
                color: judgeMode ? 'white' : '#3d5a78',
                fontSize: '9px', fontWeight: '700', letterSpacing: '0.06em',
                padding: '1px 5px', borderRadius: '2px', textTransform: 'uppercase',
              }}>
                {judgeMode ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1">

        {/* Desktop sidebar */}
        <aside
          className="hidden lg:flex flex-col shrink-0"
          style={{
            width: '220px',
            background: '#0f1e33',
            borderRight: '1px solid #182d45',
            position: 'sticky',
            top: '48px',
            height: 'calc(100vh - 48px)',
            overflowY: 'auto',
            alignSelf: 'flex-start',
          }}
        >
          <nav className="flex flex-col px-2 pb-2 flex-1">
            <NavGroup label="Analysis" items={NAV_MAIN} />
            <NavGroup label="Views" items={NAV_VIEWS} />
            <NavGroup label="System" items={NAV_SYS} />
          </nav>

          {/* Sample data notice */}
          <div style={{ padding: '10px 12px 14px', borderTop: '1px solid #182d45', marginTop: 'auto' }}>
            <div style={{
              background: 'rgba(245,158,11,0.07)',
              border: '1px solid rgba(245,158,11,0.18)',
              borderRadius: '5px',
              padding: '7px 10px',
            }}>
              <div style={{ color: '#d97706', fontSize: '9px', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Dataset status
              </div>
              <p style={{ color: 'rgba(217,119,6,0.65)', fontSize: '10.5px', lineHeight: '1.45', marginTop: '3px', marginBottom: 0 }}>
                {datasetLabel}. Not an official statistical release.
              </p>
            </div>
          </div>
        </aside>

        {/* Content column */}
        <div className="min-w-0 flex-1 flex flex-col">

          {/* Mobile: horizontal nav */}
          <div className="lg:hidden border-b" style={{ background: '#0f1e33', borderColor: '#182d45' }}>
            <nav className="flex gap-0.5 overflow-x-auto px-2 py-1.5">
              {allNavFlat.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `shrink-0 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'text-[#22d3ee] bg-[rgba(34,211,238,0.1)]'
                        : 'text-[#5a7a96] hover:text-[#9ab5cc] hover:bg-white/[0.04]'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Mobile: demo notice + judge toggle */}
          <div
            className="lg:hidden flex items-center justify-between px-4 py-1.5 text-[11px] border-b"
            style={{ background: '#fdf4e7', borderColor: '#f0dcbb', color: '#b45309' }}
          >
            <span className="min-w-0 truncate">{datasetLabel}</span>
            <button
              onClick={toggleJudgeMode}
              style={{ color: judgeMode ? '#6952a8' : '#b45309', fontSize: '10px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none' }}
            >
              Judge {judgeMode ? 'ON' : 'OFF'}
            </button>
          </div>

          <main className="flex-1 mx-auto w-full max-w-[1280px] px-5 py-6 lg:px-8 lg:py-8">
            <Outlet />
          </main>

          <footer
            className="mx-auto w-full max-w-[1280px] px-5 pb-6 text-[11px] leading-relaxed lg:px-8"
            style={{ color: '#8ca0b5' }}
          >
            FarePulse Command Center · SIH 2026 PS 26056 · {datasetNotice} Index methodology v0.2.
          </footer>
        </div>
      </div>
    </div>
  )
}
