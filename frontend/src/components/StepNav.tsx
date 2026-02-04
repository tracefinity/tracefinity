'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Upload, Scan, Settings } from 'lucide-react'

type Step = {
  id: string
  label: string
  path: string
  icon: React.ReactNode
}

type Props = {
  sessionId?: string
}

export function StepNav({ sessionId }: Props) {
  const pathname = usePathname()

  const steps: Step[] = [
    { id: 'upload', label: 'Upload', path: '/', icon: <Upload className="w-4 h-4" /> },
    { id: 'trace', label: 'Trace', path: sessionId ? `/trace/${sessionId}` : '', icon: <Scan className="w-4 h-4" /> },
    { id: 'configure', label: 'Configure', path: sessionId ? `/configure/${sessionId}` : '', icon: <Settings className="w-4 h-4" /> },
  ]

  const currentIndex = steps.findIndex(s => {
    if (s.id === 'upload') return pathname === '/'
    if (s.id === 'trace') return pathname.startsWith('/trace/')
    if (s.id === 'configure') return pathname.startsWith('/configure/')
    return false
  })

  return (
    <nav className="flex items-center gap-1 text-sm">
      {steps.map((step, i) => {
        const isActive = i === currentIndex
        const isPast = i < currentIndex
        const isClickable = step.path && (isPast || isActive)

        const content = (
          <span
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              isActive
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium'
                : isPast
                  ? 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            {step.icon}
            {step.label}
          </span>
        )

        return (
          <div key={step.id} className="flex items-center">
            {i > 0 && (
              <ChevronRight className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-1" />
            )}
            {isClickable ? (
              <Link href={step.path}>{content}</Link>
            ) : (
              content
            )}
          </div>
        )
      })}
    </nav>
  )
}
