#!/usr/bin/env bash
# Stratum — production-ish launcher: build frontend if needed, then serve everything
# from a single process on $PORT (default 8000).
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"
PY="${PYTHON:-python3}"

# --- python env -----------------------------------------------------------------
if [ ! -d .venv ]; then
  echo "[stratum] creating virtualenv (.venv)"
  "$PY" -m venv .venv
fi
if ! .venv/bin/python -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "[stratum] installing backend dependencies"
  .venv/bin/pip install -q -r backend/requirements.txt
fi

# --- frontend -------------------------------------------------------------------
if [ ! -d frontend/node_modules ]; then
  echo "[stratum] installing frontend dependencies"
  npm --prefix frontend install --no-audit --no-fund
fi
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html -newer frontend/dist/index.html 2>/dev/null | head -1)" ]; then
  echo "[stratum] building frontend"
  npm --prefix frontend run build
fi

echo "[stratum] serving on http://localhost:${PORT}"
exec .venv/bin/python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "$PORT"
