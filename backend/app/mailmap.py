"""`.mailmap` parsing and lookup, following gitmailmap(5).

Supported entry forms:

    Proper Name <commit@email>                       name replacement, keyed by email
    <proper@email> <commit@email>                    email replacement, keyed by email
    Proper Name <proper@email> <commit@email>        both, keyed by email
    Proper Name <proper@email> Commit Name <commit@email>
                                                     both, keyed by name + email

Lookup walks entries registered under the commit email, in file order, and the
first entry whose optional name matches (case-insensitively) wins — the same
precedence git itself applies.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_TOKEN = re.compile(r"(?:(?P<name>[^<>]*?)\s*)?<(?P<email>[^<>]+)>")


@dataclass
class Entry:
    key_name: str | None  # None => email-only key
    new_name: str | None
    new_email: str | None


class Mailmap:
    def __init__(self, entries: dict[str, list[Entry]] | None = None):
        self.entries = entries or {}
        self.size = sum(len(v) for v in self.entries.values())

    # ------------------------------------------------------------------ parse
    @classmethod
    def parse(cls, text: str | None) -> "Mailmap":
        entries: dict[str, list[Entry]] = {}
        if not text:
            return cls(entries)
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            tokens = [(m.group("name"), m.group("email")) for m in _TOKEN.finditer(line)]
            if not tokens:
                continue
            if len(tokens) == 1:
                name, email = tokens[0]
                if not name:
                    continue
                entry = Entry(key_name=None, new_name=name, new_email=None)
                entries.setdefault(email.lower(), []).append(entry)
            else:
                (r_name, r_email), (k_name, k_email) = tokens[0], tokens[1]
                r_name = r_name.strip() if r_name else None
                k_name = k_name.strip() if k_name else None
                entry = Entry(
                    key_name=k_name.lower() if k_name else None,
                    new_name=r_name,
                    new_email=r_email if r_email.lower() != k_email.lower() else None,
                )
                if entry.new_name is None and entry.new_email is None:
                    continue
                entries.setdefault(k_email.lower(), []).append(entry)
        return cls(entries)

    # ----------------------------------------------------------------- lookup
    def lookup(self, name: str, email: str) -> tuple[str, str, bool]:
        """Resolve a (name, email) pair. Returns (name', email', changed)."""
        candidates = self.entries.get(email.lower())
        if not candidates:
            return name, email, False
        lname = name.lower()
        for entry in candidates:
            if entry.key_name is not None and entry.key_name != lname:
                continue
            new_name = entry.new_name or name
            new_email = entry.new_email or email
            return new_name, new_email, (new_name != name or new_email != email)
        return name, email, False
