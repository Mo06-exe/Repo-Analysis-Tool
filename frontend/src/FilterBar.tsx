// The filter instrument. Five controls, one per filter dimension, all of
// them writing into the URL via useFilters(). Checkbox pickers apply
// immediately; text/date inputs apply on commit (Enter / Apply / change).

import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from './useApi'
import { useRepos } from './store'
import { activeFilterCount, filterSummary, useFilters } from './filters'
import type { AuthorRow } from './types'
import { IconCalendar, IconFilter, IconHash, IconPath, IconRepo, IconSearch, IconUsers } from './components/Icons'
import { Btn } from './components/Bits'

function usePop(): { open: boolean; toggle: () => void; close: () => void; ref: RefObject<HTMLDivElement> } {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, toggle: () => setOpen((v) => !v), close: () => setOpen(false), ref }
}

function FControl({
  active,
  icon,
  label,
  value,
  children,
}: {
  active: boolean
  icon?: ReactNode
  label: string
  value?: ReactNode
  children: (close: () => void) => ReactNode
}) {
  const pop = usePop()
  return (
    <div className={active ? 'fcontrol active' : 'fcontrol'} ref={pop.ref}>
      <button onClick={pop.toggle}>
        {icon}
        <span>{label}</span>
        {value !== undefined && <span className="fval">{value}</span>}
        <span className="caret">▾</span>
      </button>
      {pop.open && <div className="popover">{children(pop.close)}</div>}
    </div>
  )
}

function CheckRow({
  on,
  onClick,
  children,
  right,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <button className={on ? 'pickrow on' : 'pickrow'} onClick={onClick}>
      <span className="box">{on ? '✓' : ''}</span>
      <span className="grow trunc">{children}</span>
      {right !== undefined && <span className="cnt">{right}</span>}
    </button>
  )
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000)
  const p = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function FilterBar() {
  const { f, set, clearAll } = useFilters()
  const { repos } = useRepos()
  const navigate = useNavigate()

  const ready = repos.filter((r) => r.status === 'ready')
  const authors = useApi<{ rows: AuthorRow[] }>('/api/analysis/authors', {
    repos: f.repos.length ? f.repos.join(',') : undefined,
  })

  const [authorQuery, setAuthorQuery] = useState('')
  const [pathDraft, setPathDraft] = useState(f.path ?? '')
  useEffect(() => setPathDraft(f.path ?? ''), [f.path])

  const authorList = (authors.data?.rows ?? []).filter((a) => {
    if (!authorQuery.trim()) return true
    const q = authorQuery.toLowerCase()
    return a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
  })

  const toggleRepo = (id: number) => {
    set({ repos: f.repos.includes(id) ? f.repos.filter((r) => r !== id) : [...f.repos, id] })
  }
  const toggleAuthor = (id: number) => {
    set({ authors: f.authors.includes(id) ? f.authors.filter((a) => a !== id) : [...f.authors, id] })
  }

  const rangeValue =
    f.from && f.to ? `${f.from} → ${f.to}` : f.from ? `≥ ${f.from}` : f.to ? `≤ ${f.to}` : undefined

  const nActive = activeFilterCount(f)

  return (
    <div className="filterbar">
      {/* ---------------------------------------------------------- repos */}
      <FControl
        active={f.repos.length > 0}
        icon={<IconRepo />}
        label="Repos"
        value={f.repos.length ? String(f.repos.length) : undefined}
      >
        {() => (
          <>
            <div className="pop-head">repositories · {ready.length} ready</div>
            <div className="pop-body">
              {ready.map((r) => (
                <CheckRow key={r.id} on={f.repos.includes(r.id)} onClick={() => toggleRepo(r.id)} right={r.commit_count}>
                  {r.name}
                </CheckRow>
              ))}
              {ready.length === 0 && <div style={{ padding: 8 }} className="faint">no repositories yet</div>}
            </div>
            {f.repos.length > 0 && (
              <div className="pop-foot">
                <Btn xs onClick={() => set({ repos: [] })}>
                  All repositories
                </Btn>
              </div>
            )}
          </>
        )}
      </FControl>

      {/* -------------------------------------------------------- authors */}
      <FControl
        active={f.authors.length > 0}
        icon={<IconUsers />}
        label="Authors"
        value={f.authors.length ? String(f.authors.length) : undefined}
      >
        {(close) => (
          <>
            <div className="pop-head">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconSearch size={12} /> authors
              </span>
            </div>
            <div className="pop-body">
              <input
                className="input"
                style={{ width: '100%', marginBottom: 6 }}
                placeholder="filter by name or email…"
                value={authorQuery}
                onChange={(e) => setAuthorQuery(e.target.value)}
                autoFocus
              />
              {authors.loading && <div className="faint" style={{ padding: 6 }}>loading…</div>}
              {authorList.map((a) => (
                <CheckRow key={a.author_id} on={f.authors.includes(a.author_id)} onClick={() => toggleAuthor(a.author_id)} right={a.commits}>
                  <span>{a.name}</span> <span className="faint mono" style={{ fontSize: 11 }}>{a.email}</span>
                </CheckRow>
              ))}
              {!authors.loading && authorList.length === 0 && (
                <div className="faint" style={{ padding: 6 }}>no matching authors</div>
              )}
            </div>
            <div className="pop-foot">
              {f.authors.length > 0 && (
                <Btn xs onClick={() => set({ authors: [] })}>
                  Clear ({f.authors.length})
                </Btn>
              )}
              <Btn xs onClick={close}>
                Done
              </Btn>
            </div>
          </>
        )}
      </FControl>

      {/* ----------------------------------------------------------- path */}
      <FControl
        active={!!f.path}
        icon={<IconPath />}
        label="Path"
        value={f.path ? (f.path.length > 26 ? '…' + f.path.slice(-26) : f.path) : undefined}
      >
        {(close) => (
          <>
            <div className="pop-head">file or directory</div>
            <div className="pop-body">
              <input
                className="input mono"
                style={{ width: '100%' }}
                placeholder="src/core/  ·  src/app.py"
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    set({ path: pathDraft.trim() || null })
                    close()
                  }
                }}
                autoFocus
              />
              <div className="faint" style={{ padding: '7px 2px 2px', fontSize: 11, lineHeight: 1.5 }}>
                Matches the exact file, or every file beneath a directory prefix.
              </div>
            </div>
            <div className="pop-foot">
              {f.path && (
                <Btn
                  xs
                  onClick={() => {
                    set({ path: null })
                    close()
                  }}
                >
                  Clear
                </Btn>
              )}
              <Btn
                xs
                kind="primary"
                onClick={() => {
                  set({ path: pathDraft.trim() || null })
                  close()
                }}
              >
                Apply
              </Btn>
            </div>
          </>
        )}
      </FControl>

      {/* ---------------------------------------------------------- dates */}
      <FControl active={!!(f.from || f.to)} icon={<IconCalendar />} label="Window" value={rangeValue}>
        {(close) => (
          <>
            <div className="pop-head">commit time window</div>
            <div className="pop-body">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  className="input"
                  type="date"
                  value={f.from ?? ''}
                  onChange={(e) => set({ from: e.target.value || null })}
                  style={{ flex: 1 }}
                />
                <span className="faint">→</span>
                <input
                  className="input"
                  type="date"
                  value={f.to ?? ''}
                  onChange={(e) => set({ to: e.target.value || null })}
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {(
                  [
                    ['30d', 30],
                    ['90d', 90],
                    ['6mo', 182],
                    ['1y', 365],
                  ] as const
                ).map(([label, days]) => (
                  <Btn
                    key={label}
                    xs
                    onClick={() => {
                      set({ from: isoDaysAgo(days), to: isoDaysAgo(0) })
                      close()
                    }}
                  >
                    last {label}
                  </Btn>
                ))}
              </div>
            </div>
            <div className="pop-foot">
              {(f.from || f.to) && (
                <Btn
                  xs
                  onClick={() => {
                    set({ from: null, to: null })
                    close()
                  }}
                >
                  Clear
                </Btn>
              )}
              <Btn xs onClick={close}>
                Done
              </Btn>
            </div>
          </>
        )}
      </FControl>

      {/* -------------------------------------------------------- commits */}
      {f.commits.length > 0 ? (
        <div className="commits-filter">
          <div className="fcontrol active">
            <button onClick={() => navigate('/d/commits')} title="selection managed from the Commits tab">
              <IconHash />
              <span>Commits</span>
              <span className="fval">{f.commits.length}</span>
            </button>
          </div>
          <button className="chipx" title="clear commit selection" onClick={() => set({ commits: [] })}>
            ✕
          </button>
        </div>
      ) : (
        <div className="fcontrol">
          <button onClick={() => navigate('/d/commits?pick=1')} title="select commits to use as a filter">
            <IconHash />
            <span>Commits</span>
            <span className="caret">▾</span>
          </button>
        </div>
      )}

      <div className="filter-reset">
        <span>
          {nActive > 0 ? (
            <>
              <IconFilter size={11} /> {filterSummary(f)}
            </>
          ) : (
            'all history'
          )}
        </span>
        {nActive > 0 && (
          <button onClick={clearAll} title="clear every filter">
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
