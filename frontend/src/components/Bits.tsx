// Small shared primitives. Deliberately unopinionated — the CSS classes
// carry the design system, these just package them.

import type { ReactNode } from 'react'

export function Btn({
  kind = 'default',
  xs = false,
  onClick,
  disabled,
  title,
  children,
  type = 'button',
}: {
  kind?: 'default' | 'primary' | 'danger' | 'ghost'
  xs?: boolean
  onClick?: () => void
  disabled?: boolean
  title?: string
  children: ReactNode
  type?: 'button' | 'submit'
}) {
  const cls = ['btn', kind !== 'default' && kind, xs && 'xs'].filter(Boolean).join(' ')
  return (
    <button type={type} className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

export function Tag({ tone, children, title }: { tone?: 'amber' | 'green' | 'red' | 'blue'; children: ReactNode; title?: string }) {
  return (
    <span className={tone ? `tag ${tone}` : 'tag'} title={title}>
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: 'ok' | 'warn' | 'err' | 'idle' }) {
  return <span className={`dot ${tone}`} />
}

export function Prog({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="prog">
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Panel({
  title,
  note,
  actions,
  flush = false,
  children,
  className,
}: {
  title?: ReactNode
  note?: ReactNode
  actions?: ReactNode
  flush?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <span className="panel-title">{title}</span>}
          {note && <span className="panel-note">{note}</span>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel-body flush' : 'panel-body'}>{children}</div>
    </section>
  )
}

export function Kpis({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  return (
    <div className="kpis">
      {items.map((it, i) => (
        <div className="kpi" key={i}>
          <div className="k-label">{it.label}</div>
          <div className="k-value">{it.value}</div>
          {it.note !== undefined && <div className="k-note">{it.note}</div>}
        </div>
      ))}
    </div>
  )
}

export function KV({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div className="kv">
      {items.map((it, i) => (
        <div className="kv-item" key={i}>
          <div className="kv-k">{it.k}</div>
          <div className="kv-v">{it.v}</div>
        </div>
      ))}
    </div>
  )
}

export function BarList({
  rows,
  onRowClick,
}: {
  rows: { key: string | number; label: ReactNode; value: number; valueText?: string; sub?: ReactNode }[]
  onRowClick?: (key: string | number) => void
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="barlist">
      {rows.map((r, i) => (
        <div
          className="bl-row"
          key={r.key}
          onClick={onRowClick ? () => onRowClick(r.key) : undefined}
          style={onRowClick ? { cursor: 'pointer' } : undefined}
        >
          <span className="bl-rank">{String(i + 1).padStart(2, '0')}</span>
          <span className="bl-name">
            <div className="nm">{r.label}</div>
            <div className="sharebar">
              <div style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </span>
          <span className="bl-val">
            {r.valueText ?? r.value}
            {r.sub !== undefined && <span className="faint"> {r.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Empty({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-title">{title}</div>
      {note && <div>{note}</div>}
      {children}
    </div>
  )
}

export function Loading({ label = 'loading' }: { label?: string }) {
  return <div className="loading">{label}</div>
}

export function ErrNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="err-note">
      {error}
      {onRetry && (
        <button onClick={onRetry} style={{ marginLeft: 10, textDecoration: 'underline', color: 'inherit' }}>
          retry
        </button>
      )}
    </div>
  )
}
