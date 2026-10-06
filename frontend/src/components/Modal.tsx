// Overlay modal. Closes on Escape and on backdrop click; content clicks stop
// propagation so forms stay put.

import { useEffect } from 'react'
import type { ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" style={width ? { width } : undefined} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="mt">{title}</span>
          <button className="mx" onClick={onClose} aria-label="close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
