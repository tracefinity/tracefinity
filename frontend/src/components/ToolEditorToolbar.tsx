'use client'

import { ReactNode } from 'react'
import { MousePointer2, Plus, Minus, Undo2, Redo2, Trash2, Circle, Disc, Square, RectangleHorizontal, Fingerprint, Magnet, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, ChevronDown, PaintBucket } from 'lucide-react'
import type { FingerHole } from '@/types'
import { SNAP_GRID } from '@/lib/constants'

export type EditMode = 'select' | 'add-vertex' | 'delete-vertex' | 'finger-hole' | 'circle' | 'cylinder' | 'square' | 'rectangle' | 'fill-ring'

export type Selection =
  | { type: 'vertex'; pointIdx: number }
  | { type: 'hole'; holeId: string }
  | null

interface Props {
  editMode: EditMode
  setEditMode: (mode: EditMode) => void
  smoothed: boolean
  smoothLevel: number
  onSmoothedChange: (smoothed: boolean) => void
  onSmoothLevelChange: (level: number) => void
  snapEnabled: boolean
  setSnapEnabled: (enabled: boolean) => void
  canUndo: boolean
  canRedo: boolean
  handleUndo: () => void
  handleRedo: () => void
  cutoutOpen: boolean
  setCutoutOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  isCutoutMode: boolean
  cutoutModeIcon: ReactNode
  cutoutModeLabel: string
  selection: Selection
  selectedHole: FingerHole | null | undefined
  handleDeleteHole: () => void
  displayPointsCount: number
  rotateAll: (angleDeg: number) => void
  flipAll: (axis: 'horizontal' | 'vertical') => void
  hasInteriorRings: boolean
}

export function ToolEditorToolbar({
  editMode, setEditMode,
  smoothed, smoothLevel, onSmoothedChange, onSmoothLevelChange,
  snapEnabled, setSnapEnabled,
  canUndo, canRedo, handleUndo, handleRedo,
  cutoutOpen, setCutoutOpen,
  isCutoutMode, cutoutModeIcon, cutoutModeLabel,
  selection, selectedHole, handleDeleteHole,
  displayPointsCount, rotateAll, flipAll, hasInteriorRings,
}: Props) {
  return (
    <>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* mode selector */}
        <div className="flex rounded-[7px] p-0.5">
          <button
            onClick={() => setEditMode('select')}
            className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              editMode === 'select' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title="Select and drag vertices / cutouts"
          >
            <MousePointer2 className="w-4 h-4" />
            Select
          </button>
          <button
            onClick={() => setEditMode('add-vertex')}
            className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              smoothed ? 'opacity-30 cursor-not-allowed text-text-muted' : editMode === 'add-vertex' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title={smoothed ? 'Switch to Accurate mode to add points' : 'Add vertex on edge'}
            disabled={smoothed}
          >
            <Plus className="w-4 h-4" />
            Add point
          </button>
          <button
            onClick={() => setEditMode('delete-vertex')}
            className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
              smoothed || displayPointsCount <= 3 ? 'opacity-30 cursor-not-allowed text-text-muted' : editMode === 'delete-vertex' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
            }`}
            title={smoothed ? 'Switch to Accurate mode to remove points' : 'Delete vertex'}
            disabled={smoothed || displayPointsCount <= 3}
          >
            <Minus className="w-4 h-4" />
            Remove
          </button>
          <div className="relative">
            <button
              onClick={() => setCutoutOpen(prev => !prev)}
              className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                isCutoutMode ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
              }`}
            >
              {cutoutModeIcon}
              <span>{cutoutModeLabel}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {cutoutOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCutoutOpen(false)} />
                <div className="absolute top-full left-0 mt-1 bg-elevated border border-border rounded-lg shadow-lg z-20 py-1 min-w-[160px]">
                  {([
                    { mode: 'finger-hole' as EditMode, icon: <Fingerprint className="w-4 h-4" />, label: 'Finger hole', size: '15mm' },
                    { mode: 'circle' as EditMode, icon: <Circle className="w-4 h-4" />, label: 'Circle (sphere)', size: '10mm' },
                    { mode: 'cylinder' as EditMode, icon: <Disc className="w-4 h-4" />, label: 'Cylinder (flat)', size: '10mm' },
                    { mode: 'square' as EditMode, icon: <Square className="w-4 h-4" />, label: 'Square', size: '20mm' },
                    { mode: 'rectangle' as EditMode, icon: <RectangleHorizontal className="w-4 h-4" />, label: 'Rectangle', size: '30x20mm' },
                  ]).map(item => (
                    <button
                      key={item.mode}
                      onClick={() => { setEditMode(item.mode); setCutoutOpen(false) }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-border ${
                        editMode === item.mode ? 'text-accent' : 'text-text-primary'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                      <span className="text-text-muted text-xs ml-auto">{item.size}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {hasInteriorRings && (
            <button
              onClick={() => setEditMode('fill-ring')}
              className={`px-2.5 py-1 rounded-[7px] text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                editMode === 'fill-ring' ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
              }`}
              title="Fill in interior holes"
            >
              <PaintBucket className="w-4 h-4" />
              Fill in
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        {/* utility actions */}
        <div className="flex items-center gap-0.5 text-text-muted">
          <button
            onClick={() => rotateAll(-90)}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Rotate 90 counter-clockwise"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => rotateAll(90)}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Rotate 90 clockwise"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => flipAll('horizontal')}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Flip horizontally"
          >
            <FlipHorizontal2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => flipAll('vertical')}
            className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary"
            title="Flip vertically"
          >
            <FlipVertical2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          className={`px-2 py-1 rounded-[7px] text-[11px] flex items-center gap-1 transition-colors ${
            snapEnabled ? 'bg-accent-muted text-accent' : 'hover:bg-border/50 text-text-secondary'
          }`}
          title={`Snap to ${SNAP_GRID}mm grid${snapEnabled ? ' (on)' : ' (off)'}`}
        >
          <Magnet className="w-3.5 h-3.5" />
          Snap
        </button>
        <div className="flex items-center rounded-[7px] overflow-hidden border border-border-subtle text-[11px]">
          <button
            onClick={() => onSmoothedChange(false)}
            className={`px-2 py-1 transition-colors ${!smoothed ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            Accurate
          </button>
          <button
            onClick={() => { onSmoothedChange(true); if (editMode === 'add-vertex' || editMode === 'delete-vertex') setEditMode('select') }}
            className={`px-2 py-1 transition-colors ${smoothed ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            Smooth
          </button>
        </div>
        {smoothed && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={smoothLevel}
            onChange={e => onSmoothLevelChange(parseFloat(e.target.value))}
            className="w-16 h-1 accent-accent"
            title={`Smooth level: ${Math.round(smoothLevel * 100)}%`}
          />
        )}

        <div className="h-4 w-px bg-border-subtle mx-0.5" />

        <button
          onClick={handleUndo}
          disabled={!canUndo}
          className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleRedo}
          disabled={!canRedo}
          className="p-1 rounded-[7px] hover:bg-border/50 hover:text-text-secondary disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>

        {selection?.type === 'hole' && (
          <>
            <div className="h-4 w-px bg-border-subtle mx-0.5" />
            <button
              onClick={handleDeleteHole}
              className="px-2 py-1 text-[11px] font-medium text-white bg-red-700 hover:bg-red-600 rounded-[7px] flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </>
        )}
      </div>

    </>
  )
}
