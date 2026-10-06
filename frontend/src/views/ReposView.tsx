// Repository management: ingest (clone / zip upload), monitor progress,
// refresh and remove. This is the only view that talks to ingest endpoints.

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiUpload } from '../api'
import { isBusyRepo, refreshRepos, useRepos } from '../store'
import type { Repo } from '../types'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { Btn, Dot, Empty, ErrNote, Loading, Panel, Prog, Tag } from '../components/Bits'
import { IconBranch, IconLink, IconPlus, IconRefresh, IconTrash, IconUpload } from '../components/Icons'
import { fmtCompact, fmtDate, fmtSigned, fmtSize, relTime, statusLabel } from '../format'

function statusTone(r: Repo): 'ok' | 'warn' | 'err' | 'idle' {
  if (r.status === 'ready') return 'ok'
  if (r.status === 'error') return 'err'
  if (r.status === 'queued') return 'idle'
  return 'warn'
}

function AddRepoModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'clone' | 'upload'>('clone')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (tab === 'clone') {
        if (!url.trim()) return
        await api('/api/repos/clone', { method: 'POST', body: { url: url.trim(), name: name.trim() || null } })
        toast('ok', 'Clone started — full history is being mirrored')
      } else {
        if (!file) return
        await apiUpload('/api/repos/upload', { name: name.trim(), filename: file.name }, file)
        toast('ok', 'Archive uploaded — extracting and parsing')
      }
      void refreshRepos()
      onClose()
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add repository"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" onClick={submit} disabled={busy || (tab === 'clone' ? !url.trim() : !file)}>
            {busy ? 'Starting…' : tab === 'clone' ? 'Clone' : 'Upload'}
          </Btn>
        </>
      }
    >
      <div className="mtabs">
        <button className={tab === 'clone' ? 'on' : ''} onClick={() => setTab('clone')}>
          Clone remote URL
        </button>
        <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
          Upload .zip
        </button>
      </div>

      {tab === 'clone' ? (
        <>
          <div className="field">
            <label>repository url</label>
            <input
              className="input mono"
              placeholder="https://github.com/org/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label>display name (optional)</label>
            <input className="input" placeholder="defaults to the repository name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="faint" style={{ fontSize: 11 }}>
            A full mirror clone is performed, so every branch and tag is included. Private repositories need credentials
            configured for the git user running the server.
          </div>
        </>
      ) : (
        <>
          <div
            className={over ? 'dropzone over' : 'dropzone'}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) setFile(f)
            }}
          >
            {file ? (
              <>
                <div className="dz-big mono">{file.name}</div>
                <div>{fmtSize(file.size)}</div>
              </>
            ) : (
              <>
                <div className="dz-big">Drop a .zip here, or click to browse</div>
                <div>must contain the .git directory (or a .git pointer / bare repository)</div>
              </>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>display name (optional)</label>
            <input className="input" placeholder="defaults to the archive name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </>
      )}
    </Modal>
  )
}

export function ReposView() {
  const { repos, loaded, error } = useRepos()
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Repo | null>(null)
  const navigate = useNavigate()

  const removeRepo = async (repo: Repo) => {
    try {
      await api(`/api/repos/${repo.id}`, { method: 'DELETE' })
      toast('ok', `Removed “${repo.name}”`)
      void refreshRepos()
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    } finally {
      setConfirmDelete(null)
    }
  }

  const refreshRepo = async (repo: Repo) => {
    try {
      await api(`/api/repos/${repo.id}/refresh`, { method: 'POST' })
      toast('ok', `Fetching new commits for “${repo.name}”`)
      void refreshRepos()
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="content">
      <div className="page">
        <div className="stack">
          <Panel
            title="Repositories"
            note={loaded ? `${repos.length} total · ${repos.filter((r) => r.status === 'ready').length} analyzed` : undefined}
            actions={
              <>
                <Btn kind="primary" xs onClick={() => setAdding(true)}>
                  <IconPlus size={12} /> Add repository
                </Btn>
                <Btn xs onClick={() => void refreshRepos()} title="reload this list">
                  <IconRefresh size={12} />
                </Btn>
              </>
            }
            flush
          >
            {!loaded ? (
              <Loading label="loading repositories" />
            ) : repos.length === 0 ? (
              <Empty title="No repositories" note="Clone a remote URL or upload a .zip archive containing .git to begin.">
                <Btn kind="primary" onClick={() => setAdding(true)}>
                  Add repository
                </Btn>
              </Empty>
            ) : (
              <table className="dtable">
                <thead>
                  <tr>
                    <th style={{ width: '22%' }}>Repository</th>
                    <th>Source</th>
                    <th style={{ width: 130 }}>Status</th>
                    <th className="num">Commits</th>
                    <th className="num">Authors</th>
                    <th className="num">Files</th>
                    <th className="num">Added</th>
                    <th className="num">Deleted</th>
                    <th>History window</th>
                    <th>Parsed</th>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {repos.map((r) => (
                    <tr key={r.id} className={r.status === 'ready' ? 'clickable' : ''} onClick={() => r.status === 'ready' && navigate(`/d/overview?repos=${r.id}`)}>
                      <td>
                        <span style={{ color: 'var(--tx)' }}>{r.name}</span>
                        <span className="faint" style={{ marginLeft: 8, fontSize: 10 }}>
                          #{r.id}
                        </span>
                      </td>
                      <td>
                        <span className="faint" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                          {r.source === 'clone' ? <IconLink size={11} /> : <IconUpload size={11} />}
                          <span className="trunc mono" style={{ maxWidth: 220, display: 'inline-block', verticalAlign: 'bottom' }} title={r.source_ref ?? ''}>
                            {r.source_ref ?? '—'}
                          </span>
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, width: '100%' }}>
                          <Dot tone={statusTone(r)} />
                          <span className="dim" style={{ fontSize: 11 }}>
                            {statusLabel(r.status)}
                          </span>
                          {isBusyRepo(r) && <Prog value={r.progress} />}
                        </span>
                        {r.error && (
                          <div className="faint trunc" style={{ fontSize: 10, maxWidth: 220 }} title={r.error}>
                            {r.error}
                          </div>
                        )}
                      </td>
                      <td className="num">{r.commit_count || '—'}</td>
                      <td className="num">{r.author_count || '—'}</td>
                      <td className="num">{r.file_count || '—'}</td>
                      <td className="num add">{r.total_added ? '+' + fmtCompact(r.total_added) : '—'}</td>
                      <td className="num del">{r.total_deleted ? '−' + fmtCompact(r.total_deleted) : '—'}</td>
                      <td className="faint" style={{ fontSize: 11 }}>
                        {r.first_ts ? (
                          <>
                            {fmtDate(r.first_ts)} → {fmtDate(r.last_ts)}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="faint" style={{ fontSize: 11 }}>
                        {r.parsed_at ? relTime(r.parsed_at) : '—'}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          {r.source === 'clone' && (
                            <Btn xs kind="ghost" title="fetch new commits and re-parse" onClick={() => void refreshRepo(r)} disabled={isBusyRepo(r)}>
                              <IconRefresh size={12} />
                            </Btn>
                          )}
                          <Btn xs kind="ghost" title="remove this repository and its metrics" onClick={() => setConfirmDelete(r)} disabled={isBusyRepo(r)}>
                            <IconTrash size={12} />
                          </Btn>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {error && <ErrNote error={error} onRetry={() => void refreshRepos()} />}

          <div className="faint" style={{ fontSize: 11, lineHeight: 1.7 }}>
            <IconBranch size={11} /> Metrics cover the entire commit graph reachable from all refs (branches and tags),
            not just the default branch. Merges are counted, never walked into for per-file line stats, so a merged
            branch's changes are attributed once — at the commits that authored them.
          </div>

          {loaded && repos.some((r) => r.status === 'ready') && (
            <div className="faint" style={{ fontSize: 11 }}>
              Tip: click a ready repository row to scope the analysis to it, or use the filter bar above any analysis tab.
              {repos.some((r) => r.status === 'ready' && r.branch_count > 1) && (
                <span style={{ marginLeft: 4 }}>
                  {repos.filter((r) => r.status === 'ready').map((r) => (
                    <Tag key={r.id} tone={r.branch_count > 1 ? 'blue' : undefined} title={`${r.branch_count} branches · ${r.tag_count} tags`}>
                      {r.name}: {r.branch_count}b/{r.tag_count}t
                    </Tag>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {adding && <AddRepoModal onClose={() => setAdding(false)} />}
      {confirmDelete && (
        <Modal
          title="Remove repository"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Btn onClick={() => setConfirmDelete(null)}>Cancel</Btn>
              <Btn kind="danger" onClick={() => void removeRepo(confirmDelete)}>
                Remove permanently
              </Btn>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            Remove <b>{confirmDelete.name}</b> and all of its parsed history? The local mirror on disk is deleted too.
          </p>
          <div className="faint" style={{ fontSize: 11 }}>
            {fmtSigned(confirmDelete.commit_count)} commits · {fmtCompact(confirmDelete.total_added)} added ·{' '}
            {fmtCompact(confirmDelete.total_deleted)} deleted will be dropped from the database.
          </div>
        </Modal>
      )}
    </div>
  )
}
