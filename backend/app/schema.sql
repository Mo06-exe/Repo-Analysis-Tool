-- Stratum storage schema.
--
-- Layout: one row per repository; commit metadata is denormalized with its
-- per-commit totals (files/added/deleted) so author- and repo-level metrics
-- never need to touch file_changes. Path-level questions (files, dirs) walk
-- file_changes, which carries the same filters.
--
-- Author identity is two-layered:
--   identities = raw (name, email) pairs as seen in commits, per repository
--   authors    = canonical people, global, one per resolved email
-- Commits point at identities; every metric groups by canonical author.

CREATE TABLE IF NOT EXISTS repos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  source         TEXT    NOT NULL CHECK (source IN ('upload', 'clone')),
  source_ref     TEXT,                       -- origin URL or original zip filename
  repo_dir       TEXT    NOT NULL,           -- path to the git dir (bare or .git)
  status         TEXT    NOT NULL DEFAULT 'queued',
                 -- queued | cloning | extracting | parsing | ready | error
  progress       REAL    NOT NULL DEFAULT 0,
  error          TEXT,
  head_hash      TEXT,
  default_branch TEXT,
  branch_count   INTEGER NOT NULL DEFAULT 0,
  tag_count      INTEGER NOT NULL DEFAULT 0,
  commit_count   INTEGER NOT NULL DEFAULT 0,
  author_count   INTEGER NOT NULL DEFAULT 0,
  file_count     INTEGER NOT NULL DEFAULT 0,
  first_ts       INTEGER,
  last_ts        INTEGER,
  total_added    INTEGER NOT NULL DEFAULT 0,
  total_deleted  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  parsed_at      INTEGER
);

CREATE TABLE IF NOT EXISTS authors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id      INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  canonical_id INTEGER NOT NULL REFERENCES authors(id),
  via_mailmap  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, name, email)
);

CREATE TABLE IF NOT EXISTS commits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id     INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  hash        TEXT NOT NULL,
  identity_id INTEGER NOT NULL REFERENCES identities(id),
  ts          INTEGER NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  parents     INTEGER NOT NULL DEFAULT 0,
  is_merge    INTEGER NOT NULL DEFAULT 0,
  files       INTEGER NOT NULL DEFAULT 0,
  added       INTEGER NOT NULL DEFAULT 0,
  deleted     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, hash)
);

CREATE TABLE IF NOT EXISTS file_changes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id   INTEGER NOT NULL,
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  path      TEXT NOT NULL,
  added     INTEGER NOT NULL DEFAULT 0,
  deleted   INTEGER NOT NULL DEFAULT 0,
  binary    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS coauthors (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id   INTEGER NOT NULL,
  commit_id INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id),   -- canonical co-author
  name      TEXT NOT NULL,
  email     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_repo_ts    ON commits(repo_id, ts);
CREATE INDEX IF NOT EXISTS idx_commits_repo_hash  ON commits(repo_id, hash);
CREATE INDEX IF NOT EXISTS idx_commits_identity   ON commits(identity_id);
CREATE INDEX IF NOT EXISTS idx_fc_commit          ON file_changes(commit_id);
CREATE INDEX IF NOT EXISTS idx_fc_repo_path       ON file_changes(repo_id, path);
CREATE INDEX IF NOT EXISTS idx_identities_canon   ON identities(canonical_id);
CREATE INDEX IF NOT EXISTS idx_identities_email   ON identities(email);
CREATE INDEX IF NOT EXISTS idx_coauthors_commit   ON coauthors(commit_id);
CREATE INDEX IF NOT EXISTS idx_coauthors_author   ON coauthors(author_id);
