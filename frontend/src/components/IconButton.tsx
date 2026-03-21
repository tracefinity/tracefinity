'use client'

import { ReactNode, forwardRef } from 'react'

interface Props {
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  active?: boolean
  title?: string
  shortcut?: string
  className?: string
  disabled?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton({ children, onClick, active, title, shortcut, className = '', disabled }, ref) {
    const label = shortcut ? `${title} (${shortcut})` : title

    return (
      <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={title}
        className={`btn-icon ${active ? 'active' : ''} ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
      >
        {children}
      </button>
    )
  }
)
