"""FastAPI application: API + built frontend served from one process."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import db
from .routes import router

DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Stratum", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

# the dev server (vite, :5173) talks to this origin directly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.exception_handler(ValueError)
async def value_error_handler(_request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    """Serve the built frontend; unknown non-API paths fall back to index.html."""
    if full_path.startswith("api/"):
        raise HTTPException(404, "not found")
    if DIST_DIR.is_dir():
        candidate = (DIST_DIR / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(DIST_DIR)):
            return FileResponse(candidate)
        index = DIST_DIR / "index.html"
        if index.is_file():
            return FileResponse(index)
    raise HTTPException(
        404,
        "frontend build not found — run `npm --prefix frontend run build` or use ./dev.sh",
    )
