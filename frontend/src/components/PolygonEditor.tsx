'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Point, Polygon, FingerHole } from '@/types'
import { Undo2, Redo2, Trash2, Plus, Minus } from 'lucide-react'

interface Props {
  imageUrl: string
  polygons: Polygon[]
  onPolygonsChange: (polygons: Polygon[]) => void
  editable?: boolean
}

const HANDLE_RADIUS = 8
const FINGER_HOLE_DEFAULT_RADIUS = 15
const MAX_HISTORY = 50

type EditMode = 'select' | 'vertex' | 'fingerhole' | 'add-vertex' | 'delete-vertex'
type DragState =
  | { type: 'vertex'; polyId: string; pointIdx: number }
  | { type: 'fingerhole'; polyId: string; holeId: string }
  | null

export function PolygonEditor({
  imageUrl,
  polygons,
  onPolygonsChange,
  editable = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const [editMode, setEditMode] = useState<EditMode>('select')
  const [dragging, setDragging] = useState<DragState>(null)

  // undo/redo history
  const [history, setHistory] = useState<Polygon[][]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const isUndoRedo = useRef(false)

  // track changes for undo
  const pushHistory = useCallback((newPolygons: Polygon[]) => {
    if (isUndoRedo.current) {
      isUndoRedo.current = false
      return
    }
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1)
      newHistory.push(JSON.parse(JSON.stringify(newPolygons)))
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift()
        return newHistory
      }
      return newHistory
    })
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1))
  }, [historyIndex])

  // initialise history with current state
  useEffect(() => {
    if (history.length === 0 && polygons.length > 0) {
      setHistory([JSON.parse(JSON.stringify(polygons))])
      setHistoryIndex(0)
    }
  }, [polygons, history.length])

  const canUndo = historyIndex > 0
  const canRedo = historyIndex < history.length - 1

  const handleUndo = useCallback(() => {
    if (!canUndo) return
    isUndoRedo.current = true
    const newIndex = historyIndex - 1
    setHistoryIndex(newIndex)
    onPolygonsChange(JSON.parse(JSON.stringify(history[newIndex])))
  }, [canUndo, historyIndex, history, onPolygonsChange])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    isUndoRedo.current = true
    const newIndex = historyIndex + 1
    setHistoryIndex(newIndex)
    onPolygonsChange(JSON.parse(JSON.stringify(history[newIndex])))
  }, [canRedo, historyIndex, history, onPolygonsChange])

  // keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = imageUrl
  }, [imageUrl])

  const getScaledPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }

      const rect = containerRef.current.getBoundingClientRect()
      const scaleX = imageSize.width / rect.width
      const scaleY = imageSize.height / rect.height

      return {
        x: Math.max(0, Math.min(imageSize.width, (clientX - rect.left) * scaleX)),
        y: Math.max(0, Math.min(imageSize.height, (clientY - rect.top) * scaleY)),
      }
    },
    [imageSize]
  )

  const updatePolygons = useCallback((updated: Polygon[]) => {
    pushHistory(updated)
    onPolygonsChange(updated)
  }, [pushHistory, onPolygonsChange])

  const handlePolygonClick = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editable) return

    // in fingerhole mode, select and add hole in one click
    if (editMode === 'fingerhole') {
      if (selected !== id) {
        setSelected(id)
      }
      const point = getScaledPoint(e.clientX, e.clientY)
      const updated = polygons.map((poly) => {
        if (poly.id !== id) return poly
        const newHole: FingerHole = {
          id: `fh-${Date.now()}`,
          x: point.x,
          y: point.y,
          radius: FINGER_HOLE_DEFAULT_RADIUS,
        }
        return { ...poly, finger_holes: [...poly.finger_holes, newHole] }
      })
      updatePolygons(updated)
      return
    }

    setSelected(selected === id ? null : id)
  }

  const handleEdgeClick = (polyId: string, edgeIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editable || editMode !== 'add-vertex') return

    const point = getScaledPoint(e.clientX, e.clientY)
    const updated = polygons.map((poly) => {
      if (poly.id !== polyId) return poly
      const points = [...poly.points]
      points.splice(edgeIdx + 1, 0, point)
      return { ...poly, points }
    })
    updatePolygons(updated)
  }

  const handleVertexClick = (polyId: string, pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!editable) return

    if (editMode === 'delete-vertex') {
      const poly = polygons.find(p => p.id === polyId)
      if (!poly || poly.points.length <= 3) return // need at least 3 points

      const updated = polygons.map((p) => {
        if (p.id !== polyId) return p
        const points = [...p.points]
        points.splice(pointIdx, 1)
        return { ...p, points }
      })
      updatePolygons(updated)
    }
  }

  const handleVertexMouseDown = (polyId: string, pointIdx: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editable && (editMode === 'vertex' || editMode === 'select')) {
      setDragging({ type: 'vertex', polyId, pointIdx })
    }
  }

  const handleFingerHoleMouseDown = (polyId: string, holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (editable) {
      setDragging({ type: 'fingerhole', polyId, holeId })
    }
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return

      const point = getScaledPoint(e.clientX, e.clientY)

      if (dragging.type === 'vertex') {
        const updated = polygons.map((poly) => {
          if (poly.id !== dragging.polyId) return poly
          const points = [...poly.points]
          points[dragging.pointIdx] = point
          return { ...poly, points }
        })
        onPolygonsChange(updated) // don't push to history during drag
      } else if (dragging.type === 'fingerhole') {
        const updated = polygons.map((poly) => {
          if (poly.id !== dragging.polyId) return poly
          const finger_holes = poly.finger_holes.map((fh) =>
            fh.id === dragging.holeId ? { ...fh, x: point.x, y: point.y } : fh
          )
          return { ...poly, finger_holes }
        })
        onPolygonsChange(updated) // don't push to history during drag
      }
    },
    [dragging, polygons, getScaledPoint, onPolygonsChange]
  )

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      // push to history after drag completes
      pushHistory(polygons)
    }
    setDragging(null)
  }, [dragging, polygons, pushHistory])

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

  const handleBackgroundClick = () => {
    if (editMode !== 'fingerhole' || !selected) {
      setSelected(null)
    }
  }

  const handleDeletePolygon = (id: string) => {
    updatePolygons(polygons.filter((p) => p.id !== id))
    setSelected(null)
  }

  const handleDeleteFingerHole = (polyId: string, holeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = polygons.map((poly) => {
      if (poly.id !== polyId) return poly
      return { ...poly, finger_holes: poly.finger_holes.filter((fh) => fh.id !== holeId) }
    })
    updatePolygons(updated)
  }

  // auto-select first polygon when switching to edit modes
  const handleModeChange = (mode: EditMode) => {
    setEditMode(mode)
    if ((mode === 'vertex' || mode === 'add-vertex' || mode === 'delete-vertex') && !selected && polygons.length > 0) {
      setSelected(polygons[0].id)
    }
  }

  if (!imageSize.width) {
    return <div className="bg-gray-100 rounded-lg aspect-[4/3]" />
  }

  const selectedPoly = polygons.find(p => p.id === selected)

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative bg-gray-100 rounded-lg overflow-hidden"
        style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
        onClick={handleBackgroundClick}
      >
        <img
          src={imageUrl}
          alt="Corrected"
          className="w-full h-full pointer-events-none"
          draggable={false}
        />

        <svg
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
        >
          {polygons.map((poly) => {
            const isSelected = selected === poly.id
            const points = poly.points
              .map((p) => `${p.x},${p.y}`)
              .join(' ')

            return (
              <g key={poly.id}>
                <polygon
                  points={points}
                  fill={isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.15)'}
                  stroke={isSelected ? 'rgb(37, 99, 235)' : 'rgb(59, 130, 246)'}
                  strokeWidth={isSelected ? 2 : 1}
                  className={editMode === 'fingerhole' && isSelected ? 'cursor-crosshair' : 'cursor-pointer'}
                  onClick={handlePolygonClick(poly.id)}
                />

                {/* edge click targets for adding vertices */}
                {isSelected && editable && editMode === 'add-vertex' &&
                  poly.points.map((point, idx) => {
                    const nextPoint = poly.points[(idx + 1) % poly.points.length]
                    const midX = (point.x + nextPoint.x) / 2
                    const midY = (point.y + nextPoint.y) / 2
                    return (
                      <g key={`edge-${idx}`}>
                        <line
                          x1={point.x}
                          y1={point.y}
                          x2={nextPoint.x}
                          y2={nextPoint.y}
                          stroke="transparent"
                          strokeWidth={20}
                          className="cursor-crosshair"
                          onClick={handleEdgeClick(poly.id, idx)}
                        />
                        <circle
                          cx={midX}
                          cy={midY}
                          r={5}
                          fill="rgb(34, 197, 94)"
                          stroke="white"
                          strokeWidth={2}
                          className="cursor-crosshair pointer-events-none"
                        />
                      </g>
                    )
                  })}

                {/* vertex handles */}
                {isSelected &&
                  editable &&
                  (editMode === 'vertex' || editMode === 'select' || editMode === 'add-vertex' || editMode === 'delete-vertex') &&
                  poly.points.map((point, idx) => (
                    <circle
                      key={idx}
                      cx={point.x}
                      cy={point.y}
                      r={HANDLE_RADIUS}
                      fill={editMode === 'delete-vertex' ? 'rgb(239, 68, 68)' : 'white'}
                      stroke={editMode === 'delete-vertex' ? 'rgb(185, 28, 28)' : 'rgb(37, 99, 235)'}
                      strokeWidth={2}
                      className={editMode === 'delete-vertex' ? 'cursor-pointer' : 'cursor-move'}
                      onMouseDown={editMode !== 'delete-vertex' ? handleVertexMouseDown(poly.id, idx) : undefined}
                      onClick={handleVertexClick(poly.id, idx)}
                    />
                  ))}

                {/* finger holes */}
                {poly.finger_holes.map((fh) => (
                  <g key={fh.id}>
                    <circle
                      cx={fh.x}
                      cy={fh.y}
                      r={14}
                      fill={isSelected ? 'rgba(234, 88, 12, 0.5)' : 'rgba(234, 88, 12, 0.3)'}
                      stroke="rgb(234, 88, 12)"
                      strokeWidth={2}
                      className={isSelected && editable && editMode === 'fingerhole' ? 'cursor-move' : 'cursor-default'}
                      onMouseDown={isSelected && editable && editMode === 'fingerhole' ? handleFingerHoleMouseDown(poly.id, fh.id) : undefined}
                    />
                    {isSelected && editable && editMode === 'fingerhole' && (
                      <g
                        className="cursor-pointer"
                        onClick={handleDeleteFingerHole(poly.id, fh.id)}
                      >
                        <circle
                          cx={fh.x + 12}
                          cy={fh.y - 12}
                          r={8}
                          fill="rgb(220, 38, 38)"
                        />
                        <text
                          x={fh.x + 12}
                          y={fh.y - 8}
                          textAnchor="middle"
                          fill="white"
                          fontSize="12"
                          fontWeight="bold"
                        >
                          ×
                        </text>
                      </g>
                    )}
                  </g>
                ))}

                {/* label */}
                {poly.points.length > 0 && (
                  <text
                    x={poly.points.reduce((sum, p) => sum + p.x, 0) / poly.points.length}
                    y={poly.points.reduce((sum, p) => sum + p.y, 0) / poly.points.length}
                    textAnchor="middle"
                    fill={isSelected ? 'rgb(37, 99, 235)' : 'rgb(59, 130, 246)'}
                    fontSize="14"
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

      {editable && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1">
            <button
              onClick={() => handleModeChange('vertex')}
              className={`px-3 py-1.5 text-sm rounded ${
                editMode === 'vertex'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
              title="Drag vertices to adjust outline"
            >
              Move vertices
            </button>
            <button
              onClick={() => handleModeChange('add-vertex')}
              className={`px-2 py-1.5 text-sm rounded ${
                editMode === 'add-vertex'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
              title="Click edge to add vertex"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleModeChange('delete-vertex')}
              className={`px-2 py-1.5 text-sm rounded ${
                editMode === 'delete-vertex'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
              title="Click vertex to delete"
              disabled={selectedPoly && selectedPoly.points.length <= 3}
            >
              <Minus className="w-4 h-4" />
            </button>
            <div className="w-px bg-gray-300 dark:bg-gray-600 mx-1" />
            <button
              onClick={() => handleModeChange('fingerhole')}
              className={`px-3 py-1.5 text-sm rounded ${
                editMode === 'fingerhole'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
              title="Click to add finger holes"
            >
              Finger holes
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              className="p-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={!canRedo}
              className="p-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>

            {selected && (
              <>
                <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
                <button
                  onClick={() => handleDeletePolygon(selected)}
                  className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded flex items-center gap-1"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete shape
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {editable && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {editMode === 'select' && !selected && 'Click a shape to select it'}
          {editMode === 'select' && selected && 'Drag vertices to adjust, or choose an edit mode above'}
          {editMode === 'vertex' && 'Drag vertices to adjust the outline'}
          {editMode === 'add-vertex' && 'Click on an edge (green dots) to add a new vertex'}
          {editMode === 'delete-vertex' && 'Click a vertex to remove it'}
          {editMode === 'fingerhole' && selected && 'Click inside the shape to add a finger hole'}
          {editMode === 'fingerhole' && !selected && 'Select a shape first, then click to add holes'}
        </div>
      )}
    </div>
  )
}
