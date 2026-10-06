// Commits: browse, search, inspect, and — the important part — multi-select
// any set of commits and promote the selection into the global commit filter,
// which re-scopes authors/files/dirs/overview at once.

import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, useDebounced } from '../useApi'
import { useFilters, useViewParam } from '../filters'
import type { CommitDetail, CommitRow } from '../types'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { Btn, ErrNote, Empty, KV, Loading, Panel, Seg, Tag } from '../components/Bits'
import { RatioBar } from '../components/Charts'
import { toast } from '../components/Toast'
import { fmtCompact, fmtDate, fmtDateTime, fmtInt, shortHash } from '../format'
import { IconSearch } from '../components/Icons'
import { api } from '../api'

const PER_PAGE = 100
const MAX_SELECT = 2000

function CommitDetailRow({ commitId }: { commitId: number }) {
  const { set } = useFilters()
  const navigate = useNavigate()
  const detail = useApi<CommitDetail>(`/api/analysis/commit/${commitId}`)
  const d = detail.data
  if (!d) return <Loading label="loading commit" />
  const c = d.commit

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(c.hash)
      toast('ok', 'Full hash copied')
    } catch {
      toast('err', 'Clipboard unavailable')
    }
  }

  return (
    <div>
      <div className="detail-grid">
        <div className="detail-block" style={{ gridColumn: 'span 2' }}>
          <div className="db-title">message</div>
          <div className="cm-preview" style={{ marginTop: 0 }}>
            {c.subject}
            {c.body ? '\n\n' + c.body : ''}
          </div>
        </div>
        <div className="detail-block">
          <div className="db-title">meta</div>
          <KV
            items={[
              { k: 'repo', v: c.repo_name },
              { k: 'date', v: <span style={{ fontSize: 11 }}>{fmtDateTime(c.ts)}</span> },
              { k: 'parents', v: fmtInt(c.parents) },
              { k: 'merge', v: c.is_merge ? 'yes' : 'no' },
            ]}
          />
          <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono faint" style={{ fontSize: 10 }}>
              {c.hash.slice(0, 20)}…
            </span>
            <Btn xs onClick={() => void copyHash()}>
              copy full
            </Btn>
          </div>
          <div className="db-title" style={{ marginTop: 14 }}>
            author identity
          </div>
          <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            canonical: <span style={{ color: 'var(--tx-2)' }}>{c.author_name}</span> &lt;{c.author_email}&gt;
            <br />
            raw: <span className="mono">{c.raw_name}</span> &lt;<span className="mono">{c.raw_email}</span>&gt;
            {c.raw_name !== c.author_name || c.raw_email !== c.author_email ? (
              <Tag tone="amber" title="this raw identity is mapped to a canonical author">
                mapped
              </Tag>
            ) : null}
          </div>
          {d.coauthors.length > 0 && (
            <>
              <div className="db-title" style={{ marginTop: 14 }}>
                co-authors
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {d.coauthors.map((co, i) => (
                  <Tag key={i} title={co.email}>
                    {co.name}
                  </Tag>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="detail-block" style={{ marginTop: 14 }}>
        <div className="db-title">files touched ({d.files.length})</div>
        <div className="filelist">
          {d.files.map((fc) => (
            <div
              className="fl-row"
              key={fc.path}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                set({ path: fc.path })
                navigate('/d/files')
              }}
            >
              <span className="fl-path" title={fc.path}>
                {fc.path}
              </span>
              {fc.binary ? <Tag>bin</Tag> : null}
              <span className="fl-val">
                {fc.binary ? (
                  'binary'
                ) : (
                  <>
                    <span className="add">+{fmtCompact(fc.added)}</span> <span className="del">−{fmtCompact(fc.deleted)}</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CommitsView() {
  const { f, set, params } = useFilters()
  const [q, setQ] = useViewParam('q', '')
  const [page, setPage] = useViewParam('page', '1')
  const [scope, setScope] = useViewParam('scope', 'filtered') // filtered | all
  const debouncedQ = useDebounced(q, 250)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const lastIndex = useRef<number | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)

  const ignoreCommits = f.commits.length > 0 && scope === 'all'
  const commits = useApi<{ rows: CommitRow[]; total: number }>('/api/analysis/commits', {
    ...params,
    q: debouncedQ || undefined,
    page,
    per_page: PER_PAGE,
    ignore_commits: ignoreCommits ? true : undefined,
  })

  const rows = commits.data?.rows ?? []
  const total = commits.data?.total ?? 0
  const pageNum = Math.max(1, Number(page) || 1)
  const pages = Math.max(1, Math.ceil(total / PER_PAGE))

  const toggleOne = (row: CommitRow, index: number, shift: boolean) => {
    setSelected((cur) => {
      const has = cur.includes(row.hash)
      if (shift && lastIndex.current !== null) {
        const [a, b] = [lastIndex.current, index].sort((x, y) => x - y)
        const range = rows.slice(a, b + 1).map((r) => r.hash)
        const next = new Set(cur)
        for (const h of range) {
          if (has) next.delete(h)
          else next.add(h)
        }
        lastIndex.current = index
        return [...next]
      }
      lastIndex.current = index
      return has ? cur.filter((h) => h !== row.hash) : [...cur, row.hash]
    })
  }

  const togglePage = () => {
    const hashes = rows.map((r) => r.hash)
    const allOn = hashes.every((h) => selectedSet.has(h))
    setSelected((cur) => (allOn ? cur.filter((h) => !hashes.includes(h)) : [...new Set([...cur, ...hashes])]))
  }

  const selectAllMatching = async () => {
    setLoadingAll(true)
    try {
      const collected: string[] = []
      let p = 1
      const cap = Math.min(total, MAX_SELECT)
      while (collected.length < cap) {
        const res = await api<{ rows: CommitRow[] }>('/api/analysis/commits', {
          params: { ...params, q: debouncedQ || undefined, page: p, per_page: 500, ignore_commits: ignoreCommits ? true : undefined },
        })
        if (!res.rows.length) break
        collected.push(...res.rows.map((r) => r.hash))
        p += 1
      }
      setSelected(collected.slice(0, cap))
      if (total > MAX_SELECT) toast('err', `Selection capped at ${MAX_SELECT} commits (of ${fmtInt(total)})`)
      else toast('ok', `Selected all ${fmtInt(collected.length)} matching commits`)
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingAll(false)
    }
  }

  const applySelection = () => {
    set({ commits: selected.map((h) => h.slice(0, 12)) })
    toast('ok', `Filtering every scope by ${selected.length} commit${selected.length === 1 ? '' : 's'}`)
    setSelected([])
  }

  const allOnPage = rows.length > 0 && rows.every((r) => selectedSet.has(r.hash))

  const columns: Column<CommitRow>[] = [
    {
      key: 'pick',
      label: (
        <input
          type="checkbox"
          className="ck"
          checked={allOnPage}
          onChange={togglePage}
          title="select all on this page"
        />
      ),
      width: 30,
      render: (r, i) => (
        <input
          type="checkbox"
          className="ck"
          checked={selectedSet.has(r.hash)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => toggleOne(r, i, (e.nativeEvent as MouseEvent).shiftKey)}
        />
      ),
    },
    {
      key: 'hash',
      label: 'Commit',
      width: 150,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          {f.commits.some((p) => r.hash.startsWith(p)) && <span className="fdot" style={{ width: 5, height: 5, background: 'var(--amber)', borderRadius: 1, display: 'inline-block' }} title="in the active commit filter" />}
          <span className="hashlink">{shortHash(r.hash)}</span>
          {r.is_merge ? (
            <Tag tone="blue" title="merge commit">
              merge
            </Tag>
          ) : null}
        </span>
      ),
    },
    {
      key: 'subject',
      label: 'Subject',
      render: (r) => (
        <span className="subject" title={r.subject}>
          {r.subject}
        </span>
      ),
    },
    {
      key: 'author',
      label: 'Author',
      render: (r) => <span className="dim">{r.author_name}</span>,
    },
    { key: 'repo', label: 'Repo', render: (r) => <span className="repo-chip">{r.repo_name}</span> },
    { key: 'ts', label: 'Date', render: (r) => <span className="faint">{fmtDate(r.ts)}</span> },
    { key: 'files', label: 'Files', num: true, render: (r) => fmtInt(r.files) },
    { key: 'added', label: 'Added', num: true, render: (r) => <span className="add">+{fmtCompact(r.added)}</span> },
    { key: 'deleted', label: 'Deleted', num: true, render: (r) => <span className="del">−{fmtCompact(r.deleted)}</span> },
    { key: 'churn', label: 'Churn', num: true, render: (r) => fmtInt(r.churn) },
    { key: 'ratio', label: 'Ratio', width: 100, render: (r) => <RatioBar added={r.added} deleted={r.deleted} /> },
  ]

  return (
    <div className="stack">
      <Panel
        title="Commits"
        note={
          <>
            {fmtInt(total)} commit{total === 1 ? '' : 's'}
            {f.commits.length > 0 && scope === 'filtered' ? ' · whitelisted' : ''}
          </>
        }
        actions={
          <>
            {f.commits.length > 0 && (
              <Seg<string>
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'filtered', label: `selected only (${f.commits.length})` },
                  { value: 'all', label: 'browse all' },
                ]}
              />
            )}
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 8, color: 'var(--tx-3)', display: 'inline-flex' }}>
                <IconSearch size={12} />
              </span>
              <input
                className="input"
                style={{ paddingLeft: 26, width: 230 }}
                placeholder="subject or hash prefix…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage('1')
                }}
              />
            </span>
          </>
        }
        flush
      >
        {commits.error ? (
          <ErrNote error={commits.error} onRetry={commits.reload} />
        ) : !commits.data ? (
          <Loading label="walking history" />
        ) : rows.length === 0 ? (
          <Empty
            title={f.commits.length > 0 && scope === 'filtered' ? 'None of the selected commits match' : 'No commits in scope'}
            note={f.commits.length > 0 ? 'Switch to “browse all” to pick more commits, or clear the selection.' : undefined}
          />
        ) : (
          <DataTable<CommitRow>
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            expandable
            expandedKey={expanded}
            onRowClick={(r) => setExpanded((cur) => (cur === r.id ? null : r.id))}
            renderExpanded={(r) => <CommitDetailRow commitId={r.id} />}
            footer={
              <>
                <span>
                  page {pageNum} / {pages} · {PER_PAGE} per page
                </span>
                <span className="pager">
                  <Btn xs disabled={pageNum <= 1} onClick={() => setPage(String(pageNum - 1))}>
                    ← prev
                  </Btn>
                  <Btn xs disabled={pageNum >= pages} onClick={() => setPage(String(pageNum + 1))}>
                    next →
                  </Btn>
                </span>
              </>
            }
          />
        )}
      </Panel>

      {selected.length > 0 && (
        <div className="selbar">
          <span>
            <b>{fmtInt(selected.length)}</b> commit{selected.length === 1 ? '' : 's'} selected
          </span>
          <Btn kind="primary" xs onClick={applySelection}>
            Apply as filter
          </Btn>
          <Btn xs disabled={loadingAll || selected.length >= Math.min(total, MAX_SELECT)} onClick={() => void selectAllMatching()}>
            {loadingAll ? 'collecting…' : `Select all ${fmtInt(Math.min(total, MAX_SELECT))} matching`}
          </Btn>
          <Btn xs onClick={() => setSelected([])}>Clear selection</Btn>
          <span className="faint" style={{ fontSize: 11 }}>
            shift-click selects a range
          </span>
        </div>
      )}

      <div className="faint" style={{ fontSize: 11, lineHeight: 1.7 }}>
        Applying a selection re-scopes every tab — overview, authors, files, directories — to exactly those commits.
        {f.commits.length > 0 && (
          <>
            {' '}
            Current filter:{' '}
            {f.commits.slice(0, 6).map((h) => (
              <span className="mono" key={h} style={{ marginRight: 6 }}>
                {h}
              </span>
            ))}
            {f.commits.length > 6 ? `… +${f.commits.length - 6}` : ''} ·{' '}
            <button style={{ color: 'var(--amber)' }} onClick={() => set({ commits: [] })}>
              clear
            </button>
          </>
        )}
      </div>
    </div>
  )
}
