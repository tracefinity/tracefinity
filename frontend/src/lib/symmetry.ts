import type { Point, FingerHole } from '@/types'

// Symmetry helpers for the tool editor.
//
// A traced outline is never perfectly symmetric, so symmetry must first be
// *established* (symmetrize: mirror one half onto the other) before it can be
// *maintained* during live editing. `symmetrize` produces a polygon in a fixed
// canonical order so that the mirror partner of any vertex is a pure index
// function (`partnerIndex`):
//
//   [ A, k_1, k_2, ..., k_m, B, r_m, ..., r_1 ]
//
// where A and B are the two seam points lying on the axis, k_i are the kept-side
// vertices and r_i = reflect(k_i). With n = 2m + 2 total points, partner(i) =
// (n - i) % n, an involution whose only fixed points are the seams at 0 and n/2.

export type AxisOrientation = 'vertical' | 'horizontal'
export type KeepSide = 'low' | 'high' // low = left/top, high = right/bottom

export interface SymmetryAxis {
  orientation: AxisOrientation
  pos: number // x for vertical, y for horizontal (mm)
}

export interface SymmetrizeResult {
  points: Point[]
  fingerHoles: FingerHole[]
}

const SEAM_EPS = 1e-4 // a point this close to the axis is treated as on it
const HOLE_AXIS_TOL = 0.5 // mm; a hole centre this close to the axis is centred on it

// signed distance from the axis: negative = low side, positive = high side
function sideValue(p: Point, axis: SymmetryAxis): number {
  return axis.orientation === 'vertical' ? p.x - axis.pos : p.y - axis.pos
}

export function reflectPoint(p: Point, axis: SymmetryAxis): Point {
  return axis.orientation === 'vertical'
    ? { x: 2 * axis.pos - p.x, y: p.y }
    : { x: p.x, y: 2 * axis.pos - p.y }
}

// pin the on-axis coordinate exactly to the axis, leaving the free axis untouched
export function constrainToAxis(p: Point, axis: SymmetryAxis): Point {
  return axis.orientation === 'vertical' ? { x: axis.pos, y: p.y } : { x: p.x, y: axis.pos }
}

// mirror partner of vertex i in a canonical symmetric polygon of n points
export function partnerIndex(i: number, n: number): number {
  return (n - i) % n
}

// reflect a finger hole across the axis (centre + orientation)
export function reflectHole(fh: FingerHole, axis: SymmetryAxis, id: string): FingerHole {
  const c = reflectPoint({ x: fh.x, y: fh.y }, axis)
  const rot = fh.rotation ?? 0
  // reflection negates the orientation angle (matches the editor's flip convention)
  const newRot = ((-rot % 360) + 360) % 360
  return { ...fh, id, x: c.x, y: c.y, rotation: newRot }
}

function signedArea(pts: Point[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

// Sutherland–Hodgman clip of a polygon to the kept half-plane.
function clipHalfPlane(poly: Point[], axis: SymmetryAxis, keep: KeepSide): Point[] {
  const inside = (p: Point) =>
    keep === 'low' ? sideValue(p, axis) <= SEAM_EPS : sideValue(p, axis) >= -SEAM_EPS
  const intersect = (a: Point, b: Point): Point => {
    const sa = sideValue(a, axis)
    const sb = sideValue(b, axis)
    const t = sa / (sa - sb)
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
  }
  const out: Point[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return out
}

/**
 * From a half-plane-clipped polygon, return the longest arc of off-axis vertices
 * bounded by two seam (on-axis) points. This is the real body outline; the small
 * arcs are tracing noise where a jagged edge re-crosses the axis. Endpoints are
 * the two seam points (included). Returns null if there is no such arc.
 */
function longestArc(clipped: Point[], axis: SymmetryAxis): Point[] | null {
  const n = clipped.length
  const isSeam = (p: Point) => Math.abs(sideValue(p, axis)) < SEAM_EPS * 10
  const seam = clipped.map(isSeam)
  const start = seam.indexOf(true)
  if (start < 0) return null // axis doesn't intersect the kept outline

  let best: Point[] | null = null
  let bestLen = -1
  let i = start
  do {
    if (seam[i]) {
      // collect the off-axis run that starts after seam i, up to the next seam
      const arc: Point[] = [clipped[i]]
      let j = (i + 1) % n
      while (!seam[j] && j !== i) { arc.push(clipped[j]); j = (j + 1) % n }
      arc.push(clipped[j])
      if (arc.length > 2) {
        let len = 0
        for (let k = 1; k < arc.length; k++) {
          len += Math.hypot(arc[k].x - arc[k - 1].x, arc[k].y - arc[k - 1].y)
        }
        if (len > bestLen) { bestLen = len; best = arc }
      }
    }
    i = (i + 1) % n
  } while (i !== start)

  return best
}

// build the canonical [A, mids, B, reflect(mids) reversed] loop from a kept arc
function buildSymmetric(keptArc: Point[], axis: SymmetryAxis): Point[] {
  const A = constrainToAxis(keptArc[0], axis)
  const B = constrainToAxis(keptArc[keptArc.length - 1], axis)
  const mids = keptArc.slice(1, -1)
  const reflectedRev = mids.map(p => reflectPoint(p, axis)).reverse()
  return [A, ...mids, B, ...reflectedRev]
}

/**
 * Mirror one half of the polygon onto the other, producing a perfectly
 * symmetric outline in canonical order (see module header). Finger holes on the
 * kept side are mirrored; holes on the axis are centred; holes on the discarded
 * side are dropped.
 *
 * Robust to noisy traced outlines: a jagged outline crosses the axis many times
 * near the top/bottom, so rather than requiring exactly two crossings we take the
 * single longest off-axis arc (the real body) and discard the small wiggles near
 * the seam. Returns null only when the axis doesn't actually pass through the
 * outline.
 */
export function symmetrize(
  points: Point[],
  fingerHoles: FingerHole[],
  axis: SymmetryAxis,
  keep: KeepSide,
  newId: (seed: string) => string,
): SymmetrizeResult | null {
  if (points.length < 3) return null
  const clipped = clipHalfPlane(points, axis, keep)
  if (clipped.length < 3) return null

  let keptArc = longestArc(clipped, axis)
  if (!keptArc) return null

  let full = buildSymmetric(keptArc, axis)
  // preserve the original winding so downstream geometry stays valid
  if (Math.sign(signedArea(full)) !== Math.sign(signedArea(points))) {
    keptArc = [...keptArc].reverse()
    full = buildSymmetric(keptArc, axis)
  }

  const holes = symmetrizeHoles(fingerHoles, axis, keep, newId)
  return { points: full, fingerHoles: holes }
}

function symmetrizeHoles(
  holes: FingerHole[],
  axis: SymmetryAxis,
  keep: KeepSide,
  newId: (seed: string) => string,
): FingerHole[] {
  const result: FingerHole[] = []
  for (const fh of holes) {
    const s = sideValue({ x: fh.x, y: fh.y }, axis)
    if (Math.abs(s) < HOLE_AXIS_TOL) {
      result.push({ ...fh, ...constrainToAxis({ x: fh.x, y: fh.y }, axis) })
    } else if (keep === 'low' ? s < 0 : s > 0) {
      result.push(fh)
      result.push(reflectHole(fh, axis, newId(fh.id)))
    }
    // holes on the discarded side are dropped (regenerated as mirrors of the kept side)
  }
  return result
}

/**
 * Insert a vertex on a clicked edge and its mirror on the partner edge, keeping
 * the canonical symmetric order intact. Walks the array once, emitting each
 * inserted point after its edge's start vertex (handles the wrap edge cleanly).
 */
export function insertMirroredVertex(
  points: Point[],
  edgeIdx: number,
  v: Point,
  axis: SymmetryAxis,
): Point[] {
  const n = points.length
  const next = (edgeIdx + 1) % n
  const vm = reflectPoint(v, axis)
  const pA = partnerIndex(edgeIdx, n)
  const pB = partnerIndex(next, n)

  // array-order start vertex of an adjacent pair (wrap edge starts at n-1)
  const edgeStart = (a: number, b: number) =>
    (a === n - 1 && b === 0) || (b === n - 1 && a === 0) ? n - 1 : Math.min(a, b)

  const clickedStart = edgeIdx
  const mirrorStart = edgeStart(pA, pB)

  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    out.push(points[i])
    if (i === clickedStart) out.push(v)
    if (i === mirrorStart && mirrorStart !== clickedStart) out.push(vm)
  }
  return out
}

/** Remove a vertex and its mirror partner. Returns null if it can't (seam, or too few points). */
export function deleteMirroredVertex(points: Point[], i: number): Point[] | null {
  const n = points.length
  const j = partnerIndex(i, n)
  if (j === i) return null // seam point — removing it would break the structure
  if (n - 2 < 4) return null
  const [hi, lo] = [i, j].sort((a, b) => b - a)
  const out = [...points]
  out.splice(hi, 1)
  out.splice(lo, 1)
  return out
}

/** Find the mirror partner of a hole by reflected-centre match, if any. */
export function findHolePartner(
  fh: FingerHole,
  holes: FingerHole[],
  axis: SymmetryAxis,
): FingerHole | undefined {
  const t = reflectPoint({ x: fh.x, y: fh.y }, axis)
  return holes.find(h => h.id !== fh.id && Math.hypot(h.x - t.x, h.y - t.y) < HOLE_AXIS_TOL)
}

/** True when a hole sits on the axis (no distinct mirror twin). */
export function isHoleOnAxis(fh: FingerHole, axis: SymmetryAxis): boolean {
  return Math.abs(sideValue({ x: fh.x, y: fh.y }, axis)) < HOLE_AXIS_TOL
}
