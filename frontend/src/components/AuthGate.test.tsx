// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthGate } from './AuthGate'
import { AccountMenu } from './AccountMenu'
import type { AuthStatus } from '@/types'

const replaceMock = vi.fn()
let pathname = '/'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathname,
}))

vi.mock('@/lib/api', async (importOriginal) => ({
  // the gate tells a proxy error from a network failure by this class
  ApiError: (await importOriginal<typeof import('@/lib/api')>()).ApiError,
  getAuthStatus: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
  navigation: { toLogin: vi.fn(), toHome: vi.fn() },
}))

import { ApiError, getAuthStatus, getMe, logout, navigation } from '@/lib/api'

const statusMock = vi.mocked(getAuthStatus)

// jsdom has no matchMedia; useTheme needs it during init
window.matchMedia = vi.fn().mockReturnValue({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}) as unknown as typeof window.matchMedia

beforeEach(() => {
  replaceMock.mockReset()
  statusMock.mockReset()
  vi.mocked(getMe).mockReset()
  vi.mocked(logout).mockReset()
  vi.mocked(navigation.toLogin).mockReset()
  pathname = '/'
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mountGate(at = '/') {
  pathname = at
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <div>app content</div>
      </AuthGate>
    </QueryClientProvider>,
  )
}

function renderGate(status: AuthStatus, at = '/') {
  statusMock.mockResolvedValue(status)
  return mountGate(at)
}

const NATIVE_UNSET: AuthStatus = { mode: 'native', setup_required: true, authenticated: false }
const NATIVE_OUT: AuthStatus = { mode: 'native', setup_required: false, authenticated: false }
const NATIVE_IN: AuthStatus = { mode: 'native', setup_required: false, authenticated: true }

describe('AuthGate', () => {
  it('sends a fresh instance to first-run setup', async () => {
    renderGate(NATIVE_UNSET, '/tools/t1')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/setup'))
  })

  it('leaves an unconfigured instance alone once it is on /setup', async () => {
    renderGate(NATIVE_UNSET, '/setup')
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('sends a logged-out visitor to login', async () => {
    renderGate(NATIVE_OUT, '/bins/b1')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })

  it('moves off /setup once setup is done', async () => {
    renderGate(NATIVE_OUT, '/setup')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'))
  })

  it('sends an authenticated visitor off /setup to the app', async () => {
    renderGate(NATIVE_IN, '/setup')
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
  })

  it('leaves an authenticated visitor where they are', async () => {
    renderGate(NATIVE_IN, '/tools/t1')
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it.each(['open', 'proxy'])('does not route in %s mode', async (mode) => {
    renderGate({ mode, setup_required: false, authenticated: false } as AuthStatus, '/tools/t1')
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('renders its children', async () => {
    renderGate(NATIVE_IN)
    expect(await screen.findByText('app content')).toBeTruthy()
  })
})

const ADVICE = 'It may still be starting. If this keeps up, check the server logs.'

describe('AuthGate when the server cannot be reached', () => {
  it('names the HTTP status a proxy answered with', async () => {
    statusMock.mockRejectedValue(new ApiError('server unavailable (HTTP 502)', 502))
    mountGate()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`Can't reach the Tracefinity server (HTTP 502). ${ADVICE}`)
  })

  it('leaves the status out for a network failure', async () => {
    statusMock.mockRejectedValue(new TypeError('Failed to fetch'))
    mountGate()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(`Can't reach the Tracefinity server. ${ADVICE}`)
  })

  it('still renders the app and does not route', async () => {
    statusMock.mockRejectedValue(new ApiError('server unavailable (HTTP 503)', 503))
    mountGate('/tools/t1')
    await screen.findByRole('alert')
    expect(screen.getByText('app content')).toBeTruthy()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('stays quiet when the check is refused, since something did answer', async () => {
    statusMock.mockRejectedValue(new ApiError('not authenticated', 401))
    mountGate()
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1))
    await screen.findByText('app content')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe('retrying', () => {
    beforeEach(() => {
      // setImmediate stays real: react's act() resolves on it
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      })
    })

    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }

    it('asks again every 5 seconds while the server stays down', async () => {
      statusMock.mockRejectedValue(new ApiError('server unavailable (HTTP 502)', 502))
      mountGate()
      await advance(4_900)
      expect(statusMock).toHaveBeenCalledTimes(1)
      await advance(200)
      expect(statusMock).toHaveBeenCalledTimes(2)
      await advance(5_000)
      expect(statusMock).toHaveBeenCalledTimes(3)
    })

    it('keeps the alert up while a retry is in flight', async () => {
      statusMock
        .mockRejectedValueOnce(new ApiError('server timed out (HTTP 504)', 504))
        .mockReturnValueOnce(new Promise<AuthStatus>(() => {}))
      mountGate()
      await advance(5_100)
      expect(statusMock).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('alert').textContent).toBe(
        `Can't reach the Tracefinity server (HTTP 504). ${ADVICE}`,
      )
    })

    it('clears the alert, routes and stops asking once the server answers', async () => {
      statusMock
        .mockRejectedValueOnce(new ApiError('server unavailable (HTTP 502)', 502))
        .mockResolvedValue(NATIVE_OUT)
      mountGate('/bins/b1')
      await advance(100)
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(replaceMock).not.toHaveBeenCalled()

      await advance(5_000)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(replaceMock).toHaveBeenCalledWith('/login')

      await advance(60_000)
      expect(statusMock).toHaveBeenCalledTimes(2)
    })

    it('alerts when a later check fails and keeps asking until it recovers', async () => {
      renderGate(NATIVE_IN, '/tools/t1')
      await advance(31_000)
      expect(screen.queryByRole('alert')).toBeNull()

      // coming back to the tab rechecks a stale status
      statusMock.mockRejectedValue(new ApiError('server unavailable (HTTP 502)', 502))
      window.dispatchEvent(new Event('visibilitychange'))
      await advance(100)
      expect(screen.getByRole('alert')).toBeTruthy()
      expect(screen.getByText('app content')).toBeTruthy()
      expect(statusMock).toHaveBeenCalledTimes(2)

      await advance(5_000)
      expect(statusMock).toHaveBeenCalledTimes(3)

      statusMock.mockResolvedValue(NATIVE_IN)
      await advance(5_000)
      expect(screen.queryByRole('alert')).toBeNull()
      expect(replaceMock).not.toHaveBeenCalled()
    })

    it('does not poll a server that refuses the check', async () => {
      statusMock.mockRejectedValue(new ApiError('forbidden', 403))
      mountGate()
      await advance(60_000)
      expect(statusMock).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('does not poll a server that answers', async () => {
      renderGate(NATIVE_IN)
      await advance(60_000)
      expect(statusMock).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})

describe('AccountMenu no longer carries the gating', () => {
  it('does not route a fresh instance to setup on its own', async () => {
    statusMock.mockResolvedValue(NATIVE_UNSET)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AccountMenu />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(statusMock).toHaveBeenCalled())
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
