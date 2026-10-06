// Identities: the author-normalization workbench. Shows raw name/email pairs
// grouped under their canonical author, flags mailmap resolution, and lets
// the user merge strays together, detach mistakes, and rename canonical
// authors. Merges re-scope instantly across all tabs and survive re-parses.

import { useMemo, useState } from 'react'
import { api } from '../api'
import { refreshRepos, useRepos } from '../store'
import { useApi } from '../useApi'
import { useFilters } from '../filters'
import type { IdentitiesView as IdentitiesData, Identity } from '../types'
import { Btn, Empty, ErrNote, Loading, Panel, Tag } from '../components/Bits'
import { toast } from '../components/Toast'
import { fmtDate, fmtInt } from '../format'
import { IconChevron, IconMerge, IconRefresh } from '../components/Icons'

export function IdentitiesView() {
  const { f } = useFilters()
  const { repos } = useRepos()
  const repoName = (id: number) => repos.find((r) => r.id === id)?.name ?? `#${id}`
  const repoParam = f.repos.length ? f.repos.join(',') : undefined

  const data = useApi<IdentitiesData>('/api/analysis/identities', { repos: repoParam })
  const [openAuthors, setOpenAuthors] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [target, setTarget] = useState<string>('')
  const [editing, setEditing] = useState<number | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftEmail, setDraftEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const byAuthor = useMemo(() => {
    const map = new Map<number, Identity[]>()
    for (const ident of data.data?.identities ?? []) {
      const list = map.get(ident.canonical_id) ?? []
      list.push(ident)
      map.set(ident.canonical_id, list)
    }
    return map
  }, [data.data])

  const mailmapCount = (data.data?.identities ?? []).filter((i) => i.via_mailmap).length

  const toggleAuthor = (id: number) => {
    setOpenAuthors((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleIdentity = (id: number) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const merge = async () => {
    if (!selected.size || busy) return
    setBusy(true)
    try {
      const res = await api<{ author: { id: number; name: string }; merged: number }>('/api/authors/merge', {
        method: 'POST',
        body: { identity_ids: [...selected], target_author_id: target ? Number(target) : null },
      })
      toast('ok', `Merged ${res.merged} identities into “${res.author.name}”`)
      setSelected(new Set())
      setTarget('')
      data.reload()
      void refreshRepos()
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const split = async (identityId: number) => {
    try {
      const res = await api<{ author: { name: string } }>(`/api/identities/${identityId}/split`, { method: 'POST' })
      toast('ok', `Detached — now its own author “${res.author.name}”`)
      setSelected((cur) => {
        const next = new Set(cur)
        next.delete(identityId)
        return next
      })
      data.reload()
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    }
  }

  const saveRename = async (authorId: number) => {
    try {
      await api(`/api/authors/${authorId}`, { method: 'PATCH', body: { name: draftName, email: draftEmail } })
      toast('ok', 'Canonical author updated')
      setEditing(null)
      data.reload()
    } catch (e) {
      toast('err', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="stack">
      <Panel
        title="Author identities"
        note={
          data.data ? (
            <>
              {data.data.authors.length} canonical authors · {data.data.identities.length} raw identities
              {mailmapCount > 0 ? ` · ${mailmapCount} via .mailmap` : ''}
            </>
          ) : undefined
        }
        actions={
          <Btn xs onClick={data.reload} title="reload">
            <IconRefresh size={12} /> Reload
          </Btn>
        }
        flush
      >
        {data.error ? (
          <ErrNote error={data.error} onRetry={data.reload} />
        ) : !data.data ? (
          <Loading label="collecting identities" />
        ) : data.data.identities.length === 0 ? (
          <Empty title="No identities in scope" />
        ) : (
          <div>
            {data.data.authors.map((a) => {
              const idents = byAuthor.get(a.id) ?? []
              const open = openAuthors.has(a.id)
              const multi = idents.length > 1
              return (
                <div className="ident-group" key={a.id}>
                  <div className="ident-head" style={{ cursor: 'pointer' }} onClick={() => toggleAuthor(a.id)}>
                    <IconChevron open={open} />
                    {editing === a.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <input className="inline-edit" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="name" />
                        <input
                          className="inline-edit mono"
                          value={draftEmail}
                          onChange={(e) => setDraftEmail(e.target.value)}
                          placeholder="email"
                        />
                        <Btn xs kind="primary" onClick={() => void saveRename(a.id)}>
                          Save
                        </Btn>
                        <Btn xs onClick={() => setEditing(null)}>
                          Cancel
                        </Btn>
                      </span>
                    ) : (
                      <>
                        <span className="ih-name">{a.name}</span>
                        <span className="ih-mail">{a.email}</span>
                        {multi && (
                          <Tag tone="amber" title="several raw identities map to this author">
                            {idents.length} identities
                          </Tag>
                        )}
                        <span className="ih-stats">
                          <span>{fmtInt(a.commits)} commits</span>
                          {a.coauthored > 0 && <span>{fmtInt(a.coauthored)} co-authored</span>}
                          <span className="faint">
                            {fmtDate(a.first_ts)} → {fmtDate(a.last_ts)}
                          </span>
                          <button
                            className="btn ghost xs"
                            title="rename this canonical author"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditing(a.id)
                              setDraftName(a.name)
                              setDraftEmail(a.email)
                            }}
                          >
                            rename
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                  {open &&
                    idents.map((i) => (
                      <div className="ident-row" key={i.id}>
                        <input
                          type="checkbox"
                          className="ck"
                          checked={selected.has(i.id)}
                          onChange={() => toggleIdentity(i.id)}
                          title="select for merging"
                        />
                        <span className="ir-name">{i.name}</span>
                        <span className="ir-mail">{i.email}</span>
                        {i.via_mailmap ? (
                          <Tag tone="green" title="resolved via the repository .mailmap">
                            mailmap
                          </Tag>
                        ) : null}
                        <span className="repo-chip">{repoName(i.repo_id)}</span>
                        <span className="ir-stats">
                          <span>{fmtInt(i.commits)}c</span>
                          <span>
                            {fmtDate(i.first_ts)} → {fmtDate(i.last_ts)}
                          </span>
                          {idents.length > 1 && (
                            <button
                              className="btn ghost xs"
                              title="detach this identity into its own author"
                              onClick={() => void split(i.id)}
                            >
                              detach
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      {selected.size > 0 && (
        <div className="selbar">
          <span>
            <IconMerge size={13} /> <b>{selected.size}</b> identit{selected.size === 1 ? 'y' : 'ies'} selected
          </span>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} style={{ height: 24 }}>
            <option value="">→ into a new author…</option>
            {(data.data?.authors ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {`→ into ${a.name} <${a.email}>`}
              </option>
            ))}
          </select>
          <Btn kind="primary" xs disabled={busy} onClick={() => void merge()}>
            {busy ? 'merging…' : 'Merge'}
          </Btn>
          <Btn xs onClick={() => setSelected(new Set())}>
            Clear
          </Btn>
        </div>
      )}

      <div className="faint" style={{ fontSize: 11, lineHeight: 1.7 }}>
        {mailmapCount > 0
          ? 'Identities marked “mailmap” were already unified by the repository’s .mailmap — nothing to do for those. '
          : 'This history has no .mailmap. Merge duplicate names/emails by ticking their checkboxes here — '}
        Merging is stored in the database and re-applied automatically on every re-parse, so refreshes and new commits
        keep the same grouping. A canonical author’s name and email are just display labels; they never rewrite commit
        history.
        {data.data && data.data.authors.length < data.data.identities.length && (
          <span style={{ color: 'var(--amber)', marginLeft: 6 }}>
            {data.data.identities.length - data.data.authors.length} potential duplicate
            {data.data.identities.length - data.data.authors.length === 1 ? '' : 's'} to review.
          </span>
        )}
      </div>
    </div>
  )
}
