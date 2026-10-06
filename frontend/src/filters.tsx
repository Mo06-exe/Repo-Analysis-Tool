// Filter state lives entirely in the URL query string, so any view is
// shareable/bookmarkable and back/forward work for free. View-local state
// (page, q, sort, mode toggles) shares the same string but under its own keys.
//
// Router gotcha: useSearchParams()'s setter closes over the params of the
// *current render*, so two edits in one tick (set q → reset page) clobber
// each other. All editing here goes through one module-level optimistic copy
// that composes same-tick edits and flushes them as a single navigation.

import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface FilterState {
  repos: number[]
  authors: number[]
  path: string | null
  from: string | null // YYYY-MM-DD or unix seconds
  to: string | null
  commits: string[] // commit hash prefixes (may be abbreviated)
}

const FILTER_KEYS = ['repos', 'authors', 'path', 'from', 'to', 'commits'] as const

// ---------------------------------------------------------------------------
// Shared params editor

let liveParams: URLSearchParams | null = null
let pendingFlush = false
let flushFn: (() => void) | null = null

type PatchFn = (prev: URLSearchParams) => URLSearchParams

function useParamsEditor(): [URLSearchParams, (fn: PatchFn) => void] {
  const [sp, setSp] = useSearchParams()

  // The location is authoritative whenever it disagrees with the optimistic
  // copy — except while a flush is pending, when our copy is ahead.
  const spKey = sp.toString()
  if (!pendingFlush && (liveParams === null || liveParams.toString() !== spKey)) {
    liveParams = new URLSearchParams(spKey)
  }

  // Any mounted instance can perform the flush; they all navigate the same router.
  useEffect(() => {
    flushFn = () => setSp(new URLSearchParams(liveParams ?? new URLSearchParams()))
  }, [setSp])

  const patch = useCallback((fn: PatchFn) => {
    if (!liveParams) return
    liveParams = fn(new URLSearchParams(liveParams))
    if (pendingFlush) return
    pendingFlush = true
    queueMicrotask(() => {
      pendingFlush = false
      flushFn?.()
    })
  }, [])

  return [sp, patch]
}

function ints(raw: string | null): number[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0)
}

export function readFilters(sp: URLSearchParams): FilterState {
  return {
    repos: ints(sp.get('repos')),
    authors: ints(sp.get('authors')),
    path: sp.get('path') || null,
    from: sp.get('from') || null,
    to: sp.get('to') || null,
    commits: (sp.get('commits') || '')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  }
}

export function filterParams(f: FilterState): Record<string, unknown> {
  return {
    repos: f.repos.length ? f.repos.join(',') : undefined,
    authors: f.authors.length ? f.authors.join(',') : undefined,
    path: f.path || undefined,
    from: f.from || undefined,
    to: f.to || undefined,
    commits: f.commits.length ? f.commits.join(',') : undefined,
  }
}

export function filterSummary(f: FilterState): string {
  const bits: string[] = []
  if (f.repos.length) bits.push(`${f.repos.length} repo${f.repos.length > 1 ? 's' : ''}`)
  if (f.authors.length) bits.push(`${f.authors.length} author${f.authors.length > 1 ? 's' : ''}`)
  if (f.path) bits.push('path')
  if (f.from || f.to) bits.push('range')
  if (f.commits.length) bits.push(`${f.commits.length} commits`)
  return bits.length ? bits.join(' · ') : 'all history'
}

export function activeFilterCount(f: FilterState): number {
  let n = 0
  if (f.repos.length) n++
  if (f.authors.length) n++
  if (f.path) n++
  if (f.from || f.to) n++
  if (f.commits.length) n++
  return n
}

export function useFilters() {
  const [sp, patch] = useParamsEditor()
  const f = useMemo(() => readFilters(sp), [sp])

  /** Patch filter keys. Any change resets pagination. */
  const set = useCallback(
    (next: Partial<FilterState>) => {
      patch((prev) => {
        const out = new URLSearchParams(prev)
        for (const key of FILTER_KEYS) {
          if (!(key in next)) continue
          const value = next[key]
          if (value === null || value === undefined || (Array.isArray(value) && value.length === 0) || value === '') {
            out.delete(key)
          } else if (Array.isArray(value)) {
            out.set(key, value.join(','))
          } else {
            out.set(key, String(value))
          }
        }
        out.delete('page')
        return out
      })
    },
    [patch],
  )

  const clearAll = useCallback(() => {
    patch((prev) => {
      const out = new URLSearchParams(prev)
      for (const key of FILTER_KEYS) out.delete(key)
      out.delete('page')
      return out
    })
  }, [patch])

  const params = useMemo(() => filterParams(f), [f])
  return { f, set, clearAll, params }
}

/** Read a view-local param (page, q, sort, …) alongside its setter. */
export function useViewParam(key: string, fallback: string): [string, (v: string | null) => void] {
  const [sp, patch] = useParamsEditor()
  const value = sp.get(key) ?? fallback
  const set = useCallback(
    (v: string | null) => {
      patch((prev) => {
        const out = new URLSearchParams(prev)
        if (v === null || v === '' || v === fallback) out.delete(key)
        else out.set(key, v)
        return out
      })
    },
    [patch, key, fallback],
  )
  return [value, set]
}
