const TRACER_PREFERENCE_KEY = 'tracefinity.trace.preferredTracer'

export function getPreferredTracerId(availableTracers: readonly { id: string }[]): string | null {
  if (typeof window === 'undefined') return null

  try {
    const saved = window.localStorage.getItem(TRACER_PREFERENCE_KEY)
    if (!saved) return null
    return availableTracers.some((tracer) => tracer.id === saved) ? saved : null
  } catch {
    return null
  }
}

export function rememberTracerId(tracerId: string | null | undefined): void {
  if (!tracerId || typeof window === 'undefined') return

  try {
    window.localStorage.setItem(TRACER_PREFERENCE_KEY, tracerId)
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }
}
