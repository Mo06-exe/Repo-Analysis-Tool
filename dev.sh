#!/usr/bin/env bash
# Stratum — development mode: uvicorn (reload) on :8000, vite dev server on :5173.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"

if [ ! -d .venv ]; then
  "$PY" -m venv .venv
fi
if ! .venv/bin/python -c "import fastapi, uvicorn" 2>/dev/null; then
  .venv/bin/pip install -q -r backend/requirements.txt
fi
if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend install --no-audit --no-fund
fi

trap 'kill 0' EXIT
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload &
npm --prefix frontend run dev &
wait
