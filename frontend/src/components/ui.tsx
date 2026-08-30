import { useState } from 'react'
import type { ReactNode } from 'react'

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-line bg-surface shadow-[0_1px_3px_rgba(15,27,42,0.06)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5" style={{ background: 'rgba(240,243,247,0.5)' }}>
          <div>
            {title && <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11.5px] text-muted leading-relaxed">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'ok' | 'warn' | 'alert'
}) {
  const accentColor =
    tone === 'alert' ? '#c2410c' :
    tone === 'warn'  ? '#b45309' :
    tone === 'ok'    ? '#15803d' : undefined

  return (
    <div className="relative rounded-lg border border-line bg-surface px-5 py-4 overflow-hidden">
      {accentColor && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: accentColor }} />
      )}
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
        {label}
      </div>
      <div
        className={`mt-2 font-serif text-[28px] leading-none tnum ${
          tone === 'alert' ? 'text-alert' :
          tone === 'warn'  ? 'text-warn'  :
          tone === 'ok'    ? 'text-ok'    : 'text-ink'
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-2 text-[11.5px] text-muted leading-relaxed">{hint}</div>}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

const controlClass =
  'h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink outline-none ' +
  'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20'

export function Select({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  allLabel?: string
}) {
  return (
    <select className={controlClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {allLabel && <option value="">{allLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function DateInput({
  value,
  onChange,
  min,
  max,
}: {
  value: string
  onChange: (v: string) => void
  min?: string
  max?: string
}) {
  return (
    <input
      type="date"
      className={controlClass}
      value={value}
      min={min ?? undefined}
      max={max ?? undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-accent text-white hover:bg-[#095a5a] border-accent',
    secondary: 'bg-surface text-ink hover:bg-ground border-line',
    danger: 'bg-surface text-alert hover:bg-[#fdf0ea] border-[#f0cdbb]',
  }[variant]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-[13px] font-medium
        transition-colors disabled:cursor-not-allowed disabled:opacity-45
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${styles}`}
    >
      {children}
    </button>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'ok' | 'warn' | 'alert' | 'escalate' | 'accent'
}) {
  const styles = {
    neutral:  'bg-ground text-muted border-line',
    ok:       'bg-[#dcfce7] text-[#166534] border-[#86efac]',
    warn:     'bg-[#fef3c7] text-[#92400e] border-[#fcd34d]',
    alert:    'bg-[#ffedd5] text-[#9a3412] border-[#fdba74]',
    escalate: 'bg-[#991b1b] text-white border-[#7f1d1d]',
    accent:   'bg-accent-soft text-accent border-[#bcdedc]',
  }[tone]

  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] ${styles}`}
    >
      {children}
    </span>
  )
}

export function Delta({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="text-muted">—</span>
  const positive = value > 0
  const flat = Math.abs(value) < 0.005
  return (
    <span
      className={`tnum font-medium ${
        flat ? 'text-muted' : positive ? 'text-alert' : 'text-ok'
      }`}
    >
      {flat ? '' : positive ? '▲ ' : '▼ '}
      {value > 0 ? '+' : ''}
      {value.toFixed(2)}
      {suffix}
    </span>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
      <h3 className="font-serif text-[19px]">{title}</h3>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-[13px] text-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}…
    </div>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-[#f4d3c2] bg-[#fdf0ea] px-4 py-3 text-[13px] text-alert">
      {message}
    </div>
  )
}

export function JudgePanel({
  items,
}: {
  items: { q: string; a: string }[]
}) {
  return (
    <div className="rounded-lg border border-[#6952a8]/30 bg-[#f7f5ff] overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-[#6952a8]/15" style={{ background: 'rgba(105,82,168,0.06)' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6952a8" strokeWidth="2.5" aria-hidden>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#6952a8]">Judge Mode</span>
        <span className="text-[11px] text-[#6952a8]/70">· Plain-English summary using the current screen values</span>
      </div>
      <div className="grid gap-px sm:grid-cols-2 bg-[#6952a8]/10">
        {items.map((item) => (
          <div key={item.q} className="bg-[#f7f5ff] px-4 py-3.5">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#6952a8]/60 mb-1.5">
              {item.q}
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function EvidenceTag({
  items,
  label = 'Evidence',
}: {
  items: { label: string; value: string; mono?: boolean }[]
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className="inline-flex items-center gap-1 rounded border border-line bg-ground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-accent transition-colors"
        title="Show evidence trail for this metric"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
        </svg>
        {label} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-line bg-ground/70 px-3.5 py-3">
          <div className="space-y-1.5">
            {items.map((item) => (
              <div key={item.label} className="flex gap-3 text-[11px]">
                <span className="w-32 shrink-0 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted leading-relaxed">
                  {item.label}
                </span>
                <span className={`leading-relaxed ${item.mono ? 'font-mono text-[10.5px] text-ink' : 'text-ink'}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
