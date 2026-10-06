"""Git plumbing.

Stratum never mutates analyzed repositories; every operation here is read-only
except `clone_mirror` / `fetch_updates`, which own the directory they write to.
All git invocations are non-interactive (GIT_TERMINAL_PROMPT=0) so an auth-needing
remote fails fast with a readable error instead of hanging.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Callable

GIT_ENV = {
    **os.environ,
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_OPTIONAL_LOCKS": "0",
    "LC_ALL": "C",
    "LANG": "C",
}


class GitError(RuntimeError):
    def __init__(self, message: str, stderr: str = ""):
        super().__init__(message)
        self.stderr = stderr


def run_git(
    args: list[str],
    cwd: str | Path,
    timeout: float | None = 60.0,
    check: bool = True,
) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        env=GIT_ENV,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    out = proc.stdout.decode("utf-8", "replace")
    err = proc.stderr.decode("utf-8", "replace")
    if check and proc.returncode != 0:
        raise GitError(f"git {' '.join(args[:2])} failed: {err.strip()[:500]}", err)
    return subprocess.CompletedProcess(proc.args, proc.returncode, out, err)


# --------------------------------------------------------------------------- snapshot

def repo_snapshot(git_dir: str | Path) -> dict:
    """Cheap facts about a repository: HEAD, default branch, ref counts."""
    snapshot = {
        "head_hash": None,
        "default_branch": None,
        "branch_count": 0,
        "tag_count": 0,
    }
    r = run_git(["rev-parse", "--verify", "HEAD"], git_dir, check=False)
    if r.returncode == 0:
        snapshot["head_hash"] = r.stdout.strip()

    r = run_git(["symbolic-ref", "--short", "HEAD"], git_dir, check=False)
    if r.returncode == 0:
        snapshot["default_branch"] = r.stdout.strip()
    elif snapshot["head_hash"]:
        snapshot["default_branch"] = "HEAD"

    r = run_git(["for-each-ref", "--format=%(refname)", "refs/heads"], git_dir, check=False)
    if r.returncode == 0:
        snapshot["branch_count"] = len([l for l in r.stdout.splitlines() if l.strip()])
    r = run_git(["for-each-ref", "--format=%(refname)", "refs/tags"], git_dir, check=False)
    if r.returncode == 0:
        snapshot["tag_count"] = len([l for l in r.stdout.splitlines() if l.strip()])
    return snapshot


def rev_count(git_dir: str | Path) -> int:
    r = run_git(["rev-list", "--all", "--count"], git_dir, check=False)
    try:
        return int(r.stdout.strip() or 0)
    except ValueError:
        return 0


def mailmap_text(git_dir: str | Path) -> str | None:
    """Contents of `.mailmap` at HEAD, if the repository ships one."""
    for ref in ("HEAD",):
        r = run_git(["show", f"{ref}:.mailmap"], git_dir, check=False)
        if r.returncode == 0:
            return r.stdout
    return None


def head_exists(git_dir: str | Path) -> bool:
    r = run_git(["rev-parse", "--verify", "HEAD"], git_dir, check=False)
    return r.returncode == 0


# --------------------------------------------------------------------------- blame

_BLAME_AUTHOR = re.compile(r'^author (.*)$')
_BLAME_MAIL = re.compile(r"^author-mail <(.*)>$")


def blame_ownership(git_dir: str | Path, path: str, rev: str = "HEAD", timeout: float = 30.0) -> dict | None:
    """Line ownership of `path` at `rev`: [(name, email, lines)] sorted desc.

    Returns None when blame is impossible (missing file, timeout, binary...).
    """
    try:
        r = run_git(
            ["blame", "--line-porcelain", rev, "--", path],
            git_dir,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0:
        return None

    counts: dict[str, dict] = {}
    name: str | None = None
    total = 0
    for line in r.stdout.splitlines():
        m = _BLAME_AUTHOR.match(line)
        if m:
            name = m.group(1)
            continue
        m = _BLAME_MAIL.match(line)
        if m and name is not None:
            email = m.group(1).strip("<>").lower()
            entry = counts.setdefault(email, {"name": name, "email": email, "lines": 0})
            entry["name"] = name  # most recent name spelling wins
            entry["lines"] += 1
            total += 1
            name = None
    if total == 0:
        return None
    owners = sorted(counts.values(), key=lambda e: -e["lines"])
    return {"total_lines": total, "owners": owners[:20]}


# --------------------------------------------------------------------------- clone

_COUNTING = re.compile(r"Counting objects:\s+(\d+)%")
_RECEIVING = re.compile(r"Receiving objects:\s+(\d+)%")
_RESOLVING = re.compile(r"Resolving deltas:\s+(\d+)%")


def clone_mirror(
    url: str,
    dest: str | Path,
    on_progress: Callable[[float, str], None] | None = None,
) -> None:
    """Full mirror clone with coarse progress: counting 0-10%, receiving 10-90%,
    resolving 90-100%. Raises GitError with git's own stderr on failure."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["git", "clone", "--mirror", "--progress", url, str(dest)]
    proc = subprocess.Popen(
        cmd,
        env=GIT_ENV,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    progress = 0.0
    tail: list[str] = []
    assert proc.stderr is not None
    buf = b""
    while True:
        chunk = proc.stderr.read1(65536)
        if not chunk:
            break
        buf += chunk
        while b"\r" in buf or b"\n" in buf:
            sep = b"\r" if b"\r" in buf else b"\n"
            line, buf = buf.split(sep, 1)
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            tail.append(text)
            if len(tail) > 40:
                tail.pop(0)
            m = _COUNTING.search(text)
            if m:
                progress = max(progress, 0.02 + 0.08 * int(m.group(1)) / 100)
            m = _RECEIVING.search(text)
            if m:
                progress = max(progress, 0.10 + 0.80 * int(m.group(1)) / 100)
            m = _RESOLVING.search(text)
            if m:
                progress = max(progress, 0.90 + 0.10 * int(m.group(1)) / 100)
            if on_progress and ("%" in text or "Cloning" in text):
                on_progress(min(progress, 0.99), text)
    code = proc.wait()
    if code != 0:
        raise GitError("clone failed: " + " | ".join(tail[-3:])[-400:], "\n".join(tail))


def fetch_updates(git_dir: str | Path, timeout: float = 600.0) -> None:
    """Refresh a mirror clone (no-op for uploaded repositories)."""
    r = run_git(["remote", "update", "--prune"], git_dir, timeout=timeout, check=False)
    if r.returncode != 0:
        raise GitError(f"fetch failed: {r.stderr.strip()[:400]}", r.stderr)


# --------------------------------------------------------------------------- fs facts

def directory_size(path: str | Path) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total
