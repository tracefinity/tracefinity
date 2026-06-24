'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ZOOM_FACTOR } from '@/lib/constants'
import type { Point } from '@/types'

interface Props {
  imageUrl: string
  corners: Point[]
  onCornersChange: (corners: Point[]) => void
}

const HANDLE_RADIUS = 12
const HANDLE_HIT_RADIUS = 24

type DragState =
  | { type: 'corner'; index: number }
  | { type: 'pan'; startClientX: number; startClientY: number; origPanX: number; origPanY: number }
  | null

export function PaperCornerEditor({ imageUrl, corners, onCornersChange }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draftCornersRef = useRef<Point[] | null>(null)
  const pendingPointRef = useRef<Point | null>(null)
  const rafRef = useRef<number | null>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [fitted, setFitted] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<DragState>(null)
  const [draftCorners, setDraftCorners] = useState<Point[] | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])
  const displayCorners = draftCorners ?? corners

  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageSize({ width: img.width, height: img.height })

      if (corners.length === 0) {
        const margin = Math.min(img.width, img.height) * 0.1
        onCornersChange([
          { x: margin, y: margin },
          { x: img.width - margin, y: margin },
          { x: img.width - margin, y: img.height - margin },
          { x: margin, y: img.height - margin },
        ])
      }
    }
    img.src = imageUrl
    return () => { cancelled = true }
  }, [imageUrl])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  // fit container to available space while preserving aspect ratio
  useEffect(() => {
    function updateSize() {
      if (!wrapperRef.current || !imageSize.width || !imageSize.height) return
      const availW = wrapperRef.current.clientWidth
      const availH = wrapperRef.current.clientHeight
      const imgAspect = imageSize.width / imageSize.height
      let w = availW
      let h = w / imgAspect
      if (h > availH) {
        h = availH
        w = h * imgAspect
      }
      setFitted({ width: Math.floor(w), height: Math.floor(h) })
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [imageSize])

  const displayScale = imageSize.width > 0 && fitted.width > 0 ? fitted.width / imageSize.width : 1

  // convert client coords to image-space coords, accounting for zoom and pan
  const getScaledPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 }

      // getBoundingClientRect reflects the CSS transform, giving us
      // the actual on-screen position and size of the scaled container
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

  const startDrag = useCallback((index: number) => {
    draftCornersRef.current = corners
    setDraftCorners(corners)
    setDragging({ type: 'corner', index })
  }, [corners])

  const handleMouseDown = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startDrag(index)
  }

  const handleTouchStart = (index: number) => (e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startDrag(index)
  }

  const queueDraftCorner = useCallback(
    (index: number, point: Point) => {
      pendingPointRef.current = point
      if (rafRef.current !== null) return

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const pending = pendingPointRef.current
        pendingPointRef.current = null
        if (!pending) return

        setDraftCorners((current) => {
          const base = current ?? draftCornersRef.current ?? corners
          const updated = [...base]
          updated[index] = pending
          draftCornersRef.current = updated
          return updated
        })
      })
    },
    [corners]
  )

  const updateDrag = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragging || dragging.type !== 'corner') return
      const point = getScaledPoint(clientX, clientY)
      queueDraftCorner(dragging.index, point)
    },
    [dragging, getScaledPoint, queueDraftCorner]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return
      if (dragging.type === 'pan') {
        const dx = e.clientX - dragging.startClientX
        const dy = e.clientY - dragging.startClientY
        // pan is in image-pixel units; convert screen pixels by dividing
        // by the combined displayScale * zoom
        const pixPerImg = displayScale * zoomRef.current
        setPan({ x: dragging.origPanX - dx / pixPerImg, y: dragging.origPanY - dy / pixPerImg })
        return
      }
      updateDrag(e.clientX, e.clientY)
    },
    [dragging, updateDrag, displayScale]
  )

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!dragging || dragging.type !== 'corner') return
      e.preventDefault()
      const t = e.touches[0]
      if (!t) return
      updateDrag(t.clientX, t.clientY)
    },
    [dragging, updateDrag]
  )

  const finishDrag = useCallback(() => {
    if (!dragging) return
    if (dragging.type === 'pan') {
      setDragging(null)
      return
    }
    if (dragging.type !== 'corner') return
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const pending = pendingPointRef.current
    pendingPointRef.current = null
    let finalCorners = draftCornersRef.current ?? corners
    if (pending) {
      finalCorners = [...finalCorners]
      finalCorners[dragging.index] = pending
    }

    draftCornersRef.current = null
    setDraftCorners(null)
    setDragging(null)
    onCornersChange(finalCorners)
  }, [corners, dragging, onCornersChange])

  const handleMouseUp = useCallback(() => {
    finishDrag()
  }, [finishDrag])

  const handleTouchEnd = useCallback(() => {
    finishDrag()
  }, [finishDrag])

  useEffect(() => {
    if (dragging !== null) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMove, { passive: false })
      window.addEventListener('touchend', handleTouchEnd)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('touchmove', handleTouchMove)
        window.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd])

  // scroll-to-zoom with cursor-aware panning
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const oldZoom = zoomRef.current
      const newZoom = Math.min(20, Math.max(0.5, oldZoom * factor))
      if (newZoom === oldZoom) return

      if (!containerRef.current) {
        setZoom(newZoom)
        return
      }

      const rect = containerRef.current.getBoundingClientRect()
      const curPan = panRef.current

      // image-pixel coord under cursor (rect already reflects CSS transform)
      const imgX = (e.clientX - rect.left) * (imageSize.width / rect.width)
      const imgY = (e.clientY - rect.top) * (imageSize.height / rect.height)

      // keep the point under cursor fixed across zoom change.
      // derived from the CSS transform chain (see comment above getScaledPoint).
      const halfW = imageSize.width / 2
      const halfH = imageSize.height / 2
      const ratio = 1 / newZoom - 1 / oldZoom
      setPan({
        x: curPan.x + (imgX - halfW) * ratio,
        y: curPan.y + (imgY - halfH) * ratio,
      })
      setZoom(newZoom)
    }
    wrapper.addEventListener('wheel', handleWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', handleWheel)
  }, [displayScale, imageSize])

  // background mousedown on wrapper = pan
  const handleWrapperMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    // only start pan if the click target is the wrapper itself or the image
    // (not a handle, which calls stopPropagation)
    e.preventDefault()
    setDragging({
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
    })
  }

  const handleResetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  if (!imageSize.width || !fitted.width) {
    return (
      <div ref={wrapperRef} className="w-full h-full">
        <div className="bg-inset rounded-lg aspect-[4/3]" />
      </div>
    )
  }

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full flex items-center justify-center relative overflow-hidden"
      style={{ cursor: dragging?.type === 'pan' ? 'grabbing' : zoom > 1 ? 'grab' : 'default' }}
      onMouseDown={handleWrapperMouseDown}
    >
      <div
        ref={containerRef}
        className="relative bg-inset rounded-lg overflow-visible"
        style={{
          width: fitted.width,
          height: fitted.height,
          transform: `scale(${zoom}) translate(${-pan.x * displayScale}px, ${-pan.y * displayScale}px)`,
          transformOrigin: 'center center',
        }}
      >
        <img
          src={imageUrl}
          alt="Uploaded"
          className="w-full h-full"
          draggable={false}
        />

        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {displayCorners.length === 4 && (
            <polygon
              points={displayCorners
                .map((c) => `${c.x * displayScale},${c.y * displayScale}`)
                .join(' ')}
              fill="rgba(90, 180, 222, 0.1)"
              stroke="rgb(90, 180, 222)"
              strokeWidth={2 / zoom}
            />
          )}

          {displayCorners.map((corner, index) => (
            <g key={index}>
              <circle
                cx={corner.x * displayScale}
                cy={corner.y * displayScale}
                r={HANDLE_HIT_RADIUS / zoom}
                fill="transparent"
                className="pointer-events-auto cursor-move touch-none"
                onMouseDown={handleMouseDown(index)}
                onTouchStart={handleTouchStart(index)}
              />
              <circle
                cx={corner.x * displayScale}
                cy={corner.y * displayScale}
                r={HANDLE_RADIUS / zoom}
                fill="#27272a"
                stroke="rgb(90, 180, 222)"
                strokeWidth={2 / zoom}
                className="pointer-events-none"
              />
            </g>
          ))}
        </svg>
      </div>

      {/* zoom controls */}
      <div className="absolute bottom-3.5 right-3.5 z-20 glass-toolbar px-1 py-0.5 flex items-center gap-0.5 text-[11px]" onMouseDown={e => e.stopPropagation()}>
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
