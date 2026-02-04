'use client'

import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'

interface Props {
  onUpload: (file: File) => void
  disabled?: boolean
}

export function ImageUploader({ onUpload, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleClick() {
    if (!disabled) {
      inputRef.current?.click()
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && !disabled) {
      onUpload(file)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
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
    if (file && file.type.startsWith('image/')) {
      onUpload(file)
    }
  }

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
        transition-colors
        ${isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        className="hidden"
      />
      <Upload className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
      {isDragging ? (
        <p className="text-blue-600 dark:text-blue-400">Drop the image here</p>
      ) : (
        <div>
          <p className="text-gray-600 dark:text-gray-400 mb-2">
            Drag and drop an image, or click to select
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Supports JPG, PNG, WebP
          </p>
        </div>
      )}
    </div>
  )
}
