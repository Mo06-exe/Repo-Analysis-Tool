#!/usr/bin/env bash
# Generates a small but non-trivial git repository for testing Stratum:
#   - 4 developers, 2 of them with duplicate identities hidden behind a .mailmap
#   - nested directories, a binary asset, branches, a merge and a co-authored commit
#   - ~45 commits spread over two and a half years (ascending dates)
#
# Usage: scripts/make_demo_repo.sh [destination]   (default: /tmp/stratum-demo)
set -euo pipefail

DEST="${1:-/tmp/stratum-demo}"

if [ -e "$DEST" ]; then
  echo "destination $DEST already exists; pick another path" >&2
  exit 1
fi

mkdir -p "$DEST"
cd "$DEST"
git init -q -b main

# author helper: c <date> <name> <email> <message>   (stages everything first)
c() {
  git add -A
  GIT_AUTHOR_NAME="$2" GIT_AUTHOR_EMAIL="$3" \
  GIT_COMMITTER_NAME="$2" GIT_COMMITTER_EMAIL="$3" \
  GIT_AUTHOR_DATE="$1T10:0$((RANDOM % 9)):00 +0100" \
  GIT_COMMITTER_DATE="$1T10:0$((RANDOM % 9)):00 +0100" \
  git commit -q -m "$4"
}

w() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

# ---------------------------------------------------------------- early history
cat > .mailmap <<'EOF'
Ada Lovelace <ada@example.com> <ada@local>
Ada Lovelace <ada@example.com> ada <ada@example.com>
Sam Reyes <sam@example.com> <sam@personal.io>
EOF

w src/core/engine.py <<'EOF'
"""Tiny execution engine used across the demo."""


class Engine:
    def __init__(self):
        self.ready = False

    def boot(self):
        self.ready = True
        return self.ready
EOF
c 2024-01-08 "Ada Lovelace" "ada@example.com" "core: initial engine skeleton"

w src/core/models.py <<'EOF'
class Record:
    def __init__(self, key, value):
        self.key = key
        self.value = value
EOF
c 2024-01-15 "Grace Hopper" "grace@naval.dev" "core: add record model"

w src/core/io.py <<'EOF'
def read_text(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()
EOF
c 2024-01-22 "Linus T" "linus@kernel.org" "core: text reader"

cat >> src/core/engine.py <<'EOF'

    def run(self, steps):
        for step in steps:
            step()
EOF
c 2024-02-03 "ada" "ada@local" "engine: add run loop"

w docs/architecture.md <<'EOF'
# Architecture

The engine owns the loop, models carry data, io talks to the disk.
EOF
c 2024-02-14 "Sam" "sam@personal.io" "docs: write architecture notes"

w tests/test_engine.py <<'EOF'
from src.core.engine import Engine


def test_boot():
    assert Engine().boot() is True
EOF
c 2024-02-27 "Grace Hopper" "grace@naval.dev" "tests: cover engine boot"

# ------------------------------------------------------------- feature/ui branch
git checkout -q -b feature/ui

w src/ui/app.ts <<'EOF'
export function mount(root: HTMLElement) {
  root.textContent = "stratum demo";
}
EOF
c 2024-03-11 "Grace Hopper" "grace@naval.dev" "ui: minimal mount helper"

w src/ui/view.ts <<'EOF'
export function render(container: HTMLElement) {
  container.innerHTML = "";
}
EOF
c 2024-03-19 "Sam" "sam@personal.io" "ui: rendering stub"

w src/ui/theme.css <<'EOF'
:root { --bg: #101215; --fg: #e2e5ea; }
body { background: var(--bg); color: var(--fg); }
EOF
c 2024-04-02 "Sam" "sam@personal.io" "ui: theme variables"

# --------------------------------------------------------------- back to main
git checkout -q main

cat >> src/core/io.py <<'EOF'


def write_text(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
EOF
c 2024-04-09 "Linus T" "linus@kernel.org" "io: add writer"

GIT_AUTHOR_NAME="Ada Lovelace" GIT_AUTHOR_EMAIL="ada@example.com" \
GIT_COMMITTER_NAME="Ada Lovelace" GIT_COMMITTER_EMAIL="ada@example.com" \
GIT_AUTHOR_DATE="2024-04-16T11:30:00 +0100" \
GIT_COMMITTER_DATE="2024-04-16T11:30:00 +0100" \
git merge -q --no-ff feature/ui -m "Merge feature/ui into main"

# merge also needs to appear in the ui branch graveyard; keep branches tidy:
git branch -q -D feature/ui

# ------------------------------------------------------- co-authored + binary commit
cat >> src/core/models.py <<'EOF'


class Registry:
    def __init__(self):
        self.records = []
EOF
git add -A
GIT_AUTHOR_NAME="Ada Lovelace" GIT_AUTHOR_EMAIL="ada@example.com" \
GIT_COMMITTER_NAME="Ada Lovelace" GIT_COMMITTER_EMAIL="ada@example.com" \
GIT_AUTHOR_DATE="2024-05-02T14:05:00 +0100" \
GIT_COMMITTER_DATE="2024-05-02T14:05:00 +0100" \
git commit -q -m "core: registry container

Co-authored-by: Grace Hopper <grace@naval.dev>"

mkdir -p assets
printf '\x89PNG\x0d\x0a\x1a\x0a\x00\x00\x00\x0dIHDR\x00\x00\x00\x10\x00\x00\x00\x10\x08\x06\x00\x00\x00' > assets/logo.bin
printf '\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\x03\x00\x00\x00\x00\x00\x00\x00\x00\x00' >> assets/logo.bin
c 2024-05-20 "Sam" "sam@personal.io" "assets: add placeholder logo"

# ------------------------------------------------- second long-running branch
git checkout -q -b develop
cat >> src/core/io.py <<'EOF'


def list_files(root):
    import os

    return sorted(os.listdir(root))
EOF
c 2024-06-04 "Linus T" "linus@kernel.org" "io: list helper"

cat >> src/core/engine.py <<'EOF'

    def shutdown(self):
        self.ready = False
EOF
c 2024-07-19 "Linus T" "linus@kernel.org" "engine: graceful shutdown"
git checkout -q main

# ------------------------------------------------------------- steady stream
AUTHORS=("Ada Lovelace|ada@example.com" "Grace Hopper|grace@naval.dev" "Ada Lovelace|ada@example.com" "Linus T|linus@kernel.org" "Sam Reyes|sam@example.com")

i=0
while [ $i -lt 32 ]; do
  d=$(date -u -d "2024-08-01 +$((i * 24)) days" +%F)
  IFS='|' read -r name email <<< "${AUTHORS[$((i % 5))]}"
  target="src/core/engine.py"
  case $((i % 4)) in
    1) target="src/ui/view.ts" ;;
    2) target="tests/test_engine.py" ;;
    3) target="docs/architecture.md" ;;
  esac
  printf '\n# revision %s\n' "$((i + 1))" >> "$target"
  c "$d" "$name" "$email" "tune ${target##*/} for iteration $((i + 1))"
  i=$((i + 1))
done

# ---------------------------------------------------------------- scripts + ci
w scripts/build.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "building..."
EOF
c 2026-08-20 "Grace Hopper" "grace@naval.dev" "scripts: build entrypoint"

w .github/workflows/ci.yml <<'EOF'
name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo ok
EOF
c 2026-09-05 "Ada Lovelace" "ada@example.com" "ci: smoke workflow"

git tag v0.1.0 "$(git rev-list -1 --before=2024-04-10 main)"
git tag v0.2.0 "$(git rev-list -1 --before=2025-06-01 main)"

echo
echo "demo repository ready at: $DEST"
git rev-list --all --count | xargs echo "commits (all refs):"
git shortlog -sne --all | head -20
