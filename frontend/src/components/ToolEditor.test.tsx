// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { ToolEditor } from './ToolEditor'
import type { AffineMatrix, FingerHole, Point } from '@/types'

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

describe('ToolEditor outline size', () => {
  afterEach(cleanup)

  // 80 x 30.5 mm. the shallow top vertex is the first thing Detail drops, and
  // it pulls the vertex mean to (1.6, -3.1), off the bounding-box centre
  const original = [
    { x: -40, y: -15 }, { x: 8, y: -15.5 }, { x: 40, y: -15 },
    { x: 40, y: 15 }, { x: -40, y: 15 },
  ]
  const centre = { x: 1.6, y: -3.1 }
  const ring = [{ x: -10, y: -5 }, { x: 10, y: -5 }, { x: 10, y: 5 }, { x: -10, y: 5 }]
  // overhangs the right edge by 4.1 mm
  const hole: FingerHole = { id: 'fh', x: 36.6, y: 6.9, radius: 7.5, rotation: 30, shape: 'square', depth_override: 12 }
  // image px -> mm, rotated so every matrix term takes part
  const transform: AffineMatrix = [0.08, 0.06, -0.06, 0.08, -35, 12]

  const span = (outline: Point[], axis: 'x' | 'y') =>
    Math.max(...outline.map(p => p[axis])) - Math.min(...outline.map(p => p[axis]))
  const about = (p: Point, c: Point, factor: number): Point =>
    ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor })
  const expectOutline = (actual: Point[], expected: Point[]) => {
    expect(actual).toHaveLength(expected.length)
    actual.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x, 9)
      expect(p.y).toBeCloseTo(expected[i].y, 9)
    })
  }

  function setup(points: Point[] = original) {
    const latest = { points, holes: [hole], rings: [ring], transform }
    const onPointsChange = vi.fn()
    const onImageTransformChange = vi.fn()
    function Editor() {
      const [tool, setTool] = useState({ ...latest })
      const update = (patch: Partial<typeof latest>) => {
        Object.assign(latest, patch)
        setTool(prev => ({ ...prev, ...patch }))
      }
      const context = useMemo(() => ({
        image_url: '/photo.jpg', image_width: 1000, image_height: 600,
        origin_x_mm: 0, origin_y_mm: 0, scale_factor: 0.1, transform: tool.transform,
      }), [tool.transform])
      return <ToolEditor points={tool.points} fingerHoles={tool.holes} interiorRings={tool.rings}
        smoothed={false} smoothLevel={.5} sourceImageContext={context}
        onImageTransformChange={next => { onImageTransformChange(next); update({ transform: next }) }}
        onPointsChange={next => { onPointsChange(next); update({ points: next }) }}
        onFingerHolesChange={next => update({ holes: next })}
        onInteriorRingsChange={next => update({ rings: next })}
        onSmoothedChange={() => {}} onSmoothLevelChange={() => {}} />
    }
    const result = render(<Editor />)
    const slider = result.container.querySelector('input[type="range"][step="0.01"]') as HTMLInputElement
    const field = (name: 'width' | 'height' | 'scale') =>
      screen.getByTitle(new RegExp(`^Outline ${name} `)) as HTMLInputElement
    const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement
    return {
      latest, slider, field, onPointsChange, onImageTransformChange,
      undo: () => button('Undo (Ctrl+Z)'),
      redo: () => button('Redo (Ctrl+Shift+Z)'),
      // Enter commits the field and blurs it
      type(name: 'width' | 'height' | 'scale', value: string) {
        const input = field(name)
        input.focus()
        fireEvent.change(input, { target: { value } })
        fireEvent.keyDown(input, { key: 'Enter' })
      },
      detail(level: number) {
        fireEvent.change(slider, { target: { value: level } })
        fireEvent.pointerUp(slider)
      },
    }
  }

  it('shows the outline bounding box, without cutouts, in the current orientation', () => {
    const editor = setup()
    expect(editor.field('width').value).toBe('80')
    expect(editor.field('height').value).toBe('30.5')
    expect(editor.field('scale').value).toBe('100')
    expect(screen.getByText(/84\.1×30\.5 mm$/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rotate 90 clockwise' }))
    expect(editor.field('width').value).toBe('30.5')
    expect(editor.field('height').value).toBe('80')
  })

  it('scales the outline to a typed width and keeps its proportions', () => {
    const editor = setup()
    editor.type('width', '60')
    expectOutline(editor.latest.points, original.map(p => about(p, centre, 0.75)))
    expect(span(editor.latest.points, 'x')).toBeCloseTo(60, 9)
    expect(span(editor.latest.points, 'y')).toBeCloseTo(22.875, 9)
    expectOutline(editor.latest.rings[0], ring.map(p => about(p, centre, 0.75)))
    expect(editor.field('width').value).toBe('60')
    expect(editor.field('height').value).toBe('22.9')
  })

  it('reaches the typed width exactly when the reading shown was rounded', () => {
    // 80.04 mm wide reads as 80
    const editor = setup(original.map(p => ({ ...p, x: p.x * 1.0005 })))
    editor.type('width', '60')
    expect(span(editor.latest.points, 'x')).toBeCloseTo(60, 9)
  })

  it('scales the outline to a typed height', () => {
    const editor = setup()
    editor.type('height', '61')
    expectOutline(editor.latest.points, original.map(p => about(p, centre, 2)))
    expect(editor.field('width').value).toBe('160')
  })

  it('applies a percentage once and returns the field to 100', () => {
    const editor = setup()
    editor.type('scale', '110')
    expect(span(editor.latest.points, 'x')).toBeCloseTo(88, 9)
    expect(span(editor.latest.points, 'y')).toBeCloseTo(33.55, 9)
    expect(editor.field('scale').value).toBe('100')

    editor.type('scale', '50')
    expect(span(editor.latest.points, 'x')).toBeCloseTo(44, 9)
    expect(editor.field('scale').value).toBe('100')

    // one history entry per percentage
    fireEvent.click(editor.undo())
    expect(span(editor.latest.points, 'x')).toBeCloseTo(88, 9)
    fireEvent.click(editor.undo())
    expect(editor.latest.points).toEqual(original)
    expect(editor.undo().disabled).toBe(true)
  })

  it('discards typed text when the field loses focus without Enter', () => {
    // a drag reads the outline on mousedown, before the blur it causes: a
    // scale applied on that blur would be overwritten by the drag
    const editor = setup()
    const height = editor.field('height')
    height.focus()
    fireEvent.change(height, { target: { value: '61' } })
    act(() => editor.field('scale').focus())
    expect(editor.onPointsChange).not.toHaveBeenCalled()
    expect(editor.field('height').value).toBe('30.5')
    expect(editor.undo().disabled).toBe(true)
  })

  it('discards typed text on Escape', () => {
    const editor = setup()
    for (const name of ['width', 'height', 'scale'] as const) {
      const input = editor.field(name)
      input.focus()
      fireEvent.change(input, { target: { value: '55' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    }
    expect(editor.onPointsChange).not.toHaveBeenCalled()
    expect(editor.field('width').value).toBe('80')
    expect(editor.field('scale').value).toBe('100')
    expect(editor.undo().disabled).toBe(true)
  })

  it('stops a repeated percentage at the largest size the fields accept', () => {
    const editor = setup()
    editor.type('scale', '500')
    editor.type('scale', '500')
    expect(span(editor.latest.points, 'x')).toBeCloseTo(2000, 6)
    editor.onPointsChange.mockClear()
    editor.type('scale', '500')
    expect(editor.onPointsChange).not.toHaveBeenCalled()
    expect(span(editor.latest.points, 'x')).toBeCloseTo(2000, 6)
  })

  it('keeps the new size when Detail moves afterwards', () => {
    const editor = setup()
    editor.type('width', '60')
    const scaled = editor.latest.points
    editor.detail(.5)
    expect(editor.latest.points).toHaveLength(4)
    expect(span(editor.latest.points, 'x')).toBeCloseTo(60, 9)
    editor.detail(1)
    expect(editor.latest.points).toEqual(scaled)
  })

  it('scales the full-detail base about the simplified outline centre and keeps the Detail level', () => {
    const editor = setup()
    editor.detail(.5)
    expect(editor.latest.points).toHaveLength(4)
    // the four remaining corners average to the origin
    editor.type('width', '60')
    expect(editor.latest.points).toHaveLength(4)
    expect(editor.slider.value).toBe('0.5')
    editor.detail(1)
    expectOutline(editor.latest.points, original.map(p => about(p, { x: 0, y: 0 }, 0.75)))
  })

  it('undoes and redoes a scale as one step', () => {
    const editor = setup()
    editor.type('width', '60')
    const scaled = { ...editor.latest }
    expect(editor.onPointsChange).toHaveBeenCalledTimes(1)

    fireEvent.click(editor.undo())
    expect(editor.latest).toEqual({ points: original, holes: [hole], rings: [ring], transform })
    expect(editor.undo().disabled).toBe(true)
    expect(editor.field('width').value).toBe('80')

    fireEvent.click(editor.redo())
    expect(editor.latest).toEqual(scaled)
    expect(editor.redo().disabled).toBe(true)
    expect(editor.field('width').value).toBe('60')
  })

  it('scales the photo transform about the same centre', () => {
    const editor = setup()
    editor.type('width', '60')
    expect(editor.onImageTransformChange).toHaveBeenCalledTimes(1)
    const apply = ([a, b, c, d, e, f]: AffineMatrix, x: number, y: number): Point =>
      ({ x: a * x + c * y + e, y: b * x + d * y + f })
    const [scaled] = editor.onImageTransformChange.mock.calls[0] as [AffineMatrix]
    for (const [x, y] of [[0, 0], [1000, 0], [420, 600]]) {
      const expected = about(apply(transform, x, y), centre, 0.75)
      const actual = apply(scaled, x, y)
      expect(actual.x).toBeCloseTo(expected.x, 9)
      expect(actual.y).toBeCloseTo(expected.y, 9)
    }
  })

  it('moves a cutout with the outline without resizing it', () => {
    const editor = setup()
    editor.type('width', '60')
    const [scaled] = editor.latest.holes
    // 35 mm right of and 10 mm below the centre before the scale
    expect(scaled.x).toBeCloseTo(centre.x + 26.25, 9)
    expect(scaled.y).toBeCloseTo(centre.y + 7.5, 9)
    expect(scaled).toEqual({ ...hole, x: scaled.x, y: scaled.y })
  })

  it('leaves the outline alone when a field is left unchanged', () => {
    // 80.04 mm wide reads as 80: committing that reading must not rescale to it
    const editor = setup(original.map(p => ({ ...p, x: p.x * 1.0005 })))
    for (const name of ['width', 'height', 'scale'] as const) {
      editor.field(name).focus()
      fireEvent.keyDown(editor.field(name), { key: 'Enter' })
    }
    expect(editor.field('width').value).toBe('80')
    expect(editor.onPointsChange).not.toHaveBeenCalled()
    expect(editor.undo().disabled).toBe(true)
  })

  it('does not clamp a reading that is already outside the typed range', () => {
    const editor = setup([{ x: -40, y: -0.3 }, { x: 40, y: -0.3 }, { x: 40, y: 0.3 }, { x: -40, y: 0.3 }])
    expect(editor.field('height').value).toBe('0.6')
    editor.field('height').focus()
    fireEvent.keyDown(editor.field('height'), { key: 'Enter' })
    expect(editor.field('height').value).toBe('0.6')
    expect(editor.onPointsChange).not.toHaveBeenCalled()
  })

  it('clamps typed sizes', () => {
    const editor = setup()
    editor.type('width', '5000')
    expect(span(editor.latest.points, 'x')).toBeCloseTo(2000, 6)
    editor.type('scale', '1')
    expect(span(editor.latest.points, 'x')).toBeCloseTo(200, 6)
    editor.type('height', '0.2')
    expect(span(editor.latest.points, 'y')).toBeCloseTo(1, 9)
  })
})
