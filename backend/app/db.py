"""SQLite storage layer.

One process owns the database file. Reads use per-thread connections (WAL lets
them run concurrently with the parser's writes); writes are funneled through a
single lock because SQLite allows one writer at a time anyway.

`case_sensitive_like` is enabled on purpose: it makes SQLite able to use the
(path) indexes for prefix queries like `path LIKE 'src/core/%'`.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("STRATUM_DATA", PROJECT_ROOT / "data"))
DB_PATH = DATA_DIR / "stratum.db"
REPOS_DIR = DATA_DIR / "repos"
TMP_DIR = DATA_DIR / "tmp"

_local = threading.local()
write_lock = threading.RLock()

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


# --------------------------------------------------------------------------- conn

def _dirname(path: str) -> str:
    """SQL function: directory part of a path, '' for repo-root files."""
    idx = path.rfind("/")
    return path[: idx + 1] if idx >= 0 else ""


def _ext(path: str) -> str:
    """SQL function: lowercase extension without the dot ('' when none)."""
    name = path[path.rfind("/") + 1 :]
    idx = name.rfind(".")
    return name[idx + 1 :].lower() if idx > 0 else ""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA case_sensitive_like=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA cache_size=-65536")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.create_function("dirname", 1, _dirname, deterministic=True)
    conn.create_function("ext", 1, _ext, deterministic=True)
    return conn


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    REPOS_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    c = conn()
    c.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    # a crash mid-parse leaves rows behind; treat them as queued again
    c.execute(
        "UPDATE repos SET status='queued', progress=0 WHERE status IN ('cloning','extracting','parsing')"
    )


# --------------------------------------------------------------------------- access

def query(sql: str, params: tuple | list = ()) -> list[dict]:
    return [dict(r) for r in conn().execute(sql, params).fetchall()]


def query_one(sql: str, params: tuple | list = ()) -> dict | None:
    row = conn().execute(sql, params).fetchone()
    return dict(row) if row else None


def scalar(sql: str, params: tuple | list = ()):
    row = conn().execute(sql, params).fetchone()
    return row[0] if row else None


def execute(sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
    with write_lock:
        return conn().execute(sql, params)


def executemany(sql: str, rows) -> None:
    with write_lock:
        conn().executemany(sql, rows)


@contextmanager
def write_tx():
    """Exclusive write transaction; commits on success, rolls back on error."""
    with write_lock:
        c = conn()
        c.execute("BEGIN IMMEDIATE")
        try:
            yield c
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
