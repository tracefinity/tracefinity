import { useEffect, useRef, useState } from 'react'
import { generateBinStl, getImageUrl } from '@/lib/api'

/**
 * Generates (or fetches the cached) STL for each bin and exposes its URL.
 *
 * Every request settles exactly once: it either yields a URL, or -- when it
 * fails or its run is torn down (bins changed, `enabled` switched off,
 * unmount) -- it is released again so a later run requests it anew. Nothing
 * can stay "requested" forever and leave a bin stuck as a placeholder.
 */
export function useBinStlUrls(binIds: string[], enabled: boolean) {
  const [stlUrls, setStlUrls] = useState<Map<string, string>>(() => new Map())
  const [pendingCount, setPendingCount] = useState(0)
  const requestedRef = useRef<Set<string>>(new Set())

  // a stable key: moving or recolouring placements rebuilds the id array but
  // must not tear down generation that is already running
  const key = Array.from(new Set(binIds)).sort().join('|')

  useEffect(() => {
    if (!enabled || !key) return
    // the set itself is never replaced, only mutated
    const requested = requestedRef.current
    const missing = key.split('|').filter(binId => !requested.has(binId))
    if (missing.length === 0) return

    const controller = new AbortController()
    const unfinished = new Set(missing)
    missing.forEach(binId => requested.add(binId))
    setPendingCount(count => count + missing.length)

    function settle(binId: string) {
      unfinished.delete(binId)
      setPendingCount(count => Math.max(0, count - 1))
    }

    async function generateAll() {
      // sequential on purpose: STL generation is heavy on the server
      for (const binId of missing) {
        if (controller.signal.aborted) return
        try {
          const result = await generateBinStl(binId, controller.signal)
          if (controller.signal.aborted) return // the cleanup already released it
          setStlUrls(prev => new Map(prev).set(binId, `${getImageUrl(result.stl_url)}?v=${Date.now()}`))
          settle(binId)
        } catch {
          if (controller.signal.aborted) return
          // keep the placeholder block, but allow a retry on the next run
          requested.delete(binId)
          settle(binId)
        }
      }
    }
    generateAll()

    return () => {
      controller.abort()
      for (const binId of unfinished) requested.delete(binId)
      const released = unfinished.size
      unfinished.clear()
      if (released > 0) setPendingCount(count => Math.max(0, count - released))
    }
  }, [enabled, key])

  return { stlUrls, pendingCount }
}
