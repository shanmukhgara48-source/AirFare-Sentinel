import { MapPinned } from 'lucide-react'
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
  routes: <MapPinned size={15} strokeWidth={1.75}/>,
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
  { to: '/', end: true,  label: 'Overview',          desc: 'Publication-gated basket view',    icon: 'overview' },
  { to: '/routes', label: 'Route Observatory', desc: 'Interactive India network', icon: 'routes' },
  { to: '/spikes',       label: 'Fare Alerts',        desc: 'Analyst queue · case files',      icon: 'alert'    },
  { to: '/review', label: 'Regulatory Review', desc: 'Evidence & case workflow', icon: 'shield' },
  { to: '/competition',  label: 'Competition',         desc: 'Observation-share proxy',         icon: 'bar'      },
  { to: '/vulnerability',label: 'Vulnerability',       desc: 'Evidence-adjusted signal',        icon: 'shield'   },
  { to: '/fairness',     label: 'Fairness Lens',       desc: 'Category index comparison',       icon: 'scale'    },
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
    <NavLink to={to} end={end} title={desc} className={({ isActive }) => `command-nav-item ${isActive ? 'is-active' : ''}`}>
      <span className="command-nav-icon">{ICONS[icon]}</span>
      <span className="min-w-0">
        <span className="command-nav-label">{label}</span>
      </span>
    </NavLink>
  )
}

function NavGroup({ label, items }: { label: string; items: readonly NavEntry[] }) {
  return (
    <div className="command-nav-group">
      <div className="command-nav-heading">{label}</div>
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
    const refreshSystem = () => {
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
    }
    refreshSystem()
    window.addEventListener('farepulse-data-changed', refreshSystem)
    return () => {
      cancelled = true
      window.removeEventListener('farepulse-data-changed', refreshSystem)
    }
  }, [])

  const allNavFlat: readonly NavEntry[] = [...NAV_MAIN, ...NAV_VIEWS, ...NAV_SYS]
  const liveDatasetActive = system?.demo_mode === false
    && system.operating_mode === 'live'
    && system.active_analysis_source === 'live'
    && system.available_analysis_sources.includes('live')
  const modeTone = systemStatus === 'error' ? 'unavailable'
    : system?.demo_mode ? 'demo'
    : liveDatasetActive ? 'live' : 'pending'
  const modeLabel = systemStatus === 'error' ? 'Status unavailable'
    : system?.demo_mode ? 'Demo Mode'
    : liveDatasetActive ? 'Live fare quote snapshots'
    : system?.operating_mode === 'live' ? 'Live fetch enabled'
    : system ? 'Live fetch unavailable' : 'Checking mode'
  const datasetLabel = system?.active_analysis_source === 'live'
    ? 'Live fare quote snapshots' : system?.dataset_label ?? 'Dataset status unavailable'
  const datasetNotice = system?.dataset_notice
    ?? 'Dataset provenance could not be verified. No live-data claim is being made.'
  const modeDetail = system?.demo_mode
    ? `${system.live_provider_configured ? 'Credentials ready · ' : ''}Live fetch disabled. ${system.active_analysis_source === 'demo' ? 'Viewing synthetic observations.' : `Analysis source: ${system.active_analysis_source ?? 'none'}.`}`
    : liveDatasetActive ? 'Observed at fetch time. Final ticket prices may differ.'
    : system?.operating_mode === 'live' ? 'Provider enabled. Active analysis is not a live dataset.'
    : system?.mode_notice ?? 'Connecting to the backend to verify operating mode.'

  return (
    <div className="command-shell">
      <a className="skip-link" href="#main-content">Skip to dashboard</a>
      <header className="command-header">
        <NavLink to="/" className="command-brand" aria-label="AirFare Sentinel overview">
          <span className="brand-mark" aria-hidden="true">
            <svg width="27" height="27" viewBox="0 0 32 32" fill="none">
              <path d="M16 3 19 14 28 21 28 24 18 20 18 26 22 29 22 30 16 28 10 30 10 29 14 26 14 20 4 24 4 21 13 14Z" fill="currentColor" />
            </svg>
          </span>
          <span><strong>AirFare<span>Sentinel</span></strong><small>AVIATION INTELLIGENCE</small></span>
        </NavLink>
        <div className="command-header-center"><span className="header-crosshair" aria-hidden="true">＋</span> India <span>/</span> Domestic aviation</div>
        <div className="command-header-actions">
          <span className="command-project">SIH 2026 <span>PS 26056</span></span>
          <button onClick={toggleJudgeMode} aria-pressed={judgeMode} className={`judge-switch ${judgeMode ? 'is-on' : ''}`}
            title="Toggle Judge Mode — plain-English explanations on every screen">
            <span>Judge Mode</span><span className="judge-switch-state">{judgeMode ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>
      <div className="command-body">
        <aside className="command-sidebar">
          <div className="workspace-label"><span className="workspace-dot" /> ANALYST WORKSPACE <span>01</span></div>
          <nav aria-label="Main navigation" className="command-navigation">
            <NavGroup label="Monitor & investigate" items={NAV_MAIN} />
            <NavGroup label="Explore the data" items={NAV_VIEWS} />
            <NavGroup label="System & evidence" items={NAV_SYS} />
          </nav>
          <div className="sidebar-provenance">
            <div className="sidebar-provenance-label"><span className={`status-dot ${modeTone}`} /> DATA PROVENANCE</div>
            <strong>{datasetLabel}</strong>
            <p>Not an official statistical release.</p>
            <NavLink to="/method">Review methodology <span aria-hidden="true">↗</span></NavLink>
          </div>
          <div className="sidebar-footer"><span>IND / AIRFARE MONITOR</span><span>v{system?.version ?? '—'}</span></div>
        </aside>
        <div className="command-content">
          <nav className="command-mobile-nav" aria-label="Mobile navigation">
            {allNavFlat.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}
                className={({ isActive }) => isActive ? 'is-active' : ''}>{item.label}</NavLink>
            ))}
          </nav>
          <div className={`mode-ribbon ${modeTone}`} data-testid="operating-mode" role="status">
            <div className="mode-ribbon-label"><span className={`status-dot ${modeTone}`} /><strong>{modeLabel}</strong></div>
            <span className="mode-ribbon-detail">{modeDetail}</span>
            <NavLink to="/admin">Data source <span aria-hidden="true">↗</span></NavLink>
          </div>
          <main id="main-content" className="command-main" tabIndex={-1}><Outlet /></main>
          <footer className="command-footer">
            <span>AirFare Sentinel <span aria-hidden="true">/</span> SIH 2026 · PS 26056</span>
            <span>{datasetNotice} Prototype methodology v0.3.</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
