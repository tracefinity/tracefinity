'use client'

import { MousePointer2, Trash2, Magnet, Type, Pencil, Maximize2 } from 'lucide-react'
import type { PlacedTool, TextLabel } from '@/types'
import { SNAP_GRID } from '@/lib/constants'

type Tool = 'select' | 'text'

interface Props {
  activeTool: Tool
  setActiveTool: (tool: Tool) => void
  snapEnabled: boolean
  setSnapEnabled: (enabled: boolean) => void
  handleRecenter: () => void
  selectedTool: PlacedTool | null
  selectedLabel: TextLabel | null
  onEditTool?: (toolId: string) => void
  onRemoveTool: () => void
  onRemoveLabel: () => void
  smoothedToolIds?: Set<string>
  smoothLevels?: Map<string, number>
  onToggleSmoothed?: (toolId: string, smoothed: boolean) => void
  onSmoothLevelChange?: (toolId: string, level: number) => void
  onUpdateLabel: (updates: Partial<TextLabel>) => void
}

const tbBtn = 'flex items-center gap-1.5 px-2.5 py-1.5 rounded-[7px] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap'
const tbActive = 'bg-accent-muted text-accent'
const tbInactive = 'text-text-muted hover:text-text-secondary hover:bg-[rgba(255,255,255,0.03)]'

export function BinEditorToolbar({
  activeTool,
  setActiveTool,
  snapEnabled,
  setSnapEnabled,
  handleRecenter,
  selectedTool,
  selectedLabel,
  onEditTool,
  onRemoveTool,
  onRemoveLabel,
  smoothedToolIds,
  smoothLevels,
  onToggleSmoothed,
  onSmoothLevelChange,
  onUpdateLabel,
}: Props) {
  return (
    <>
      <button
        onClick={() => setActiveTool('select')}
        className={`${tbBtn} ${activeTool === 'select' ? tbActive : tbInactive}`}
        title="Select & move tools"
      >
        <MousePointer2 className="w-3.5 h-3.5" />
        Select
      </button>
      <button
        onClick={() => setActiveTool('text')}
        className={`${tbBtn} ${activeTool === 'text' ? tbActive : tbInactive}`}
        title="Place text label"
      >
        <Type className="w-3.5 h-3.5" />
        Text
      </button>

      <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />

      <button
        onClick={() => setSnapEnabled(!snapEnabled)}
        className={`${tbBtn} ${snapEnabled ? 'text-accent' : tbInactive}`}
        title={`Snap to ${SNAP_GRID}mm grid${snapEnabled ? ' (on)' : ' (off)'}`}
      >
        <Magnet className="w-3.5 h-3.5" />
        Snap
      </button>
      <button
        onClick={handleRecenter}
        className={`${tbBtn} ${tbInactive}`}
        title="Recenter view"
      >
        <Maximize2 className="w-3.5 h-3.5" />
        Recenter
      </button>

      {selectedTool && (
        <>
          <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />
          {onToggleSmoothed && (
            <div className="flex items-center rounded-[6px] overflow-hidden border border-glass-border">
              <button
                onClick={() => onToggleSmoothed(selectedTool.tool_id, false)}
                className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${!smoothedToolIds?.has(selectedTool.tool_id) ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                Accurate
              </button>
              <button
                onClick={() => onToggleSmoothed(selectedTool.tool_id, true)}
                className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${smoothedToolIds?.has(selectedTool.tool_id) ? 'bg-accent text-white' : 'text-text-muted hover:text-text-secondary'}`}
              >
                Smooth
              </button>
            </div>
          )}
          {smoothedToolIds?.has(selectedTool.tool_id) && onSmoothLevelChange && (
            <input
              type="range" min={0} max={1} step={0.05}
              value={smoothLevels?.get(selectedTool.tool_id) ?? 0.5}
              onChange={e => onSmoothLevelChange(selectedTool.tool_id, parseFloat(e.target.value))}
              className="w-16 h-1 accent-accent"
            />
          )}
          {onEditTool && (
            <button
              onClick={() => onEditTool(selectedTool.tool_id)}
              className={`${tbBtn} text-accent`}
            >
              <Pencil className="w-3 h-3" />
              Edit
            </button>
          )}
          <button
            onClick={onRemoveTool}
            className={`${tbBtn} text-red-400 hover:bg-red-900/20`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}

      {selectedLabel && (
        <>
          <div className="w-px h-4 bg-glass-border mx-1 flex-shrink-0" />
          <input
            type="text"
            value={selectedLabel.text}
            onChange={e => onUpdateLabel({ text: e.target.value })}
            className="w-24 px-2 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[11px] outline-none focus:border-accent"
            placeholder="Label text"
          />
          <div className="flex items-center gap-0.5 text-[10px] text-text-muted" title="Text size">
            <span>Size</span>
            <input
              type="number"
              value={selectedLabel.font_size}
              onChange={e => onUpdateLabel({ font_size: Math.max(1, Math.min(50, parseFloat(e.target.value) || 1)) })}
              className="w-10 px-1 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[10px] text-center outline-none focus:border-accent"
              min={1} max={50} step={0.5}
            />
          </div>
          <div className="flex items-center gap-0.5 text-[10px] text-text-muted" title="Depth into surface">
            <span>Depth</span>
            <input
              type="number"
              value={selectedLabel.depth}
              onChange={e => onUpdateLabel({ depth: Math.max(0.1, Math.min(5, parseFloat(e.target.value) || 0.5)) })}
              className="w-10 px-1 py-1 bg-elevated border border-border-subtle rounded-[6px] text-text-primary text-[10px] text-center outline-none focus:border-accent"
              min={0.1} max={5} step={0.1}
            />
          </div>
          <div className="flex items-center rounded-[6px] overflow-hidden border border-glass-border">
            <button
              onClick={() => onUpdateLabel({ emboss: true })}
              className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${
                selectedLabel.emboss ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Emboss
            </button>
            <button
              onClick={() => onUpdateLabel({ emboss: false })}
              className={`px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer ${
                !selectedLabel.emboss ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Recess
            </button>
          </div>
          <button onClick={onRemoveLabel} className={`${tbBtn} text-red-400 hover:bg-red-900/20`}>
            <Trash2 className="w-3 h-3" />
          </button>
        </>
      )}
    </>
  )
}
