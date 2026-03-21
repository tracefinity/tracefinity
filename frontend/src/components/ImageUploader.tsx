'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

interface Props {
  onUpload: (file: File) => void
  disabled?: boolean
  compact?: boolean
}

export function ImageUploader({ onUpload, disabled, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleClick() {
    if (!disabled) inputRef.current?.click()
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && !disabled) onUpload(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!disabled) setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onUpload(file)
  }

  if (compact) {
    return (
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          glass-toolbar flex items-center justify-center gap-2.5 px-4 py-3 cursor-pointer
          transition-all duration-150
          ${isDragging ? 'border-accent bg-accent-muted scale-[1.005]' : 'hover:bg-glass-hover'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
        <div className="w-7 h-7 rounded-full bg-accent-muted flex items-center justify-center flex-shrink-0">
          <Upload className="w-3.5 h-3.5 text-accent" />
        </div>
        {isDragging ? (
          <span className="text-xs text-accent font-medium">Drop image here</span>
        ) : (
          <span className="text-xs text-text-secondary">
            <span className="text-text-primary font-medium">Upload a photo</span>
            <span className="hidden sm:inline"> to trace more tools</span>
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        glass rounded-[10px] py-10 px-6 text-center cursor-pointer
        transition-all duration-150
        ${isDragging ? 'border-accent bg-accent-muted scale-[1.01]' : 'hover:bg-glass-hover'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={handleChange} className="hidden" />
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-accent-muted flex items-center justify-center">
        <Upload className="w-5 h-5 text-accent" />
      </div>
      {isDragging ? (
        <p className="text-sm text-accent font-medium">Drop the image here</p>
      ) : (
        <div>
          <p className="text-sm text-text-primary font-medium mb-1">
            Upload a photo of your tools
          </p>
          <p className="text-xs text-text-muted">
            Drag and drop, or click to select. JPG, PNG, WebP, HEIC.
          </p>
        </div>
      )}
    </div>
  )
}
