'use client'

import { useEffect, useRef, useState } from 'react'

interface NumericInputProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  className?: string
  disabled?: boolean
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function parseNumericInput(raw: string, min: number, max: number, fallback: number): number {
  const value = parseFloat(raw.trim())
  return Number.isNaN(value) ? fallback : clampNumber(value, min, max)
}

export function NumericInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  disabled,
}: NumericInputProps) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  const skipNextCommit = useRef(false)

  useEffect(() => {
    if (!focused) setText(String(value))
  }, [focused, value])

  const commit = (raw: string) => {
    const next = parseNumericInput(raw, min, max, value)
    setText(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (skipNextCommit.current) {
          skipNextCommit.current = false
          return
        }
        commit(text)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          skipNextCommit.current = true
          setText(String(value))
          e.currentTarget.blur()
        }
      }}
      className={className}
    />
  )
}
