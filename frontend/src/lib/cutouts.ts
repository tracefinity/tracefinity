import type { CutoutShape } from '@/types'

// floor for cutout dimensions in mm; keeps geometry non-degenerate and
// shapes grabbable in the editor while allowing narrow slots (issue #114)
export const MIN_CUTOUT_SIZE_MM = 1

const CUTOUT_SHAPE_LABELS: Record<CutoutShape, string> = {
  circle: 'circle',
  cylinder: 'cylinder',
  square: 'square',
  rectangle: 'rectangle',
  filleted_rectangle: 'filleted rectangle',
}

export function isRectangularCutout(shape?: CutoutShape): boolean {
  return shape === 'rectangle' || shape === 'filleted_rectangle'
}

export function isFilletedRectangleCutout(shape?: CutoutShape): boolean {
  return shape === 'filleted_rectangle'
}

export function filletedRectangleRadius(width: number, cutoutDepth: number): number {
  return Math.max(0, Math.min(width / 3, cutoutDepth / 2))
}

export function cutoutShapeLabel(shape?: CutoutShape): string {
  return shape ? CUTOUT_SHAPE_LABELS[shape] : CUTOUT_SHAPE_LABELS.circle
}

// pinned-corner resize: dragged corner follows the mouse, dims measured in
// the rectangle's local (rotated) space and floored at MIN_CUTOUT_SIZE_MM.
// centre is always the anchor-mouse midpoint, so when the floor clamps the
// anchored corner drifts slightly rather than staying fixed
export function resizeRectCutout(
  anchorX: number,
  anchorY: number,
  mouseX: number,
  mouseY: number,
  rotationDeg: number,
): { x: number; y: number; width: number; height: number } {
  const rot = rotationDeg * Math.PI / 180
  const cosR = Math.cos(rot)
  const sinR = Math.sin(rot)
  const gdx = mouseX - anchorX
  const gdy = mouseY - anchorY
  const localW = gdx * cosR + gdy * sinR
  const localH = -gdx * sinR + gdy * cosR
  return {
    x: (anchorX + mouseX) / 2,
    y: (anchorY + mouseY) / 2,
    width: Math.max(MIN_CUTOUT_SIZE_MM, Math.abs(localW)),
    height: Math.max(MIN_CUTOUT_SIZE_MM, Math.abs(localH)),
  }
}

// circle/square resize: radius is the centre-to-mouse distance, floored at
// half MIN_CUTOUT_SIZE_MM (1mm diameter / side)
export function resizeRoundCutout(
  centerX: number,
  centerY: number,
  mouseX: number,
  mouseY: number,
): number {
  const dx = mouseX - centerX
  const dy = mouseY - centerY
  return Math.max(MIN_CUTOUT_SIZE_MM / 2, Math.sqrt(dx * dx + dy * dy))
}
