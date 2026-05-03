'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Plus, Circle, Square, RectangleHorizontal, Fingerprint, ImageIcon, Eye, EyeOff } from 'lucide-react'
import type { Point, FingerHole, ToolImageContext, AffineMatrix } from '@/types'
import { simplifyPolygon, smoothEpsilon, snapToGrid as snapToGridUtil } from '@/lib/svg'
import { rotateAround, flipAround } from '@/lib/affine'
import { DISPLAY_SCALE, SNAP_GRID, ZOOM_FACTOR } from '@/lib/constants'
import { useHistory } from '@/hooks/useHistory'
import { ToolEditorToolbar } from '@/components/ToolEditorToolbar'
import { ToolEditorCanvas } from '@/components/ToolEditorCanvas'
import type { EditMode, Selection } from '@/components/ToolEditorToolbar'

interface Props {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings?: Point[][]
  smoothed: boolean
  smoothLevel: number
  sourceImageContext?: ToolImageContext | null
  showSourceImage?: boolean
  onShowSourceImageChange?: (show: boolean) => void
  sourceImageOpacity?: number
  onSourceImageOpacityChange?: (opacity: number) => void
  onImageTransformChange?: (transform: AffineMatrix) => void
  onPointsChange: (points: Point[]) => void
  onFingerHolesChange: (holes: FingerHole[]) => void
  onSmoothedChange: (smoothed: boolean) => void
  onSmoothLevelChange: (level: number) => void
  onInteriorRingsChange?: (rings: Point[][]) => void
}

const PADDING_MM = 20

type DragState =
  | { type: 'vertex'; pointIdx: number }
  | { type: 'hole'; holeId: string; startX: number; startY: number; origX: number; origY: number }
  | { type: 'resize'; holeId: string; startX: number; startY: number; origRadius: number; origWidth?: number; origHeight?: number; centerX: number; centerY: number; anchorX?: number; anchorY?: number; rotation?: number }
  | { type: 'rotate-hole'; holeId: string; centerX: number; centerY: number; startAngle: number; origRotation: number }
  | { type: 'rotate-polygon'; centerX: number; centerY: number; startAngle: number; origPoints: Point[]; origHoles: FingerHole[] }
  | { type: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number; svgScale: number }
  | null

interface HistoryEntry {
  points: Point[]
  fingerHoles: FingerHole[]
  interiorRings: Point[][]
}

export function ToolEditor({ points, fingerHoles, interiorRings, smoothed, smoothLevel, sourceImageContext, showSourceImage = false, onShowSourceImageChange, sourceImageOpacity = 0.45, onSourceImageOpacityChange, onImageTransformChange, onPointsChange, onFingerHolesChange, onSmoothedChange, onSmoothLevelChange, onInteriorRingsChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [editMode, setEditMode] = useState<EditMode>('select')
  const [dragging, setDragging] = useState<DragState>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [cutoutOpen, setCutoutOpen] = useState(false)
  const spaceHeld = useRef(false)
  const didPanRef = useRef(false)

  // undo/redo
  const historyOnChange = useCallback((entry: HistoryEntry) => {
    onPointsChange(entry.points)
    onFingerHolesChange(entry.fingerHoles)
    onInteriorRingsChange?.(entry.interiorRings)
  }, [onPointsChange, onFingerHolesChange, onInteriorRingsChange])

  const currentRings = interiorRings ?? []

  const { set: pushHistory, undo: handleUndo, redo: handleRedo, canUndo, canRedo } = useHistory<HistoryEntry>(
    { points, fingerHoles, interiorRings: currentRings },
    historyOnChange
  )

  // local drag state: renders locally during drag, flushes to parent on mouseup
  const [dragPoints, setDragPoints] = useState<Point[] | null>(null)
  const [dragHoles, setDragHoles] = useState<FingerHole[] | null>(null)
  const rawDisplayPoints = dragPoints ?? points
  const displayHoles = dragHoles ?? fingerHoles
  const smoothedPoints = useMemo(() => {
    if (!smoothed || rawDisplayPoints.length <= 3) return null
    return simplifyPolygon(rawDisplayPoints, smoothEpsilon(rawDisplayPoints, smoothLevel))
  }, [smoothed, smoothLevel, rawDisplayPoints])
  const displayPoints = smoothed && smoothedPoints ? smoothedPoints : rawDisplayPoints

  // refs for stale closure avoidance
  const pointsRef = useRef(points)
  const holesRef = useRef(fingerHoles)
  const dragPointsRef = useRef(dragPoints)
  const dragHolesRef = useRef(dragHoles)
  const onPointsRef = useRef(onPointsChange)
  const onHolesRef = useRef(onFingerHolesChange)
  const imageTransformRef = useRef<AffineMatrix | null>(sourceImageContext?.transform ?? null)
  const onImageTransformRef = useRef(onImageTransformChange)
  useEffect(() => { pointsRef.current = points }, [points])
  useEffect(() => { holesRef.current = fingerHoles }, [fingerHoles])
  useEffect(() => { dragPointsRef.current = dragPoints }, [dragPoints])
  useEffect(() => { dragHolesRef.current = dragHoles }, [dragHoles])
  useEffect(() => { onPointsRef.current = onPointsChange }, [onPointsChange])
  useEffect(() => { onHolesRef.current = onFingerHolesChange }, [onFingerHolesChange])
  useEffect(() => { imageTransformRef.current = sourceImageContext?.transform ?? null }, [sourceImageContext?.transform])
  useEffect(() => { onImageTransformRef.current = onImageTransformChange }, [onImageTransformChange])
  const rotateDragRef = useRef<{ delta: number; cx: number; cy: number } | null>(null)
  const currentRingsRef = useRef(currentRings)
  useEffect(() => { currentRingsRef.current = currentRings }, [currentRings])
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // compute viewBox from props (not drag state) so the coordinate frame stays stable during drag
  const bounds = (() => {
    if (points.length === 0) return { minX: -50, minY: -50, maxX: 50, maxY: 50 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    for (const fh of fingerHoles) {
      const r = fh.shape === 'rectangle' ? Math.max(fh.width || 0, fh.height || 0) / 2 : fh.radius
      minX = Math.min(minX, fh.x - r)
      minY = Math.min(minY, fh.y - r)
      maxX = Math.max(maxX, fh.x + r)
      maxY = Math.max(maxY, fh.y + r)
    }
    return { minX, minY, maxX, maxY }
  })()

  const vbX = (bounds.minX - PADDING_MM) * DISPLAY_SCALE
  const vbY = (bounds.minY - PADDING_MM) * DISPLAY_SCALE
  const vbW = (bounds.maxX - bounds.minX + PADDING_MM * 2) * DISPLAY_SCALE
  const vbH = (bounds.maxY - bounds.minY + PADDING_MM * 2) * DISPLAY_SCALE

  // zoomed viewBox
  const zvbW = vbW / zoom
  const zvbH = vbH / zoom
  const zvbX = vbX + (vbW - zvbW) / 2 + pan.x
  const zvbY = vbY + (vbH - zvbH) / 2 + pan.y

  // grid lines (10mm spacing, centered on origin)
  const gridStep = 10
  const visMinX = zvbX / DISPLAY_SCALE
  const visMaxX = (zvbX + zvbW) / DISPLAY_SCALE
  const visMinY = zvbY / DISPLAY_SCALE
  const visMaxY = (zvbY + zvbH) / DISPLAY_SCALE
  const gridMinX = Math.floor(visMinX / gridStep) * gridStep
  const gridMaxX = Math.ceil(visMaxX / gridStep) * gridStep
  const gridMinY = Math.floor(visMinY / gridStep) * gridStep
  const gridMaxY = Math.ceil(visMaxY / gridStep) * gridStep

  const screenToMm = useCallback((clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = zvbW / rect.width
    const scaleY = zvbH / rect.height
    const scale = Math.max(scaleX, scaleY)
    const offsetX = (rect.width * scale - zvbW) / 2
    const offsetY = (rect.height * scale - zvbH) / 2
    const svgX = (clientX - rect.left) * scale - offsetX + zvbX
    const svgY = (clientY - rect.top) * scale - offsetY + zvbY
    return { x: svgX / DISPLAY_SCALE, y: svgY / DISPLAY_SCALE }
  }, [zvbW, zvbH, zvbX, zvbY])

  const screenToMmRef = useRef(screenToMm)
  useEffect(() => { screenToMmRef.current = screenToMm }, [screenToMm])

  // scroll-to-zoom (needs passive: false for preventDefault)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const oldZoom = zoomRef.current
      const newZoom = Math.min(20, Math.max(0.5, oldZoom * factor))
      if (newZoom === oldZoom) return

      const rect = svg.getBoundingClientRect()
      const curPan = panRef.current

      const curW = vbW / oldZoom
      const curH = vbH / oldZoom
      const curX = vbX + (vbW - curW) / 2 + curPan.x
      const curY = vbY + (vbH - curH) / 2 + curPan.y

      const svgScale = Math.min(rect.width / curW, rect.height / curH)
      const padLeft = (rect.width - curW * svgScale) / 2
      const padTop = (rect.height - curH * svgScale) / 2
      const cursorX = curX + (e.clientX - rect.left - padLeft) / svgScale
      const cursorY = curY + (e.clientY - rect.top - padTop) / svgScale

      const newW = vbW / newZoom
      const newH = vbH / newZoom
      const newX = vbX + (vbW - newW) / 2 + curPan.x
      const newY = vbY + (vbH - newH) / 2 + curPan.y

      const newSvgScale = Math.min(rect.width / newW, rect.height / newH)
      const newPadLeft = (rect.width - newW * newSvgScale) / 2
      const newPadTop = (rect.height - newH * newSvgScale) / 2
      const newCursorX = newX + (e.clientX - rect.left - newPadLeft) / newSvgScale
      const newCursorY = newY + (e.clientY - rect.top - newPadTop) / newSvgScale

      setPan({ x: curPan.x + (cursorX - newCursorX), y: curPan.y + (cursorY - newCursorY) })
      setZoom(newZoom)
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => svg.removeEventListener('wheel', handleWheel)
  }, [vbW, vbH, vbX, vbY])

  // space key for pan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeld.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const snapToGrid = useCallback((v: number) => {
    if (!snapEnabled) return v
    return snapToGridUtil(v, SNAP_GRID)
  }, [snapEnabled])

  const snapRef = useRef(snapToGrid)
  useEffect(() => { snapRef.current = snapToGrid }, [snapToGrid])

  const centroid = (() => {
    if (displayPoints.length === 0) return { x: 0, y: 0 }
    const cx = displayPoints.reduce((s, p) => s + p.x, 0) / displayPoints.length
    const cy = displayPoints.reduce((s, p) => s + p.y, 0) / displayPoints.length
    return { x: cx, y: cy }
  })()

  const rotateAll = useCallback((angleDeg: number) => {
    const n = pointsRef.current.length
    if (n === 0) return
    const pts = pointsRef.current
    const holes = holesRef.current
    const cx = pts.reduce((s, p) => s + p.x, 0) / n
    const cy = pts.reduce((s, p) => s + p.y, 0) / n
    const rad = angleDeg * Math.PI / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const newPts = pts.map(p => {
      const dx = p.x - cx, dy = p.y - cy
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
    })
    const newHoles = holes.map(fh => {
      const dx = fh.x - cx, dy = fh.y - cy
      return { ...fh, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rotation: ((fh.rotation || 0) + angleDeg) % 360 }
    })
    pushHistory({ points: newPts, fingerHoles: newHoles, interiorRings: currentRings })
    onPointsRef.current(newPts)
    onHolesRef.current(newHoles)
    const m = imageTransformRef.current
    if (m && onImageTransformRef.current) {
      const next = rotateAround(m, rad, cx, cy)
      imageTransformRef.current = next
      onImageTransformRef.current(next)
    }
  }, [pushHistory, currentRings])

  const flipAll = useCallback((axis: 'horizontal' | 'vertical') => {
    const pts = pointsRef.current
    const holes = holesRef.current
    const rings = currentRingsRef.current
    const n = pts.length
    if (n === 0) return
    const cx = pts.reduce((s, p) => s + p.x, 0) / n
    const cy = pts.reduce((s, p) => s + p.y, 0) / n
    const flip = (p: Point) => axis === 'horizontal'
      ? { x: 2 * cx - p.x, y: p.y }
      : { x: p.x, y: 2 * cy - p.y }
    // flipping reverses winding order
    const newPts = pts.map(flip).reverse()
    const newHoles = holes.map(fh => ({
      ...fh,
      ...(axis === 'horizontal' ? { x: 2 * cx - fh.x } : { y: 2 * cy - fh.y }),
      rotation: -((fh.rotation || 0) % 360),
    }))
    const newRings = rings.map(ring => ring.map(flip).reverse())
    pushHistory({ points: newPts, fingerHoles: newHoles, interiorRings: newRings })
    onPointsRef.current(newPts)
    onHolesRef.current(newHoles)
    onInteriorRingsChange?.(newRings)
    const m = imageTransformRef.current
    if (m && onImageTransformRef.current) {
      const next = flipAround(m, axis, cx, cy)
      imageTransformRef.current = next
      onImageTransformRef.current(next)
    }
  }, [pushHistory, onInteriorRingsChange])

  const handleRotatePolygonMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    const pos = screenToMm(e.clientX, e.clientY)
    const cx = centroid.x
    const cy = centroid.y
    const startAngle = Math.atan2(pos.y - cy, pos.x - cx)
    setDragging({
      type: 'rotate-polygon',
      centerX: cx,
      centerY: cy,
      startAngle,
      origPoints: JSON.parse(JSON.stringify(points)),
      origHoles: JSON.parse(JSON.stringify(fingerHoles)),
    })
  }

  const createCutout = (xMm: number, yMm: number): FingerHole | null => {
    const base = { id: `fh-${Date.now()}`, x: xMm, y: yMm, rotation: 0 }
    switch (editMode) {
      case 'finger-hole': return { ...base, radius: 15, shape: 'circle' as const }
      case 'circle': return { ...base, radius: 10, shape: 'circle' as const }
      case 'square': return { ...base, radius: 10, shape: 'square' as const }
      case 'rectangle': return { ...base, radius: 15, width: 30, height: 20, shape: 'rectangle' as const }
      default: return null
    }
  }

  // vertex interactions
  const handleVertexMouseDown = (pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode === 'delete-vertex') {
      if (points.length <= 3) return
      const updated = [...points]
      updated.splice(pointIdx, 1)
      pushHistory({ points: updated, fingerHoles, interiorRings: currentRings })
      onPointsChange(updated)
      return
    }
    setSelection({ type: 'vertex', pointIdx })
    setDragging({ type: 'vertex', pointIdx })
  }

  const handleEdgeClick = (edgeIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode !== 'add-vertex') return
    const pos = screenToMm(e.clientX, e.clientY)
    const updated = [...points]
    updated.splice(edgeIdx + 1, 0, pos)
    pushHistory({ points: updated, fingerHoles, interiorRings: currentRings })
    onPointsChange(updated)
  }

  // hole interactions
  const handleHoleMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editMode !== 'select' && editMode !== 'fill-ring') {
      const pos = screenToMm(e.clientX, e.clientY)
      const cutout = createCutout(pos.x, pos.y)
      if (cutout) {
        const updated = [...fingerHoles, cutout]
        pushHistory({ points, fingerHoles: updated, interiorRings: currentRings })
        onFingerHolesChange(updated)
      }
      return
    }
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    setSelection({ type: 'hole', holeId })
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({ type: 'hole', holeId, startX: pos.x, startY: pos.y, origX: hole.x, origY: hole.y })
  }

  const handleResizeMouseDown = (holeId: string, cornerIndex?: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    const pos = screenToMm(e.clientX, e.clientY)
    // for rectangle corners, pin the opposite corner in world coords
    let anchorX: number | undefined, anchorY: number | undefined
    if (cornerIndex !== undefined && hole.shape === 'rectangle' && hole.width && hole.height) {
      const rot = (hole.rotation || 0) * Math.PI / 180
      const cosR = Math.cos(rot), sinR = Math.sin(rot)
      const hw = hole.width / 2, hh = hole.height / 2
      // local corner offsets: 0=TL(-hw,-hh) 1=TR(hw,-hh) 2=BR(hw,hh) 3=BL(-hw,hh)
      const opp = (cornerIndex + 2) % 4
      const lx = (opp === 0 || opp === 3) ? -hw : hw
      const ly = (opp < 2) ? -hh : hh
      anchorX = hole.x + lx * cosR - ly * sinR
      anchorY = hole.y + lx * sinR + ly * cosR
    }
    setDragging({
      type: 'resize', holeId, startX: pos.x, startY: pos.y,
      origRadius: hole.radius, origWidth: hole.width, origHeight: hole.height,
      centerX: hole.x, centerY: hole.y,
      anchorX, anchorY, rotation: hole.rotation,
    })
  }

  const handleHoleRotateMouseDown = (holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const hole = fingerHoles.find(fh => fh.id === holeId)
    if (!hole) return
    const pos = screenToMm(e.clientX, e.clientY)
    const startAngle = Math.atan2(pos.y - hole.y, pos.x - hole.x)
    setDragging({ type: 'rotate-hole', holeId, centerX: hole.x, centerY: hole.y, startAngle, origRotation: hole.rotation || 0 })
  }

  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (didPanRef.current) {
      didPanRef.current = false
      return
    }
    if (editMode === 'finger-hole' || editMode === 'circle' || editMode === 'square' || editMode === 'rectangle') {
      const pos = screenToMm(e.clientX, e.clientY)
      const cutout = createCutout(snapToGrid(pos.x), snapToGrid(pos.y))
      if (cutout) {
        const updated = [...fingerHoles, cutout]
        pushHistory({ points, fingerHoles: updated, interiorRings: currentRings })
        onFingerHolesChange(updated)
      }
      return
    }
    setSelection(null)
  }

  const handleSvgMouseDown = (e: React.MouseEvent) => {
    const isPanTrigger = e.button === 1 || (e.button === 0 && spaceHeld.current)
    if (!isPanTrigger) return
    e.preventDefault()
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgScale = Math.min(rect.width / zvbW, rect.height / zvbH)
    setDragging({
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      svgScale,
    })
  }

  const handleResetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return
    const pos = screenToMmRef.current(e.clientX, e.clientY)
    const snap = snapRef.current
    const currentPoints = dragPointsRef.current ?? pointsRef.current
    const currentHoles = dragHolesRef.current ?? holesRef.current

    if (dragging.type === 'vertex') {
      const updated = [...currentPoints]
      updated[dragging.pointIdx] = { x: snap(pos.x), y: snap(pos.y) }
      setDragPoints(updated)
    } else if (dragging.type === 'hole') {
      const dx = pos.x - dragging.startX
      const dy = pos.y - dragging.startY
      const updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        return { ...fh, x: snap(dragging.origX + dx), y: snap(dragging.origY + dy) }
      })
      setDragHoles(updated)
    } else if (dragging.type === 'resize') {
      const updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        if (fh.shape === 'rectangle' && dragging.anchorX !== undefined && dragging.anchorY !== undefined) {
          // pinned corner resize: anchor stays fixed, dragged corner follows mouse
          const rot = (dragging.rotation || 0) * Math.PI / 180
          const cosR = Math.cos(rot), sinR = Math.sin(rot)
          // vector from anchor to mouse in local space
          const gdx = pos.x - dragging.anchorX
          const gdy = pos.y - dragging.anchorY
          const localW = gdx * cosR + gdy * sinR
          const localH = -gdx * sinR + gdy * cosR
          const newW = Math.max(10, Math.abs(localW))
          const newH = Math.max(10, Math.abs(localH))
          // new centre = midpoint of anchor and dragged corner
          const cx = (dragging.anchorX + pos.x) / 2
          const cy = (dragging.anchorY + pos.y) / 2
          return { ...fh, x: snap(cx), y: snap(cy), width: newW, height: newH, radius: Math.max(newW, newH) / 2 }
        }
        // circle / square: distance from centre
        const dx = pos.x - dragging.centerX
        const dy = pos.y - dragging.centerY
        return { ...fh, radius: Math.max(5, Math.sqrt(dx * dx + dy * dy)) }
      })
      setDragHoles(updated)
    } else if (dragging.type === 'rotate-hole') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = (currentAngle - dragging.startAngle) * (180 / Math.PI)
      const updated = currentHoles.map(fh => {
        if (fh.id !== dragging.holeId) return fh
        return { ...fh, rotation: (dragging.origRotation + deltaAngle) % 360 }
      })
      setDragHoles(updated)
    } else if (dragging.type === 'rotate-polygon') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const delta = currentAngle - dragging.startAngle
      const cos = Math.cos(delta), sin = Math.sin(delta)
      const cx = dragging.centerX, cy = dragging.centerY
      const newPts = dragging.origPoints.map(p => {
        const dx = p.x - cx, dy = p.y - cy
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
      })
      const newHoles = dragging.origHoles.map(fh => {
        const dx = fh.x - cx, dy = fh.y - cy
        const origRot = fh.rotation || 0
        return { ...fh, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rotation: (origRot + delta * 180 / Math.PI) % 360 }
      })
      setDragPoints(newPts)
      setDragHoles(newHoles)
      rotateDragRef.current = { delta, cx, cy }
    } else if (dragging.type === 'pan') {
      const dx = (e.clientX - dragging.startClientX) / dragging.svgScale
      const dy = (e.clientY - dragging.startClientY) / dragging.svgScale
      setPan({ x: dragging.origPanX - dx, y: dragging.origPanY - dy })
      didPanRef.current = true
    }
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      if (dragging.type === 'pan') {
        setDragging(null)
        return
      }
      const finalPoints = dragPointsRef.current ?? pointsRef.current
      const finalHoles = dragHolesRef.current ?? holesRef.current
      if (dragPointsRef.current) onPointsRef.current(finalPoints)
      if (dragHolesRef.current) onHolesRef.current(finalHoles)
      pushHistory({ points: finalPoints, fingerHoles: finalHoles, interiorRings: currentRingsRef.current })
      if (dragging.type === 'rotate-polygon' && rotateDragRef.current) {
        const { delta, cx, cy } = rotateDragRef.current
        const m = imageTransformRef.current
        if (m && delta !== 0 && onImageTransformRef.current) {
          const next = rotateAround(m, delta, cx, cy)
          imageTransformRef.current = next
          onImageTransformRef.current(next)
        }
      }
      rotateDragRef.current = null
      setDragPoints(null)
      setDragHoles(null)
    }
    setDragging(null)
  }, [dragging, pushHistory])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  const handleDeleteHole = () => {
    if (selection?.type !== 'hole') return
    const updated = fingerHoles.filter(fh => fh.id !== selection.holeId)
    pushHistory({ points, fingerHoles: updated, interiorRings: currentRings })
    onFingerHolesChange(updated)
    setSelection(null)
  }

  const selectedHole = selection?.type === 'hole'
    ? displayHoles.find(fh => fh.id === selection.holeId)
    : null

  const handleFillRing = useCallback((ringIndex: number) => {
    if (!onInteriorRingsChange) return
    const updated = currentRings.filter((_, i) => i !== ringIndex)
    pushHistory({ points, fingerHoles, interiorRings: updated })
    onInteriorRingsChange(updated)
  }, [currentRings, points, fingerHoles, pushHistory, onInteriorRingsChange])

  const isCutoutMode = editMode === 'finger-hole' || editMode === 'circle' || editMode === 'square' || editMode === 'rectangle'

  const cutoutModeIcon = editMode === 'finger-hole' ? <Fingerprint className="w-4.5 h-4.5" />
    : editMode === 'circle' ? <Circle className="w-4.5 h-4.5" />
    : editMode === 'square' ? <Square className="w-4.5 h-4.5" />
    : editMode === 'rectangle' ? <RectangleHorizontal className="w-4.5 h-4.5" />
    : <Plus className="w-4.5 h-4.5" />

  const cutoutModeLabel = editMode === 'finger-hole' ? 'Finger hole'
    : editMode === 'circle' ? 'Circle'
    : editMode === 'square' ? 'Square'
    : editMode === 'rectangle' ? 'Rectangle'
    : 'Cutout'

  return (
    <div className="h-full w-full relative">
      {/* canvas fills entire area */}
      <ToolEditorCanvas
        svgRef={svgRef}
        zvbX={zvbX}
        zvbY={zvbY}
        zvbW={zvbW}
        zvbH={zvbH}
        isCutoutMode={isCutoutMode}
        handleBackgroundClick={handleBackgroundClick}
        handleSvgMouseDown={handleSvgMouseDown}
        gridMinX={gridMinX}
        gridMaxX={gridMaxX}
        gridMinY={gridMinY}
        gridMaxY={gridMaxY}
        gridStep={gridStep}
        zoom={zoom}
        displayPoints={displayPoints}
        smoothed={smoothed}
        interiorRings={interiorRings}
        points={points}
        editMode={editMode}
        selection={selection}
        handleEdgeClick={handleEdgeClick}
        handleVertexMouseDown={handleVertexMouseDown}
        displayHoles={displayHoles}
        handleHoleMouseDown={handleHoleMouseDown}
        handleResizeMouseDown={handleResizeMouseDown}
        handleHoleRotateMouseDown={handleHoleRotateMouseDown}
        handleRotatePolygonMouseDown={handleRotatePolygonMouseDown}
        onRingClick={handleFillRing}
        sourceImageContext={sourceImageContext}
        showSourceImage={showSourceImage}
        sourceImageOpacity={sourceImageOpacity}
      />

      {/* floating toolbar: top centre */}
      <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-20 glass-toolbar px-2 py-1 pointer-events-auto">
        <ToolEditorToolbar
          editMode={editMode}
          setEditMode={setEditMode}
          smoothed={smoothed}
          smoothLevel={smoothLevel}
          onSmoothedChange={onSmoothedChange}
          onSmoothLevelChange={onSmoothLevelChange}
          snapEnabled={snapEnabled}
          setSnapEnabled={setSnapEnabled}
          canUndo={canUndo}
          canRedo={canRedo}
          handleUndo={handleUndo}
          handleRedo={handleRedo}
          cutoutOpen={cutoutOpen}
          setCutoutOpen={setCutoutOpen}
          isCutoutMode={isCutoutMode}
          cutoutModeIcon={cutoutModeIcon}
          cutoutModeLabel={cutoutModeLabel}
          selection={selection}
          selectedHole={selectedHole}
          handleDeleteHole={handleDeleteHole}
          displayPointsCount={displayPoints.length}
          rotateAll={rotateAll}
          flipAll={flipAll}
          hasInteriorRings={currentRings.length > 0}
        />
      </div>

      {/* floating properties panel: right edge, shown when hole selected */}
      {selectedHole && (
        <div className="absolute top-[70px] right-3.5 z-20 w-[200px] glass-toolbar px-3 py-2 text-[11px] text-text-secondary">
          <div className="font-medium text-text-primary text-[12px] mb-1">Selection</div>
          <div>
            {selectedHole.shape || 'circle'}
            {selectedHole.shape === 'rectangle' && selectedHole.width && selectedHole.height
              ? ` ${selectedHole.width.toFixed(0)}x${selectedHole.height.toFixed(0)}mm`
              : selectedHole.shape === 'square'
              ? ` ${(selectedHole.radius * 2).toFixed(0)}mm`
              : ` r=${selectedHole.radius.toFixed(1)}mm`
            }
          </div>
          {selectedHole.rotation ? <div>rotation: {selectedHole.rotation.toFixed(0)}deg</div> : null}
        </div>
      )}

      {/* floating info pill: bottom left */}
      <div className="absolute bottom-3.5 left-3.5 z-20 glass-toolbar px-3 py-1.5 text-[11px] text-text-secondary">
        {displayPoints.length} vertices{smoothed ? ` (${points.length} raw)` : ''}, {displayHoles.length} cutout{displayHoles.length !== 1 ? 's' : ''}
        {' \u00b7 '}
        {((bounds.maxX - bounds.minX)).toFixed(1)}&times;{((bounds.maxY - bounds.minY)).toFixed(1)} mm
      </div>

      {/* floating zoom controls: bottom right */}
      <div className="absolute bottom-3.5 right-3.5 z-20 glass-toolbar px-1 py-0.5 flex items-center gap-0.5 text-[11px]">
        {sourceImageContext && (
          <>
            <button
              onClick={() => onShowSourceImageChange?.(!showSourceImage)}
              className={`p-1 rounded-[7px] transition-colors ${showSourceImage ? 'text-accent bg-accent-muted' : 'text-text-muted hover:text-text-secondary hover:bg-border/50'}`}
              title={showSourceImage ? 'Hide source photo' : 'Show source photo'}
            >
              {showSourceImage ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <ImageIcon className={`w-3.5 h-3.5 mx-0.5 ${showSourceImage ? 'text-text-secondary' : 'text-text-muted opacity-50'}`} />
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={sourceImageOpacity}
              disabled={!showSourceImage}
              onChange={e => onSourceImageOpacityChange?.(parseFloat(e.target.value))}
              className="w-16 h-1 accent-accent disabled:opacity-40"
              title={`Source photo opacity: ${Math.round(sourceImageOpacity * 100)}%`}
            />
            <div className="h-3.5 w-px bg-border-subtle mx-0.5" />
          </>
        )}
        <button
          onClick={() => setZoom(z => Math.max(0.5, z / ZOOM_FACTOR))}
          className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
        >
          -
        </button>
        <span className="px-1.5 text-text-secondary min-w-[36px] text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.min(20, z * ZOOM_FACTOR))}
          className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
        >
          +
        </button>
        <div className="h-3.5 w-px bg-border-subtle mx-0.5" />
        <button
          onClick={handleResetZoom}
          className="px-2 py-1 rounded-[7px] text-text-muted hover:text-text-primary hover:bg-border/50 transition-colors"
        >
          Fit
        </button>
      </div>
    </div>
  )
}
