import type {
  UploadResponse,
  CornersResponse,
  TraceResponse,
  GenerateResponse,
  Point,
  Polygon,
  BinConfig,
  Session,
  SessionSummary,
} from '@/types'

// empty string means use relative URLs (same origin, for Docker)
// undefined means use default dev URL
const API_URL = process.env.NEXT_PUBLIC_API_URL === ''
  ? ''
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'request failed' }))
    throw new Error(error.detail || 'request failed')
  }

  return res.json()
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const formData = new FormData()
  formData.append('image', file)

  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    throw new Error('upload failed')
  }

  return res.json()
}

export async function setCorners(
  sessionId: string,
  corners: Point[],
  paperSize: 'a4' | 'letter'
): Promise<CornersResponse> {
  return fetchApi(`/api/sessions/${sessionId}/corners`, {
    method: 'POST',
    body: JSON.stringify({ corners, paper_size: paperSize }),
  })
}

export async function getAvailableKeys(): Promise<{ google: boolean }> {
  return fetchApi('/api/api-keys')
}

export async function traceTools(
  sessionId: string,
  provider: 'google',
  apiKey?: string
): Promise<TraceResponse> {
  return fetchApi(`/api/sessions/${sessionId}/trace`, {
    method: 'POST',
    body: JSON.stringify({
      provider,
      api_key: apiKey || null,
    }),
  })
}

export async function updatePolygons(
  sessionId: string,
  polygons: Polygon[]
): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}/polygons`, {
    method: 'PUT',
    body: JSON.stringify({ polygons }),
  })
}

export async function generateStl(
  sessionId: string,
  config: BinConfig,
  polygons?: Polygon[]
): Promise<GenerateResponse> {
  return fetchApi(`/api/sessions/${sessionId}/generate`, {
    method: 'POST',
    body: JSON.stringify({ ...config, polygons }),
  })
}

export async function getSession(sessionId: string): Promise<Session> {
  return fetchApi(`/api/sessions/${sessionId}`)
}

export function getImageUrl(path: string): string {
  return `${API_URL}${path}`
}

export function getStlUrl(sessionId: string): string {
  return `${API_URL}/api/files/${sessionId}/bin.stl`
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await fetchApi<{ sessions: SessionSummary[] }>('/api/sessions')
  return res.sessions
}

export async function deleteSession(sessionId: string): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function updateSession(
  sessionId: string,
  updates: { name?: string; description?: string; tags?: string[] }
): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

export async function traceFromMask(
  sessionId: string,
  maskFile: File
): Promise<TraceResponse> {
  const formData = new FormData()
  formData.append('mask', maskFile)

  const res = await fetch(`${API_URL}/api/sessions/${sessionId}/trace-mask`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'upload failed' }))
    throw new Error(error.detail || 'upload failed')
  }

  return res.json()
}

// backwards compat
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await updateSession(sessionId, { name })
}
