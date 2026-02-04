'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <h2 className="text-red-800 dark:text-red-200 font-medium mb-2">Something went wrong</h2>
          <p className="text-red-600 dark:text-red-400 text-sm">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1 text-sm bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
