'use client'

import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  size?: 'sm' | 'md'
  hover?: boolean
}

export function GlassPanel({ children, className = '', size = 'md', hover }: Props) {
  const base = size === 'sm' ? 'glass-sm' : 'glass'
  const hoverClass = hover ? 'hover:bg-glass-hover transition-colors duration-150' : ''

  return (
    <div className={`${base} rounded-[10px] ${hoverClass} ${className}`}>
      {children}
    </div>
  )
}
