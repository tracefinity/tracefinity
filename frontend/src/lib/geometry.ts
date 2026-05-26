import type { Point, FingerHole } from '@/types'

interface RotatedGeometry {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings: Point[][]
}

// rotate points, finger holes, and interior rings around polygon centroid
export function rotateGeometry(
  points: Point[],
  fingerHoles: FingerHole[],
  interiorRings: Point[][],
  angleDeg: number,
): RotatedGeometry {
  const n = points.length
  if (n === 0) return { points, fingerHoles, interiorRings }

  const cx = points.reduce((s, p) => s + p.x, 0) / n
  const cy = points.reduce((s, p) => s + p.y, 0) / n
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

// centroid of a point array
export function centroidOf(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  const n = points.length
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  }
}
