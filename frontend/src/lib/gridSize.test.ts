import { describe, it, expect } from 'vitest'
import {
  binFitMargin,
  getGridSizeError,
  gridCellCount,
  MAX_GRID_CELLS,
  MAX_GRID_UNITS,
  MIN_GRID_UNITS,
  maxGridUnitsForOtherAxis,
  requiredGridUnits,
} from './constants'

describe('grid size limits', () => {
  it('matches the backend resource bounds', () => {
    expect(MIN_GRID_UNITS).toBe(1)
    expect(MAX_GRID_UNITS).toBe(25)
    expect(MAX_GRID_CELLS).toBe(100)
  })

  it('accepts long, narrow bins at the existing resource ceiling', () => {
    expect(getGridSizeError(20, 5)).toBeNull()
    expect(getGridSizeError(25, 4)).toBeNull()
    expect(getGridSizeError(10.5, 9)).toBeNull()
  })

  it('rejects a dimension above the sanity ceiling', () => {
    expect(getGridSizeError(25.5, 2)).toContain('25 units per axis')
  })

  it('rejects footprints above 100 cells instead of silently shrinking them', () => {
    expect(getGridSizeError(10.5, 10)).toContain('100 cells')
    expect(getGridSizeError(20, 5.5)).toContain('100 cells')
    expect(getGridSizeError(25, 4.5)).toContain('100 cells')
  })

  it('reports the actual auto-sized requirement instead of clamping to ten', () => {
    const defaultMargin = binFitMargin({ wall_thickness: 1.6, cutout_clearance: 1, stacking_lip: true })
    expect(requiredGridUnits(412, defaultMargin, false)).toBe(10)
    expect(requiredGridUnits(413, defaultMargin, false)).toBe(11)
    expect(requiredGridUnits(413, defaultMargin, true)).toBe(10.5)
  })

  it.each([
    [true, false, 1.6, 3],
    [false, false, 1.6, 2],
    [true, true, 1.6, 2.5],
    [true, false, 3, 3],
  ])('reserves lip/wall space for an 80 mm tool (lip=%s, half-grid=%s, wall=%s)', (stacking_lip, halfGrid, wall_thickness, expected) => {
    const margin = binFitMargin({ stacking_lip, wall_thickness, cutout_clearance: .1 })
    expect(requiredGridUnits(80, margin, halfGrid)).toBe(expected)
  })

  it('counts fractional dimensions by the cells they occupy', () => {
    expect(gridCellCount(10.5, 9)).toBe(99)
    expect(gridCellCount(10.5, 10)).toBe(110)
  })

  it('rejects invalid lower bounds and increments', () => {
    expect(getGridSizeError(0.5, 2)).toContain('at least 1 unit')
    expect(getGridSizeError(2.25, 2)).toContain('0.5-unit increments')
  })

  it('constrains manual controls using the other dimension', () => {
    expect(maxGridUnitsForOtherAxis(4)).toBe(25)
    expect(maxGridUnitsForOtherAxis(5)).toBe(20)
    expect(maxGridUnitsForOtherAxis(9)).toBe(11)
    expect(maxGridUnitsForOtherAxis(10.5)).toBe(9)
  })
})
