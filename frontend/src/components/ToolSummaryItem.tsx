'use client'

import { Wrench } from 'lucide-react'
import { getImageUrl } from '@/lib/api'
import type { ToolSummary } from '@/types'
import type { ReactNode } from 'react'

type ThumbnailSize = 'xs' | 'sm' | 'md'

const thumbnailClasses: Record<ThumbnailSize, string> = {
  xs: 'w-7 h-7 rounded-[8px]',
  sm: 'w-8 h-8 rounded-[8px]',
  md: 'w-14 h-14 rounded-[8px]',
}

const iconClasses: Record<ThumbnailSize, string> = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
}

export function ToolSummaryItem({ tool, size = 'md', showPoints = true, className = '', children }: {
  tool: ToolSummary
  size?: ThumbnailSize
  showPoints?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <span className={`min-w-0 flex items-center gap-2 ${className}`}>
      <span className={`${thumbnailClasses[size]} bg-inset flex items-center justify-center overflow-hidden flex-shrink-0`}>
        {tool.thumbnail_url ? (
          <img src={getImageUrl(tool.thumbnail_url)} alt="" className="w-full h-full object-contain p-0.5" />
        ) : (
          <Wrench className={`${iconClasses[size]} text-text-muted`} />
        )}
      </span>
      <span className="min-w-0">
        <span className={`${size === 'xs' ? 'text-[10px] text-text-secondary' : size === 'sm' ? 'text-[11px]' : 'text-xs'} block text-text-primary truncate`}>
          {tool.name}
        </span>
        {showPoints && size !== 'xs' && (
          <span className="block text-[10px] text-text-muted">{tool.point_count} points</span>
        )}
        {children}
      </span>
    </span>
  )
}

export function ToolSummaryButton({ tool, onClick, size = 'sm', className = '' }: {
  tool: ToolSummary
  onClick: () => void
  size?: ThumbnailSize
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 text-left rounded-[7px] hover:bg-glass-hover transition-colors cursor-pointer ${size === 'sm' ? 'h-9' : 'h-8'} ${className}`}
    >
      <ToolSummaryItem tool={tool} size={size} showPoints={size !== 'xs'} />
    </button>
  )
}
