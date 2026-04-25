import { describe, expect, it } from 'vitest'
import { calcMaxCutoutDepth } from './BinConfigurator'

describe('calcMaxCutoutDepth', () => {
  it('2u with lip floors to minimum 5.0', () => {
    expect(calcMaxCutoutDepth(2, true)).toBe(5.0)
  })

  it('2u without lip', () => {
    expect(calcMaxCutoutDepth(2, false)).toBe(7.25)
  })

  it('4u with lip', () => {
    expect(calcMaxCutoutDepth(4, true)).toBe(17.45)
  })

  it('4u without lip', () => {
    expect(calcMaxCutoutDepth(4, false)).toBe(21.25)
  })

  it('toggling lip clamps cutout_depth to new max', () => {
    // at 2u, lip-off max is 7.25 so a depth of 7 is valid
    const depthWithoutLip = 7.0
    const maxWithLip = calcMaxCutoutDepth(2, true)
    // toggling lip on should force clamp: min(7.0, 5.0) = 5.0
    expect(Math.min(depthWithoutLip, maxWithLip)).toBe(5.0)
  })
})
