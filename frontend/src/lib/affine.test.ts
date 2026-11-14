import { describe, it, expect } from 'vitest'
import { scaleAround } from './affine'
import type { AffineMatrix } from '@/types'

// guards the contract ToolEditor relies on: scaling the photo transform
// about the outline centre keeps every pixel under the scaled outline
describe('scaleAround', () => {
  // rotated, scaled and offset, so every matrix term takes part
  const m: AffineMatrix = [0.08, 0.06, -0.06, 0.08, -35, 12]
  const apply = ([a, b, c, d, e, f]: AffineMatrix, x: number, y: number) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  })

  it('maps an image point to the scaled position of its original mapping', () => {
    const before = apply(m, 400, 250)
    const after = apply(scaleAround(m, 1.25, 10, -4), 400, 250)
    expect(after.x).toBeCloseTo(10 + (before.x - 10) * 1.25, 9)
    expect(after.y).toBeCloseTo(-4 + (before.y + 4) * 1.25, 9)
  })

  it('keeps the image point under the centre fixed', () => {
    const centre = apply(m, 120, 80)
    const after = apply(scaleAround(m, 0.6, centre.x, centre.y), 120, 80)
    expect(after.x).toBeCloseTo(centre.x, 9)
    expect(after.y).toBeCloseTo(centre.y, 9)
  })

  it('leaves the matrix unchanged at a factor of one', () => {
    expect(scaleAround(m, 1, 10, -4)).toEqual(m)
  })
})
