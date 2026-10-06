// Repositories store — a tiny external store shared by every view. Mirrors
// what /api/repos reports and re-polls while any repository is still being
// ingested, so progress bars move without any view-level polling logic.

import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import type { Repo } from './types'

export interface GlobalStats {
  repos: number
  commits: number
  files: number
  added: number
  deleted: number
}

interface State {
  repos: Repo[]
  stats: GlobalStats
  loaded: boolean
  error: string | null
}

const EMPTY_STATS: GlobalStats = { repos: 0, commits: 0, files: 0, added: 0, deleted: 0 }

let state: State = { repos: [], stats: EMPTY_STATS, loaded: false, error: null }
const listeners = new Set<() => void>()
let timer: number | null = null
let inflight = false

function emit() {
  for (const l of listeners) l()
}

function snapshot(): State {
  return state
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function isBusyRepo(r: Repo): boolean {
  return r.status === 'queued' || r.status === 'cloning' || r.status === 'extracting' || r.status === 'parsing'
}

export async function refreshRepos() {
  if (inflight) return
  inflight = true
  try {
    const [repos, stats] = await Promise.all([
      api<{ rows: Repo[] }>('/api/repos'),
      api<GlobalStats>('/api/stats'),
    ])
    state = { repos: repos.rows, stats, loaded: true, error: null }
  } catch (e) {
    state = { ...state, loaded: true, error: e instanceof Error ? e.message : String(e) }
  } finally {
    inflight = false
  }
  emit()
  schedule()
}

function schedule() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  if (state.repos.some(isBusyRepo)) {
    timer = window.setTimeout(() => {
      timer = null
      void refreshRepos()
    }, 1500)
  }
}

export function useRepos(): State {
  const s = useSyncExternalStore(subscribe, snapshot)
  useEffect(() => {
    if (!state.loaded) void refreshRepos()
  }, [])
  return s
}
