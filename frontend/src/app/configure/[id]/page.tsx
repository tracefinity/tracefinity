'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { LayoutEditor } from '@/components/LayoutEditor'
import { BinConfigurator } from '@/components/BinConfigurator'
import { BinPreview3D } from '@/components/BinPreview3D'
import { getSession, generateStl, updatePolygons, getStlUrl, getImageUrl } from '@/lib/api'
import type { BinConfig, Session, Polygon } from '@/types'
import { Download, RefreshCw, Loader2 } from 'lucide-react'
import { Alert } from '@/components/Alert'

const DEFAULT_CONFIG: BinConfig = {
  grid_x: 2,
  grid_y: 2,
  height_units: 4,
  magnets: true,
  stacking_lip: true,
  wall_thickness: 1.6,
  cutout_depth: 20,
  cutout_clearance: 1.0,
}

export default function ConfigurePage() {
  const params = useParams()
  const sessionId = params.id as string

  const [session, setSession] = useState<Session | null>(null)
  const [polygons, setPolygons] = useState<Polygon[]>([])
  const [config, setConfig] = useState<BinConfig>(DEFAULT_CONFIG)
  const [stlUrl, setStlUrl] = useState<string | null>(null)
  const [stlVersion, setStlVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastGenerateRef = useRef<string>('')
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const generatingRef = useRef(false)
  const pendingGenerateRef = useRef(false)

  useEffect(() => {
    async function load() {
      try {
        const s = await getSession(sessionId)
        setSession(s)

        if (!s.polygons || s.polygons.length === 0) {
          setError('no tools traced - go back and trace tools first')
        } else {
          let centeredPolygons = s.polygons

          if (s.scale_factor && s.polygons.length > 0) {
            const sf = s.scale_factor
            const allPoints = s.polygons.flatMap(p => p.points)
            const xs = allPoints.map(p => p.x * sf)
            const ys = allPoints.map(p => p.y * sf)
            const minX = Math.min(...xs)
            const maxX = Math.max(...xs)
            const minY = Math.min(...ys)
            const maxY = Math.max(...ys)
            const toolWidth = maxX - minX
            const toolHeight = maxY - minY

            const clearance = 1.0
            const wallThickness = 1.6
            const neededWidth = toolWidth + 2 * clearance + 2 * wallThickness
            const neededHeight = toolHeight + 2 * clearance + 2 * wallThickness

            const gridX = Math.max(1, Math.ceil(neededWidth / 42))
            const gridY = Math.max(1, Math.ceil(neededHeight / 42))
            const binWidthMm = gridX * 42
            const binHeightMm = gridY * 42

            // center polygons in the bin
            const currentCenterX = (minX + maxX) / 2
            const currentCenterY = (minY + maxY) / 2
            const targetCenterX = binWidthMm / 2
            const targetCenterY = binHeightMm / 2
            const offsetX = (targetCenterX - currentCenterX) / sf
            const offsetY = (targetCenterY - currentCenterY) / sf

            centeredPolygons = s.polygons.map(poly => ({
              ...poly,
              points: poly.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY })),
              finger_holes: poly.finger_holes.map(fh => ({ ...fh, x: fh.x + offsetX, y: fh.y + offsetY })),
            }))

            setConfig(prev => ({
              ...prev,
              grid_x: gridX,
              grid_y: gridY,
            }))
          }

          setPolygons(centeredPolygons)
        }
      } catch {
        setError('session not found')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sessionId])

  const doGenerate = useCallback(async () => {
    const key = JSON.stringify({ polygons, config })
    if (key === lastGenerateRef.current) return

    // if already generating, mark as pending and return
    if (generatingRef.current) {
      pendingGenerateRef.current = true
      return
    }

    lastGenerateRef.current = key
    generatingRef.current = true
    setGenerating(true)
    setError(null)

    try {
      const result = await generateStl(sessionId, config, polygons)
      setStlUrl(getImageUrl(result.stl_url))
      setStlVersion(v => v + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed')
    } finally {
      generatingRef.current = false
      setGenerating(false)

      // if something changed while generating, regenerate
      if (pendingGenerateRef.current) {
        pendingGenerateRef.current = false
        doGenerate()
      }
    }
  }, [sessionId, polygons, config])

  // auto-generate STL with debounce
  useEffect(() => {
    if (!session || polygons.length === 0) return

    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current)
    }

    generateTimeoutRef.current = setTimeout(() => {
      doGenerate()
    }, 800)

    return () => {
      if (generateTimeoutRef.current) {
        clearTimeout(generateTimeoutRef.current)
      }
    }
  }, [session, polygons, config, doGenerate])

  // cleanup save timeout on unmount only
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const handlePolygonsChange = useCallback((updated: Polygon[]) => {
    setPolygons(updated)

    // debounced save to backend
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await updatePolygons(sessionId, updated)
      } catch (err) {
        console.error('failed to save polygons:', err)
      }
    }, 1000)
  }, [sessionId])

  function handleDownload() {
    if (!stlUrl) return
    window.open(getStlUrl(sessionId), '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-gray-600 dark:text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading session...</span>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="max-w-md mx-auto py-12">
        <Alert variant="error">{error}</Alert>
      </div>
    )
  }

  const stlUrlWithVersion = stlUrl ? `${stlUrl}?v=${stlVersion}` : null

  return (
    <div className="h-[calc(100vh-100px)] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[280px_1fr_1fr] gap-4 w-full">
      {/* left sidebar - config */}
      <div className="space-y-4 overflow-y-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-4">Bin Configuration</h3>
          <BinConfigurator config={config} onChange={setConfig} />
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Dimensions</h3>
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
            <p>Width: {config.grid_x * 42}mm ({config.grid_x}u)</p>
            <p>Depth: {config.grid_y * 42}mm ({config.grid_y}u)</p>
            <p>
              Height: {config.height_units * 7 + 5 + (config.stacking_lip ? 4.4 : 0)}mm
              ({config.height_units}u + base{config.stacking_lip ? ' + lip' : ''})
            </p>
          </div>
        </div>

        {stlUrl && (
          <button
            onClick={handleDownload}
            className="w-full py-2 flex items-center justify-center gap-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download STL
          </button>
        )}

        {error && (
          <Alert variant="error">{error}</Alert>
        )}
      </div>

      {/* layout editor */}
      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden p-4">
        {session?.scale_factor && (
          <LayoutEditor
            polygons={polygons}
            onPolygonsChange={handlePolygonsChange}
            gridX={config.grid_x}
            gridY={config.grid_y}
            scaleFactor={session.scale_factor}
          />
        )}
      </div>

      {/* 3D preview */}
      <div className="bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden flex flex-col">
        <div className="bg-white dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">3D Preview</span>
          {generating && (
            <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Generating...
            </span>
          )}
        </div>
        <div className="flex-1 p-4 min-h-[300px]">
          {stlUrlWithVersion ? (
            <BinPreview3D key={stlVersion} stlUrl={stlUrlWithVersion} />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 text-sm">
              {generating ? 'Generating preview...' : 'Preview will appear here'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
