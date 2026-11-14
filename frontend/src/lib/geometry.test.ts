import { describe, it, expect } from 'vitest'
import { centroidOf, rotateGeometry, scaleGeometry, sizeOf } from './geometry'

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

// guards the contract ToolEditor relies on: a scale keeps the vertex-mean
// centre in place and resizes the outline, never the cutouts
describe('scaleGeometry', () => {
  // the extra vertex on the left edge puts the vertex mean at (24, 18),
  // away from the bounding-box centre (30, 20)
  const outline = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 40 },
    { x: 0, y: 40 },
    { x: 0, y: 10 },
  ]
  const ring = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
  ]

  it('scales the outline about its vertex-mean centre', () => {
    const { points } = scaleGeometry(outline, [], [], 1.5)
    expect(points).toEqual([
      { x: -12, y: -9 },
      { x: 78, y: -9 },
      { x: 78, y: 51 },
      { x: -12, y: 51 },
      { x: -12, y: 6 },
    ])
    expect(sizeOf(points)).toEqual({ width: 90, height: 60 })
  })

  it('keeps the vertex-mean centre fixed', () => {
    const { points } = scaleGeometry(outline, [], [], 0.37)
    const centre = centroidOf(points)
    expect(centre.x).toBeCloseTo(24, 9)
    expect(centre.y).toBeCloseTo(18, 9)
  })

  it('scales interior rings about the outline centre', () => {
    const { interiorRings } = scaleGeometry(outline, [], [ring], 1.5)
    expect(interiorRings).toEqual([[
      { x: 3, y: 6 },
      { x: 18, y: 6 },
      { x: 18, y: 21 },
      { x: 3, y: 21 },
    ]])
  })

  it('moves cutouts with the outline but leaves their size, rotation and depth alone', () => {
    const holes = [
      { id: 'round', x: 40, y: 30, radius: 7.5, shape: 'circle' as const },
      { id: 'slot', x: 12, y: 8, radius: 15, width: 30, height: 20, rotation: 25, shape: 'rectangle' as const, depth_override: 6 },
    ]
    const { fingerHoles } = scaleGeometry(outline, holes, [], 1.5)
    expect(fingerHoles).toEqual([
      { ...holes[0], x: 48, y: 36 },
      { ...holes[1], x: 6, y: 3 },
    ])
  })

  it('scales about a supplied centre', () => {
    const { points } = scaleGeometry(outline, [], [], 2, { x: 0, y: 0 })
    expect(points).toEqual(outline.map(p => ({ x: p.x * 2, y: p.y * 2 })))
  })

  it('returns geometry without an outline untouched', () => {
    const holes = [{ id: 'h', x: 5, y: 5, radius: 5 }]
    expect(scaleGeometry([], holes, [ring], 2)).toEqual({ points: [], fingerHoles: holes, interiorRings: [ring] })
  })
})

describe('sizeOf', () => {
  it('measures the axis-aligned extent of a point array', () => {
    expect(sizeOf([{ x: -40, y: 15 }, { x: 32, y: -15 }, { x: 40, y: 0 }])).toEqual({ width: 80, height: 30 })
  })

  it('reports no extent for an empty array', () => {
    expect(sizeOf([])).toEqual({ width: 0, height: 0 })
  })
})
