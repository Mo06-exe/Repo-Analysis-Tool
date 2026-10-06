// Formatting helpers shared across views. Everything renders compactly —
// a dense table forgives nothing wider than it needs to be.

export function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US')
}

export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'b'
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'm'
  if (abs >= 5e3) return (n / 1e3).toFixed(0) + 'k'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return (n > 0 ? '+' : '') + fmtInt(n)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtDateShort(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${MONTHS[d.getMonth()]} ${d.getDate()} '${pad(d.getFullYear() % 100)}`
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${fmtDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function relTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30.44)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

export function fmtSpan(days: number | null | undefined): string {
  if (!days || days <= 0) return '—'
  if (days < 1) return '<1 day'
  if (days < 90) return `${Math.round(days)} days`
  const mo = days / 30.44
  if (mo < 24) return `${mo.toFixed(1)} mo`
  return `${(days / 365.25).toFixed(1)} yr`
}

export function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return (x * 100).toFixed(digits) + '%'
}

export function fmtSize(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function shortHash(h: string): string {
  return h.slice(0, 12)
}

export function extLabel(ext: string): string {
  return ext === '' ? '(other)' : '.' + ext
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'queued'
    case 'cloning':
      return 'cloning'
    case 'extracting':
      return 'extracting'
    case 'parsing':
      return 'parsing history'
    case 'ready':
      return 'ready'
    case 'error':
      return 'failed'
    default:
      return status
  }
}
