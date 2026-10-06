"""Repository ingestion.

Two sources, one pipeline: `ingest_zip` unpacks an uploaded archive and locates
the git directory inside it; `ingest_clone` performs a full mirror clone with
progress reporting. Both end in `parse.repo_parse`, which materializes metrics.
Jobs run on daemon threads; repository `status` in the database is the single
source of truth the API polls.
"""

from __future__ import annotations

import shutil
import threading
import time
import zipfile
from pathlib import Path

from . import db, gitcmd, parse

_busy: set[int] = set()
_busy_lock = threading.Lock()


# --------------------------------------------------------------------------- jobs

def is_busy(repo_id: int) -> bool:
    with _busy_lock:
        return repo_id in _busy


def _mark_busy(repo_id: int, on: bool) -> None:
    with _busy_lock:
        if on:
            _busy.add(repo_id)
        else:
            _busy.discard(repo_id)


def _status(repo_id: int, status: str, progress: float = 0.0, error: str | None = None) -> None:
    db.execute(
        "UPDATE repos SET status=?, progress=?, error=?, updated_at=? WHERE id=?",
        (status, round(progress, 4), error, int(time.time()), repo_id),
    )


def create_repo(name: str, source: str, source_ref: str | None) -> int:
    now = int(time.time())
    name = (name or "repository").strip()[:120] or "repository"
    with db.write_tx() as c:
        cur = c.execute(
            "INSERT INTO repos (name, source, source_ref, repo_dir, status, created_at, updated_at)"
            " VALUES (?, ?, ?, '', 'queued', ?, ?)",
            (name, source, source_ref, now, now),
        )
        repo_id = cur.lastrowid
        repo_dir = str(db.REPOS_DIR / f"r{repo_id}")
        c.execute("UPDATE repos SET repo_dir=? WHERE id=?", (repo_dir, repo_id))
    return repo_id


def start_ingest(repo_id: int, source: str, payload: str) -> None:
    """Kick off ingestion on a background thread. `payload` is a zip path or URL."""
    _mark_busy(repo_id, True)
    target = ingest_zip if source == "upload" else ingest_clone
    thread = threading.Thread(target=_job, args=(repo_id, target, payload), daemon=True, name=f"ingest-{repo_id}")
    thread.start()


def _job(repo_id: int, target, payload: str) -> None:
    try:
        target(repo_id, payload)
        parse.repo_parse(repo_id)
    except Exception as exc:  # noqa: BLE001 — surface every failure to the UI
        _status(repo_id, "error", 0.0, f"{type(exc).__name__}: {exc}"[:900])
    finally:
        _mark_busy(repo_id, False)


# --------------------------------------------------------------------------- zip

def _is_git_dir(p: Path) -> bool:
    return (p / "HEAD").is_file() and (p / "objects").is_dir()


def find_git_dir(root: Path) -> Path:
    """Locate the git directory inside an extracted archive.

    Handles: repo root containing `.git/`, a bare repository, a `.git` file with
    a `gitdir:` pointer, and archives wrapped in a single top-level folder.
    """
    def resolve_dotgit(p: Path) -> Path | None:
        if p.is_dir():
            return p if _is_git_dir(p) else None
        if p.is_file():
            text = p.read_text(encoding="utf-8", errors="replace").strip()
            if text.lower().startswith("gitdir:"):
                target = text.split(":", 1)[1].strip()
                resolved = (p.parent / target).resolve() if not Path(target).is_absolute() else Path(target)
                if resolved.is_dir() and _is_git_dir(resolved):
                    return resolved
        return None

    candidates: list[Path] = [root]
    if root.is_dir():
        candidates += [c for c in root.iterdir() if c.is_dir() and c.name != "__MACOSX"]

    for base in candidates:
        if _is_git_dir(base):
            return base
        dotgit = base / ".git"
        resolved = resolve_dotgit(dotgit) if dotgit.exists() else None
        if resolved:
            return resolved
        # one more level (e.g. archive_root/project/.git)
        if base.is_dir():
            for child in base.iterdir():
                if child.is_dir() and child.name != "__MACOSX":
                    if _is_git_dir(child):
                        return child
                    dotgit = child / ".git"
                    resolved = resolve_dotgit(dotgit) if dotgit.exists() else None
                    if resolved:
                        return resolved
    raise gitcmd.GitError(
        "no git repository found in archive — expected a .git directory/file "
        "or a bare repository (HEAD + objects/)"
    )


def ingest_zip(repo_id: int, zip_path: str) -> None:
    _status(repo_id, "extracting", 0.05)
    row = db.query_one("SELECT repo_dir FROM repos WHERE id=?", (repo_id,))
    dest = Path(row["repo_dir"]) / "repo"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    with zipfile.ZipFile(zip_path) as zf:
        try:
            zf.extractall(dest, filter="data")  # blocks absolute paths and traversal
        except TypeError:  # python < 3.12 fallback
            _extract_sanitized(zf, dest)

    _status(repo_id, "extracting", 0.5)
    git_dir = find_git_dir(dest)
    db.execute("UPDATE repos SET repo_dir=? WHERE id=?", (str(git_dir), repo_id))
    try:
        Path(zip_path).unlink(missing_ok=True)
    except OSError:
        pass


def _extract_sanitized(zf: zipfile.ZipFile, dest: Path) -> None:
    base = dest.resolve()
    for info in zf.infolist():
        target = (dest / info.filename).resolve()
        if not str(target).startswith(str(base)):
            raise gitcmd.GitError(f"archive member escapes extraction root: {info.filename}")
        if info.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)


# --------------------------------------------------------------------------- clone

def ingest_clone(repo_id: int, url: str) -> None:
    _status(repo_id, "cloning", 0.0)
    row = db.query_one("SELECT repo_dir FROM repos WHERE id=?", (repo_id,))
    dest = Path(row["repo_dir"]) / "repo.git"
    if dest.exists():
        shutil.rmtree(dest)

    last = [0.0, 0.0]

    def on_progress(fraction: float, text: str) -> None:
        now = time.time()
        if now - last[0] > 0.4 or fraction - last[1] >= 0.02:
            last[0], last[1] = now, fraction
            _status(repo_id, "cloning", fraction)

    gitcmd.clone_mirror(url, dest, on_progress)
    db.execute("UPDATE repos SET repo_dir=? WHERE id=?", (str(dest), repo_id))
    _status(repo_id, "cloning", 1.0)


# --------------------------------------------------------------------------- refresh / delete

def start_refresh(repo_id: int) -> None:
    _mark_busy(repo_id, True)

    def run() -> None:
        try:
            row = db.query_one("SELECT source, repo_dir FROM repos WHERE id=?", (repo_id,))
            if row["source"] == "clone":
                _status(repo_id, "cloning", 0.0, None)
                gitcmd.fetch_updates(row["repo_dir"])
            parse.repo_parse(repo_id)
        except Exception as exc:  # noqa: BLE001
            _status(repo_id, "error", 0.0, f"{type(exc).__name__}: {exc}"[:900])
        finally:
            _mark_busy(repo_id, False)

    threading.Thread(target=run, daemon=True, name=f"refresh-{repo_id}").start()


def delete_repo(repo_id: int) -> bool:
    if is_busy(repo_id):
        return False
    row = db.query_one("SELECT repo_dir FROM repos WHERE id=?", (repo_id,))
    if not row:
        return False
    with db.write_tx() as c:
        c.execute("DELETE FROM commits WHERE repo_id=?", (repo_id,))  # cascades file_changes, coauthors
        c.execute("DELETE FROM identities WHERE repo_id=?", (repo_id,))
        c.execute("DELETE FROM repos WHERE id=?", (repo_id,))
        c.execute("DELETE FROM authors WHERE id NOT IN (SELECT canonical_id FROM identities)")
    repo_root = Path(db.REPOS_DIR / f"r{repo_id}")
    if repo_root.exists():
        shutil.rmtree(repo_root, ignore_errors=True)
    return True
