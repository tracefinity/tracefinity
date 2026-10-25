'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tags, X } from 'lucide-react'
import { normalizeTags } from '@/lib/toolTags'

export function ToolTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul aria-label="Tags" className="mt-1.5 flex flex-wrap gap-1">
      {tags.map((tag, index) => (
        <li key={`${tag}-${index}`} className="max-w-full break-words rounded bg-inset px-1.5 py-0.5 text-[11px] text-text-secondary">
          {tag}
        </li>
      ))}
    </ul>
  )
}

export function ToolTagsEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('')

  function addTag() {
    if (!draft.trim()) return
    onChange(normalizeTags([...tags, draft]))
    setDraft('')
  }

  return (
    <div>
      <label htmlFor="tool-tag" className="block text-[11px] font-semibold text-text-secondary">Tags</label>
      <div className="mt-1 flex gap-1.5">
        <input
          id="tool-tag"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); addTag() }
            if (event.key === 'Escape') setDraft('')
          }}
          placeholder="e.g. hex keys"
          className="min-w-0 flex-1 rounded-[7px] border border-border-subtle bg-inset px-2 py-1.5 text-xs text-text-primary focus:border-accent outline-none"
        />
        <button type="button" onClick={addTag} disabled={!draft.trim()} className="btn-secondary px-2 text-xs">Add tag</button>
      </div>
      <ul aria-label="Tool tags" className="mt-1.5 flex flex-wrap gap-1">
        {tags.map((tag, index) => (
          <li key={`${tag}-${index}`} className="flex max-w-full items-center rounded bg-inset pl-2 text-xs text-text-secondary">
            <span className="min-w-0 break-words">{tag}</span>
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter((_, position) => position !== index))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:text-text-primary focus-visible:outline-accent"
            ><X className="h-3.5 w-3.5" /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ToolTagFilter({ tags, value, onChange }: { tags: string[]; value: string[]; onChange: (tags: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 320, width: 288 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const selected = new Set(value.map(tag => tag.toLowerCase()))
  const options = normalizeTags([...tags, ...value]).sort((a, b) => a.localeCompare(b))
  const filtered = options.filter(tag => tag.toLowerCase().includes(search.trim().toLowerCase()))

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function toggleOpen() {
    if (open) { setOpen(false); return }
    const rect = buttonRef.current!.getBoundingClientRect()
    const width = Math.min(288, window.innerWidth - 16)
    const below = window.innerHeight - rect.bottom - 16
    const above = rect.top - 16
    const maxHeight = Math.min(320, Math.max(below, above))
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: below >= Math.min(320, above) ? rect.bottom + 8 : rect.top - maxHeight - 8,
      maxHeight,
      width,
    })
    setSearch('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    function outside(event: MouseEvent) {
      if (!buttonRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function dismiss() { setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', keydown)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={value.length ? `Tags (${value.length} selected)` : 'Tags'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggleOpen}
        className={`glass-sm inline-flex flex-shrink-0 items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[11px] transition-colors cursor-pointer ${value.length ? 'bg-accent-muted text-accent' : 'text-text-secondary hover:bg-glass-hover'}`}
      >
        <Tags className="h-3 w-3" />
        Tags
        {value.length > 0 && <span className="text-[10px]">{value.length}</span>}
      </button>
      {open && createPortal(
        <div ref={panelRef} id={panelId} role="dialog" aria-label="Filter by tag" style={position} className="fixed z-50 flex flex-col rounded-[10px] border border-border-subtle bg-surface p-3 shadow-xl text-text-primary">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Filter by tag</span>
            <button type="button" onClick={close} aria-label="Close tag filter" className="rounded p-1 text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
          </div>
          <input ref={searchRef} type="search" aria-label="Search tags" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tags…" className="mb-2 w-full shrink-0 rounded-[7px] border border-border-subtle bg-inset px-2 py-1.5 text-xs outline-none focus:border-accent" />
          <div className="min-h-0 overflow-y-auto">
            {filtered.map(tag => (
              <label key={tag.toLowerCase()} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-xs hover:bg-glass-hover">
                <input type="checkbox" checked={selected.has(tag.toLowerCase())} onChange={() => {
                  const key = tag.toLowerCase()
                  onChange(selected.has(key) ? value.filter(item => item.toLowerCase() !== key) : [...value, key])
                }} className="accent-accent" />
                <span className="min-w-0 break-words">{tag}</span>
              </label>
            ))}
            {filtered.length === 0 && <p className="py-2 text-xs text-text-muted">{options.length ? 'No matching tags.' : 'No tags yet.'}</p>}
          </div>
          <div className="mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-border-subtle pt-2 text-[11px] text-text-muted">
            <span>Match any selected tag.</span>
            {value.length > 0 && <button type="button" onClick={() => onChange([])} className="text-accent hover:underline">Clear tags</button>}
          </div>
        </div>, document.body,
      )}
    </>
  )
}
