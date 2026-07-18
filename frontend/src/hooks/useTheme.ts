'use client'

import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const listeners = new Set<() => void>()
let observer: MutationObserver | null = null
let initialized = false

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark'
}

function emit() {
  for (const listener of listeners) listener()
}

function ensureObserver() {
  if (observer || typeof document === 'undefined') return
  observer = new MutationObserver(emit)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

/** Resolve theme from localStorage / system preference once on the client. */
export function initTheme() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored)
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
}

function subscribe(listener: () => void) {
  initTheme()
  listeners.add(listener)
  ensureObserver()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && observer) {
      observer.disconnect()
      observer = null
    }
  }
}

function getSnapshot(): Theme {
  return readTheme()
}

function getServerSnapshot(): Theme {
  return 'dark'
}

export function setTheme(next: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', next)
  localStorage.setItem('theme', next)
  emit()
}

export function toggleTheme() {
  setTheme(readTheme() === 'dark' ? 'light' : 'dark')
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const set = useCallback((next: Theme) => setTheme(next), [])
  const toggle = useCallback(() => toggleTheme(), [])

  return { theme, setTheme: set, toggleTheme: toggle }
}
