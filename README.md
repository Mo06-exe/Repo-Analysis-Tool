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

## Requirements

- **Python 3.11+** (runtime) and **Node 18+** (to build the UI — not needed at runtime)
- **git** on `PATH`: all history reading shells out to real Git, never a re-implementation

## Quickstart

```bash
./run.sh          # builds the frontend if needed, serves on http://localhost:8000
./dev.sh          # backend on :8000 (reload) + vite dev server on :5173
```

Manual equivalent:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install && npm --prefix frontend run build
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
```

No repository handy? Generate one:

```bash
./scripts/make_demo_repo.sh /tmp/stratum-demo   # then zip it or point a clone at it
```

The demo repository ships with duplicate author identities, a `.mailmap`, a merge,
a co-authored commit and a binary asset — handy for exercising the Identities tab.

Data (SQLite db + repository mirrors) lives in `./data` — delete it to start over.

## HTTP API

Everything the UI does is plain JSON over these routes (interactive schema at
`/api/docs` while the server runs):

| Route | Purpose |
|---|---|
| `GET /api/repos` · `POST /api/repos/clone` · `POST /api/repos/upload` | repository management |
| `POST /api/repos/{id}/refresh` · `DELETE /api/repos/{id}` | re-mirror / remove |
| `GET /api/repos/{id}/blame?path=` | line ownership at HEAD (LRU-cached) |
| `GET /api/analysis/summary` · `/timeline` · `/composition` | repository scope |
| `GET /api/analysis/authors` · `/author?author=` | author scope |
| `GET /api/analysis/files` · `/file?repo=&path=` | file scope (+ per-author churn, blame, recent history) |
| `GET /api/analysis/dirs[?flat=1]` | directory roll-ups |
| `GET /api/analysis/commits` · `/commit/{id}` | commit list / detail |
| `GET /api/analysis/identities` | raw identities grouped under canonical authors |
| `POST /api/authors/merge` · `POST /api/identities/{id}/split` · `PATCH /api/authors/{id}` | identity surgery |

Every analysis route accepts the same filter vocabulary:

```
repos=1,2          restrict to repositories
authors=3,7        restrict to canonical authors
path=src/core      exact file, or every path beneath the prefix
from=2024-01-01&to=2024-06-30     commit-date window (inclusive)
commits=ab12cd,ef34ab             explicit commit whitelist (hash prefixes)
```

## Running locally

A step-by-step guide. Both launchers are idempotent — they create the
virtualenv, install missing dependencies and (for `run.sh`) rebuild the
frontend only when sources changed — so the first run does the heavy lifting
and later starts are near-instant.

### 1. Set up the Python environment

Requires Python 3.11+ (see [Requirements](#requirements)). From the project
root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
```

Both launchers run these two commands automatically when `.venv` is missing
or FastAPI/uvicorn are not yet installed. To use a specific interpreter, set
`PYTHON` (e.g. `PYTHON=/usr/bin/python3.11 ./run.sh`).

### 2. Install frontend dependencies

Requires Node 18+ — build-time only; the built UI is served by the backend, so
Node is not needed at runtime.

```bash
npm --prefix frontend install
```

`dev.sh` and `run.sh` run this automatically whenever `frontend/node_modules`
is missing.

### 3. Launch the server

#### Development mode — `./dev.sh`

```bash
./dev.sh
```

Starts two processes side by side, and stops both on `Ctrl-C`:

| Process | URL | Behavior |
|---|---|---|
| Backend (uvicorn) | http://127.0.0.1:8000 | `--reload`: restarts on edits under `backend/` |
| Frontend (vite) | http://localhost:5173 | hot-reloads `frontend/src`; proxies `/api` to the backend |

Open **http://localhost:5173** in a browser. Use this mode while developing:
UI edits appear instantly, and backend edits restart the API on their own.

#### Production mode — `./run.sh`

```bash
./run.sh
```

Rebuilds `frontend/dist` when it is missing or older than the sources, then
serves the static dashboard and the JSON API from a single uvicorn process.
Open **http://localhost:8000**. The port is configurable:

```bash
PORT=9000 ./run.sh        # serves on http://localhost:9000
```

### Launching by hand

Prefer to run every step yourself? This is what the launchers do, explicitly:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend install && npm --prefix frontend run build
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
```

Then open http://localhost:8000. For a live-reload frontend against the same
backend, skip the build step and start the vite dev server instead
(`npm --prefix frontend run dev`), then visit http://localhost:5173.

## Layout

```
run.sh, dev.sh     launchers: single-process production / vite hot-reload dev mode
backend/app        FastAPI service, git plumbing, streaming parser, metrics SQL
frontend/src       React dashboard (vite; hand-rolled CSS + SVG charts, no UI kit)
scripts            demo-repo generator for local testing
data/              runtime: sqlite db + mirrored repositories (git-ignored)
```
