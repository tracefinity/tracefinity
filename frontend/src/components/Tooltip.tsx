'use client'

import { ReactNode, useState, useRef, useEffect, useCallback } from 'react'

interface Props {
  content: string
  shortcut?: string
  children: ReactNode
  side?: 'top' | 'bottom'
  delay?: number
}

export function Tooltip({ content, shortcut, children, side = 'bottom', delay = 400 }: Props) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }, [delay])

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setVisible(false)
  }, [])

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  const posClass = side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className={`absolute ${posClass} left-1/2 -translate-x-1/2 z-50 pointer-events-none`}>
          <div className="glass-toolbar px-2 py-1 text-[11px] text-text-secondary whitespace-nowrap flex items-center gap-1.5">
            <span>{content}</span>
            {shortcut && (
              <kbd className="text-[10px] text-text-muted bg-elevated px-1 py-0.5 rounded">{shortcut}</kbd>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
