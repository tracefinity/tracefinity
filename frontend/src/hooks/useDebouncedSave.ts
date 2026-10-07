import { useState, useEffect, useRef, useCallback } from 'react'

export function useDebouncedSave(
  saveFn: () => Promise<void> | void,
  deps: unknown[],
  delay: number = 150,
  options?: { skipInitial?: boolean }
): { saving: boolean; saved: boolean; saveCount: number; error: Error | null; flush: (options?: { force?: boolean }) => Promise<void> } {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveCount, setSaveCount] = useState(0)
  const [error, setError] = useState<Error | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveRef = useRef<(() => Promise<void> | void) | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const armedRef = useRef(!options?.skipInitial)
  const saveFnRef = useRef(saveFn)
  saveFnRef.current = saveFn

  const flush = useCallback(async (options?: { force?: boolean }) => {
    if (options?.force) pendingSaveRef.current = saveFnRef.current
    if (!pendingSaveRef.current && !inFlightRef.current) return
    setSaving(true)
    setSaved(false)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    try {
      while (pendingSaveRef.current || inFlightRef.current) {
        if (inFlightRef.current) {
          await inFlightRef.current
          continue
        }
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        const save = pendingSaveRef.current!
        pendingSaveRef.current = null
        const request = Promise.resolve().then(save)
        inFlightRef.current = request
        try {
          await request
          setSaveCount(c => c + 1)
          setError(null)
        } catch (err) {
          pendingSaveRef.current ??= save
          throw err
        } finally {
          if (inFlightRef.current === request) inFlightRef.current = null
        }
      }
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      const failure = err instanceof Error ? err : new Error('save failed')
      setError(failure)
      throw failure
    } finally {
      if (!inFlightRef.current) setSaving(false)
    }
  }, [])

  // arm after initial render cycle
  useEffect(() => {
    if (options?.skipInitial) {
      const t = setTimeout(() => { armedRef.current = true }, 100)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!armedRef.current) return
    pendingSaveRef.current = saveFnRef.current
    setSaved(false)
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      void flush().catch(() => {})
    }, delay)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  // flush pending save on page unload
  useEffect(() => {
    const beforeUnload = () => {
      if (pendingSaveRef.current) void flush().catch(() => {})
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [flush])

  return { saving, saved, saveCount, error, flush }
}
