"""Metrics engine.

Every endpoint answers the same shape of question — "these commits, then
aggregate" — so all filters compile into one WHERE fragment over the aliases
`c` (commits) and `i` (identities):

    repos      c.repo_id IN (...)
    authors    i.canonical_id IN (...)          canonical people, cross-repo
    path       c touches path (or dir under it) — either via EXISTS on
               file_changes, or directly on a joined fc.path expression
    from/to    c.ts range (unix seconds)
    commits    c.hash prefix whitelist (per-prefix index range seeks),
               skippable for browsing

Path filters are written as `= ? OR LIKE ? || '/%'`, which with
case_sensitive_like=ON rides the (repo_id, path) index.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from . import db, gitcmd

BUCKET_FORMATS = {
    "day": "%Y-%m-%d",
    "week": "%Y-%W",
    "month": "%Y-%m",
    "year": "%Y",
}

FILE_SORTS = {
    "commits": "COUNT(DISTINCT fc.commit_id)",
    "authors": "COUNT(DISTINCT i.canonical_id)",
    "added": "SUM(fc.added)",
    "deleted": "SUM(fc.deleted)",
    "churn": "(SUM(fc.added) + SUM(fc.deleted))",
    "net": "(SUM(fc.added) - SUM(fc.deleted))",
    "recent": "MAX(c.ts)",
    "path": "fc.path",
}

BLAME_CACHE: dict[tuple[int, str], dict | None] = {}
BLAME_CACHE_MAX = 256


def clear_blame_cache(repo_id: int | None = None) -> None:
    if repo_id is None:
        BLAME_CACHE.clear()
    else:
        for key in [k for k in BLAME_CACHE if k[0] == repo_id]:
            BLAME_CACHE.pop(key, None)


# --------------------------------------------------------------------------- filters

@dataclass
class Filters:
    repos: list[int] = field(default_factory=list)
    authors: list[int] = field(default_factory=list)
    path: str | None = None
    from_ts: int | None = None
    to_ts: int | None = None
    commits: list[str] = field(default_factory=list)
    ignore_commits: bool = False

    def label(self) -> str:
        bits = []
        if self.repos:
            bits.append(f"repos={self.repos}")
        if self.authors:
            bits.append(f"authors={self.authors}")
        if self.path:
            bits.append(f"path={self.path}")
        if self.from_ts:
            bits.append(f"from={self.from_ts}")
        if self.to_ts:
            bits.append(f"to={self.to_ts}")
        if self.commits and not self.ignore_commits:
            bits.append(f"commits={len(self.commits)}")
        return " ".join(bits) or "all"


def normalize_path(path: str | None) -> str | None:
    if not path:
        return None
    cleaned = path.strip()
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    cleaned = cleaned.lstrip("/").rstrip("/")
    while "//" in cleaned:
        cleaned = cleaned.replace("//", "/")
    return cleaned or None


def _placeholders(n: int) -> str:
    return ",".join("?" * n)


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


_HEX_DIGITS = set("0123456789abcdef")


def _hash_prefixes(commits: list[str]) -> list[str]:
    """De-duplicated lowercase hex prefixes, order preserved.

    Anything non-hex can never match a Git hash and is dropped — which also
    means no LIKE escaping is needed, and without an ESCAPE clause SQLite can
    rewrite each `hash LIKE 'p%'` into an index range scan (ESCAPE would
    disable that optimization).
    """
    seen: dict[str, None] = {}
    for raw in commits:
        prefix = raw.strip().lower()
        if prefix and all(ch in _HEX_DIGITS for ch in prefix):
            seen[prefix] = None
    return list(seen)


def commit_where(f: Filters, path_expr: str | None = None) -> tuple[str, list]:
    """WHERE over `c` (commits) and `i` (identities).

    `path_expr` — the SQL expression addressing a joined file path; when None
    the path filter becomes an EXISTS over file_changes.
    """
    conds: list[str] = []
    params: list = []
    if f.repos:
        conds.append(f"c.repo_id IN ({_placeholders(len(f.repos))})")
        params += f.repos
    if f.from_ts:
        conds.append("c.ts >= ?")
        params.append(f.from_ts)
    if f.to_ts:
        conds.append("c.ts <= ?")
        params.append(f.to_ts)
    if f.authors:
        conds.append(f"i.canonical_id IN ({_placeholders(len(f.authors))})")
        params += f.authors
    if f.commits and not f.ignore_commits:
        prefixes = _hash_prefixes(f.commits)
        if prefixes:
            ors = " OR ".join(["x.hash LIKE ?"] * len(prefixes))
            conds.append(f"c.id IN (SELECT x.id FROM commits x WHERE {ors})")
            params += [p + "%" for p in prefixes]
        else:
            conds.append("0=1")
    if f.path:
        if path_expr:
            conds.append(f"({path_expr} = ? OR {path_expr} LIKE ? ESCAPE '\\')")
            params += [f.path, _escape_like(f.path) + "/%"]
        else:
            conds.append(
                "EXISTS (SELECT 1 FROM file_changes fx WHERE fx.commit_id = c.id"
                " AND (fx.path = ? OR fx.path LIKE ? ESCAPE '\\'))"
            )
            params += [f.path, _escape_like(f.path) + "/%"]
    return (" AND ".join(conds) if conds else "1=1"), params


JOIN_IDENT = "JOIN identities i ON i.id = c.identity_id"
JOIN_AUTHOR = "JOIN identities i ON i.id = c.identity_id JOIN authors a ON a.id = i.canonical_id"


# --------------------------------------------------------------------------- summary

def summary(f: Filters) -> dict:
    where, params = commit_where(f)
    main = db.query_one(
        f"""SELECT COUNT(*) AS commits, COALESCE(SUM(c.is_merge),0) AS merges,
                   MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts,
                   COALESCE(SUM(c.added),0) AS added, COALESCE(SUM(c.deleted),0) AS deleted,
                   COUNT(DISTINCT i.canonical_id) AS authors,
                   COUNT(DISTINCT date(c.ts,'unixepoch')) AS active_days
            FROM commits c {JOIN_IDENT} WHERE {where}""",
        params,
    )
    fwhere, fparams = commit_where(f, path_expr="fc.path")
    files = db.query_one(
        f"""SELECT COUNT(DISTINCT fc.path) AS files
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
            WHERE {fwhere}""",
        fparams,
    )
    out = dict(main)
    out["files"] = files["files"] if files else 0
    out["net"] = out["added"] - out["deleted"]
    span = (out["last_ts"] - out["first_ts"]) if out["first_ts"] and out["last_ts"] else 0
    out["span_days"] = round(span / 86400, 1)
    return out


# --------------------------------------------------------------------------- timeline

def _auto_bucket(first_ts: int | None, last_ts: int | None) -> str:
    span = (last_ts or 0) - (first_ts or 0)
    days = span / 86400
    if days <= 100:
        return "day"
    if days <= 600:
        return "week"
    if days <= 3000:
        return "month"
    return "year"


def timeline(f: Filters, bucket: str = "auto", top_n: int = 8) -> dict:
    where, params = commit_where(f)
    bounds = db.query_one(
        f"SELECT MIN(c.ts) AS a, MAX(c.ts) AS b FROM commits c {JOIN_IDENT} WHERE {where}", params
    )
    if bucket == "auto":
        bucket = _auto_bucket(bounds["a"] if bounds else None, bounds["b"] if bounds else None)
    fmt = BUCKET_FORMATS.get(bucket, "%Y-%m")

    totals = db.query(
        f"""SELECT strftime(?, c.ts, 'unixepoch') AS b, COUNT(*) AS commits,
                   COALESCE(SUM(c.added),0) AS added, COALESCE(SUM(c.deleted),0) AS deleted
            FROM commits c {JOIN_IDENT} WHERE {where} GROUP BY b ORDER BY b""",
        [fmt, *params],
    )

    top = db.query(
        f"""SELECT i.canonical_id AS aid, a.name AS name, COUNT(*) AS n,
                   COALESCE(SUM(c.added + c.deleted),0) AS churn
            FROM commits c {JOIN_AUTHOR} WHERE {where}
            GROUP BY i.canonical_id ORDER BY churn DESC LIMIT ?""",
        [*params, top_n],
    )
    labels = [r["b"] for r in totals]
    if not top:
        return {
            "bucket": bucket,
            "labels": labels,
            "totals": _pivot_totals(totals),
            "series": [],
            "others": _zeros(len(labels)),
        }

    ids = [r["aid"] for r in top]
    per = db.query(
        f"""SELECT strftime(?, c.ts, 'unixepoch') AS b, i.canonical_id AS aid,
                   COUNT(*) AS commits, COALESCE(SUM(c.added),0) AS added,
                   COALESCE(SUM(c.deleted),0) AS deleted
            FROM commits c {JOIN_IDENT}
            WHERE {where} AND i.canonical_id IN ({_placeholders(len(ids))})
            GROUP BY b, aid""",
        [fmt, *params, *ids],
    )
    index = {label: pos for pos, label in enumerate(labels)}
    series = []
    for t in top:
        rows = {r["b"]: r for r in per if r["aid"] == t["aid"]}
        commits = [0] * len(labels)
        added = [0] * len(labels)
        deleted = [0] * len(labels)
        for label, r in rows.items():
            pos = index.get(label)
            if pos is None:
                continue
            commits[pos] = r["commits"]
            added[pos] = r["added"]
            deleted[pos] = r["deleted"]
        series.append({"author_id": t["aid"], "name": t["name"], "commits": commits, "added": added, "deleted": deleted})

    others = {
        "commits": [],
        "added": [],
        "deleted": [],
    }
    for key in ("commits", "added", "deleted"):
        top_sum = [sum(s[key][pos] for s in series) for pos in range(len(labels))]
        others[key] = [max((totals[pos][key] - top_sum[pos]), 0) for pos in range(len(labels))]

    return {
        "bucket": bucket,
        "labels": labels,
        "totals": _pivot_totals(totals),
        "series": series,
        "others": others,
    }


def _pivot_totals(rows: list[dict]) -> dict:
    return {
        "commits": [r["commits"] for r in rows],
        "added": [r["added"] for r in rows],
        "deleted": [r["deleted"] for r in rows],
    }


def _zeros(n: int) -> dict:
    return {"commits": [0] * n, "added": [0] * n, "deleted": [0] * n}


# --------------------------------------------------------------------------- authors

def authors_table(f: Filters) -> dict:
    where, params = commit_where(f)
    rows = db.query(
        f"""SELECT i.canonical_id AS author_id, a.name, a.email,
                   COUNT(*) AS commits, COALESCE(SUM(c.is_merge),0) AS merges,
                   COALESCE(SUM(c.added),0) AS added, COALESCE(SUM(c.deleted),0) AS deleted,
                   COALESCE(SUM(c.files),0) AS files_touched_sum,
                   MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts,
                   COUNT(DISTINCT date(c.ts,'unixepoch')) AS active_days
            FROM commits c {JOIN_AUTHOR} WHERE {where}
            GROUP BY i.canonical_id""",
        params,
    )

    fwhere, fparams = commit_where(f, path_expr="fc.path")
    files_rows = db.query(
        f"""SELECT i.canonical_id AS author_id, COUNT(DISTINCT fc.path) AS files
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
            WHERE {fwhere} GROUP BY i.canonical_id""",
        fparams,
    )
    files_map = {r["author_id"]: r["files"] for r in files_rows}

    co_rows = db.query(
        f"""SELECT co.author_id AS author_id, COUNT(*) AS coauthored
            FROM coauthors co JOIN commits c ON c.id = co.commit_id {JOIN_IDENT}
            WHERE {where} GROUP BY co.author_id""",
        params,
    )
    co_map = {r["author_id"]: r["coauthored"] for r in co_rows}

    total_churn = sum(r["added"] + r["deleted"] for r in rows) or 1
    for r in rows:
        r["files"] = files_map.get(r["author_id"], 0)
        r["coauthored"] = co_map.get(r["author_id"], 0)
        r["net"] = r["added"] - r["deleted"]
        r["churn"] = r["added"] + r["deleted"]
        r["churn_share"] = round(r["churn"] / total_churn, 6)
        r["avg_commit_size"] = round(r["churn"] / r["commits"], 1) if r["commits"] else 0
    rows.sort(key=lambda r: -r["commits"])
    return {"rows": rows}


def author_detail(f: Filters, author_id: int) -> dict:
    f = Filters(**{**f.__dict__, "authors": [author_id]})
    where, params = commit_where(f)
    fwhere, fparams = commit_where(f, path_expr="fc.path")
    top_files = db.query(
        f"""SELECT fc.path, fc.repo_id, COUNT(DISTINCT fc.commit_id) AS commits,
                   COALESCE(SUM(fc.added),0) AS added, COALESCE(SUM(fc.deleted),0) AS deleted
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
            WHERE {fwhere}
            GROUP BY fc.repo_id, fc.path ORDER BY (SUM(fc.added) + SUM(fc.deleted)) DESC LIMIT 12""",
        fparams,
    )
    n = db.scalar(f"SELECT COUNT(*) FROM commits c {JOIN_IDENT} WHERE {where}", params) or 0
    sizes = {"count": n, "p50": 0, "p90": 0, "max": 0}
    if n:
        for key, fraction in (("p50", 0.5), ("p90", 0.9)):
            off = max(0, min(int(n * fraction), n - 1))
            sizes[key] = db.scalar(
                f"""SELECT (c.added + c.deleted) FROM commits c {JOIN_IDENT} WHERE {where}
                    ORDER BY (c.added + c.deleted) ASC LIMIT 1 OFFSET ?""",
                [*params, off],
            ) or 0
        sizes["max"] = db.scalar(
            f"SELECT MAX(c.added + c.deleted) FROM commits c {JOIN_IDENT} WHERE {where}", params
        ) or 0
    return {"top_files": top_files, "sizes": sizes}


# --------------------------------------------------------------------------- files

def files_table(
    f: Filters,
    sort: str = "churn",
    limit: int = 100,
    offset: int = 0,
    q: str | None = None,
) -> dict:
    where, params = commit_where(f, path_expr="fc.path")
    q_cond = ""
    q_params: list = []
    if q:
        q_cond = " AND fc.path LIKE ? ESCAPE '\\'"
        q_params = ["%" + _escape_like(q) + "%"]
    order = FILE_SORTS.get(sort, "(SUM(fc.added) + SUM(fc.deleted))")
    direction = "ASC" if sort == "path" else "DESC"
    rows = db.query(
        f"""SELECT fc.repo_id, r.name AS repo_name, fc.path,
                   COUNT(DISTINCT fc.commit_id) AS n_commits,
                   COUNT(DISTINCT i.canonical_id) AS n_authors,
                   COALESCE(SUM(fc.added),0) AS added, COALESCE(SUM(fc.deleted),0) AS deleted,
                   MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts, MAX(fc.binary) AS binary
            FROM file_changes fc
            JOIN commits c ON c.id = fc.commit_id
            JOIN repos r ON r.id = fc.repo_id
            {JOIN_IDENT}
            WHERE {where}{q_cond}
            GROUP BY fc.repo_id, fc.path
            ORDER BY {order} {direction}, fc.path ASC
            LIMIT ? OFFSET ?""",
        [*params, *q_params, limit, offset],
    )
    total = db.scalar(
        f"""SELECT COUNT(*) FROM (
              SELECT 1 FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
              WHERE {where}{q_cond} GROUP BY fc.repo_id, fc.path)""",
        [*params, *q_params],
    )
    for r in rows:
        r["churn"] = r["added"] + r["deleted"]
        r["net"] = r["added"] - r["deleted"]
    return {"rows": rows, "total": total or 0}


def file_detail(f: Filters, repo_id: int, path: str) -> dict:
    f = Filters(**{**f.__dict__, "repos": [repo_id], "path": path})
    where, params = commit_where(f, path_expr="fc.path")
    by_author = db.query(
        f"""SELECT i.canonical_id AS author_id, a.name, a.email,
                   COUNT(DISTINCT fc.commit_id) AS commits,
                   COALESCE(SUM(fc.added),0) AS added, COALESCE(SUM(fc.deleted),0) AS deleted,
                   MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_AUTHOR}
            WHERE {where} GROUP BY i.canonical_id
            ORDER BY (SUM(fc.added) + SUM(fc.deleted)) DESC""",
        params,
    )
    cwhere, cparams = commit_where(f)
    recent = db.query(
        f"""SELECT c.id, c.hash, c.ts, c.subject, c.added, c.deleted,
                   a.name AS author_name, i.canonical_id AS author_id
            FROM commits c {JOIN_AUTHOR} WHERE {cwhere}
            ORDER BY c.ts DESC LIMIT 15""",
        cparams,
    )
    stats = db.query_one(
        f"""SELECT COUNT(DISTINCT fc.commit_id) AS n_commits,
                   COUNT(DISTINCT i.canonical_id) AS n_authors,
                   COALESCE(SUM(fc.added),0) AS added, COALESCE(SUM(fc.deleted),0) AS deleted,
                   MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts, MAX(fc.binary) AS binary
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
            WHERE {where}""",
        params,
    )
    if stats:
        stats["churn"] = stats["added"] + stats["deleted"]
        stats["net"] = stats["added"] - stats["deleted"]
    return {"stats": stats, "authors": by_author, "recent_commits": recent, "blame": get_blame(repo_id, path)}


def get_blame(repo_id: int, path: str) -> dict | None:
    key = (repo_id, path)
    if key in BLAME_CACHE:
        return BLAME_CACHE[key]
    row = db.query_one("SELECT repo_dir, status FROM repos WHERE id=?", (repo_id,))
    result = None
    if row and row["status"] == "ready":
        try:
            result = gitcmd.blame_ownership(row["repo_dir"], path)
        except Exception:  # noqa: BLE001 — blame is a bonus, never a failure
            result = None
    if len(BLAME_CACHE) >= BLAME_CACHE_MAX:
        BLAME_CACHE.pop(next(iter(BLAME_CACHE)))
    BLAME_CACHE[key] = result
    return result


# --------------------------------------------------------------------------- directories

def dirs_table(f: Filters, flat: bool = False, limit: int = 2000) -> dict:
    where, params = commit_where(f, path_expr="fc.path")
    if flat:
        # every ancestor directory of every touched file, rolled up correctly:
        # each (file, commit, author) contributes to each of its parent dirs
        max_depth = db.scalar(
            f"""SELECT COALESCE(MAX(path_levels(fc.path)), 0) FROM file_changes fc
                JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT} WHERE {where}""",
            params,
        ) or 0
        max_depth = min(max_depth, 16)
        if max_depth == 0:
            return {"rows": [], "truncated": False}
        rows = db.query(
            f"""WITH RECURSIVE lv(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM lv WHERE i < ?)
                SELECT fc.repo_id, ancestor(fc.path, lv.i) AS dir,
                       COUNT(DISTINCT fc.path) AS files,
                       COUNT(DISTINCT fc.commit_id) AS n_commits,
                       COUNT(DISTINCT i.canonical_id) AS n_authors,
                       COALESCE(SUM(fc.added),0) AS added, COALESCE(SUM(fc.deleted),0) AS deleted,
                       MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts
                FROM file_changes fc
                JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
                CROSS JOIN lv
                WHERE {where} AND lv.i <= path_levels(fc.path)
                GROUP BY fc.repo_id, dir
                ORDER BY dir ASC LIMIT ?""",
            [max_depth, *params, limit + 1],
        )
        truncated = len(rows) > limit
        rows = rows[:limit]
        for r in rows:
            r["kind"] = "dir"
            r["depth"] = r["dir"].count("/")
            r["dir"] = r["dir"].rstrip("/")
        return {"rows": rows, "truncated": truncated}

    prefix = (f.path + "/") if f.path else ""
    plen = len(prefix)
    if plen:
        rest = f"substr(fc.path, {plen + 1})"
        child = (
            f"CASE WHEN instr({rest}, '/') > 0 THEN substr(fc.path, 1, {plen} + instr({rest}, '/')) "
            f"ELSE fc.path END"
        )
    else:
        child = "CASE WHEN instr(fc.path, '/') > 0 THEN substr(fc.path, 1, instr(fc.path, '/')) ELSE fc.path END"
    rows = db.query(
        f"""SELECT fc.repo_id, {child} AS dir, MAX(fc.binary) AS binary,
                   COUNT(DISTINCT fc.path) AS files,
                   COUNT(DISTINCT fc.commit_id) AS n_commits,
                   COUNT(DISTINCT i.canonical_id) AS n_authors,
                   COALESCE(SUM(fc.added),0) AS added, COALESCE(SUM(fc.deleted),0) AS deleted,
                   MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
            WHERE {where}
            GROUP BY fc.repo_id, dir
            ORDER BY dir ASC""",
        params,
    )
    for r in rows:
        is_dir = r["dir"].endswith("/")
        r["depth"] = r["dir"].count("/")
        r["kind"] = "dir" if is_dir else "file"
        if is_dir:
            r["dir"] = r["dir"].rstrip("/")
    return {"rows": rows, "truncated": False}


# --------------------------------------------------------------------------- commits

def commits_list(
    f: Filters,
    limit: int = 100,
    offset: int = 0,
    q: str | None = None,
    ignore_commits: bool = False,
) -> dict:
    f = Filters(**{**f.__dict__, "ignore_commits": ignore_commits})
    where, params = commit_where(f)
    q_cond = ""
    q_params: list = []
    if q:
        q_cond = " AND (c.subject LIKE ? ESCAPE '\\' OR c.hash LIKE ? ESCAPE '\\')"
        like = "%" + _escape_like(q) + "%"
        q_params = [like, _escape_like(q) + "%"]
    rows = db.query(
        f"""SELECT c.id, c.repo_id, r.name AS repo_name, c.hash, c.ts, c.subject,
                   c.parents, c.is_merge, c.files, c.added, c.deleted,
                   i.canonical_id AS author_id, a.name AS author_name
            FROM commits c {JOIN_AUTHOR}
            JOIN repos r ON r.id = c.repo_id
            WHERE {where}{q_cond}
            ORDER BY c.ts DESC, c.id DESC LIMIT ? OFFSET ?""",
        [*params, *q_params, limit, offset],
    )
    for r in rows:
        r["churn"] = r["added"] + r["deleted"]
    total = db.scalar(
        f"""SELECT COUNT(*) FROM commits c {JOIN_IDENT} WHERE {where}{q_cond}""",
        [*params, *q_params],
    )
    return {"rows": rows, "total": total or 0}


def commit_detail(commit_id: int) -> dict | None:
    commit = db.query_one(
        f"""SELECT c.id, c.repo_id, r.name AS repo_name, c.hash, c.ts, c.subject, c.body,
                   c.parents, c.is_merge, c.files, c.added, c.deleted,
                   i.canonical_id AS author_id, a.name AS author_name, a.email AS author_email,
                   i.name AS raw_name, i.email AS raw_email
            FROM commits c {JOIN_AUTHOR}
            JOIN repos r ON r.id = c.repo_id
            WHERE c.id = ?""",
        (commit_id,),
    )
    if not commit:
        return None
    files = db.query(
        "SELECT path, added, deleted, binary FROM file_changes WHERE commit_id=?"
        " ORDER BY (added + deleted) DESC",
        (commit_id,),
    )
    coauthors = db.query(
        "SELECT name, email, author_id FROM coauthors WHERE commit_id=?", (commit_id,)
    )
    return {"commit": commit, "files": files, "coauthors": coauthors}


# --------------------------------------------------------------------------- composition

def composition(f: Filters, limit: int = 12) -> dict:
    where, params = commit_where(f, path_expr="fc.path")
    rows = db.query(
        f"""SELECT ext(fc.path) AS ext,
                   COUNT(DISTINCT fc.path) AS files,
                   COALESCE(SUM(fc.added),0) AS added,
                   COALESCE(SUM(fc.deleted),0) AS deleted
            FROM file_changes fc JOIN commits c ON c.id = fc.commit_id {JOIN_IDENT}
            WHERE {where}
            GROUP BY ext ORDER BY (SUM(fc.added) + SUM(fc.deleted)) DESC""",
        params,
    )
    top = rows[:limit]
    rest = rows[limit:]
    if rest:
        top.append(
            {
                "ext": "",
                "files": sum(r["files"] for r in rest),
                "added": sum(r["added"] for r in rest),
                "deleted": sum(r["deleted"] for r in rest),
            }
        )
    return {"rows": top}


# --------------------------------------------------------------------------- identities

def identities_view(repo_ids: list[int]) -> dict:
    if not repo_ids:
        return {"authors": [], "identities": []}
    ph = _placeholders(len(repo_ids))
    identities = db.query(
        f"""SELECT ident.id, ident.repo_id, r.name AS repo_name, ident.name, ident.email,
                   ident.canonical_id, ident.via_mailmap,
                   COUNT(c.id) AS commits, MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts
            FROM identities ident
            JOIN repos r ON r.id = ident.repo_id
            LEFT JOIN commits c ON c.identity_id = ident.id
            WHERE ident.repo_id IN ({ph})
            GROUP BY ident.id
            ORDER BY commits DESC, ident.name ASC""",
        repo_ids,
    )
    authors = db.query(
        f"""SELECT a.id, a.name, a.email
            FROM authors a
            WHERE a.id IN (SELECT canonical_id FROM identities WHERE repo_id IN ({ph}))
               OR a.id IN (SELECT author_id FROM coauthors WHERE repo_id IN ({ph}))
            ORDER BY a.name ASC""",
        [*repo_ids, *repo_ids],
    )
    co_rows = db.query(
        f"SELECT author_id, COUNT(*) AS coauthored FROM coauthors WHERE repo_id IN ({ph}) GROUP BY author_id",
        repo_ids,
    )
    co_map = {r["author_id"]: r["coauthored"] for r in co_rows}
    by_author: dict[int, dict] = {}
    for ident in identities:
        agg = by_author.setdefault(
            ident["canonical_id"],
            {"commits": 0, "coauthored": co_map.get(ident["canonical_id"], 0), "identity_count": 0,
             "first_ts": None, "last_ts": None},
        )
        agg["commits"] += ident["commits"]
        agg["identity_count"] += 1
        if ident["first_ts"] and (agg["first_ts"] is None or ident["first_ts"] < agg["first_ts"]):
            agg["first_ts"] = ident["first_ts"]
        if ident["last_ts"] and (agg["last_ts"] is None or ident["last_ts"] > agg["last_ts"]):
            agg["last_ts"] = ident["last_ts"]
    author_rows = []
    for a in authors:
        agg = by_author.get(a["id"], {"commits": 0, "coauthored": 0, "identity_count": 0,
                                      "first_ts": None, "last_ts": None})
        author_rows.append({**a, **agg})
    author_rows.sort(key=lambda r: -r["commits"])
    return {"authors": author_rows, "identities": identities}


def merge_identities(identity_ids: list[int], target_author_id: int | None) -> dict:
    if not identity_ids:
        raise ValueError("no identities selected")
    now = int(time.time())
    with db.write_tx() as c:
        rows = c.execute(
            f"SELECT id, repo_id, name, email, canonical_id FROM identities WHERE id IN "
            f"({_placeholders(len(identity_ids))})",
            identity_ids,
        ).fetchall()
        if not rows:
            raise ValueError("identities not found")
        if target_author_id is None:
            # adopt the identity with the most commits as the anchor
            counts = dict(
                c.execute(
                    f"SELECT identity_id, COUNT(*) FROM commits WHERE identity_id IN "
                    f"({_placeholders(len(identity_ids))}) GROUP BY identity_id",
                    identity_ids,
                ).fetchall()
            )
            anchor = max(rows, key=lambda r: counts.get(r["id"], 0))
            cur = c.execute(
                "INSERT INTO authors (name, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (anchor["name"], anchor["email"], now, now),
            )
            target_author_id = cur.lastrowid
        c.execute(
            f"UPDATE identities SET canonical_id=? WHERE id IN ({_placeholders(len(identity_ids))})",
            [target_author_id, *identity_ids],
        )
        c.execute(
            "DELETE FROM authors WHERE id NOT IN (SELECT canonical_id FROM identities)"
            " AND id NOT IN (SELECT author_id FROM coauthors)"
        )
    row = db.query_one("SELECT id, name, email FROM authors WHERE id=?", (target_author_id,))
    return {"author": row, "merged": len(identity_ids)}


def split_identity(identity_id: int) -> dict:
    now = int(time.time())
    with db.write_tx() as c:
        ident = c.execute(
            "SELECT id, name, email FROM identities WHERE id=?", (identity_id,)
        ).fetchone()
        if not ident:
            raise ValueError("identity not found")
        cur = c.execute(
            "INSERT INTO authors (name, email, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (ident["name"], ident["email"], now, now),
        )
        new_id = cur.lastrowid
        c.execute("UPDATE identities SET canonical_id=? WHERE id=?", (new_id, identity_id))
        c.execute(
            "DELETE FROM authors WHERE id NOT IN (SELECT canonical_id FROM identities)"
            " AND id NOT IN (SELECT author_id FROM coauthors)"
        )
    return {"author": {"id": new_id, "name": ident["name"], "email": ident["email"]}}


def rename_author(author_id: int, name: str, email: str) -> dict:
    name = (name or "").strip()
    email = (email or "").strip().lower()
    if not name or not email:
        raise ValueError("name and email are required")
    db.execute(
        "UPDATE authors SET name=?, email=?, updated_at=? WHERE id=?",
        (name, email, int(time.time()), author_id),
    )
    row = db.query_one("SELECT id, name, email FROM authors WHERE id=?", (author_id,))
    if not row:
        raise ValueError("author not found")
    return {"author": row}
