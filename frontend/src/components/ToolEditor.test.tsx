// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ToolEditor } from './ToolEditor'
import type { Point } from '@/types'

const points = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
]

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  })
})

describe('ToolEditor detail after outline edits', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  const original = [
    { x: -40, y: -15 }, { x: 32, y: -15 }, { x: 40, y: 0 },
    { x: 32, y: 15 }, { x: -40, y: 15 },
  ]

  function setup() {
    let current = original
    function Editor() {
      const [outline, setOutline] = useState(original)
      return <ToolEditor points={outline} fingerHoles={[]} smoothed={false} smoothLevel={.5}
        onPointsChange={next => { current = next; setOutline(next) }}
        onFingerHolesChange={() => {}} onSmoothedChange={() => {}} onSmoothLevelChange={() => {}} />
    }
    const result = render(<Editor />)
    const slider = result.container.querySelector('input[type="range"][step="0.01"]')!
    return {
      ...result,
      outline: () => current,
      detail(level: number) {
        fireEvent.change(slider, { target: { value: level } })
        fireEvent.pointerUp(slider)
      },
      shorten() {
        vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
          x: 0, y: 0, left: 0, top: 0, right: 960, bottom: 560,
          width: 960, height: 560, toJSON: () => ({}),
        })
        const vertex = result.container.querySelectorAll('circle.cursor-move')[2]
        fireEvent.mouseDown(vertex, { clientX: 800, clientY: 280 })
        fireEvent.mouseMove(window, { clientX: 736, clientY: 280 })
        fireEvent.mouseUp(window)
      },
    }
  }

  const width = (outline: Point[]) => Math.max(...outline.map(p => p.x)) - Math.min(...outline.map(p => p.x))

  it('keeps a manually shortened outline when changing detail and restoring full detail', () => {
    const editor = setup()
    editor.shorten()
    expect(width(editor.outline())).toBe(72)
    editor.detail(.5)
    expect(width(editor.outline())).toBe(72)
    expect(editor.outline()).toHaveLength(4)
    editor.detail(1)
    expect(width(editor.outline())).toBe(72)
    expect(editor.outline()).toHaveLength(5)
  })

  it.each(['Rotate 90 clockwise', 'Flip horizontally'])('keeps %s when changing detail', action => {
    const editor = setup()
    fireEvent.click(screen.getByRole('button', { name: action }))
    const transformed = editor.outline()
    editor.detail(.5)
    editor.detail(1)
    expect(editor.outline()).toEqual(transformed)
  })

  it('rotates the full-detail base around the same centre as the simplified outline', () => {
    const editor = setup()
    editor.shorten()
    const corrected = editor.outline()
    editor.detail(.5)
    expect(editor.outline()).toHaveLength(4)
    const centre = editor.outline().reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 clockwise' }))
    editor.detail(1)
    expect(editor.outline()).toHaveLength(5)
    editor.outline().forEach((point, index) => {
      expect(point.x).toBeCloseTo(centre.x - (corrected[index].y - centre.y))
      expect(point.y).toBeCloseTo(centre.y + (corrected[index].x - centre.x))
    })
  })

  it('restores the detail base together with the outline through undo and redo', () => {
    const editor = setup()
    editor.shorten()
    const corrected = editor.outline()
    editor.detail(.5)
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }))
    expect(editor.outline()).toEqual(corrected)
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }))
    expect(editor.outline()).toEqual(original)
    fireEvent.click(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }))
    expect(editor.outline()).toEqual(corrected)
    editor.detail(.5)
    expect(width(editor.outline())).toBe(72)
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }))
    expect(editor.outline()).toEqual(corrected)
  })
})

function renderEditor(outputSmoothed = true) {
  const onSmoothedChange = vi.fn()
  const result = render(
    <ToolEditor
      points={points}
      fingerHoles={[]}
      smoothed={outputSmoothed}
      smoothLevel={0.5}
      onPointsChange={() => {}}
      onFingerHolesChange={() => {}}
      onSmoothedChange={onSmoothedChange}
      onSmoothLevelChange={() => {}}
    />
  )
  return { ...result, onSmoothedChange }
}

describe('ToolEditor outline view', () => {
  afterEach(cleanup)

  it('opens in the accurate editable view without changing the smooth output preference', () => {
    const { container, onSmoothedChange } = renderEditor(true)

    expect(screen.getByRole('button', { name: 'Accurate' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Output: Smooth' }).getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('circle.cursor-move')).toHaveLength(points.length)
    expect(onSmoothedChange).not.toHaveBeenCalled()
  })

  it('previews smoothing independently from the saved output preference', () => {
    const { container, onSmoothedChange } = renderEditor(false)

    fireEvent.click(screen.getByRole('button', { name: 'Smooth' }))

    expect(screen.getByRole('button', { name: 'Smooth' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Output: Accurate' }).getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelectorAll('circle.cursor-move')).toHaveLength(0)
    expect(onSmoothedChange).not.toHaveBeenCalled()
  })

  it('changes the saved output preference only through the output control', () => {
    const { onSmoothedChange } = renderEditor(true)

    fireEvent.click(screen.getByRole('button', { name: 'Output: Smooth' }))

    expect(onSmoothedChange).toHaveBeenCalledWith(false)
  })
})
