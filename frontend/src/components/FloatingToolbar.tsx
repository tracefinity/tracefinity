'use client'

import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  position?: 'top-center' | 'bottom-center' | 'top-left' | 'top-right'
}

const positionClasses = {
  'top-center': 'top-2 left-1/2 -translate-x-1/2',
  'bottom-center': 'bottom-2 left-1/2 -translate-x-1/2',
  'top-left': 'top-2 left-2',
  'top-right': 'top-2 right-2',
}

export function FloatingToolbar({ children, className = '', position = 'top-center' }: Props) {
  return (
    <div className={`absolute z-20 ${positionClasses[position]} ${className}`}>
      <div className="glass-toolbar flex items-center gap-0.5 px-1.5 py-1">
        {children}
      </div>
    </div>
  )
}
