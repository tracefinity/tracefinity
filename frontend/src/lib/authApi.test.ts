// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  getAuthStatus,
  navigation,
  listSessions,
  login,
  loginTwoFactor,
  logout,
  setupAdmin,
  uploadImage,
} from './api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// what a reverse proxy sends when it answers instead of the backend
function htmlResponse(status: number) {
  return new Response('<html><body><h1>proxy error</h1></body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  window.history.pushState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('credentials at both choke points', () => {
  it('fetchApi sends cookies', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ mode: 'native', setup_required: false, authenticated: true }))
    await getAuthStatus()
    const [, init] = fetchMock.mock.calls[0]
    expect(init.credentials).toBe('include')
  })

  it('fetchForm sends cookies', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ session_id: 's1' }))
    await uploadImage(new File(['x'], 'x.png'))
    const [, init] = fetchMock.mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(init.method).toBe('POST')
  })
})

describe('login flow', () => {
  it('parses a direct login', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      pending: false,
      pending_token: null,
      account: { id: 'a1', email: 'admin@example.com', is_admin: true, disabled: false, created_at: 'now', totp_enabled: false },
    }))
    const result = await login('Admin@Example.com', 'password')
    expect(result.pending).toBe(false)
    expect(result.account?.email).toBe('admin@example.com')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/auth/login')
    expect(JSON.parse(init.body)).toEqual({ email: 'Admin@Example.com', password: 'password' })
  })

  it('surfaces the pending token for two-factor accounts', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pending: true, pending_token: 'tok', account: null }))
    const result = await login('a@example.com', 'password')
    expect(result.pending).toBe(true)
    expect(result.pending_token).toBe('tok')
  })

  it('redeems a pending token with a code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pending: false, pending_token: null, account: null }))
    await loginTwoFactor('tok', '123456')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/auth/login/2fa')
    expect(JSON.parse(init.body)).toEqual({ pending_token: 'tok', code: '123456' })
  })

  it('throws ApiError with the backend detail on bad credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'invalid email or password' }, 401))
    window.history.pushState({}, '', '/login')
    await expect(login('a@example.com', 'nope')).rejects.toThrowError(
      new ApiError('invalid email or password', 401),
    )
  })

  it('carries the backend error code when the detail is structured', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { detail: { code: 'pending_login_invalid', message: 'invalid or expired login token' } },
        401,
      ),
    )
    window.history.pushState({}, '', '/login')
    await expect(loginTwoFactor('tok', '123456')).rejects.toMatchObject({
      status: 401,
      code: 'pending_login_invalid',
      message: 'invalid or expired login token',
    })
  })

  it('leaves code undefined for a plain string detail', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'invalid email or password' }, 401))
    window.history.pushState({}, '', '/login')
    await expect(login('a@example.com', 'nope')).rejects.toMatchObject({ code: undefined })
  })
})

describe('setup flow', () => {
  it('posts the first administrator credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      id: 'a1', email: 'admin@example.com', is_admin: true, disabled: false, created_at: 'now', totp_enabled: false,
    }))
    const account = await setupAdmin('admin@example.com', 'long password')
    expect(account.is_admin).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/auth/setup')
    expect(JSON.parse(init.body)).toEqual({ email: 'admin@example.com', password: 'long password' })
  })

  it('surfaces the 409 a setup race loser receives', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'setup has already been completed' }, 409))
    await expect(setupAdmin('a@example.com', 'long password')).rejects.toMatchObject({ status: 409 })
  })
})

describe('401 handling', () => {
  it('redirects to /login when a data call is unauthenticated', async () => {
    const toLogin = vi.spyOn(navigation, 'toLogin').mockImplementation(() => {})
    window.history.pushState({}, '', '/tools/t1')
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'not authenticated' }, 401))
    await expect(listSessions()).rejects.toBeInstanceOf(ApiError)
    expect(toLogin).toHaveBeenCalled()
  })

  it.each(['/login', '/setup'])('does not redirect while already on %s', async (page) => {
    const toLogin = vi.spyOn(navigation, 'toLogin').mockImplementation(() => {})
    window.history.pushState({}, '', page)
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'not authenticated' }, 401))
    await expect(listSessions()).rejects.toBeInstanceOf(ApiError)
    expect(toLogin).not.toHaveBeenCalled()
  })

  it('still redirects when the 401 carries no detail', async () => {
    const toLogin = vi.spyOn(navigation, 'toLogin').mockImplementation(() => {})
    window.history.pushState({}, '', '/tools/t1')
    fetchMock.mockResolvedValue(htmlResponse(401))
    await expect(listSessions()).rejects.toThrowError(new ApiError('request failed (HTTP 401)', 401))
    expect(toLogin).toHaveBeenCalled()
  })
})

describe('errors with no usable detail', () => {
  it.each([
    [502, 'server unavailable (HTTP 502)'],
    [503, 'server unavailable (HTTP 503)'],
    [504, 'server timed out (HTTP 504)'],
    [500, 'request failed (HTTP 500)'],
  ])('names the status of a %i error page from the proxy', async (status, message) => {
    fetchMock.mockResolvedValue(htmlResponse(status))
    await expect(getAuthStatus()).rejects.toThrowError(new ApiError(message, status))
  })

  it('names an upload the proxy refused as too large', async () => {
    fetchMock.mockResolvedValue(htmlResponse(413))
    await expect(uploadImage(new File(['x'], 'x.png'))).rejects.toThrowError(
      new ApiError('file too large for the server (HTTP 413)', 413),
    )
  })

  it('names the status when the body is empty', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 504 }))
    await expect(getAuthStatus()).rejects.toThrowError(new ApiError('server timed out (HTTP 504)', 504))
  })

  it.each([
    ['no detail', { error: 'nope' }],
    ['an empty detail', { detail: '' }],
    ['a detail that is not text', { detail: 404 }],
    ['a validation list for a detail', { detail: [{ loc: ['body', 'email'], msg: 'field required' }] }],
  ])('names the status when the json body has %s', async (_label, body) => {
    fetchMock.mockResolvedValue(jsonResponse(body, 422))
    await expect(getAuthStatus()).rejects.toThrowError(new ApiError('request failed (HTTP 422)', 422))
  })

  it('keeps the code of a structured detail that has no message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: { code: 'rate_limited' } }, 429))
    await expect(getAuthStatus()).rejects.toThrowError(
      new ApiError('request failed (HTTP 429)', 429, 'rate_limited'),
    )
  })

  it('prefers a string detail over the status wording', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'model is still loading' }, 503))
    await expect(getAuthStatus()).rejects.toThrowError(new ApiError('model is still loading', 503))
  })

  it('prefers a structured detail over the status wording', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: { code: 'upstream_busy', message: 'try again shortly' } }, 502),
    )
    await expect(getAuthStatus()).rejects.toThrowError(
      new ApiError('try again shortly', 502, 'upstream_busy'),
    )
  })
})

describe('endpoints without a body', () => {
  it('logout tolerates a 204 response', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(logout()).resolves.toBeUndefined()
  })
})
