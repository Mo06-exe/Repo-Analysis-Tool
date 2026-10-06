// API response types — mirrors backend/app/queries.py + routes.py

export type RepoStatus = 'queued' | 'cloning' | 'extracting' | 'parsing' | 'ready' | 'error'

export interface Repo {
  id: number
  name: string
  source: 'upload' | 'clone'
  source_ref: string | null
  repo_dir: string
  status: RepoStatus
  progress: number
  error: string | null
  head_hash: string | null
  default_branch: string | null
  branch_count: number
  tag_count: number
  commit_count: number
  author_count: number
  file_count: number
  first_ts: number | null
  last_ts: number | null
  total_added: number
  total_deleted: number
  created_at: number
  updated_at: number
  parsed_at: number | null
}

export interface Summary {
  commits: number
  merges: number
  first_ts: number | null
  last_ts: number | null
  added: number
  deleted: number
  authors: number
  active_days: number
  files: number
  net: number
  span_days: number
}

export interface Timeline {
  bucket: 'day' | 'week' | 'month' | 'year'
  labels: string[]
  totals: { commits: number[]; added: number[]; deleted: number[] }
  series: {
    author_id: number
    name: string
    commits: number[]
    added: number[]
    deleted: number[]
  }[]
  others: { commits: number[]; added: number[]; deleted: number[] }
}

export interface AuthorRow {
  author_id: number
  name: string
  email: string
  commits: number
  merges: number
  added: number
  deleted: number
  files_touched_sum: number
  first_ts: number | null
  last_ts: number | null
  active_days: number
  files: number
  coauthored: number
  net: number
  churn: number
  churn_share: number
  avg_commit_size: number
}

export interface AuthorDetail {
  top_files: { path: string; repo_id: number; commits: number; added: number; deleted: number }[]
  sizes: { count: number; p50: number; p90: number; max: number }
}

export interface FileRow {
  repo_id: number
  repo_name: string
  path: string
  n_commits: number
  n_authors: number
  added: number
  deleted: number
  first_ts: number
  last_ts: number
  binary: number
  churn: number
  net: number
}

export interface FileDetail {
  stats: {
    n_commits: number
    n_authors: number
    added: number
    deleted: number
    first_ts: number
    last_ts: number
    binary: number
    churn: number
    net: number
  } | null
  authors: {
    author_id: number
    name: string
    email: string
    commits: number
    added: number
    deleted: number
    first_ts: number
    last_ts: number
  }[]
  recent_commits: { id: number; hash: string; ts: number; subject: string; added: number; deleted: number; author_name: string; author_id: number }[]
  blame: Blame | null
}

export interface Blame {
  total_lines: number
  owners: { name: string; email: string; lines: number }[]
}

export interface DirRow {
  repo_id: number
  dir: string
  kind: 'dir' | 'file'
  depth: number
  files: number
  n_commits: number
  n_authors: number
  added: number
  deleted: number
  first_ts: number
  last_ts: number
  binary?: number
}

export interface CommitRow {
  id: number
  repo_id: number
  repo_name: string
  hash: string
  ts: number
  subject: string
  parents: number
  is_merge: number
  files: number
  added: number
  deleted: number
  author_id: number
  author_name: string
  churn: number
}

export interface CommitDetail {
  commit: CommitRow & { body: string; repo_name: string; author_email: string; raw_name: string; raw_email: string }
  files: { path: string; added: number; deleted: number; binary: number }[]
  coauthors: { name: string; email: string; author_id: number }[]
}

export interface Composition {
  rows: { ext: string; files: number; added: number; deleted: number }[]
}

export interface Identity {
  id: number
  repo_id: number
  repo_name: string
  name: string
  email: string
  canonical_id: number
  via_mailmap: number
  commits: number
  first_ts: number | null
  last_ts: number | null
}

export interface IdentityAuthor {
  id: number
  name: string
  email: string
  commits: number
  coauthored: number
  identity_count: number
  first_ts: number | null
  last_ts: number | null
}

export interface IdentitiesView {
  authors: IdentityAuthor[]
  identities: Identity[]
}
