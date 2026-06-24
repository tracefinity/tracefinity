// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedSave } from '../useDebouncedSave'

describe('useDebouncedSave', () => {
  it('saveCount starts at 0', () => {
    const saveFn = vi.fn()
    const { result } = renderHook(() => useDebouncedSave(saveFn, [], 50))

    expect(result.current.saveCount).toBe(0)
  })

  it('saveCount increments after a successful save', async () => {
    vi.useFakeTimers()
    const saveFn = vi.fn().mockResolvedValue(undefined)
    let dep = 0

    const { result, rerender } = renderHook(() =>
      useDebouncedSave(saveFn, [dep], 50),
    )

    // trigger a dep change to fire the save
    dep = 1
    rerender()

    // advance past debounce delay
    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    // flush microtasks for the async saveFn
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(result.current.saveCount).toBe(1)
    expect(saveFn).toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('saving is true while save is in progress', async () => {
    vi.useFakeTimers()
    let resolveSave: () => void
    const saveFn = vi.fn(
      () => new Promise<void>((resolve) => { resolveSave = resolve }),
    )
    let dep = 0

    const { result, rerender } = renderHook(() =>
      useDebouncedSave(saveFn, [dep], 50),
    )

    dep = 1
    rerender()

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.saving).toBe(true)

    await act(async () => {
      resolveSave!()
    })

    expect(result.current.saving).toBe(false)

    vi.useRealTimers()
  })
})
