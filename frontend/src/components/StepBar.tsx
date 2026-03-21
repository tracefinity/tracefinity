'use client'

import { Check } from 'lucide-react'

interface Props {
  steps: string[]
  current: number
  onStepClick?: (index: number) => void
}

export function StepBar({ steps, current, onStepClick }: Props) {
  return (
    <div className="flex items-center justify-center gap-0 px-4 py-2 border-b border-border bg-surface/60 backdrop-blur-md">
      {steps.map((label, i) => {
        const completed = i < current
        const active = i === current
        const clickable = onStepClick && i < current

        return (
          <div key={label} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 sm:w-12 h-px mx-1 transition-colors duration-300 ${
                i <= current ? 'bg-accent' : 'bg-border-subtle'
              }`} />
            )}
            <button
              onClick={() => clickable && onStepClick(i)}
              disabled={!clickable}
              className={`flex items-center gap-1.5 transition-all duration-150 ${
                clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
              }`}
            >
              <div className={`
                w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all duration-300
                ${completed ? 'bg-accent text-white' : active ? 'bg-accent text-white shadow-[0_0_0_3px_var(--color-accent-muted)]' : 'bg-elevated text-text-muted border border-border-subtle'}
              `}>
                {completed ? <Check className="w-3 h-3" /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:inline transition-colors duration-150 ${
                active ? 'text-text-primary' : completed ? 'text-text-secondary' : 'text-text-muted'
              }`}>
                {label}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
