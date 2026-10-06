// Authors: one row per canonical developer, sortable client-side, with an
// expandable detail (top files, commit-size percentiles, activity sparkline).

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { useFilters } from '../filters'
import type { AuthorDetail, AuthorRow, Timeline } from '../types'
import { DataTable, nextSort } from '../components/DataTable'
import type { Column, SortState } from '../components/DataTable'
import { Btn, ErrNote, KV, Loading, Panel } from '../components/Bits'
import { RatioBar, Sparkline } from '../components/Charts'
import { fmtCompact, fmtDate, fmtInt, fmtPct, fmtSigned, fmtSpan } from '../format'

function AuthorDetailRow({ authorId, params }: { authorId: number; params: Record<string, unknown> }) {
  const { f, set } = useFilters()
  const navigate = useNavigate()
  const detail = useApi<AuthorDetail>('/api/analysis/author', { ...params, author: authorId })
  const spark = useApi<Timeline>('/api/analysis/timeline', { ...params, authors: authorId, bucket: 'month', top: 1 })

  const d = detail.data
  return (
    <div className="detail-grid">
      <div className="detail-block">
        <div className="db-title">top files by churn</div>
        {d ? (
          d.top_files.length ? (
            <div className="filelist">
              {d.top_files.map((t) => (
                <div className="fl-row" key={`${t.repo_id}:${t.path}`}>
                  <span className="fl-path" title={t.path}>
                    {t.path}
                  </span>
                  <span className="fl-val">
                    {t.commits}c · <span className="add">+{fmtCompact(t.added)}</span>{' '}
                    <span className="del">−{fmtCompact(t.deleted)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="faint">no files in scope</div>
          )
        ) : (
          <Loading />
        )}
      </div>

      <div className="detail-block">
        <div className="db-title">commit size · lines changed</div>
        {d ? (
          <KV
            items={[
              { k: 'p50', v: fmtInt(d.sizes.p50) },
              { k: 'p90', v: fmtInt(d.sizes.p90) },
              { k: 'max', v: fmtInt(d.sizes.max) },
              { k: 'commits', v: fmtInt(d.sizes.count) },
            ]}
          />
        ) : (
          <Loading />
        )}
        <div className="db-title" style={{ marginTop: 14 }}>
          monthly commits
        </div>
        {spark.data && spark.data.series.length ? (
          <Sparkline values={spark.data.series[0].commits} width={200} height={34} />
        ) : (
          <div className="faint">—</div>
        )}
      </div>

      <div className="detail-block">
        <div className="db-title">scope</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn
            xs
            kind={f.authors.includes(authorId) ? 'primary' : 'default'}
            onClick={() =>
              set({ authors: f.authors.includes(authorId) ? f.authors.filter((a) => a !== authorId) : [...f.authors, authorId] })
            }
          >
            {f.authors.includes(authorId) ? 'Unfilter this author' : 'Filter to this author'}
          </Btn>
          <Btn xs onClick={() => navigate('/d/commits')}>
            View commits
          </Btn>
        </div>
      </div>
    </div>
  )
}

export function AuthorsView() {
  const { f, set, params } = useFilters()
  const authors = useApi<{ rows: AuthorRow[] }>('/api/analysis/authors', params)
  const [sort, setSort] = useState<SortState | null>({ key: 'commits', dir: 'desc' })
  const [expanded, setExpanded] = useState<number | null>(null)

  const rows = useMemo(() => {
    const list = [...(authors.data?.rows ?? [])]
    if (!sort) return list
    const dir = sort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sort.key]
      const bv = (b as unknown as Record<string, unknown>)[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return list
  }, [authors.data, sort])

  const columns: Column<AuthorRow>[] = [
    {
      key: 'name',
      label: 'Author',
      render: (a) => (
        <>
          <span style={{ color: 'var(--tx)' }}>{a.name}</span>{' '}
          <span className="faint mono" style={{ fontSize: 11 }}>
            {a.email}
          </span>
        </>
      ),
      sortable: true,
    },
    { key: 'commits', label: 'Commits', num: true, render: (a) => fmtInt(a.commits), sortable: true },
    { key: 'merges', label: 'Merges', num: true, render: (a) => (a.merges ? fmtInt(a.merges) : '·'), sortable: true },
    {
      key: 'churn_share',
      label: 'Share',
      num: true,
      width: 120,
      render: (a) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span className="sharebar" style={{ width: 60 }}>
            <div style={{ width: `${Math.min(100, a.churn_share * 100)}%` }} />
          </span>
          {fmtPct(a.churn_share, 1)}
        </span>
      ),
      sortable: true,
    },
    { key: 'added', label: 'Added', num: true, render: (a) => <span className="add">+{fmtCompact(a.added)}</span>, sortable: true },
    { key: 'deleted', label: 'Deleted', num: true, render: (a) => <span className="del">−{fmtCompact(a.deleted)}</span>, sortable: true },
    { key: 'net', label: 'Net', num: true, render: (a) => fmtSigned(a.net), sortable: true },
    {
      key: 'ratio',
      label: 'Ratio',
      width: 110,
      render: (a) => <RatioBar added={a.added} deleted={a.deleted} />,
    },
    { key: 'files', label: 'Files', num: true, render: (a) => fmtInt(a.files), sortable: true },
    { key: 'avg_commit_size', label: 'Ø commit', num: true, render: (a) => fmtInt(Math.round(a.avg_commit_size)), sortable: true, title: 'average churn per commit' },
    { key: 'active_days', label: 'Days', num: true, render: (a) => fmtInt(a.active_days), sortable: true, title: 'distinct active days' },
    { key: 'coauthored', label: 'Co-auth', num: true, render: (a) => (a.coauthored ? fmtInt(a.coauthored) : '·'), sortable: true, title: 'co-authored commits (Co-authored-by trailer)' },
    {
      key: 'first_ts',
      label: 'First',
      render: (a) => <span className="faint">{fmtDate(a.first_ts)}</span>,
      sortable: true,
    },
    {
      key: 'last_ts',
      label: 'Last',
      render: (a) => (
        <span className="faint">
          {fmtDate(a.last_ts)}
          <span className="faint"> · {fmtSpan(((a.last_ts ?? 0) - (a.first_ts ?? 0)) / 86400)}</span>
        </span>
      ),
      sortable: true,
    },
  ]

  return (
    <Panel
      title="Authors"
      note={
        authors.data
          ? `${rows.length} canonical authors${f.authors.length ? ` · ${f.authors.length} filtered` : ''}`
          : undefined
      }
      actions={
        f.authors.length ? (
          <Btn xs onClick={() => set({ authors: [] })}>
            Clear author filter
          </Btn>
        ) : undefined
      }
      flush
    >
      {authors.error ? (
        <ErrNote error={authors.error} onRetry={authors.reload} />
      ) : !authors.data ? (
        <Loading label="aggregating per author" />
      ) : (
        <DataTable<AuthorRow>
          columns={columns}
          rows={rows}
          rowKey={(a) => a.author_id}
          sort={sort}
          onSort={(key) => setSort((cur) => nextSort(cur, key))}
          expandable
          expandedKey={expanded}
          onRowClick={(a) => setExpanded((cur) => (cur === a.author_id ? null : a.author_id))}
          renderExpanded={(a) => <AuthorDetailRow authorId={a.author_id} params={params} />}
        />
      )}
    </Panel>
  )
}
