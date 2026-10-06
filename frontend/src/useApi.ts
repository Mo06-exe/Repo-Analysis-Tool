// Data-fetching hook with stale-response protection. Keyed on the stringified
// params so views can pass fresh objects every render without re-fetch loops.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  setData: (d: T | null) => void
}

export function useApi<T>(path: string | null, params?: Record<string, unknown>): ApiState<T> {
  const key = path ? path + '|' + JSON.stringify(params ?? {}) : null
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    if (!key || !path) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    const my = ++seq.current
    setLoading(true)
    setError(null)
    api<T>(path, { params })
      .then((d) => {
        if (my === seq.current) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (my === seq.current) {
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload, setData }
}

/** Debounce a quickly-changing value (search boxes). */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}
