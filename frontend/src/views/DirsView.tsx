// Directories: two modes — Level (children of the current path, drill down by
// clicking) and Flat (every ancestor directory rolled up independently).

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { useFilters, useViewParam } from '../filters'
import { useRepos } from '../store'
import type { DirRow } from '../types'
import { Btn, Empty, ErrNote, Loading, Panel, Seg } from '../components/Bits'
import { RatioBar } from '../components/Charts'
import { fmtCompact, fmtDate, fmtInt, fmtSigned } from '../format'
import { PathCrumb } from './FilesView'

export function DirsView() {
  const { f, set, params } = useFilters()
  const [mode, setMode] = useViewParam('mode', 'level') // level | flat
  const { repos } = useRepos()
  const navigate = useNavigate()
  const repoName = (id: number) => repos.find((r) => r.id === id)?.name ?? `#${id}`

  const dirs = useApi<{ rows: DirRow[]; truncated?: boolean }>('/api/analysis/dirs', {
    ...params,
    flat: mode === 'flat' ? true : undefined,
  })

  const rows = dirs.data?.rows ?? []
  const multiRepo = useMemo(() => new Set(rows.map((r) => r.repo_id)).size > 1, [rows])

  const clickRow = (r: DirRow) => {
    if (r.kind === 'file') {
      set({ path: r.dir })
      navigate('/d/files')
      return
    }
    set({ path: r.dir })
    if (mode === 'flat') setMode('level')
  }

  return (
    <div className="stack">
      <Panel
        title="Directories"
        note={
          <>
            {fmtInt(rows.length)} {mode === 'flat' ? 'directories' : 'entries'}
            {f.path ? ` under ${f.path}` : ' at root'}
          </>
        }
        actions={
          <>
            {f.path && <PathCrumb path={f.path} onPick={(p) => set({ path: p })} />}
            <Seg<string>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'level', label: 'Level', title: 'one level below the current path' },
                { value: 'flat', label: 'Flat', title: 'every directory, rolled up' },
              ]}
            />
          </>
        }
        flush
      >
        {dirs.error ? (
          <ErrNote error={dirs.error} onRetry={dirs.reload} />
        ) : !dirs.data ? (
          <Loading label="rolling up directories" />
        ) : rows.length === 0 ? (
          <Empty title="No directories in scope" note={f.path ? 'Nothing beneath this path.' : undefined}>
            {f.path ? <Btn onClick={() => set({ path: null })}>Back to root</Btn> : null}
          </Empty>
        ) : (
          <table className="dtable">
            <thead>
              <tr>
                <th>{mode === 'flat' ? 'Directory' : 'Name'}</th>
                <th className="num">Files</th>
                <th className="num">Commits</th>
                <th className="num">Authors</th>
                <th className="num">Added</th>
                <th className="num">Deleted</th>
                <th className="num">Churn</th>
                <th className="num">Net</th>
                <th>Ratio</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const churn = r.added + r.deleted
                const isDir = r.kind === 'dir'
                const label = mode === 'flat' ? r.dir : lastSegment(r.dir)
                return (
                  <tr
                    key={`${r.repo_id}:${r.dir}`}
                    className="clickable"
                    onClick={() => clickRow(r)}
                    title={r.dir + (isDir ? '/' : '')}
                  >
                    <td>
                      <span className="mono" style={{ fontSize: 11.5, color: isDir ? 'var(--amber)' : 'var(--tx)' }}>
                        {label}
                        {isDir ? '/' : ''}
                      </span>
                      {mode === 'flat' && r.depth > 0 && (
                        <span className="faint" style={{ marginLeft: 6, fontSize: 9.5 }}>
                          d{r.depth}
                        </span>
                      )}
                      {!isDir && !multiRepo && <span className="faint" style={{ marginLeft: 6, fontSize: 10 }}>file</span>}
                      {multiRepo && <span className="repo-chip" style={{ marginLeft: 8 }}>{repoName(r.repo_id)}</span>}
                    </td>
                    <td className="num">{fmtInt(r.files)}</td>
                    <td className="num">{fmtInt(r.n_commits)}</td>
                    <td className="num">{fmtInt(r.n_authors)}</td>
                    <td className="num add">+{fmtCompact(r.added)}</td>
                    <td className="num del">−{fmtCompact(r.deleted)}</td>
                    <td className="num">{fmtInt(churn)}</td>
                    <td className="num">{fmtSigned(r.added - r.deleted)}</td>
                    <td>
                      <RatioBar added={r.added} deleted={r.deleted} width={80} />
                    </td>
                    <td className="faint" style={{ fontSize: 11 }}>
                      {fmtDate(r.first_ts)} → {fmtDate(r.last_ts)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="faint" style={{ fontSize: 11, lineHeight: 1.7 }}>
        {mode === 'level'
          ? 'Click a directory to descend; click a file to jump to it in the Files tab. Metrics roll up everything beneath each directory.'
          : 'Flat mode lists every ancestor directory separately — a commit that touches src/core/util.py counts toward src, src/core and the repo rollup, so numbers include all descendants.'}
        {dirs.data?.truncated ? ' Output truncated.' : ''}
      </div>
    </div>
  )
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}
