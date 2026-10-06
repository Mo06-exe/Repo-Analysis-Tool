# Stratum

Repository archaeology for engineering teams. Point Stratum at a Git repository —
upload a zip or clone a URL — and read its history as sediment: who wrote what,
where it accumulated, and which files absorb the most churn.

## What it measures

Metrics are computed at four scopes, each filterable by repository, author,
file/directory path, and commit set (date range or hand-picked commits).

| Scope | Metrics |
|---|---|
| Repository | commits, contributors, files touched, lines added/deleted/net, churn, merge commits, active days, span, branches, tags, per-day rate |
| Author | commits, added/deleted/net lines, churn share, files touched, active days, first/last commit, mean / median / p90 commit size, co-authored commits |
| File | commits, distinct authors, added/deleted, churn, first/last change, current blame ownership, recent history |
| Directory | roll-up of all descendant files: file count, commits, distinct authors, churn, last change, depth |

## Ingesting repositories

- **Zip upload** — a `.zip` of a working tree containing `.git` (directory or
  `gitdir:` pointer file) or a bare repository.
- **Clone** — any cloneable URL; a full mirror clone (`git clone --mirror`), so
  every ref and the complete history is captured.

## Author identity

Git author identity is messy; Stratum treats it as data.

1. Every commit's `(name, email)` pair is resolved through the repository's
   `.mailmap` (HEAD revision) at parse time, following the documented precedence:
   full `(name, email)` match, then email-only match.
2. Distinct emails become canonical authors; commits from the same email across
   repositories collapse into one person on the multi-repo dashboard.
3. The **Identities** tab lists every raw identity with commit counts and lets you
   merge, split, and rename authors by hand at any time — mailmap not required.

## Design notes

- All history parsing is streaming: one pass for metadata, one for numstat,
  written into SQLite (WAL) in a single transaction per repository.
- The dashboard is served as a static build by the same process; no external
  services, no accounts, no telemetry.
- The UI is a dense instrument panel, not a landing page: monospace figures,
  hairline borders, keyboard-free but fast, every number one hover from its source.

## Quickstart

```bash
./run.sh          # builds the frontend if needed, serves on http://localhost:8000
./dev.sh          # backend on :8000 (reload) + vite dev server on :5173
```

Data (SQLite db + repository mirrors) lives in `./data` — delete it to start over.

## Layout

```
backend/app      FastAPI service, git plumbing, parser, metrics queries
frontend/src     React dashboard (vite, no UI framework)
scripts          demo-repo generator for local testing
```
