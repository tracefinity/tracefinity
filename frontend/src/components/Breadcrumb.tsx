'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export interface BreadcrumbSegment {
  label: string
  href?: string
  editable?: boolean
  onEdit?: (value: string) => void
}

interface Props {
  segments: BreadcrumbSegment[]
}

function EditableSegment({ label, onEdit }: { label: string; onEdit: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(label) }, [label])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed && trimmed !== label) onEdit(trimmed)
    else setValue(label)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setValue(label); setEditing(false) }
        }}
        className="text-sm font-semibold text-text-primary bg-transparent border-none outline-none min-w-[60px] max-w-[200px]"
        style={{ width: `${Math.max(60, value.length * 8)}px` }}
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-sm font-semibold text-text-primary hover:text-accent transition-colors cursor-text truncate max-w-[200px]"
      title="Click to rename"
    >
      {label}
    </button>
  )
}

export function Breadcrumb({ segments }: Props) {
  return (
    <nav className="flex items-center gap-1 min-w-0" aria-label="Breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1

        return (
          <div key={i} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />}
            {seg.editable && seg.onEdit ? (
              <EditableSegment label={seg.label} onEdit={seg.onEdit} />
            ) : seg.href ? (
              <Link
                href={seg.href}
                className={`text-sm transition-colors truncate ${
                  isLast ? 'font-semibold text-text-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {seg.label}
              </Link>
            ) : (
              <span className={`text-sm truncate ${isLast ? 'font-semibold text-text-primary' : 'text-text-muted'}`}>
                {seg.label}
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
