'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Check, Download } from 'lucide-react'
import Link from 'next/link'
import { getTool, updateTool, getToolSvgUrl } from '@/lib/api'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import { ToolEditor } from '@/components/ToolEditor'
import { Alert } from '@/components/Alert'
import { Breadcrumb } from '@/components/Breadcrumb'
import type { Tool, Point, FingerHole } from '@/types'

export default function ToolPage() {
  const params = useParams()
  const toolId = params.id as string

  const [tool, setTool] = useState<Tool | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    async function load() {
      try {
        const t = await getTool(toolId)
        setTool(t)
        setName(t.name)
      } catch {
        setError('Tool not found')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [toolId])

  const { saving, saved } = useDebouncedSave(
    async () => {
      if (!tool) return
      await updateTool(toolId, { name, points: tool.points, finger_holes: tool.finger_holes, interior_rings: tool.interior_rings, smoothed: tool.smoothed, smooth_level: tool.smooth_level })
    },
    [tool, name, toolId],
    150,
    { skipInitial: true }
  )

  const handlePointsChange = useCallback((points: Point[]) => {
    setTool(prev => prev ? { ...prev, points } : null)
  }, [])

  const handleFingerHolesChange = useCallback((finger_holes: FingerHole[]) => {
    setTool(prev => prev ? { ...prev, finger_holes } : null)
  }, [])

  const handleSmoothedChange = useCallback((smoothed: boolean) => {
    setTool(prev => prev ? { ...prev, smoothed } : null)
  }, [])

  const handleSmoothLevelChange = useCallback((smooth_level: number) => {
    setTool(prev => prev ? { ...prev, smooth_level } : null)
  }, [])

  const handleInteriorRingsChange = useCallback((interior_rings: Point[][]) => {
    setTool(prev => prev ? { ...prev, interior_rings } : null)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading tool...</span>
      </div>
    )
  }

  if (error || !tool) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Alert variant="error">{error || 'Tool not found'}</Alert>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-44px)] relative overflow-hidden">
      {/* floating breadcrumb panel */}
      <div className="absolute top-3.5 left-3.5 z-20 glass-toolbar px-3 py-1.5 flex items-center gap-3">
        <Breadcrumb segments={[
          { label: 'Tools', href: '/' },
          { label: name || 'Untitled', editable: true, onEdit: (v) => setName(v) },
        ]} />
        <div className="flex items-center gap-1 text-[11px] text-text-muted">
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {saved && <Check className="w-3 h-3 text-green-400" />}
          {saving ? 'Saving...' : saved ? 'Saved' : ''}
        </div>
        <a
          href={getToolSvgUrl(toolId)}
          download
          className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-accent-muted text-accent hover:bg-accent-muted/80 transition-colors inline-flex items-center gap-1.5"
        >
          <Download className="w-3 h-3" />
          Export SVG
        </a>
      </div>

      {/* editor fills the entire area */}
      <ToolEditor
        points={tool.points}
        fingerHoles={tool.finger_holes}
        interiorRings={tool.interior_rings}
        smoothed={tool.smoothed}
        smoothLevel={tool.smooth_level}
        onPointsChange={handlePointsChange}
        onFingerHolesChange={handleFingerHolesChange}
        onSmoothedChange={handleSmoothedChange}
        onSmoothLevelChange={handleSmoothLevelChange}
        onInteriorRingsChange={handleInteriorRingsChange}
      />
    </div>
  )
}
