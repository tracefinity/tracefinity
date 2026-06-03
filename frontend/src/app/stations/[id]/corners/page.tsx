'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Alert } from '@/components/Alert'
import { CornersHint } from '@/components/OnboardingIllustrations'
import { PaperCornerEditor } from '@/components/PaperCornerEditor'
import { StepBar } from '@/components/StepBar'
import { getImageUrl, getPhotoStation, updatePhotoStation } from '@/lib/api'
import type { PhotoStation, Point } from '@/types'

const STEPS = ['Stations', 'Corners']

function fallbackStationImage(station: PhotoStation): string {
  const width = Math.max(1, station.image_width)
  const height = Math.max(1, station.image_height)
  const gridW = width / 12
  const gridH = height / 12
  const stroke = Math.max(width, height) * 0.001
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="#18181b"/>
      <defs>
        <pattern id="grid" width="${gridW}" height="${gridH}" patternUnits="userSpaceOnUse">
          <path d="M ${gridW} 0 L 0 0 0 ${gridH}" fill="none" stroke="#3f3f46" stroke-width="${stroke}" opacity="0.7"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>
    </svg>
  `
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export default function StationCornersPage() {
  const params = useParams()
  const router = useRouter()
  const stationId = params.id as string
  const [station, setStation] = useState<PhotoStation | null>(null)
  const [paperSize, setPaperSize] = useState<'a4' | 'letter'>('a4')
  const [corners, setCorners] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    getPhotoStation(stationId)
      .then((found) => {
        if (cancelled) return
        setStation(found)
        setPaperSize(found.paper_size)
        setCorners(found.corners.map((point) => ({ ...point })))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed to load station')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [stationId])

  const imageUrl = useMemo(() => {
    if (!station) return ''
    const imagePath = station.image_path
    return imagePath ? getImageUrl(`/storage/${imagePath}`) : fallbackStationImage(station)
  }, [station])

  async function handleSave() {
    if (!station) return
    setSaving(true)
    setError(null)
    try {
      await updatePhotoStation(station.id, {
        paper_size: paperSize,
        corners,
      })
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to update station')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col w-full">
      <StepBar
        steps={STEPS}
        current={1}
        onStepClick={(index) => {
          if (index === 0) router.push('/')
        }}
      />

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        <div className="md:w-[240px] md:flex-shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border overflow-y-auto flex flex-col max-h-[40vh] md:max-h-none">
          <div className="p-3 space-y-3">
            <div className="glass rounded-[10px] px-3 py-3">
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-widest mb-2">
                Adjust Corners
              </h3>
              <div className="space-y-3">
                <CornersHint />
                <p className="text-xs text-text-muted">
                  Drag the corner handles to match the paper edges.
                </p>

                <div>
                  <span className="text-xs text-text-primary tracking-[0.3px]">Paper Size</span>
                  <div className="inline-flex rounded-[10px] glass p-0.5 mt-1.5">
                    {(['a4', 'letter'] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPaperSize(size)}
                        className={`px-3 py-1 rounded text-xs font-medium ${
                          paperSize === size
                            ? 'bg-surface text-text-primary shadow-sm'
                            : 'text-text-muted hover:text-text-primary'
                        }`}
                      >
                        {size === 'a4' ? 'A4' : 'Letter'}
                      </button>
                    ))}
                  </div>
                </div>

                {station && !station.image_path && (
                  <p className="text-xs text-amber-300 leading-snug">
                    Station photo unavailable; showing a grid.
                  </p>
                )}
              </div>
            </div>

            {error && <Alert variant="error">{error}</Alert>}
          </div>

          <div className="p-3 md:mt-auto">
            <button
              type="button"
              onClick={handleSave}
              disabled={!station || loading || saving || corners.length !== 4}
              className="btn-primary w-full py-2 text-sm inline-flex items-center justify-center gap-1.5"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Saving...' : 'Save Station'}
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-base overflow-hidden p-3">
          {loading ? (
            <div className="w-full h-full flex items-center justify-center text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : station && imageUrl ? (
            <PaperCornerEditor
              imageUrl={imageUrl}
              corners={corners}
              onCornersChange={setCorners}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-sm text-text-muted">
              Station unavailable.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
