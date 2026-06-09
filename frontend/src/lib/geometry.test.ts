import { describe, it, expect } from 'vitest'
import { rotateGeometry } from './geometry'

// guards the contract ToolEditor relies on: rotation must carry interior
// rings along with the outline and finger holes
describe('rotateGeometry', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ]
  const ring = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
  ]

  it('rotates interior rings about the outline centroid', () => {
    const { interiorRings } = rotateGeometry(square, [], [ring], 90)
    // centroid (20,20); (10,10) rotated 90deg -> (30,10)
    expect(interiorRings[0][0].x).toBeCloseTo(30, 6)
    expect(interiorRings[0][0].y).toBeCloseTo(10, 6)
  })

  it('keeps ring shape rigid under rotation', () => {
    const { interiorRings } = rotateGeometry(square, [], [ring], 37)
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y)
    expect(d(interiorRings[0][0], interiorRings[0][1])).toBeCloseTo(10, 6)
    expect(d(interiorRings[0][1], interiorRings[0][2])).toBeCloseTo(10, 6)
  })

  it('rotates finger hole positions and accumulates their rotation', () => {
    const holes = [{ id: 'h', x: 10, y: 20, radius: 5, rotation: 10, shape: 'square' as const }]
    const { fingerHoles } = rotateGeometry(square, holes, [], 90)
    expect(fingerHoles[0].x).toBeCloseTo(20, 6)
    expect(fingerHoles[0].y).toBeCloseTo(10, 6)
    expect(fingerHoles[0].rotation).toBeCloseTo(100, 6)
  })
})
