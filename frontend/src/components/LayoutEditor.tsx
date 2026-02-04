'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Circle, Hand, Fingerprint, Trash2, Magnet, Square, RectangleHorizontal } from 'lucide-react'
import type { Polygon, FingerHole } from '@/types'

interface Props {
  polygons: Polygon[]
  onPolygonsChange: (polygons: Polygon[]) => void
  gridX: number
  gridY: number
  scaleFactor: number
}

const GRID_UNIT = 42
const DISPLAY_SCALE = 8
const SNAP_GRID = 5 // mm - holes snap to this grid

type Tool = 'select' | 'finger-hole' | 'circle' | 'square' | 'rectangle'

type Selection =
  | { type: 'polygon'; polyId: string }
  | { type: 'hole'; polyId: string; holeId: string }
  | null

type DragState =
  | { type: 'polygon'; polyId: string; startX: number; startY: number; origPoints: { x: number; y: number }[]; origHoles: { id: string; x: number; y: number }[] }
  | { type: 'hole'; polyId: string; holeId: string; startX: number; startY: number; origX: number; origY: number }
  | { type: 'resize'; polyId: string; holeId: string; startX: number; startY: number; origRadius: number; origWidth?: number; origHeight?: number; centerX: number; centerY: number }
  | { type: 'rotate'; polyId: string; centerX: number; centerY: number; startAngle: number; origPoints: { x: number; y: number }[]; origHoles: { id: string; x: number; y: number }[] }
  | { type: 'rotate-hole'; polyId: string; holeId: string; centerX: number; centerY: number; startAngle: number; origRotation: number }
  | null

export function LayoutEditor({
  polygons,
  onPolygonsChange,
  gridX,
  gridY,
  scaleFactor,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [dragging, setDragging] = useState<DragState>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)

  // refs to avoid stale closures in event handlers
  const polygonsRef = useRef(polygons)
  const onChangeRef = useRef(onPolygonsChange)
  useEffect(() => { polygonsRef.current = polygons }, [polygons])
  useEffect(() => { onChangeRef.current = onPolygonsChange }, [onPolygonsChange])

  const binWidthMm = gridX * GRID_UNIT
  const binHeightMm = gridY * GRID_UNIT
  const displayWidth = binWidthMm * DISPLAY_SCALE
  const displayHeight = binHeightMm * DISPLAY_SCALE

  const getPolygonMm = useCallback((poly: Polygon) => {
    return poly.points.map(p => ({
      x: p.x * scaleFactor,
      y: p.y * scaleFactor,
    }))
  }, [scaleFactor])

  const getAllBounds = useCallback(() => {
    if (polygons.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const poly of polygons) {
      for (const p of poly.points) {
        const x = p.x * scaleFactor
        const y = p.y * scaleFactor
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    return { minX, minY, maxX, maxY }
  }, [polygons, scaleFactor])

  const handleRecenter = useCallback(() => {
    const bounds = getAllBounds()
    const targetCenterX = binWidthMm / 2
    const targetCenterY = binHeightMm / 2
    const currentCenterX = (bounds.minX + bounds.maxX) / 2
    const currentCenterY = (bounds.minY + bounds.maxY) / 2
    const offsetX = (targetCenterX - currentCenterX) / scaleFactor
    const offsetY = (targetCenterY - currentCenterY) / scaleFactor

    const updated = polygons.map(poly => ({
      ...poly,
      points: poly.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY })),
      finger_holes: poly.finger_holes.map(fh => ({ ...fh, x: fh.x + offsetX, y: fh.y + offsetY })),
    }))
    onPolygonsChange(updated)
  }, [getAllBounds, binWidthMm, binHeightMm, scaleFactor, polygons, onPolygonsChange])

  const screenToMm = useCallback((clientX: number, clientY: number) => {
    if (!svgRef.current) return { x: 0, y: 0 }
    const rect = svgRef.current.getBoundingClientRect()
    // viewBox is: -10 -10 (displayWidth + 70) (displayHeight + 30)
    const viewBoxWidth = displayWidth + 70
    const viewBoxHeight = displayHeight + 30
    // calculate actual scale from rendered size vs viewBox
    const scaleX = viewBoxWidth / rect.width
    const scaleY = viewBoxHeight / rect.height
    // use the larger scale (since preserveAspectRatio is 'meet')
    const scale = Math.max(scaleX, scaleY)
    // adjust for centering offset
    const offsetX = (rect.width * scale - viewBoxWidth) / 2
    const offsetY = (rect.height * scale - viewBoxHeight) / 2
    const svgX = (clientX - rect.left) * scale - offsetX - 10 // -10 is viewBox origin
    const svgY = (clientY - rect.top) * scale - offsetY - 10
    return {
      x: svgX / DISPLAY_SCALE,
      y: svgY / DISPLAY_SCALE,
    }
  }, [displayWidth, displayHeight])

  // snap mm value to grid (if enabled)
  const snapToGrid = useCallback((valueMm: number) => {
    if (!snapEnabled) return valueMm
    return Math.round(valueMm / SNAP_GRID) * SNAP_GRID
  }, [snapEnabled])

  // create a new cutout shape based on active tool
  const createCutout = (xMm: number, yMm: number): FingerHole | null => {
    const base = {
      id: `fh-${Date.now()}`,
      x: xMm / scaleFactor,
      y: yMm / scaleFactor,
      rotation: 0,
    }

    switch (activeTool) {
      case 'finger-hole':
        return { ...base, radius: 15, shape: 'circle' as const }
      case 'circle':
        return { ...base, radius: 10, shape: 'circle' as const }
      case 'square':
        return { ...base, radius: 10, shape: 'square' as const } // radius = half-width
      case 'rectangle':
        return { ...base, radius: 15, width: 30, height: 20, shape: 'rectangle' as const }
      default:
        return null
    }
  }

  // polygon click/drag
  const handlePolygonMouseDown = (polyId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const poly = polygons.find(p => p.id === polyId)
    if (!poly) return

    if (activeTool !== 'select') {
      const pos = screenToMm(e.clientX, e.clientY)
      const newCutout = createCutout(pos.x, pos.y)
      if (newCutout) {
        const updated = polygons.map(p => {
          if (p.id !== polyId) return p
          return { ...p, finger_holes: [...p.finger_holes, newCutout] }
        })
        onPolygonsChange(updated)
        setSelection({ type: 'polygon', polyId })
      }
      return
    }

    setSelection({ type: 'polygon', polyId })
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({
      type: 'polygon',
      polyId,
      startX: pos.x,
      startY: pos.y,
      origPoints: poly.points.map(p => ({ x: p.x, y: p.y })),
      origHoles: poly.finger_holes.map(fh => ({ id: fh.id, x: fh.x, y: fh.y })),
    })
  }

  // hole click/drag
  const handleHoleMouseDown = (polyId: string, holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (activeTool !== 'select') return

    const poly = polygons.find(p => p.id === polyId)
    const hole = poly?.finger_holes.find(fh => fh.id === holeId)
    if (!hole) return

    setSelection({ type: 'hole', polyId, holeId })
    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({
      type: 'hole',
      polyId,
      holeId,
      startX: pos.x,
      startY: pos.y,
      origX: hole.x,
      origY: hole.y,
    })
  }

  // prevent click from bubbling to background
  const stopClick = (e: React.MouseEvent) => e.stopPropagation()

  // resize handle drag
  const handleResizeMouseDown = (polyId: string, holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const poly = polygons.find(p => p.id === polyId)
    const hole = poly?.finger_holes.find(fh => fh.id === holeId)
    if (!hole) return

    const pos = screenToMm(e.clientX, e.clientY)
    setDragging({
      type: 'resize',
      polyId,
      holeId,
      startX: pos.x,
      startY: pos.y,
      origRadius: hole.radius,
      origWidth: hole.width,
      origHeight: hole.height,
      centerX: hole.x * scaleFactor,
      centerY: hole.y * scaleFactor,
    })
  }

  // rotate hole around its own center
  const handleHoleRotateMouseDown = (polyId: string, holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const poly = polygons.find(p => p.id === polyId)
    const hole = poly?.finger_holes.find(fh => fh.id === holeId)
    if (!hole) return

    const pos = screenToMm(e.clientX, e.clientY)
    const holeCenterX = hole.x * scaleFactor
    const holeCenterY = hole.y * scaleFactor
    const startAngle = Math.atan2(pos.y - holeCenterY, pos.x - holeCenterX)

    setDragging({
      type: 'rotate-hole',
      polyId,
      holeId,
      centerX: holeCenterX,
      centerY: holeCenterY,
      startAngle,
      origRotation: hole.rotation || 0,
    })
  }

  // rotate polygon around its center
  const handleRotateMouseDown = (polyId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const poly = polygons.find(p => p.id === polyId)
    if (!poly) return

    const pos = screenToMm(e.clientX, e.clientY)
    const centerX = poly.points.reduce((sum, p) => sum + p.x * scaleFactor, 0) / poly.points.length
    const centerY = poly.points.reduce((sum, p) => sum + p.y * scaleFactor, 0) / poly.points.length
    const startAngle = Math.atan2(pos.y - centerY, pos.x - centerX)

    setDragging({
      type: 'rotate',
      polyId,
      centerX,
      centerY,
      startAngle,
      origPoints: poly.points.map(p => ({ x: p.x, y: p.y })),
      origHoles: poly.finger_holes.map(fh => ({ id: fh.id, x: fh.x, y: fh.y })),
    })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return
    const pos = screenToMm(e.clientX, e.clientY)
    const currentPolygons = polygonsRef.current
    const onChange = onChangeRef.current

    if (dragging.type === 'polygon') {
      const origCenterX = dragging.origPoints.reduce((sum, p) => sum + p.x * scaleFactor, 0) / dragging.origPoints.length
      const origCenterY = dragging.origPoints.reduce((sum, p) => sum + p.y * scaleFactor, 0) / dragging.origPoints.length
      const rawDx = pos.x - dragging.startX
      const rawDy = pos.y - dragging.startY
      const newCenterX = snapToGrid(origCenterX + rawDx)
      const newCenterY = snapToGrid(origCenterY + rawDy)
      const dx = (newCenterX - origCenterX) / scaleFactor
      const dy = (newCenterY - origCenterY) / scaleFactor
      const updated = currentPolygons.map(poly => {
        if (poly.id !== dragging.polyId) return poly
        return {
          ...poly,
          points: dragging.origPoints.map(p => ({ x: p.x + dx, y: p.y + dy })),
          finger_holes: poly.finger_holes.map(fh => {
            const orig = dragging.origHoles.find(h => h.id === fh.id)
            if (!orig) return fh
            return { ...fh, x: orig.x + dx, y: orig.y + dy }
          }),
        }
      })
      onChange(updated)
    } else if (dragging.type === 'hole') {
      const dx = (pos.x - dragging.startX) / scaleFactor
      const dy = (pos.y - dragging.startY) / scaleFactor
      const newXMm = snapToGrid((dragging.origX + dx) * scaleFactor)
      const newYMm = snapToGrid((dragging.origY + dy) * scaleFactor)
      const updated = currentPolygons.map(poly => {
        if (poly.id !== dragging.polyId) return poly
        return {
          ...poly,
          finger_holes: poly.finger_holes.map(fh => {
            if (fh.id !== dragging.holeId) return fh
            return { ...fh, x: newXMm / scaleFactor, y: newYMm / scaleFactor }
          }),
        }
      })
      onChange(updated)
    } else if (dragging.type === 'resize') {
      const dx = pos.x - dragging.centerX
      const dy = pos.y - dragging.centerY
      const newRadius = Math.max(5, Math.sqrt(dx * dx + dy * dy))
      const scaleMult = dragging.origRadius > 0 ? newRadius / dragging.origRadius : 1
      const updated = currentPolygons.map(poly => {
        if (poly.id !== dragging.polyId) return poly
        return {
          ...poly,
          finger_holes: poly.finger_holes.map(fh => {
            if (fh.id !== dragging.holeId) return fh
            if (fh.shape === 'rectangle' && dragging.origWidth && dragging.origHeight) {
              return {
                ...fh,
                radius: newRadius,
                width: Math.max(10, dragging.origWidth * scaleMult),
                height: Math.max(10, dragging.origHeight * scaleMult),
              }
            }
            return { ...fh, radius: newRadius }
          }),
        }
      })
      onChange(updated)
    } else if (dragging.type === 'rotate') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = currentAngle - dragging.startAngle
      const cos = Math.cos(deltaAngle)
      const sin = Math.sin(deltaAngle)
      const cx = dragging.centerX / scaleFactor
      const cy = dragging.centerY / scaleFactor

      const updated = currentPolygons.map(poly => {
        if (poly.id !== dragging.polyId) return poly
        return {
          ...poly,
          points: dragging.origPoints.map(p => {
            const pdx = p.x - cx
            const pdy = p.y - cy
            return {
              x: cx + pdx * cos - pdy * sin,
              y: cy + pdx * sin + pdy * cos,
            }
          }),
          finger_holes: poly.finger_holes.map(fh => {
            const orig = dragging.origHoles.find(h => h.id === fh.id)
            if (!orig) return fh
            const fdx = orig.x - cx
            const fdy = orig.y - cy
            return {
              ...fh,
              x: cx + fdx * cos - fdy * sin,
              y: cy + fdx * sin + fdy * cos,
            }
          }),
        }
      })
      onChange(updated)
    } else if (dragging.type === 'rotate-hole') {
      const currentAngle = Math.atan2(pos.y - dragging.centerY, pos.x - dragging.centerX)
      const deltaAngle = (currentAngle - dragging.startAngle) * (180 / Math.PI)
      const newRotation = (dragging.origRotation + deltaAngle) % 360

      const updated = currentPolygons.map(poly => {
        if (poly.id !== dragging.polyId) return poly
        return {
          ...poly,
          finger_holes: poly.finger_holes.map(fh => {
            if (fh.id !== dragging.holeId) return fh
            return { ...fh, rotation: newRotation }
          }),
        }
      })
      onChange(updated)
    }
  }, [dragging, scaleFactor, screenToMm, snapToGrid])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

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
    const updated = polygons.map(poly => {
      if (poly.id !== selection.polyId) return poly
      return { ...poly, finger_holes: poly.finger_holes.filter(fh => fh.id !== selection.holeId) }
    })
    onPolygonsChange(updated)
    setSelection(null)
  }

  const handleBackgroundClick = () => {
    // clicking background always deselects
    setSelection(null)
  }


  const selectedHole = selection?.type === 'hole'
    ? polygons.find(p => p.id === selection.polyId)?.finger_holes.find(fh => fh.id === selection.holeId)
    : null

  return (
    <div className="h-full flex flex-col gap-3">
      {/* toolbar - fixed */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="flex gap-1 bg-white dark:bg-gray-700 rounded-lg p-1 border border-gray-200 dark:border-gray-600">
          <button
            onClick={() => setActiveTool('select')}
            className={`p-2 rounded ${activeTool === 'select' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
            title="Select & Move"
          >
            <Hand className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTool('finger-hole')}
            className={`p-2 rounded ${activeTool === 'finger-hole' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
            title="Add Finger Hole (15mm)"
          >
            <Fingerprint className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTool('circle')}
            className={`p-2 rounded ${activeTool === 'circle' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
            title="Add Circle Cutout (10mm)"
          >
            <Circle className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTool('square')}
            className={`p-2 rounded ${activeTool === 'square' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
            title="Add Square Cutout (20mm)"
          >
            <Square className="w-5 h-5" />
          </button>
          <button
            onClick={() => setActiveTool('rectangle')}
            className={`p-2 rounded ${activeTool === 'rectangle' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'}`}
            title="Add Rectangle Cutout (30x20mm)"
          >
            <RectangleHorizontal className="w-5 h-5" />
          </button>
        </div>

        <div className="h-6 w-px bg-gray-300 dark:bg-gray-600" />

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`p-2 rounded flex items-center gap-1 ${snapEnabled ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}
          title={`Snap to grid (${SNAP_GRID}mm) - ${snapEnabled ? 'ON' : 'OFF'}`}
        >
          <Magnet className="w-5 h-5" />
          <span className="text-xs font-medium">{snapEnabled ? 'ON' : 'OFF'}</span>
        </button>

        <span className="text-sm text-gray-500 dark:text-gray-400">
          {activeTool === 'select' && 'Drag to move. Use handles to resize or rotate.'}
          {activeTool === 'finger-hole' && 'Click to add finger hole (15mm)'}
          {activeTool === 'circle' && 'Click to add circle (10mm)'}
          {activeTool === 'square' && 'Click to add square (20mm)'}
          {activeTool === 'rectangle' && 'Click to add rectangle (30×20mm)'}
        </span>

        {selection?.type === 'hole' && (
          <button
            onClick={handleDeleteHole}
            className="ml-auto px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded border border-red-200 dark:border-red-800 flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        )}
      </div>

      {selectedHole && (
        <div className="text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 px-3 py-2 flex-shrink-0">
          Selected: {selectedHole.shape || 'circle'}
          {selectedHole.shape === 'rectangle' && selectedHole.width && selectedHole.height
            ? ` (${selectedHole.width.toFixed(0)}×${selectedHole.height.toFixed(0)}mm)`
            : selectedHole.shape === 'square'
            ? ` (${(selectedHole.radius * 2).toFixed(0)}mm)`
            : ` (r=${selectedHole.radius.toFixed(1)}mm)`
          }
          {selectedHole.rotation ? `, rot: ${selectedHole.rotation.toFixed(0)}°` : ''}
        </div>
      )}

      {/* SVG area - scales to fit */}
      <div className="flex-1 min-h-0 bg-gray-200 dark:bg-gray-900 rounded-lg p-4 flex items-center justify-center">
        <svg
          ref={svgRef}
          viewBox={`-10 -10 ${displayWidth + 70} ${displayHeight + 30}`}
          preserveAspectRatio="xMidYMid meet"
          className={`rounded max-w-full max-h-full ${activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
          style={{ overflow: 'visible' }}
          onClick={handleBackgroundClick}
        >
          {/* background */}
          <rect x="0" y="0" width={displayWidth} height={displayHeight} fill="rgb(156, 163, 175)" rx="4" />
          {/* grid lines */}
          {Array.from({ length: gridX + 1 }).map((_, i) => (
            <line
              key={`v${i}`}
              x1={i * GRID_UNIT * DISPLAY_SCALE}
              y1={0}
              x2={i * GRID_UNIT * DISPLAY_SCALE}
              y2={displayHeight}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={1}
              strokeDasharray={i === 0 || i === gridX ? undefined : '4,4'}
            />
          ))}
          {Array.from({ length: gridY + 1 }).map((_, i) => (
            <line
              key={`h${i}`}
              x1={0}
              y1={i * GRID_UNIT * DISPLAY_SCALE}
              x2={displayWidth}
              y2={i * GRID_UNIT * DISPLAY_SCALE}
              stroke="rgba(255,255,255,0.3)"
              strokeWidth={1}
              strokeDasharray={i === 0 || i === gridY ? undefined : '4,4'}
            />
          ))}

          {polygons.map(poly => {
            const pointsMm = getPolygonMm(poly)
            const pathData = pointsMm
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * DISPLAY_SCALE} ${p.y * DISPLAY_SCALE}`)
              .join(' ') + ' Z'
            const isPolySelected = selection?.type === 'polygon' && selection.polyId === poly.id
            const isPolyOrHoleSelected = isPolySelected || (selection?.type === 'hole' && selection.polyId === poly.id)
            const centerX = pointsMm.reduce((sum, p) => sum + p.x, 0) / pointsMm.length * DISPLAY_SCALE
            const centerY = pointsMm.reduce((sum, p) => sum + p.y, 0) / pointsMm.length * DISPLAY_SCALE
            const maxX = Math.max(...pointsMm.map(p => p.x)) * DISPLAY_SCALE

            return (
              <g key={poly.id}>
                <path
                  d={pathData}
                  fill={isPolySelected ? 'rgb(180, 180, 180)' : 'rgb(200, 200, 200)'}
                  stroke={isPolySelected ? 'rgb(80, 80, 80)' : 'rgb(120, 120, 120)'}
                  strokeWidth={2}
                  className={activeTool === 'select' ? 'cursor-move' : 'cursor-crosshair'}
                  onMouseDown={handlePolygonMouseDown(poly.id)}
                  onClick={stopClick}
                />

                {/* rotation handle - near selected item */}
                {isPolySelected && activeTool === 'select' && (
                  <g>
                    <line
                      x1={centerX}
                      y1={centerY}
                      x2={maxX + 25}
                      y2={centerY}
                      stroke="rgb(59, 130, 246)"
                      strokeWidth={2}
                      strokeDasharray="4,4"
                    />
                    <circle
                      cx={maxX + 35}
                      cy={centerY}
                      r={12}
                      fill="rgb(59, 130, 246)"
                      stroke="white"
                      strokeWidth={2}
                      className="cursor-grab"
                      onMouseDown={handleRotateMouseDown(poly.id)}
                      onClick={stopClick}
                    />
                    <text
                      x={maxX + 35}
                      y={centerY + 5}
                      textAnchor="middle"
                      fill="white"
                      fontSize="14"
                      fontWeight="bold"
                      className="pointer-events-none select-none"
                    >
                      ↻
                    </text>
                  </g>
                )}

                {poly.finger_holes.map(fh => {
                  const x = fh.x * scaleFactor * DISPLAY_SCALE
                  const y = fh.y * scaleFactor * DISPLAY_SCALE
                  const r = fh.radius * DISPLAY_SCALE
                  const shape = fh.shape || 'circle'
                  const rotation = fh.rotation || 0
                  const isHoleSelected = selection?.type === 'hole' && selection.holeId === fh.id

                  // dimensions for shape rendering
                  const w = shape === 'rectangle' && fh.width ? fh.width * DISPLAY_SCALE : r * 2
                  const h = shape === 'rectangle' && fh.height ? fh.height * DISPLAY_SCALE : r * 2

                  // handle offset for resize (based on shape)
                  const handleOffset = shape === 'circle' ? r : w / 2

                  return (
                    <g key={fh.id} transform={rotation !== 0 ? `rotate(${rotation} ${x} ${y})` : undefined}>
                      {shape === 'circle' && (
                        <circle
                          cx={x}
                          cy={y}
                          r={r}
                          fill={isHoleSelected ? 'rgb(80, 80, 80)' : 'rgb(100, 100, 100)'}
                          stroke={isHoleSelected ? 'rgb(59, 130, 246)' : 'rgb(60, 60, 60)'}
                          strokeWidth={isHoleSelected ? 3 : 1}
                          className={activeTool === 'select' ? 'cursor-move' : 'cursor-default'}
                          onMouseDown={handleHoleMouseDown(poly.id, fh.id)}
                          onClick={stopClick}
                        />
                      )}
                      {(shape === 'square' || shape === 'rectangle') && (
                        <rect
                          x={x - w / 2}
                          y={y - h / 2}
                          width={w}
                          height={h}
                          fill={isHoleSelected ? 'rgb(80, 80, 80)' : 'rgb(100, 100, 100)'}
                          stroke={isHoleSelected ? 'rgb(59, 130, 246)' : 'rgb(60, 60, 60)'}
                          strokeWidth={isHoleSelected ? 3 : 1}
                          className={activeTool === 'select' ? 'cursor-move' : 'cursor-default'}
                          onMouseDown={handleHoleMouseDown(poly.id, fh.id)}
                          onClick={stopClick}
                        />
                      )}
                      {isHoleSelected && (
                        <>
                          {/* resize handle */}
                          <circle
                            cx={x + handleOffset}
                            cy={y}
                            r={8}
                            fill="rgb(59, 130, 246)"
                            stroke="white"
                            strokeWidth={2}
                            className="cursor-ew-resize"
                            onMouseDown={handleResizeMouseDown(poly.id, fh.id)}
                            onClick={stopClick}
                          />
                          {/* rotation handle */}
                          <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={y - (shape === 'circle' ? r : h / 2) - 15}
                            stroke="rgb(59, 130, 246)"
                            strokeWidth={2}
                            strokeDasharray="4,4"
                          />
                          <circle
                            cx={x}
                            cy={y - (shape === 'circle' ? r : h / 2) - 25}
                            r={10}
                            fill="rgb(59, 130, 246)"
                            stroke="white"
                            strokeWidth={2}
                            className="cursor-grab"
                            onMouseDown={handleHoleRotateMouseDown(poly.id, fh.id)}
                            onClick={stopClick}
                          />
                          <text
                            x={x}
                            y={y - (shape === 'circle' ? r : h / 2) - 21}
                            textAnchor="middle"
                            fill="white"
                            fontSize="12"
                            fontWeight="bold"
                            className="pointer-events-none select-none"
                          >
                            ↻
                          </text>
                        </>
                      )}
                    </g>
                  )
                })}

                {pointsMm.length > 0 && (
                  <text
                    x={pointsMm.reduce((sum, p) => sum + p.x, 0) / pointsMm.length * DISPLAY_SCALE}
                    y={pointsMm.reduce((sum, p) => sum + p.y, 0) / pointsMm.length * DISPLAY_SCALE}
                    textAnchor="middle"
                    fill="rgb(60, 60, 60)"
                    fontSize="12"
                    fontWeight="500"
                    className="pointer-events-none"
                  >
                    {poly.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* bottom bar - fixed */}
      <div className="flex items-center justify-between text-sm flex-shrink-0">
        <span className="text-gray-500 dark:text-gray-400">{gridX}×{gridY} Grid ({binWidthMm}×{binHeightMm}mm)</span>
        <button
          onClick={handleRecenter}
          className="px-3 py-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-300 dark:border-gray-600"
        >
          Recenter
        </button>
      </div>
    </div>
  )
}
