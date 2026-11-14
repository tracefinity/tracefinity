import type { AffineMatrix } from '@/types'

// matrix(a, b, c, d, e, f) maps (x, y) -> (a*x + c*y + e, b*x + d*y + f)

export function rotateAround(m: AffineMatrix, angleRad: number, cx: number, cy: number): AffineMatrix {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const [a, b, c, d, e, f] = m
  return [
    cos * a - sin * b,
    sin * a + cos * b,
    cos * c - sin * d,
    sin * c + cos * d,
    cos * e - sin * f + cx * (1 - cos) + sin * cy,
    sin * e + cos * f - sin * cx + cy * (1 - cos),
  ]
}

export function flipAround(m: AffineMatrix, axis: 'horizontal' | 'vertical', cx: number, cy: number): AffineMatrix {
  const [a, b, c, d, e, f] = m
  if (axis === 'horizontal') {
    return [-a, b, -c, d, -e + 2 * cx, f]
  }
  return [a, -b, c, -d, e, -f + 2 * cy]
}

export function scaleAround(m: AffineMatrix, factor: number, cx: number, cy: number): AffineMatrix {
  const [a, b, c, d, e, f] = m
  return [
    factor * a,
    factor * b,
    factor * c,
    factor * d,
    factor * e + cx * (1 - factor),
    factor * f + cy * (1 - factor),
  ]
}
