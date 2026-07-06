import { describe, it, expect } from 'vitest'
import { MIN_CUTOUT_SIZE_MM, resizeRectCutout, resizeRoundCutout } from './cutouts'

// guards issue #114: rectangle cutouts must resize below 10mm
describe('resizeRectCutout', () => {
  it('allows a 25x5mm rectangle', () => {
    const r = resizeRectCutout(0, 0, 25, 5, 0)
    expect(r.width).toBeCloseTo(25)
    expect(r.height).toBeCloseTo(5)
  })

  it('clamps dimensions to the minimum cutout size', () => {
    const r = resizeRectCutout(0, 0, 0.4, 0.4, 0)
    expect(r.width).toBe(MIN_CUTOUT_SIZE_MM)
    expect(r.height).toBe(MIN_CUTOUT_SIZE_MM)
  })

  it('allows the minimum size exactly', () => {
    const r = resizeRectCutout(0, 0, MIN_CUTOUT_SIZE_MM, MIN_CUTOUT_SIZE_MM, 0)
    expect(r.width).toBeCloseTo(MIN_CUTOUT_SIZE_MM)
    expect(r.height).toBeCloseTo(MIN_CUTOUT_SIZE_MM)
  })

  it('measures dimensions in local space under rotation', () => {
    // 90deg rotation: global (5, 25) drag reads as 25 wide x 5 high locally
    const r = resizeRectCutout(0, 0, 5, 25, 90)
    expect(r.width).toBeCloseTo(25)
    expect(r.height).toBeCloseTo(5)
  })

  it('centres the rectangle at the anchor-mouse midpoint', () => {
    const r = resizeRectCutout(10, 20, 30, 40, 0)
    expect(r.x).toBeCloseTo(20)
    expect(r.y).toBeCloseTo(30)
  })

  it('handles dragging past the anchor (negative local dims)', () => {
    const r = resizeRectCutout(25, 5, 0, 0, 0)
    expect(r.width).toBeCloseTo(25)
    expect(r.height).toBeCloseTo(5)
  })
})

// guards the circle/square radius floor against regressing to the old 5mm
describe('resizeRoundCutout', () => {
  it('returns the centre-to-mouse distance as radius', () => {
    expect(resizeRoundCutout(0, 0, 3, 4)).toBeCloseTo(5)
  })

  it('allows radii below the old 5mm floor', () => {
    expect(resizeRoundCutout(0, 0, 2, 0)).toBeCloseTo(2)
  })

  it('clamps the radius to half the minimum cutout size', () => {
    expect(resizeRoundCutout(0, 0, 0.1, 0)).toBe(MIN_CUTOUT_SIZE_MM / 2)
  })
})

describe('MIN_CUTOUT_SIZE_MM', () => {
  it('is well below the reported 10mm floor', () => {
    expect(MIN_CUTOUT_SIZE_MM).toBeLessThanOrEqual(5)
    expect(MIN_CUTOUT_SIZE_MM).toBeGreaterThan(0)
  })
})
