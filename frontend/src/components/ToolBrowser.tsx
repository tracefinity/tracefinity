'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Loader2, Search } from 'lucide-react'
import { getProject, listTools } from '@/lib/api'
import type { BinProject, ToolSummary, PlacedTool, Point } from '@/types'
import { getTool } from '@/lib/api'
import { polygonPathData } from '@/lib/svg'

interface Props {
  onAddTool: (tool: PlacedTool) => void
  binWidthMm: number
  binHeightMm: number
  layout?: 'grid' | 'horizontal'
  projectId?: string | null
  currentToolIds?: string[]
}

function ToolThumbnail({ points, interiorRings }: { points: Point[]; interiorRings?: Point[][] }) {
  if (points.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const w = maxX - minX
  const h = maxY - minY
  const pad = Math.max(w, h) * 0.1
  const vx = minX - pad
  const vy = minY - pad
  const vw = w + pad * 2
  const vh = h + pad * 2

  const pathData = polygonPathData(points, interiorRings)

  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <path
        d={pathData}
        fillRule="evenodd"
        fill="var(--color-tool-fill)"
        stroke="var(--color-tool-stroke)"
        strokeWidth={Math.max(vw, vh) * 0.015}
      />
    </svg>
  )
}

export function ToolBrowser({ onAddTool, binWidthMm, binHeightMm, layout = 'grid', projectId, currentToolIds = [] }: Props) {
  const [tools, setTools] = useState<ToolSummary[]>([])
  const [project, setProject] = useState<BinProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showPlaced, setShowPlaced] = useState(false)

  const projectToolIds = useMemo(() => new Set(project?.tool_ids || []), [project])
  const placedToolIds = useMemo(() => {
    return new Set([...(project?.placed_tool_ids || []), ...currentToolIds])
  }, [project, currentToolIds])

  const visibleTools = useMemo(() => {
    let list = projectId ? tools.filter(tool => projectToolIds.has(tool.id)) : tools
    if (projectId && !showPlaced) list = list.filter(tool => !placedToolIds.has(tool.id))
    return list
  }, [tools, projectId, projectToolIds, placedToolIds, showPlaced])

  const filtered = useMemo(() => {
    if (!search.trim()) return visibleTools
    const q = search.toLowerCase()
    return visibleTools.filter(t => t.name.toLowerCase().includes(q))
  }, [visibleTools, search])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      listTools(),
      projectId ? getProject(projectId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([toolList, projectData]) => {
        setTools(toolList)
        setProject(projectData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [projectId])

  async function handleAdd(toolSummary: ToolSummary) {
    setAdding(toolSummary.id)
    try {
      const tool = await getTool(toolSummary.id)
      const pts = tool.points

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of pts) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      const toolCx = (minX + maxX) / 2
      const toolCy = (minY + maxY) / 2
      const binCx = binWidthMm / 2
      const binCy = binHeightMm / 2
      const dx = binCx - toolCx
      const dy = binCy - toolCy

      const placed: PlacedTool = {
        id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool_id: tool.id,
        name: tool.name,
        points: pts.map(p => ({ x: p.x + dx, y: p.y + dy })),
        finger_holes: tool.finger_holes.map(fh => ({ ...fh, x: fh.x + dx, y: fh.y + dy })),
        interior_rings: (tool.interior_rings ?? []).map(ring =>
          ring.map(p => ({ x: p.x + dx, y: p.y + dy }))
        ),
        rotation: 0,
      }
      onAddTool(placed)
    } catch {
      // ignore
    } finally {
      setAdding(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-xs py-4 justify-center">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading tools...
      </div>
    )
  }

  if (tools.length === 0) {
    return (
      <p className="text-xs text-text-muted py-4 text-center">
        No tools in library yet. Upload and trace tools first.
      </p>
    )
  }

  if (layout === 'horizontal') {
    return (
      <div className="space-y-1.5">
        {/* header with label + inline filter */}
        <div className="flex items-center gap-2">
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px]">Library</h3>
          <span className="text-[10px] text-text-muted bg-elevated px-1.5 py-px rounded-full">{visibleTools.length}</span>
          {projectId && (
            <button
              onClick={() => setShowPlaced(prev => !prev)}
              className="text-[10px] text-text-secondary glass-sm rounded-[7px] px-1.5 py-px hover:bg-glass-hover transition-colors cursor-pointer"
              title="Show project tools already placed in bins."
            >
              {showPlaced ? 'Hide placed' : 'Show placed'}
            </button>
          )}
          {tools.length > 4 && (
            <div className="relative ml-auto">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter..."
                className="w-24 pl-6 pr-2 py-1 text-[10px] bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent focus:w-36 transition-all"
              />
            </div>
          )}
        </div>
        {/* scrollable card strip */}
        <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
          {filtered.map(tool => (
            <button
              key={tool.id}
              onClick={() => handleAdd(tool)}
              disabled={adding === tool.id}
              className="group flex-shrink-0 w-[90px] glass-sm rounded-[8px] overflow-hidden text-left transition-all duration-150 hover:bg-glass-hover cursor-pointer"
            >
              <div className="h-[52px] p-1.5 flex items-center justify-center bg-inset/30 relative">
                {adding === tool.id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                ) : (
                  <>
                    <ToolThumbnail points={tool.points} interiorRings={tool.interior_rings} />
                    {projectId && placedToolIds.has(tool.id) && (
                      <span className="absolute top-1 left-1 rounded-[7px] bg-accent-muted px-1 py-px text-[9px] text-accent">Placed</span>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                      <Plus className="w-4 h-4 text-white" />
                    </div>
                  </>
                )}
              </div>
              <div className="px-1.5 py-1">
                <span className="text-[10px] text-text-secondary truncate block">{tool.name}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && search && (
            <span className="text-[10px] text-text-muted py-2 flex-shrink-0">No matches</span>
          )}
          {filtered.length === 0 && !search && projectId && (
            <span className="text-[10px] text-text-muted py-2 flex-shrink-0">No unplaced project tools</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {tools.length > 6 && (
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter tools..."
            className="w-full pl-6 pr-2 py-1.5 text-xs bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
      {filtered.map(tool => (
        <button
          key={tool.id}
          onClick={() => handleAdd(tool)}
          disabled={adding === tool.id}
          className="group relative bg-elevated hover:bg-border rounded-[8px] overflow-hidden text-left transition-colors cursor-pointer"
        >
          <div className="aspect-square p-2 flex items-center justify-center bg-inset/50">
            {adding === tool.id ? (
              <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
            ) : (
              <>
                <ToolThumbnail points={tool.points} interiorRings={tool.interior_rings} />
                {projectId && placedToolIds.has(tool.id) && (
                  <span className="absolute top-1 left-1 rounded-[7px] bg-accent-muted px-1 py-px text-[9px] text-accent">Placed</span>
                )}
              </>
            )}
          </div>
          <div className="px-1.5 py-1 flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-secondary truncate">{tool.name}</span>
            <Plus className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity" />
          </div>
        </button>
      ))}
      {filtered.length === 0 && search && (
        <p className="text-xs text-text-muted py-2 text-center col-span-2">No matches</p>
      )}
      </div>
    </div>
  )
}
