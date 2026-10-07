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

  it('surfaces a failed save instead of swallowing it', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('422 bin_config.wall_thickness'))
    let dep = 0
    const { result, rerender } = renderHook(() => useDebouncedSave(saveFn, [dep], 50))

    dep = 1
    rerender()

    await act(async () => {
      await new Promise(r => setTimeout(r, 80))
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toContain('wall_thickness')
    expect(result.current.saved).toBe(false)
    expect(result.current.saving).toBe(false)
  })

  it('does not count a failed save as saved', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('nope'))
    let dep = 0
    const { result, rerender } = renderHook(() => useDebouncedSave(saveFn, [dep], 50))

    dep = 1
    rerender()

    await act(async () => {
      await new Promise(r => setTimeout(r, 80))
    })

    expect(result.current.saveCount).toBe(0)
  })

  it('clears the error once a later save succeeds', async () => {
    const saveFn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)
    let dep = 0
    const { result, rerender } = renderHook(() => useDebouncedSave(saveFn, [dep], 50))

    dep = 1
    rerender()
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    expect(result.current.error).not.toBeNull()

    dep = 2
    rerender()
    await act(async () => { await new Promise(r => setTimeout(r, 80)) })
    expect(result.current.error).toBeNull()
    expect(result.current.saveCount).toBe(1)
  })
})

it('flush serializes an in-flight save and coalesces newer edits', async () => {
  vi.useFakeTimers()
  let releaseFirst!: () => void
  const firstRequest = new Promise<void>(resolve => { releaseFirst = resolve })
  const writes: number[] = []
  const save = vi.fn(async (value: number) => {
    if (value === 1) await firstRequest
    writes.push(value)
  })
  const { result, rerender } = renderHook(({ value }) =>
    useDebouncedSave(() => save(value), [value], 1000),
  { initialProps: { value: 1 } })

  let first!: Promise<void>
  act(() => { first = result.current.flush() })
  await act(async () => { await Promise.resolve() })
  expect(save).toHaveBeenCalledTimes(1)

  rerender({ value: 2 })
  let second!: Promise<void>
  act(() => { second = result.current.flush() })
  rerender({ value: 3 })
  let third!: Promise<void>
  act(() => { third = result.current.flush() })
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.saving).toBe(true)

  await act(async () => {
    releaseFirst()
    await Promise.all([first, second, third])
  })
  expect(writes).toEqual([1, 3])
  expect(result.current.saving).toBe(false)
  expect(result.current.saved).toBe(true)
  vi.useRealTimers()
})

it('flush rejects a failed save so dependent work cannot continue', async () => {
  vi.useFakeTimers()
  const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  const { result } = renderHook(() => useDebouncedSave(save, [], 1000))

  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow('offline')
  })
  expect(result.current.error?.message).toBe('offline')
  expect(result.current.saved).toBe(false)
  await act(async () => { await result.current.flush() })
  expect(result.current.error).toBeNull()
  expect(result.current.saved).toBe(true)
  vi.useRealTimers()
})

it('an idle flush does not overwrite storage, while generation can explicitly save current state', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const { result } = renderHook(() => useDebouncedSave(save, [], 1000, { skipInitial: true }))
  await act(async () => { await result.current.flush() })
  expect(save).not.toHaveBeenCalled()
  await act(async () => { await result.current.flush({ force: true }) })
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.flush() })
  expect(save).toHaveBeenCalledTimes(1)
})
