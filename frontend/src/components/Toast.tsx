// Bottom-right toast stack. Fire-and-forget: `toast('err', '…')` from any
// module, no context plumbing needed.

import { useEffect, useState } from 'react'

let seq = 0
type ToastKind = 'ok' | 'err' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}
let items: ToastItem[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function toast(kind: ToastKind, text: string) {
  const id = ++seq
  items = [...items, { id, kind, text }].slice(-4)
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, 5000)
}

export function ToastHost() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  if (!items.length) return null
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={t.kind === 'info' ? 'toast' : `toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
