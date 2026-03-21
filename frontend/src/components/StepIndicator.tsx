'use client'

interface Props {
  steps: string[]
  current: number
}

export function StepIndicator({ steps, current }: Props) {
  return (
    <div className="flex items-center gap-1 px-4 py-2.5 border-b border-border">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          {i > 0 && (
            <div className={`w-6 h-px ${i <= current ? 'bg-accent' : 'bg-border-subtle'}`} />
          )}
          <div className="flex items-center gap-1.5">
            <div className={`
              w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold
              ${i < current ? 'bg-accent text-white' : i === current ? 'bg-accent text-white' : 'bg-elevated text-text-muted border border-border-subtle'}
            `}>
              {i < current ? (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${i === current ? 'text-text-primary' : 'text-text-muted'}`}>
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
