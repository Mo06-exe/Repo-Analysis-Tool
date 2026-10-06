// Minimal typed fetch layer. All endpoints live under /api and speak JSON.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(
  path: string,
  opts: { params?: Record<string, unknown>; method?: string; body?: unknown } = {},
): Promise<T> {
  const url = new URL(path, window.location.origin)
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
      url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v))
    }
  }
  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export async function apiUpload<T>(path: string, params: Record<string, string>, file: File): Promise<T> {
  const url = new URL(path, window.location.origin)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}
