'use client'

import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'
import { ReactNode } from 'react'
import { useTheme } from '@/hooks/useTheme'

interface Props {
  variant?: 'error' | 'warning' | 'info' | 'success'
  children: ReactNode
  className?: string
}

const variantsDark = {
  error: {
    container: 'bg-red-900/15 border-red-800/40',
    icon: 'text-red-400',
    text: 'text-red-200',
    Icon: XCircle,
  },
  warning: {
    container: 'bg-amber-900/15 border-amber-800/40',
    icon: 'text-amber-400',
    text: 'text-amber-200',
    Icon: AlertTriangle,
  },
  info: {
    container: 'bg-blue-900/15 border-blue-800/40',
    icon: 'text-blue-400',
    text: 'text-blue-200',
    Icon: Info,
  },
  success: {
    container: 'bg-green-900/15 border-green-800/40',
    icon: 'text-green-400',
    text: 'text-green-200',
    Icon: CheckCircle,
  },
}

const variantsLight = {
  error: {
    container: 'bg-red-500/15 border-red-400/40',
    icon: 'text-red-600',
    text: 'text-red-600',
    Icon: XCircle,
  },
  warning: {
    container: 'bg-amber-500/15 border-amber-400/40',
    icon: 'text-amber-600',
    text: 'text-amber-600',
    Icon: AlertTriangle,
  },
  info: {
    container: 'bg-blue-500/15 border-blue-400/40',
    icon: 'text-blue-600',
    text: 'text-blue-600',
    Icon: Info,
  },
  success: {
    container: 'bg-green-500/15 border-green-400/40',
    icon: 'text-green-600',
    text: 'text-green-600',
    Icon: CheckCircle,
  },
}

export function Alert({ variant = 'info', children, className = '' }: Props) {
  const { theme } = useTheme()
  const variants = theme === 'dark' ? variantsDark : variantsLight
  const v = variants[variant]
  const Icon = v.Icon

  return (
    <div className={`flex items-center justify-start gap-2.5 p-3 border rounded-[10px] backdrop-blur-sm ${v.container} ${className}`}>
      <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${v.icon}`} />
      <div className={`text-xs ${v.text}`}>{children}</div>
    </div>
  )
}
