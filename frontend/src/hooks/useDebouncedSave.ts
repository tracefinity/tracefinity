import { useState, useEffect, useRef, useCallback } from 'react'

export function useDebouncedSave(
  saveFn: () => Promise<void> | void,
  deps: unknown[],
  delay: number = 150,
  options?: { skipInitial?: boolean }
): { saving: boolean; saved: boolean; saveCount: number; error: Error | null; flush: () => Promise<void> } {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveCount, setSaveCount] = useState(0)
  const [error, setError] = useState<Error | null>(null)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingSaveRef = useRef<(() => Promise<void> | void) | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)
  const armedRef = useRef(!options?.skipInitial)
  const saveFnRef = useRef(saveFn)
  saveFnRef.current = saveFn

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
    const doSave = async () => {
      setSaving(true)
      setSaved(false)
      try {
        await saveFnRef.current()
        setSaveCount(c => c + 1)
        setSaved(true)
        setError(null)
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaved(false), 2000)
      } catch (err) {
        // surfaced to the caller: a silent failure looks identical to a save
        setError(err instanceof Error ? err : new Error('save failed'))
      } finally {
        setSaving(false)
      }
    }
    pendingSaveRef.current = doSave
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      pendingSaveRef.current = null
      doSave()
    }, delay)
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  /** Run a save that is still waiting out the debounce, e.g. before navigating away. */
  const flush = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    const pending = pendingSaveRef.current
    pendingSaveRef.current = null
    if (pending) await pending()
  }, [])

  // flush pending save on page unload
  useEffect(() => {
    const onUnload = () => { pendingSaveRef.current?.() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return { saving, saved, saveCount, error, flush }
}
