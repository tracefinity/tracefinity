import type { CutoutShape } from '@/types'

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
