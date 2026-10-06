// Files: searchable, sortable, paginated list of every path touched in
// scope. Expanding a row pulls the file's per-author breakdown, blame
// ownership and recent commits.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi, useDebounced } from '../useApi'
import { useFilters, useViewParam } from '../filters'
import type { FileDetail, FileRow, Summary } from '../types'
import { DataTable } from '../components/DataTable'
import type { Column, SortState } from '../components/DataTable'
import { Btn, ErrNote, Empty, KV, Loading, Panel } from '../components/Bits'
import { RatioBar, colorFor } from '../components/Charts'
import { fmtCompact, fmtDate, fmtInt, fmtPct, fmtSigned, shortHash } from '../format'
import { IconSearch } from '../components/Icons'

export function PathCrumb({ path, onPick }: { path: string; onPick: (p: string | null) => void }) {
  const segs = path.split('/')
  const accum: string[] = []
  return (
    <span className="crumb">
      <button onClick={() => onPick(null)} title="clear path filter">
        (root)
      </button>
      {segs.map((s, i) => {
        accum.push(s)
        const p = accum.join('/')
        const last = i === segs.length - 1
        return (
          <span key={p}>
            <span className="sep">/</span>
            <button
              onClick={() => !last && onPick(p)}
              style={last ? { color: 'var(--tx)', cursor: 'default' } : undefined}
            >
              {s}
            </button>
          </span>
        )
      })}
    </span>
  )
}

function FileDetailRow({ repoId, path }: { repoId: number; path: string }) {
  const { set } = useFilters()
  const navigate = useNavigate()
  const detail = useApi<FileDetail>('/api/analysis/file', { repo: repoId, path })
  const d = detail.data

  const openCommits = () => {
    set({ path })
    navigate('/d/commits')
  }

  const blameTotal = d?.blame?.total_lines ?? 0

  return (
    <div>
      <div className="detail-grid">
        <div className="detail-block">
          <div className="db-title">file</div>
          <div className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', marginBottom: 10 }}>
            {path}
          </div>
          {d && d.stats ? (
            <KV
              items={[
                { k: 'commits', v: fmtInt(d.stats.n_commits) },
                { k: 'authors', v: fmtInt(d.stats.n_authors) },
                { k: 'added', v: <span className="add">+{fmtCompact(d.stats.added)}</span> },
                { k: 'deleted', v: <span className="del">−{fmtCompact(d.stats.deleted)}</span> },
                { k: 'net', v: fmtSigned(d.stats.net) },
                { k: 'first', v: <span style={{ fontSize: 11 }}>{fmtDate(d.stats.first_ts)}</span> },
                { k: 'last', v: <span style={{ fontSize: 11 }}>{fmtDate(d.stats.last_ts)}</span> },
                ...(d.stats.binary ? [{ k: 'binary', v: 'yes' }] : []),
              ]}
            />
          ) : (
            <Loading />
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <Btn xs onClick={() => set({ path })}>
              Filter everywhere to this path
            </Btn>
            <Btn xs onClick={openCommits}>
              Commits touching it
            </Btn>
          </div>
        </div>

        <div className="detail-block">
          <div className="db-title">authors of this file</div>
          {d ? (
            d.authors.length ? (
              <div className="filelist">
                {d.authors.map((a) => (
                  <div className="fl-row" key={a.author_id}>
                    <span className="fl-path" style={{ fontFamily: 'var(--font-ui)', color: 'var(--tx-2)', minWidth: 90 }}>
                      {a.name}
                    </span>
                    <span className="fl-val">
                      {a.commits}c · <span className="add">+{fmtCompact(a.added)}</span>{' '}
                      <span className="del">−{fmtCompact(a.deleted)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="faint">no changes in scope</div>
            )
          ) : (
            <Loading />
          )}
        </div>

        <div className="detail-block">
          <div className="db-title">blame ownership · HEAD</div>
          {d ? (
            d.blame && blameTotal > 0 ? (
              <>
                <div className="blame-ribbon">
                  {d.blame.owners.map((o, i) => (
                    <div
                      key={`${o.email}:${i}`}
                      style={{ width: `${(o.lines / blameTotal) * 100}%`, background: colorFor(i) }}
                      title={`${o.name} — ${o.lines} lines`}
                    />
                  ))}
                </div>
                <div className="filelist" style={{ marginTop: 8 }}>
                  {d.blame.owners.slice(0, 8).map((o, i) => (
                    <div className="fl-row" key={`${o.email}:${i}`}>
                      <span
                        style={{ width: 7, height: 7, borderRadius: 1, background: colorFor(i), flex: 'none', display: 'inline-block' }}
                      />
                      <span className="fl-path" style={{ fontFamily: 'var(--font-ui)', color: 'var(--tx-2)' }}>
                        {o.name}
                      </span>
                      <span className="fl-val">
                        {fmtInt(o.lines)} · {fmtPct(o.lines / blameTotal, 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="faint">blame unavailable (binary, huge, or merge-only file)</div>
            )
          ) : (
            <Loading />
          )}
        </div>
      </div>

      {d && d.recent_commits.length > 0 && (
        <div className="detail-block" style={{ marginTop: 14 }}>
          <div className="db-title">recent commits touching this file</div>
          <div className="filelist">
            {d.recent_commits.map((c) => (
              <div className="fl-row" key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/d/commits?q=${shortHash(c.hash)}`)}>
                <span className="hashlink">{shortHash(c.hash)}</span>
                <span className="fl-path" style={{ fontFamily: 'var(--font-ui)', color: 'var(--tx-2)', flex: 1 }}>
                  {c.subject}
                </span>
                <span className="fl-val" style={{ color: 'var(--tx-3)' }}>
                  {c.author_name}
                </span>
                <span className="fl-val" style={{ color: 'var(--tx-3)', minWidth: 70, textAlign: 'right' }}>
                  {fmtDate(c.ts)}
                </span>
                <span className="fl-val">
                  <span className="add">+{fmtCompact(c.added)}</span> <span className="del">−{fmtCompact(c.deleted)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function FilesView() {
  const { f, set, params } = useFilters()
  const [q, setQ] = useViewParam('q', '')
  const [sort, setSort] = useViewParam('sort', 'churn')
  const [page, setPage] = useViewParam('page', '1')
  const [expanded, setExpanded] = useState<string | null>(null)
  const debouncedQ = useDebounced(q, 250)

  const summary = useApi<Summary>('/api/analysis/summary', params)
  const files = useApi<{ rows: FileRow[]; total: number }>('/api/analysis/files', {
    ...params,
    sort,
    page,
    per_page: 100,
    q: debouncedQ || undefined,
  })

  const rows = files.data?.rows ?? []
  const total = files.data?.total ?? 0
  const perPage = 100
  const pageNum = Math.max(1, Number(page) || 1)
  const pages = Math.max(1, Math.ceil(total / perPage))

  const multiRepo = useMemo(() => new Set(rows.map((r) => r.repo_id)).size > 1, [rows])

  const columns: Column<FileRow>[] = useMemo(
    () => [
      {
        key: 'path',
        label: 'Path',
        render: (r) => (
          <>
            <span className="mono" style={{ fontSize: 11.5 }} title={r.path}>
              {r.path}
            </span>
            {r.binary ? <span className="tag" style={{ marginLeft: 8 }}>bin</span> : null}
            {multiRepo && <span className="repo-chip" style={{ marginLeft: 8 }}>{r.repo_name}</span>}
          </>
        ),
        sortable: true,
      },
      // column keys must match the backend FILE_SORTS keys so the server sorts
      { key: 'commits', label: 'Commits', num: true, render: (r) => fmtInt(r.n_commits), sortable: true },
      { key: 'authors', label: 'Authors', num: true, render: (r) => fmtInt(r.n_authors), sortable: true },
      { key: 'added', label: 'Added', num: true, render: (r) => <span className="add">+{fmtCompact(r.added)}</span>, sortable: true },
      { key: 'deleted', label: 'Deleted', num: true, render: (r) => <span className="del">−{fmtCompact(r.deleted)}</span>, sortable: true },
      { key: 'churn', label: 'Churn', num: true, render: (r) => fmtInt(r.churn), sortable: true },
      { key: 'net', label: 'Net', num: true, render: (r) => fmtSigned(r.net), sortable: true },
      { key: 'ratio', label: 'Ratio', width: 105, render: (r) => <RatioBar added={r.added} deleted={r.deleted} /> },
      { key: 'recent', label: 'Last change', render: (r) => <span className="faint">{fmtDate(r.last_ts)}</span>, sortable: true },
    ],
    [multiRepo],
  )

  const sortState: SortState = { key: sort, dir: sort === 'path' ? 'asc' : 'desc' }

  return (
    <div className="stack">
      <Panel
        title="Files"
        note={
          <>
            {fmtInt(total)} path{total === 1 ? '' : 's'} in scope
            {f.path ? ' · filtered by ' : ''}
          </>
        }
        actions={
          <>
            {f.path && <PathCrumb path={f.path} onPick={(p) => set({ path: p })} />}
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 8, color: 'var(--tx-3)', display: 'inline-flex' }}>
                <IconSearch size={12} />
              </span>
              <input
                className="input"
                style={{ paddingLeft: 26, width: 220 }}
                placeholder="filter paths…"
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
        {files.error ? (
          <ErrNote error={files.error} onRetry={files.reload} />
        ) : !files.data ? (
          <Loading label="scanning files" />
        ) : rows.length === 0 ? (
          <Empty
            title="No files match"
            note={f.path || debouncedQ ? 'Try clearing the path filter or search.' : 'No changes in scope.'}
          >
            {f.path ? <Btn onClick={() => set({ path: null })}>Clear path filter</Btn> : null}
          </Empty>
        ) : (
          <DataTable<FileRow>
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.repo_id}:${r.path}`}
            sort={sortState}
            onSort={(key) => setSort(key)}
            expandable
            expandedKey={expanded}
            onRowClick={(r) => setExpanded((cur) => (cur === `${r.repo_id}:${r.path}` ? null : `${r.repo_id}:${r.path}`))}
            renderExpanded={(r) => <FileDetailRow repoId={r.repo_id} path={r.path} />}
            footer={
              <>
                <span>
                  page {pageNum} / {pages} · {perPage} per page
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

      {summary.data && (
        <div className="faint" style={{ fontSize: 11 }}>
          Scope: {fmtInt(summary.data.commits)} commits · {fmtInt(summary.data.files)} paths ·{' '}
          <span className="add">+{fmtCompact(summary.data.added)}</span>{' '}
          <span className="del">−{fmtCompact(summary.data.deleted)}</span>. Sort by any column header; expand a row for
          per-author churn and blame.
        </div>
      )}
    </div>
  )
}
