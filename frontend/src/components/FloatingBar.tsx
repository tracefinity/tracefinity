'use client'

import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export function FloatingBar({ children, className = '' }: Props) {
  return (
    <div className={`absolute bottom-2 left-2 right-2 z-20 ${className}`}>
      <div className="glass-toolbar flex items-center justify-between px-3 py-1.5 text-xs">
        {children}
      </div>
    </div>
  )
}
