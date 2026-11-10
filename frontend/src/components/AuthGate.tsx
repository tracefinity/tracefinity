'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ApiError, getAuthStatus } from '@/lib/api'
import { Alert } from '@/components/Alert'

const AUTH_PAGES = ['/login', '/setup']
const RETRY_INTERVAL_MS = 5_000

// a network failure or a 5xx. a 4xx means something answered
function isUnreachable(error: Error | null): error is Error {
  return error !== null && (!(error instanceof ApiError) || error.status >= 500)
}

function unreachableMessage(error: Error): string {
  const status = error instanceof ApiError ? ` (HTTP ${error.status})` : ''
  return `Can't reach the Tracefinity server${status}. It may still be starting. If this keeps up, check the server logs.`
}

/**
 * First-run and login routing for the whole app.
 *
 * This belongs in the layout, not in a header control: moving or removing a
 * piece of chrome must not be able to drop first-run gating.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()

  const { data: status, error, isSuccess } = useQuery({
    queryKey: ['auth-status'],
    queryFn: getAuthStatus,
    staleTime: 30_000,
    retry: false,
    // keep asking while the server is unreachable so the alert clears itself
    refetchInterval: (query) => (isUnreachable(query.state.error) ? RETRY_INTERVAL_MS : false),
  })

  // a retry with nothing cached resets the query to pending and drops its
  // error, so hold the last failure until a request succeeds
  const [failure, setFailure] = useState<Error | null>(null)
  if (isUnreachable(error)) {
    if (error !== failure) setFailure(error)
  } else if (failure && (isSuccess || error)) {
    setFailure(null)
  }

  // route to first-run setup or login before anything else renders data
  useEffect(() => {
    if (!status || status.mode !== 'native') return
    if (status.setup_required) {
      if (pathname !== '/setup') router.replace('/setup')
      return
    }
    if (pathname === '/setup') {
      router.replace(status.authenticated ? '/' : '/login')
      return
    }
    if (!status.authenticated && !AUTH_PAGES.includes(pathname)) {
      router.replace('/login')
    }
  }, [status, pathname, router])

  return (
    <>
      {failure && (
        <div role="alert" className="px-4 py-2">
          <Alert variant="error">{unreachableMessage(failure)}</Alert>
        </div>
      )}
      {children}
    </>
  )
}
