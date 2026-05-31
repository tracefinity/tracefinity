import type { CutoutShape } from '@/types'

export function isRectangularCutout(shape?: CutoutShape): boolean {
  return shape === 'rectangle' || shape === 'filleted_rectangle'
}

export function isFilletedRectangleCutout(shape?: CutoutShape): boolean {
  return shape === 'filleted_rectangle'
}

export function cutoutShapeLabel(shape?: CutoutShape): string {
  switch (shape) {
    case 'cylinder':
      return 'cylinder'
    case 'square':
      return 'square'
    case 'rectangle':
      return 'rectangle'
    case 'filleted_rectangle':
      return 'filleted rectangle'
    case 'circle':
    default:
      return 'circle'
  }
}
