"""HTTP API.

Conventions
-----------
* Every analysis endpoint reads the same filter vocabulary as query params:
  `repos`, `authors`, `path`, `from`, `to`, `commits` (comma-separated lists).
 `from`/`to` accept unix seconds or `YYYY-MM-DD`.
* `repos` defaults to every repository currently in `ready` state.
* `commits` is a whitelist of (possibly abbreviated) hashes governing all four
  metric scopes at once — the "manually selected commits" filter.
"""

from __future__ import annotations

import time
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from . import db, ingest, queries
from .queries import Filters

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024  # 8 GiB
MAX_SELECTED_COMMITS = 2000


# --------------------------------------------------------------------------- helpers

def _parse_ts(value: str | None, end_of_day: bool = False) -> int | None:
    if not value:
        return None
    value = value.strip()
    if value.isdigit():
        return int(value)
    try:
        parts = [int(p) for p in value.split("-")]
        if len(parts) != 3:
            raise ValueError
        import calendar

        struct = (parts[0], parts[1], parts[2], 23, 59, 59, 0, 0, 0) if end_of_day else (
            parts[0], parts[1], parts[2], 0, 0, 0, 0, 0, 0
        )
        return calendar.timegm(struct)
    except ValueError:
        raise HTTPException(400, f"cannot parse date {value!r} (use unix seconds or YYYY-MM-DD)")


def _parse_ids(value: str | None) -> list[int]:
    if not value:
        return []
    try:
        return [int(v) for v in value.split(",") if v.strip()]
    except ValueError:
        raise HTTPException(400, "list params must be comma-separated integers")


def _ready_repo_ids() -> list[int]:
    return [r["id"] for r in db.query("SELECT id FROM repos WHERE status='ready' ORDER BY id")]


def parse_filters(
    repos: str | None = Query(None, description="comma-separated repo ids; default: all ready"),
    authors: str | None = Query(None, description="comma-separated canonical author ids"),
    path: str | None = Query(None, description="file or directory path"),
    from_: str | None = Query(None, alias="from", description="unix seconds or YYYY-MM-DD"),
    to: str | None = Query(None, description="unix seconds or YYYY-MM-DD"),
    commits: str | None = Query(None, description="comma-separated commit hash prefixes"),
) -> Filters:
    repo_ids = _parse_ids(repos) or _ready_repo_ids()
    commit_list = []
    if commits:
        commit_list = [c.strip().lower() for c in commits.split(",") if c.strip()]
        if len(commit_list) > MAX_SELECTED_COMMITS:
            raise HTTPException(400, f"at most {MAX_SELECTED_COMMITS} commits can be selected")
    return Filters(
        repos=repo_ids,
        authors=_parse_ids(authors),
        path=queries.normalize_path(path),
        from_ts=_parse_ts(from_),
        to_ts=_parse_ts(to, end_of_day=True),
        commits=commit_list,
    )


def repo_or_404(repo_id: int) -> dict:
    row = db.query_one("SELECT * FROM repos WHERE id=?", (repo_id,))
    if not row:
        raise HTTPException(404, "repository not found")
    return row


# --------------------------------------------------------------------------- repos

@router.get("/health")
def health() -> dict:
    return {"ok": True, "time": int(time.time())}


@router.get("/stats")
def stats() -> dict:
    row = db.query_one(
        """SELECT COUNT(*) AS repos, COALESCE(SUM(commit_count),0) AS commits,
                  COALESCE(SUM(file_count),0) AS files, COALESCE(SUM(total_added),0) AS added,
                  COALESCE(SUM(total_deleted),0) AS deleted
           FROM repos WHERE status='ready'"""
    )
    return row or {}


@router.get("/repos")
def list_repos() -> dict:
    rows = db.query("SELECT * FROM repos ORDER BY created_at DESC, id DESC")
    return {"rows": rows}


@router.get("/repos/{repo_id}")
def get_repo(repo_id: int) -> dict:
    return {"repo": repo_or_404(repo_id)}


class CloneBody(BaseModel):
    url: str
    name: str | None = None


@router.post("/repos/clone")
def clone_repo(body: CloneBody) -> dict:
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "url is required")
    name = (body.name or "").strip()
    if not name:
        base = url.rstrip("/").split("/")[-1]
        name = base[:-4] if base.endswith(".git") else base
    repo_id = ingest.create_repo(name or "repository", "clone", url)
    ingest.start_ingest(repo_id, "clone", url)
    return {"id": repo_id}


@router.post("/repos/upload")
async def upload_repo(
    request: Request,
    name: str | None = Query(None),
    filename: str | None = Query(None),
) -> dict:
    tmp = db.TMP_DIR / f"upload-{uuid.uuid4().hex}.zip"
    size = 0
    try:
        with open(tmp, "wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "archive too large")
                fh.write(chunk)
        if size == 0:
            raise HTTPException(400, "empty upload")
        if not zipfile.is_zipfile(tmp):
            raise HTTPException(400, "upload is not a zip archive")
        display = (name or "").strip()
        if not display and filename:
            display = Path(filename).name
            if display.lower().endswith(".zip"):
                display = display[:-4]
        repo_id = ingest.create_repo(display or "archive", "upload", filename or None)
        ingest.start_ingest(repo_id, "upload", str(tmp))
        return {"id": repo_id}
    except HTTPException:
        tmp.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        raise HTTPException(500, f"upload failed: {exc}")


@router.post("/repos/{repo_id}/refresh")
def refresh_repo(repo_id: int) -> dict:
    repo_or_404(repo_id)
    if ingest.is_busy(repo_id):
        raise HTTPException(409, "repository is currently being processed")
    queries.clear_blame_cache(repo_id)
    ingest.start_refresh(repo_id)
    return {"ok": True}


@router.delete("/repos/{repo_id}")
def delete_repo(repo_id: int) -> dict:
    repo_or_404(repo_id)
    if not ingest.delete_repo(repo_id):
        raise HTTPException(409, "repository is currently being processed")
    queries.clear_blame_cache(repo_id)
    return {"ok": True}


@router.get("/repos/{repo_id}/blame")
def blame(repo_id: int, path: str = Query(...)) -> dict:
    repo_or_404(repo_id)
    return {"blame": queries.get_blame(repo_id, queries.normalize_path(path) or path)}


# --------------------------------------------------------------------------- analysis

@router.get("/analysis/summary")
def analysis_summary(f: Filters = Depends(parse_filters)) -> dict:
    return queries.summary(f)


@router.get("/analysis/timeline")
def analysis_timeline(
    bucket: str = Query("auto", pattern="^(auto|day|week|month|year)$"),
    top: int = Query(8, ge=1, le=24),
    f: Filters = Depends(parse_filters),
) -> dict:
    return queries.timeline(f, bucket=bucket, top_n=top)


@router.get("/analysis/authors")
def analysis_authors(f: Filters = Depends(parse_filters)) -> dict:
    return queries.authors_table(f)


@router.get("/analysis/author")
def analysis_author(author: int = Query(...), f: Filters = Depends(parse_filters)) -> dict:
    return queries.author_detail(f, author)


@router.get("/analysis/files")
def analysis_files(
    sort: str = Query("churn"),
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=10, le=500),
    q: str | None = Query(None),
    f: Filters = Depends(parse_filters),
) -> dict:
    return queries.files_table(f, sort=sort, limit=per_page, offset=(page - 1) * per_page, q=q)


@router.get("/analysis/file")
def analysis_file(repo: int = Query(...), path: str = Query(...), f: Filters = Depends(parse_filters)) -> dict:
    repo_or_404(repo)
    path = queries.normalize_path(path) or path
    return queries.file_detail(f, repo, path)


@router.get("/analysis/dirs")
def analysis_dirs(
    flat: bool = Query(False),
    f: Filters = Depends(parse_filters),
) -> dict:
    return queries.dirs_table(f, flat=flat)


@router.get("/analysis/commits")
def analysis_commits(
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=10, le=500),
    q: str | None = Query(None),
    ignore_commits: bool = Query(False, description="browse the full set even while a commit filter is active"),
    f: Filters = Depends(parse_filters),
) -> dict:
    return queries.commits_list(
        f, limit=per_page, offset=(page - 1) * per_page, q=q, ignore_commits=ignore_commits
    )


@router.get("/analysis/commit/{commit_id}")
def analysis_commit(commit_id: int) -> dict:
    detail = queries.commit_detail(commit_id)
    if not detail:
        raise HTTPException(404, "commit not found")
    return detail


@router.get("/analysis/composition")
def analysis_composition(f: Filters = Depends(parse_filters)) -> dict:
    return queries.composition(f)


# --------------------------------------------------------------------------- author management

@router.get("/analysis/identities")
def analysis_identities(repos: str | None = Query(None)) -> dict:
    repo_ids = _parse_ids(repos) or _ready_repo_ids()
    return queries.identities_view(repo_ids)


class MergeBody(BaseModel):
    identity_ids: list[int]
    target_author_id: int | None = None


@router.post("/authors/merge")
def merge_authors(body: MergeBody) -> dict:
    try:
        return queries.merge_identities(body.identity_ids, body.target_author_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/identities/{identity_id}/split")
def split_identity(identity_id: int) -> dict:
    try:
        return queries.split_identity(identity_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


class RenameBody(BaseModel):
    name: str
    email: str


@router.patch("/authors/{author_id}")
def rename_author(author_id: int, body: RenameBody) -> dict:
    try:
        return queries.rename_author(author_id, body.name, body.email)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
