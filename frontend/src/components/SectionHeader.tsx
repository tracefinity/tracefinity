'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpDown, ChevronDown, ChevronRight, Search } from 'lucide-react'

export function SectionHeader({ title, count, search, onSearchChange, sortKey, onSortChange, collapsed, onToggleCollapsed, children }: {
  title: string
  count?: number
  search?: string
  onSearchChange?: (v: string) => void
  sortKey?: string
  onSortChange?: (v: string) => void
  collapsed?: boolean
  onToggleCollapsed?: () => void
  children?: ReactNode
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

  return (
    <div className="flex items-center justify-between mb-3 gap-2">
      {onToggleCollapsed ? (
        <button
          onClick={onToggleCollapsed}
          className="flex items-center gap-1.5 flex-shrink-0 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <h3 className="text-[10px] font-semibold uppercase tracking-[1.5px]">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="text-[10px] text-text-muted bg-elevated px-1.5 py-px rounded-full tracking-normal">{count}</span>
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-[1.5px]">{title}</h3>
          {count !== undefined && count > 0 && (
            <span className="text-[10px] text-text-muted bg-elevated px-1.5 py-px rounded-full">{count}</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        {onSearchChange && (
          searchOpen ? (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted" />
              <input
                ref={searchRef}
                type="text"
                value={search || ''}
                onChange={e => onSearchChange(e.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false) }}
                onKeyDown={e => { if (e.key === 'Escape') { onSearchChange(''); setSearchOpen(false) } }}
                placeholder="Filter..."
                className="w-36 pl-6 pr-2 py-1 text-[11px] bg-elevated border border-border-subtle rounded-[7px] text-text-primary outline-none focus:border-accent"
              />
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="glass-sm rounded-[7px] px-2.5 py-1 text-[11px] text-text-secondary flex items-center gap-1.5 hover:bg-glass-hover transition-colors cursor-pointer"
            >
              <Search className="w-3 h-3" />
              Search
            </button>
          )
        )}
        {onSortChange && (
          <button
            onClick={() => onSortChange(sortKey === 'name' ? 'date' : 'name')}
            className="glass-sm rounded-[7px] px-2.5 py-1 text-[11px] text-text-secondary flex items-center gap-1.5 hover:bg-glass-hover transition-colors cursor-pointer"
          >
            <ArrowUpDown className="w-3 h-3" />
            {sortKey === 'name' ? 'A-Z' : 'Recent'}
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
