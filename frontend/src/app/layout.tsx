'use client'

import './globals.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ThemeToggle } from '@/components/ThemeToggle'
import { StepNav } from '@/components/StepNav'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [queryClient] = useState(() => new QueryClient())
  const pathname = usePathname()

  // extract session id from path
  const match = pathname.match(/\/(trace|configure)\/([^/]+)/)
  const sessionId = match ? match[2] : undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Tracefinity</title>
        <meta name="description" content="Generate gridfinity bins from photos of tools" />
      </head>
      <body className="bg-gray-50 dark:bg-gray-900 min-h-screen transition-colors">
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <div className="px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <Link href="/" className="text-xl font-semibold text-gray-900 dark:text-gray-100 hover:text-gray-700 dark:hover:text-gray-300">
                    Tracefinity
                  </Link>
                  <StepNav sessionId={sessionId} />
                </div>
                <ThemeToggle />
              </div>
            </header>
            <main className="px-4 py-4">
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>
          </QueryClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
