import { describe, it, expect } from 'vitest'
import { smoothEpsilon, simplifyPolygon } from './svg'

describe('smoothEpsilon', () => {
  // must mirror backend polygon_scaler.smooth_epsilon exactly: absolute mm,
  // independent of tool size (trace noise does not scale with the tool)
  it('returns absolute values matching the backend', () => {
    expect(smoothEpsilon(0)).toBeCloseTo(0.3, 6)
    expect(smoothEpsilon(0.5)).toBeCloseTo(0.9, 6)
    expect(smoothEpsilon(1)).toBeCloseTo(1.5, 6)
  })

  it('is monotonic in level', () => {
    const eps = [0, 0.25, 0.5, 0.75, 1].map(smoothEpsilon)
    expect([...eps].sort((a, b) => a - b)).toEqual(eps)
  })
})

describe('simplifyPolygon', () => {
  it('removes near-collinear points within epsilon', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0.01 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ]
    const out = simplifyPolygon(pts, 0.3)
    expect(out.length).toBe(4)
  })
})
