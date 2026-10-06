"""History materialization.

Two streaming passes over `git log`:

  1. metadata — hash, author (name, email), timestamp, parents, subject, body
  2. numstat  — per-file added/deleted counts

They are kept separate on purpose: in a combined invocation the commit body
(multi-line) and the numstat rows share one byte stream, which is ambiguous to
parse. Two focused passes are exact, still O(history), and let each pass report
progress independently. Rows are written in batches of a few thousand per
transaction so the API keeps answering while a parse runs.

Identity resolution happens once per distinct (name, email) pair and is
merge-aware: mailmap first, then the pair's resolved email is looked up against
existing canonical authors, then against existing identities (so a manual merge
survives a re-parse). Existing identity rows are never rewritten, only reused.
"""

from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

from . import db, gitcmd
from .gitcmd import GIT_ENV
from .mailmap import Mailmap

RS = "\x1e"  # record separator between commits
US = "\x1f"  # unit separator between header fields

META_FORMAT = "%x1e%H%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%s%x1f%b"
NUMSTAT_FORMAT = "%x1e%H%x1f"

COAUTHOR_RE = re.compile(
    r"^[ \t]*co-authored-by:[ \t]*(?P<name>[^<\n]+?)[ \t]*<(?P<email>[^>\n]+)>[ \t]*$",
    re.IGNORECASE | re.MULTILINE,
)

BODY_CAP = 4000
BATCH = 2000

INSERT_COMMIT = (
    "INSERT INTO commits (repo_id, hash, identity_id, ts, subject, body, parents, is_merge,"
    " files, added, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)"
)
INSERT_FILE_CHANGE = (
    "INSERT INTO file_changes (repo_id, commit_id, path, added, deleted, binary)"
    " VALUES (?, ?, ?, ?, ?, ?)"
)
INSERT_COAUTHOR = (
    "INSERT INTO coauthors (repo_id, commit_id, author_id, name, email) VALUES (?, ?, ?, ?, ?)"
)


class Resolver:
    """Maps raw (name, email) pairs -> identity ids and canonical author ids."""

    def __init__(self, repo_id: int, mailmap: Mailmap):
        self.repo_id = repo_id
        self.mailmap = mailmap
        self.identities: dict[tuple[str, str], tuple[int, int]] = {}
        self.canonical_by_email: dict[str, int] = {}
        self.authors_by_email: dict[str, int] = {}
        self.new_identities = 0

    def preload(self) -> None:
        """Adopt everything a previous parse (or manual merge) already decided."""
        for row in db.query(
            "SELECT id, name, email, canonical_id FROM identities WHERE repo_id=? ORDER BY id",
            (self.repo_id,),
        ):
            self.identities[(row["name"], row["email"])] = (row["id"], row["canonical_id"])
            self.canonical_by_email[row["email"].lower()] = row["canonical_id"]
        for row in db.query("SELECT id, email FROM authors"):
            self.authors_by_email.setdefault(row["email"].lower(), row["id"])

    def _author_for(self, c, name: str, email: str) -> int:
        key = email.lower()
        for table in (self.canonical_by_email, self.authors_by_email):
            found = table.get(key)
            if found:
                self.canonical_by_email[key] = found
                return found
        now = int(time.time())
        cur = c.execute(
            "INSERT INTO authors (name, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (name, email, now, now),
        )
        author_id = cur.lastrowid
        self.canonical_by_email[key] = author_id
        self.authors_by_email[key] = author_id
        return author_id

    def identity(self, c, name: str, email: str) -> int:
        cached = self.identities.get((name, email))
        if cached:
            return cached[0]
        proper_name, proper_email, via = self.mailmap.lookup(name, email)
        author_id = self._author_for(c, proper_name, proper_email)
        c.execute(
            "INSERT INTO identities (repo_id, name, email, canonical_id, via_mailmap)"
            " VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo_id, name, email) DO NOTHING",
            (self.repo_id, name, email, author_id, int(via)),
        )
        row = c.execute(
            "SELECT id, canonical_id FROM identities WHERE repo_id=? AND name=? AND email=?",
            (self.repo_id, name, email),
        ).fetchone()
        self.identities[(name, email)] = (row["id"], row["canonical_id"])
        self.new_identities += 1
        return row["id"]

    def coauthor_author_id(self, c, name: str, email: str) -> int:
        proper_name, proper_email, _via = self.mailmap.lookup(name, email)
        return self._author_for(c, proper_name, proper_email)


def _progress(repo_id: int, fraction: float) -> None:
    db.execute(
        "UPDATE repos SET progress=? WHERE id=? AND status='parsing'",
        (round(min(fraction, 0.99), 4), repo_id),
    )


def _stream_records(cmd: list[str], git_dir: str):
    """Yield raw records (bytes) split on \\x1e from a git subprocess' stdout."""
    proc = subprocess.Popen(
        cmd, cwd=git_dir, env=GIT_ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    assert proc.stdout is not None
    buf = b""
    first = True
    try:
        while True:
            chunk = proc.stdout.read(1 << 20)
            if not chunk:
                break
            buf += chunk
            parts = buf.split(b"\x1e")
            buf = parts.pop()
            for part in parts:
                if first:  # output starts with the separator; first part is empty
                    first = False
                    if not part.strip():
                        continue
                yield part
        if buf.strip():
            yield buf
    finally:
        proc.stdout.close()
        proc.wait()


# --------------------------------------------------------------------------- phases

def _phase_metadata(
    repo_id: int, git_dir: str, resolver: Resolver, total: int
) -> tuple[dict[str, int], list[tuple[str, str, str]]]:
    cmd = [
        "git", "-c", "core.quotepath=false", "log", "--all", "--no-renames",
        f"--pretty=format:{META_FORMAT}",
    ]
    hash_to_id: dict[str, int] = {}
    coauthors: list[tuple[str, str, str]] = []
    batch: list[tuple[str, str, str, int, str, str, int, int]] = []
    seen = 0
    last_ping = 0.0

    def commit_batch() -> None:
        if not batch:
            return
        with db.write_tx() as c:
            before = c.execute(
                "SELECT COALESCE(MAX(id), 0) FROM commits WHERE repo_id=?", (repo_id,)
            ).fetchone()[0]
            for hash_, name, email, ts, subject, body, parents, is_merge in batch:
                identity_id = resolver.identity(c, name, email)
                c.execute(INSERT_COMMIT, (repo_id, hash_, identity_id, ts, subject, body, parents, is_merge))
            for row in c.execute(
                "SELECT id, hash FROM commits WHERE repo_id=? AND id>? ORDER BY id", (repo_id, before)
            ):
                hash_to_id[row["hash"]] = row["id"]
        batch.clear()

    for rec in _stream_records(cmd, git_dir):
        fields = rec.decode("utf-8", "replace").split(US, 6)
        if len(fields) < 7:
            continue
        hash_, name, email, at, parents, subject, body = fields
        name = name.strip() or "unknown"
        email = (email.strip() or "unknown@localhost").lower()
        ts = int(at) if at.strip().isdigit() else 0
        parent_count = len(parents.split())
        body = body[:BODY_CAP]

        batch.append(
            (hash_, name, email, ts, subject.strip(), body, parent_count, 1 if parent_count > 1 else 0)
        )
        for m in COAUTHOR_RE.finditer(body):
            cname, cemail = m.group("name").strip(), m.group("email").strip().lower()
            if cemail and cemail != email:
                coauthors.append((hash_, cname, cemail))

        seen += 1
        now = time.time()
        if len(batch) >= BATCH or now - last_ping > 0.7:
            commit_batch()
            last_ping = now
            if total:
                _progress(repo_id, 0.05 + 0.45 * min(seen / total, 1.0))
    commit_batch()
    if total == 0:
        _progress(repo_id, 0.5)
    return hash_to_id, coauthors


def _phase_file_changes(repo_id: int, git_dir: str, hash_to_id: dict[str, int], total: int) -> None:
    cmd = [
        "git", "-c", "core.quotepath=false", "log", "--all", "--no-renames",
        "--numstat", f"--pretty=format:{NUMSTAT_FORMAT}",
    ]
    totals: dict[str, tuple[int, int, int]] = {}
    batch: list[tuple] = []
    seen = 0
    last_ping = 0.0

    def flush() -> None:
        if batch:
            db.executemany(INSERT_FILE_CHANGE, batch)
            batch.clear()

    for rec in _stream_records(cmd, git_dir):
        head, _, rest = rec.partition(b"\n")
        hash_ = head.rstrip(b"\x1f").decode("utf-8", "replace").strip()
        commit_id = hash_to_id.get(hash_)
        if commit_id is None:
            continue
        files = added_sum = deleted_sum = 0
        for line in rest.split(b"\n"):
            if not line:
                continue
            parts = line.decode("utf-8", "replace").split("\t", 2)
            if len(parts) < 3:
                continue
            a_raw, d_raw, path = parts
            binary = 1 if a_raw == "-" else 0
            added = 0 if binary else int(a_raw or 0)
            deleted = 0 if binary else int(d_raw or 0)
            files += 1
            added_sum += added
            deleted_sum += deleted
            batch.append((repo_id, commit_id, path, added, deleted, binary))
        if files:
            totals[hash_] = (files, added_sum, deleted_sum)

        seen += 1
        now = time.time()
        if len(batch) >= BATCH or (seen % 500 == 0):
            flush()
        if total and now - last_ping > 0.7:
            last_ping = now
            _progress(repo_id, 0.5 + 0.48 * min(seen / total, 1.0))

    flush()
    updates = [(f, a, d, repo_id, h) for h, (f, a, d) in totals.items()]
    for i in range(0, len(updates), 10000):
        db.executemany(
            "UPDATE commits SET files=?, added=?, deleted=? WHERE repo_id=? AND hash=?",
            updates[i : i + 10000],
        )


# --------------------------------------------------------------------------- entry point

def repo_parse(repo_id: int) -> None:
    row = db.query_one("SELECT * FROM repos WHERE id=?", (repo_id,))
    if not row:
        raise ValueError(f"repo {repo_id} not found")
    git_dir = row["repo_dir"]
    if not Path(git_dir).exists():
        raise gitcmd.GitError(f"repository directory missing: {git_dir}")

    db.execute(
        "UPDATE repos SET status='parsing', progress=0, error=NULL, updated_at=? WHERE id=?",
        (int(time.time()), repo_id),
    )
    try:
        mailmap = Mailmap.parse(gitcmd.mailmap_text(git_dir))
        resolver = Resolver(repo_id, mailmap)
        resolver.preload()

        total = gitcmd.rev_count(git_dir)
        db.execute("DELETE FROM commits WHERE repo_id=?", (repo_id,))  # cascade: file_changes, coauthors

        hash_to_id: dict[str, int] = {}
        coauthors: list = []
        if total:
            hash_to_id, coauthors = _phase_metadata(repo_id, git_dir, resolver, total)
            _phase_file_changes(repo_id, git_dir, hash_to_id, total)

        if coauthors:
            with db.write_tx() as c:
                rows = []
                seen_pairs: set[tuple[int, str]] = set()
                for hash_, cname, cemail in coauthors:
                    commit_id = hash_to_id.get(hash_)
                    if commit_id is None:
                        continue
                    author_id = resolver.coauthor_author_id(c, cname, cemail)
                    if (commit_id, cemail) in seen_pairs:
                        continue
                    seen_pairs.add((commit_id, cemail))
                    rows.append((repo_id, commit_id, author_id, cname, cemail))
                if rows:
                    c.executemany(INSERT_COAUTHOR, rows)

        _finalize(repo_id, git_dir)
    except BaseException:
        db.execute("DELETE FROM commits WHERE repo_id=?", (repo_id,))
        raise


def _finalize(repo_id: int, git_dir: str) -> None:
    stats = db.query_one(
        "SELECT COUNT(*) AS n, COALESCE(SUM(added),0) AS added, COALESCE(SUM(deleted),0) AS deleted,"
        "       MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM commits WHERE repo_id=?",
        (repo_id,),
    )
    authors = db.scalar(
        "SELECT COUNT(DISTINCT i.canonical_id) FROM commits c"
        " JOIN identities i ON i.id = c.identity_id WHERE c.repo_id=?",
        (repo_id,),
    )
    files = db.scalar("SELECT COUNT(DISTINCT path) FROM file_changes WHERE repo_id=?", (repo_id,))
    snapshot = gitcmd.repo_snapshot(git_dir)
    now = int(time.time())
    db.execute(
        "UPDATE repos SET status='ready', progress=1, error=NULL, commit_count=?, author_count=?,"
        " file_count=?, first_ts=?, last_ts=?, total_added=?, total_deleted=?, head_hash=?,"
        " default_branch=?, branch_count=?, tag_count=?, parsed_at=?, updated_at=? WHERE id=?",
        (
            stats["n"], authors or 0, files or 0, stats["first_ts"], stats["last_ts"],
            stats["added"], stats["deleted"], snapshot["head_hash"], snapshot["default_branch"],
            snapshot["branch_count"], snapshot["tag_count"], now, now, repo_id,
        ),
    )
