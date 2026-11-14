import type { Point, FingerHole } from '@/types'

interface TransformedGeometry {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings: Point[][]
}

// Rotate around the polygon centroid unless a shared geometry centre is supplied.
export function rotateGeometry(
  points: Point[],
  fingerHoles: FingerHole[],
  interiorRings: Point[][],
  angleDeg: number,
  center?: Point,
): TransformedGeometry {
  const n = points.length
  if (n === 0) return { points, fingerHoles, interiorRings }

  const { x: cx, y: cy } = center ?? centroidOf(points)
  const rad = angleDeg * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  const rotPt = (p: Point): Point => {
    const dx = p.x - cx, dy = p.y - cy
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
  }

  return {
    points: points.map(rotPt),
    fingerHoles: fingerHoles.map(fh => {
      const dx = fh.x - cx, dy = fh.y - cy
      return {
        ...fh,
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
        rotation: ((fh.rotation || 0) + angleDeg) % 360,
      }
    }),
    interiorRings: interiorRings.map(ring => ring.map(rotPt)),
  }
}

// scale around the polygon centroid unless a shared geometry centre is supplied.
// cutouts move with the outline but keep their size, which is set in real mm
export function scaleGeometry(
  points: Point[],
  fingerHoles: FingerHole[],
  interiorRings: Point[][],
  factor: number,
  centre?: Point,
): TransformedGeometry {
  if (points.length === 0) return { points, fingerHoles, interiorRings }

  const { x: cx, y: cy } = centre ?? centroidOf(points)
  const scalePt = (p: Point): Point => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  })

  return {
    points: points.map(scalePt),
    fingerHoles: fingerHoles.map(fh => ({ ...fh, ...scalePt(fh) })),
    interiorRings: interiorRings.map(ring => ring.map(scalePt)),
  }
}

// centroid of a point array
export function centroidOf(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  const n = points.length
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  }
}

// axis-aligned extent of a point array
export function sizeOf(points: Point[]): { width: number; height: number } {
  if (points.length === 0) return { width: 0, height: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { width: maxX - minX, height: maxY - minY }
}
