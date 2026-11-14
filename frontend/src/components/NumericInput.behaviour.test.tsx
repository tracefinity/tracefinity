// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { NumericInput } from './NumericInput'

describe('NumericInput commits', () => {
  afterEach(cleanup)

  function setup(commitOnBlur?: boolean) {
    const onChange = vi.fn()
    const { container } = render(
      <NumericInput value={5} min={1} max={50} onChange={onChange} commitOnBlur={commitOnBlur} />,
    )
    const input = container.querySelector('input') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: '7' } })
    return { input, onChange }
  }

  it('commits once on Enter, not again on the blur that follows', () => {
    const { input, onChange } = setup()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(7)
    expect(document.activeElement).not.toBe(input)
  })

  it('discards typed text on Escape', () => {
    const { input, onChange } = setup()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('5')
  })

  it('commits on blur by default', () => {
    const { input, onChange } = setup()
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('commits again after an Enter when refocused and edited', () => {
    const { input, onChange } = setup()
    fireEvent.keyDown(input, { key: 'Enter' })
    input.focus()
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(9)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('discards typed text on blur when only Enter may commit', () => {
    const { input, onChange } = setup(false)
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('5')
  })
})
