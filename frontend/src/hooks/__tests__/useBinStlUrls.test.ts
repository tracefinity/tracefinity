// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

interface PendingCall {
  binId: string
  signal?: AbortSignal
  resolve: (value: { stl_url: string }) => void
  reject: (reason: unknown) => void
}

const { calls } = vi.hoisted(() => ({ calls: [] as PendingCall[] }))

vi.mock('@/lib/api', () => ({
  // behaves like fetch: an aborted signal rejects the pending request
  generateBinStl: vi.fn((binId: string, signal?: AbortSignal) => new Promise((resolve, reject) => {
    calls.push({ binId, signal, resolve, reject })
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })),
  getImageUrl: (path: string) => `http://api${path}`,
}))

import { generateBinStl } from '@/lib/api'
import { useBinStlUrls } from '../useBinStlUrls'

async function flush() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

function lastCall(binId: string): PendingCall {
  const call = [...calls].reverse().find(entry => entry.binId === binId)
  if (!call) throw new Error(`no request for ${binId}`)
  return call
}

async function succeed(binId: string) {
  lastCall(binId).resolve({ stl_url: `/storage/${binId}.stl` })
  await flush()
}

function render(ids: string[], enabled: boolean) {
  return renderHook(
    ({ ids: binIds, enabled: on }) => useBinStlUrls(binIds, on),
    { initialProps: { ids, enabled } },
  )
}

describe('useBinStlUrls', () => {
  beforeEach(() => {
    calls.length = 0
    vi.mocked(generateBinStl).mockClear()
  })

  it('requests nothing while disabled', async () => {
    const { result } = render(['a'], false)
    await flush()

    expect(generateBinStl).not.toHaveBeenCalled()
    expect(result.current.pendingCount).toBe(0)
  })

  it('generates each distinct bin once and exposes its url', async () => {
    const { result } = render(['b', 'a', 'a'], true)
    await flush()

    expect(result.current.pendingCount).toBe(2)
    await succeed('a')
    await succeed('b')

    expect(generateBinStl).toHaveBeenCalledTimes(2)
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.stlUrls.get('a')).toMatch(/^http:\/\/api\/storage\/a\.stl\?v=\d+$/)
    expect(result.current.stlUrls.get('b')).toMatch(/^http:\/\/api\/storage\/b\.stl\?v=\d+$/)
  })

  it('keeps running generation when the same bins arrive in a new array', async () => {
    const { result, rerender } = render(['a', 'b'], true)
    await flush()
    const inFlight = lastCall('a')

    // a placement was dragged: new array, same bins
    rerender({ ids: ['b', 'a'], enabled: true })
    await flush()

    expect(inFlight.signal?.aborted).toBe(false)
    expect(generateBinStl).toHaveBeenCalledTimes(1)

    await succeed('a')
    await succeed('b')
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.stlUrls.size).toBe(2)
  })

  it('releases unfinished requests when disabled mid-flight and requests them again later', async () => {
    const { result, rerender } = render(['a', 'b'], true)
    await flush()
    const inFlight = lastCall('a')

    // back to the 2D view while "a" is generating and "b" is still queued
    rerender({ ids: ['a', 'b'], enabled: false })
    await flush()

    expect(inFlight.signal?.aborted).toBe(true)
    expect(result.current.pendingCount).toBe(0)

    rerender({ ids: ['a', 'b'], enabled: true })
    await flush()
    expect(result.current.pendingCount).toBe(2)

    await succeed('a')
    await succeed('b')
    expect(result.current.pendingCount).toBe(0)
    expect([...result.current.stlUrls.keys()].sort()).toEqual(['a', 'b'])
  })

  it('only requests newly added bins when the set grows', async () => {
    const { result, rerender } = render(['a'], true)
    await flush()
    await succeed('a')

    rerender({ ids: ['a', 'c'], enabled: true })
    await flush()

    expect(calls.map(call => call.binId)).toEqual(['a', 'c'])
    await succeed('c')
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.stlUrls.size).toBe(2)
  })

  it('retries a bin whose generation failed on the next run', async () => {
    const { result, rerender } = render(['a'], true)
    await flush()

    lastCall('a').reject(new Error('generation failed'))
    await flush()
    expect(result.current.pendingCount).toBe(0)
    expect(result.current.stlUrls.has('a')).toBe(false)

    rerender({ ids: ['a'], enabled: false })
    rerender({ ids: ['a'], enabled: true })
    await flush()

    expect(generateBinStl).toHaveBeenCalledTimes(2)
    await succeed('a')
    expect(result.current.stlUrls.has('a')).toBe(true)
  })

  it('aborts outstanding work on unmount', async () => {
    const { unmount } = render(['a'], true)
    await flush()
    const inFlight = lastCall('a')

    unmount()

    expect(inFlight.signal?.aborted).toBe(true)
  })
})
