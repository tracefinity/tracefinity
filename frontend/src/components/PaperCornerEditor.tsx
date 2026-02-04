'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Point } from '@/types'

interface Props {
  imageUrl: string
  corners: Point[]
  onCornersChange: (corners: Point[]) => void
}

const HANDLE_RADIUS = 12

export function PaperCornerEditor({ imageUrl, corners, onCornersChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [containerWidth, setContainerWidth] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
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
  }, [imageUrl])

  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [imageSize])

  const displayScale = imageSize.width > 0 ? containerWidth / imageSize.width : 1

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

  const handleMouseDown = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(index)
  }

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (dragging === null) return

      const point = getScaledPoint(e.clientX, e.clientY)
      const updated = [...corners]
      updated[dragging] = point
      onCornersChange(updated)
    },
    [dragging, corners, getScaledPoint, onCornersChange]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  useEffect(() => {
    if (dragging !== null) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [dragging, handleMouseMove, handleMouseUp])

  if (!imageSize.width || !containerWidth) {
    return (
      <div
        ref={containerRef}
        className="bg-gray-100 rounded-lg aspect-[4/3]"
      />
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative bg-gray-100 rounded-lg overflow-hidden"
      style={{ aspectRatio: `${imageSize.width} / ${imageSize.height}` }}
    >
      <img
        src={imageUrl}
        alt="Uploaded"
        className="w-full h-full object-contain"
        draggable={false}
      />

      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {corners.length === 4 && (
          <polygon
            points={corners
              .map((c) => `${c.x * displayScale},${c.y * displayScale}`)
              .join(' ')}
            fill="rgba(59, 130, 246, 0.1)"
            stroke="rgb(59, 130, 246)"
            strokeWidth={2}
          />
        )}

        {corners.map((corner, index) => (
          <circle
            key={index}
            cx={corner.x * displayScale}
            cy={corner.y * displayScale}
            r={HANDLE_RADIUS}
            fill="white"
            stroke="rgb(59, 130, 246)"
            strokeWidth={2}
            className="pointer-events-auto cursor-move"
            onMouseDown={handleMouseDown(index)}
          />
        ))}
      </svg>
    </div>
  )
}
