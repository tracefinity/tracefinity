// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useHistory } from '../useHistory'

it('records a new edit after undo and discards the replaced redo branch', () => {
  const onChange = vi.fn()
  const { result } = renderHook(() => useHistory<string>('original', onChange))
  act(() => result.current.set('corrected'))
  act(() => result.current.set('simplified'))
  act(() => result.current.undo())
  expect(onChange).toHaveBeenLastCalledWith('corrected')
  act(() => result.current.set('different correction'))
  expect(result.current.canRedo).toBe(false)
  act(() => result.current.undo())
  expect(onChange).toHaveBeenLastCalledWith('corrected')
  act(() => result.current.redo())
  expect(onChange).toHaveBeenLastCalledWith('different correction')
})
