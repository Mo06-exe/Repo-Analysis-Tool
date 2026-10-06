// Overview: the readout after a scope is chosen. KPI strip, activity strata
// (stacked by author), contributors, composition, hotspots, dirs, recents.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { useFilters } from '../filters'
import { useRepos } from '../store'
import type { AuthorRow, CommitRow, Composition, DirRow, FileRow, Summary, Timeline } from '../types'
import { BarList, Empty, ErrNote, Kpis, Loading, Panel } from '../components/Bits'
import { Legend, OTHERS_COLOR, StrataChart, colorFor } from '../components/Charts'
import { Seg } from '../components/Bits'
import { extLabel, fmtCompact, fmtInt, fmtPct, fmtSigned, fmtSpan, relTime, shortHash } from '../format'

type Metric = 'commits' | 'added' | 'deleted' | 'churn'
type Bucket = 'auto' | 'day' | 'week' | 'month' | 'year'

function pick(metric: Metric, s: { commits: number[]; added: number[]; deleted: number[] }): number[] {
  if (metric === 'commits') return s.commits
  if (metric === 'added') return s.added
  if (metric === 'deleted') return s.deleted
  return s.added.map((v, i) => v + (s.deleted[i] ?? 0))
}

export function OverviewView() {
  const { f, set, params } = useFilters()
  const { repos } = useRepos()
  const navigate = useNavigate()
  const [metric, setMetric] = useState<Metric>('commits')
  const [bucket, setBucket] = useState<Bucket>('auto')

  const scopeRepoCount = f.repos.length || repos.filter((r) => r.status === 'ready').length
  const multiRepo = scopeRepoCount > 1
  const repoName = (id: number) => repos.find((r) => r.id === id)?.name ?? `#${id}`
  const repoChip = (id: number) => (multiRepo ? <span className="repo-chip">{repoName(id)}</span> : null)

  const summary = useApi<Summary>('/api/analysis/summary', params)
  const timeline = useApi<Timeline>('/api/analysis/timeline', { ...params, bucket, top: 7 })
  const authors = useApi<{ rows: AuthorRow[] }>('/api/analysis/authors', params)
  const hotspots = useApi<{ rows: FileRow[]; total: number }>('/api/analysis/files', { ...params, sort: 'churn', per_page: 10 })
  const dirs = useApi<{ rows: DirRow[] }>('/api/analysis/dirs', params)
  const recent = useApi<{ rows: CommitRow[]; total: number }>('/api/analysis/commits', { ...params, per_page: 10 })
  const composition = useApi<Composition>('/api/analysis/composition', params)

  const chart = useMemo(() => {
    const tl = timeline.data
    if (!tl) return null
    const series = tl.series.map((s, i) => ({
      key: String(s.author_id),
      name: s.name,
      color: colorFor(i),
      values: pick(metric, s),
    }))
    const othersVals = pick(metric, tl.others)
    if (othersVals.some((v) => v > 0)) {
      series.push({ key: 'others', name: 'others', color: OTHERS_COLOR, values: othersVals })
    }
    return { labels: tl.labels, series, bucket: tl.bucket }
  }, [timeline.data, metric])

  const s = summary.data
  const toggleAuthor = (key: string) => {
    const id = Number(key)
    if (!Number.isFinite(id)) return
    set({ authors: f.authors.includes(id) ? f.authors.filter((a) => a !== id) : [...f.authors, id] })
  }

  return (
    <div className="stack">
      {summary.error && <ErrNote error={summary.error} onRetry={summary.reload} />}

      {!s ? (
        <Loading label="computing metrics" />
      ) : (
        <Kpis
          items={[
            { label: 'Commits', value: fmtInt(s.commits), note: `${fmtInt(s.merges)} merges` },
            { label: 'Authors', value: fmtInt(s.authors), note: 'distinct canonical' },
            { label: 'Active days', value: fmtInt(s.active_days), note: s.active_days > 0 ? `${(s.commits / s.active_days).toFixed(1)} commits/day` : '' },
            { label: 'Files', value: fmtInt(s.files), note: 'paths touched' },
            { label: 'Added', value: <span className="add">+{fmtCompact(s.added)}</span>, note: 'lines introduced' },
            { label: 'Deleted', value: <span className="del">−{fmtCompact(s.deleted)}</span>, note: 'lines removed' },
            { label: 'Net', value: fmtSigned(s.net), note: 'added − deleted' },
            { label: 'Span', value: fmtSpan(s.span_days), note: s.first_ts ? `${fmtSpan(s.span_days)} of history` : '' },
          ]}
        />
      )}

      <div className="grid main">
        <Panel
          title="Activity"
          note={chart ? `bucket: ${chart.bucket}` : undefined}
          actions={
            <>
              <Seg<Metric>
                value={metric}
                onChange={setMetric}
                options={[
                  { value: 'commits', label: 'commits' },
                  { value: 'churn', label: 'churn' },
                  { value: 'added', label: '+' },
                  { value: 'deleted', label: '−' },
                ]}
              />
              <Seg<Bucket>
                value={bucket}
                onChange={setBucket}
                options={[
                  { value: 'auto', label: 'auto' },
                  { value: 'day', label: 'd' },
                  { value: 'week', label: 'w' },
                  { value: 'month', label: 'm' },
                  { value: 'year', label: 'y' },
                ]}
              />
            </>
          }
        >
          {timeline.loading && !chart ? (
            <Loading label="building timeline" />
          ) : timeline.error ? (
            <ErrNote error={timeline.error} onRetry={timeline.reload} />
          ) : chart && chart.labels.length ? (
            <>
              <StrataChart labels={chart.labels} series={chart.series} valueName={metric} />
              <div style={{ marginTop: 8 }}>
                <Legend
                  items={chart.series.map((sr) => ({
                    key: sr.key,
                    name: sr.key === 'others' ? 'others' : sr.name,
                    color: sr.color,
                    muted: sr.key === 'others',
                  }))}
                  onClick={toggleAuthor}
                />
              </div>
            </>
          ) : (
            <Empty title="No activity in scope" note="Loosen the filters to see the timeline." />
          )}
        </Panel>

        <div className="stack">
          <Panel title="Contributors" note={authors.data ? `${authors.data.rows.length} in scope` : undefined} flush>
            {authors.data ? (
              <BarList
                rows={authors.data.rows.slice(0, 8).map((a) => ({
                  key: a.author_id,
                  label: a.name,
                  value: a.commits,
                  valueText: fmtInt(a.commits),
                  sub: fmtPct(a.churn_share, 0),
                }))}
                onRowClick={(k) => toggleAuthor(String(k))}
              />
            ) : (
              <Loading />
            )}
          </Panel>

          <Panel title="Composition" note="by extension" flush>
            {composition.data ? (
              composition.data.rows.length ? (
                <BarList
                  rows={composition.data.rows.slice(0, 8).map((c) => ({
                    key: c.ext || '(other)',
                    label: <span className="mono">{extLabel(c.ext)}</span>,
                    value: c.files,
                    valueText: fmtInt(c.files),
                    sub: c.added + c.deleted > 0 ? `±${fmtCompact(c.added + c.deleted)}` : '',
                  }))}
                />
              ) : (
                <Empty title="No files in scope" />
              )
            ) : (
              <Loading />
            )}
          </Panel>
        </div>
      </div>

      <div className="grid tri">
        <Panel title="Hotspots" note="most churned files" flush>
          {hotspots.data ? (
            hotspots.data.rows.length ? (
              <BarList
                rows={hotspots.data.rows.map((r) => ({
                  key: `${r.repo_id}:${r.path}`,
                  label: (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span className="mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.path}>
                        {r.path}
                      </span>
                      {repoChip(r.repo_id)}
                    </span>
                  ),
                  value: r.churn,
                  valueText: fmtInt(r.churn),
                  sub: `${r.n_commits}c`,
                }))}
                onRowClick={(k) => {
                  const row = hotspots.data?.rows.find((r) => `${r.repo_id}:${r.path}` === k)
                  if (row) {
                    set({ path: row.path, repos: f.repos.length ? f.repos : [] })
                    navigate('/d/files')
                  }
                }}
              />
            ) : (
              <Empty title="Nothing touched in scope" />
            )
          ) : (
            <Loading />
          )}
        </Panel>

        <Panel title="Directories" note={f.path ? `under ${f.path}` : 'top level'} flush>
          {dirs.data ? (
            dirs.data.rows.length ? (
              <BarList
                rows={dirs.data.rows.slice(0, 10).map((d) => ({
                  key: `${d.repo_id}:${d.dir}`,
                  label: (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {d.dir}
                        {d.kind === 'dir' ? '/' : ''}
                      </span>
                      {repoChip(d.repo_id)}
                    </span>
                  ),
                  value: d.n_commits,
                  valueText: `${d.n_commits}c`,
                  sub: `${d.files}f`,
                }))}
                onRowClick={(k) => {
                  const row = dirs.data?.rows.find((d) => `${d.repo_id}:${d.dir}` === k)
                  if (!row) return
                  if (row.kind === 'dir') set({ path: row.dir })
                  else {
                    set({ path: row.dir })
                    navigate('/d/files')
                  }
                }}
              />
            ) : (
              <Empty title="No directories in scope" />
            )
          ) : (
            <Loading />
          )}
        </Panel>

        <Panel title="Latest commits" flush>
          {recent.data ? (
            recent.data.rows.length ? (
              <div className="filelist" style={{ padding: '4px 0' }}>
                {recent.data.rows.map((c) => (
                  <div
                    className="fl-row"
                    key={c.id}
                    style={{ padding: '3px 12px', cursor: 'pointer' }}
                    onClick={() => navigate('/d/commits')}
                  >
                    <span className="hashlink" style={{ fontSize: 11 }}>
                      {shortHash(c.hash)}
                    </span>
                    <span className="trunc" style={{ flex: 1, fontSize: 12 }}>
                      {c.subject}
                    </span>
                    {multiRepo && <span className="repo-chip">{c.repo_name}</span>}
                    <span className="fl-val" style={{ color: 'var(--tx-3)' }}>
                      {c.author_name}
                    </span>
                    <span className="fl-val" style={{ color: 'var(--tx-3)', minWidth: 62, textAlign: 'right' }}>
                      {relTime(c.ts)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No commits in scope" />
            )
          ) : (
            <Loading />
          )}
        </Panel>
      </div>
    </div>
  )
}
