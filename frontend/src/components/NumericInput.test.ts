import { describe, expect, it } from 'vitest'
import { clampNumber, parseNumericInput } from './NumericInput'

describe('NumericInput helpers', () => {
  it('clamps only when parsing a committed value', () => {
    expect(parseNumericInput('7', 1, 50, 5)).toBe(7)
    expect(parseNumericInput('75', 1, 50, 5)).toBe(50)
    expect(parseNumericInput('-1', 1, 50, 5)).toBe(1)
  })

  it('uses the current value as the fallback for invalid drafts', () => {
    expect(parseNumericInput('', 1, 50, 5)).toBe(5)
    expect(parseNumericInput('abc', 1, 50, 5)).toBe(5)
  })

  it('keeps clampNumber reusable for callers with direct slider values', () => {
    expect(clampNumber(3, 1, 5)).toBe(3)
    expect(clampNumber(0, 1, 5)).toBe(1)
    expect(clampNumber(6, 1, 5)).toBe(5)
  })
})
