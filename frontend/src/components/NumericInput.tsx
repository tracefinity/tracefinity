'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  className?: string
  disabled?: boolean
  title?: string
}

export function clampNumericValue(raw: string, min: number, max: number, step: number, fallback: number): number {
  const trimmed = raw.trim()
  if (trimmed === '') return fallback
  const parsed = step < 1 ? parseFloat(trimmed) : parseInt(trimmed, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

// defers min/max clamping to blur or Enter -- lets users type freely
export function NumericInput({ value, min, max, step = 1, onChange, className, disabled, title }: Props) {
  const [text, setText] = useState(String(value))
  const committedRef = useRef(value)

  useEffect(() => {
    // sync display when value changes externally (e.g. slider drag)
    const incoming = String(value)
    if (incoming !== text && value !== committedRef.current) {
      setText(incoming)
      committedRef.current = value
    }
    // intentionally excluding `text` -- we only want to react to external value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = useCallback((raw: string) => {
    const result = clampNumericValue(raw, min, max, step, committedRef.current)
    setText(String(result))
    if (raw.trim() !== '') {
      committedRef.current = result
      onChange(result)
    }
  }, [min, max, step, onChange])

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      disabled={disabled}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit(e.currentTarget.value)
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          setText(String(committedRef.current))
          e.currentTarget.blur()
        }
      }}
      className={className}
    />
  )
}
