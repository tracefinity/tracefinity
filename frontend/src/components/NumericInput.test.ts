import { describe, expect, it } from 'vitest'

// test the clamping logic that NumericInput uses on commit
function clampNumeric(raw: string, min: number, max: number, step: number, fallback: number): number {
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  const parsed = step < 1 ? parseFloat(trimmed) : parseInt(trimmed, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

describe('NumericInput clamping', () => {
  it('clamps value above max to max', () => {
    expect(clampNumeric('999', 1, 50, 1, 5)).toBe(50)
  })

  it('clamps value below min to min', () => {
    expect(clampNumeric('0', 1, 50, 1, 5)).toBe(1)
  })

  it('passes through value within range', () => {
    expect(clampNumeric('7', 1, 50, 1, 5)).toBe(7)
  })

  it('returns fallback for empty string', () => {
    expect(clampNumeric('', 1, 50, 1, 5)).toBe(5)
  })

  it('returns fallback for non-numeric text', () => {
    expect(clampNumeric('abc', 1, 50, 1, 5)).toBe(5)
  })

  it('parses float when step < 1', () => {
    expect(clampNumeric('3.5', 0, 10, 0.5, 1)).toBe(3.5)
  })

  it('parses int when step >= 1', () => {
    expect(clampNumeric('3.9', 0, 10, 1, 1)).toBe(3)
  })

  it('handles whitespace-padded input', () => {
    expect(clampNumeric('  7  ', 1, 50, 1, 5)).toBe(7)
  })

  it('clamps negative values to min', () => {
    expect(clampNumeric('-5', 0, 100, 1, 10)).toBe(0)
  })
})
