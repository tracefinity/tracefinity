'use client'

import { useState, useEffect, useRef } from 'react'
import { Download, Loader2, Settings, Upload } from 'lucide-react'
import { getSettings, saveSettings } from '@/lib/settings'
import { getBackupExportUrl, restoreBackup } from '@/lib/api'
import { IconButton } from '@/components/IconButton'

export function SettingsPopover() {
  const [open, setOpen] = useState(false)
  const [bedSize, setBedSize] = useState(256)
  const [restoring, setRestoring] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setBedSize(getSettings().bedSize)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleBedSizeChange(v: number) {
    setBedSize(v)
    saveSettings({ bedSize: v })
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const confirmed = window.confirm(
      'Restore this backup? Existing data will be overwritten. Tracefinity will first save an automatic backup with the app before replacing current data.'
    )
    if (!confirmed) return

    setRestoring(true)
    setBackupMessage(null)
    setBackupError(null)
    try {
      const result = await restoreBackup(file)
      const message = `Restore complete. Automatic backup saved with the app as ${result.auto_backup_filename}.`
      setBackupMessage(message)
      window.alert(`${message} The app will reload now.`)
      window.location.assign('/')
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'restore failed')
    } finally {
      setRestoring(false)
    }
  }

  const pct = ((bedSize - 150) / (400 - 150)) * 100

  return (
    <div ref={ref} className="relative">
      <IconButton onClick={() => setOpen(!open)} title="Settings">
        <Settings className="w-4 h-4" />
      </IconButton>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 glass rounded-[10px] shadow-xl z-50 p-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Settings</h3>

          <div className="space-y-1.5 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-primary tracking-[0.3px]">Default Bed Size</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={150}
                max={400}
                step={1}
                value={bedSize}
                onChange={(e) => handleBedSizeChange(parseInt(e.target.value))}
                className="flex-1 min-w-0"
                style={{ '--slider-pct': `${pct}%` } as React.CSSProperties}
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={150}
                  max={400}
                  step={1}
                  value={bedSize}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v)) handleBedSizeChange(Math.min(400, Math.max(150, v)))
                  }}
                  className="w-14 h-7 bg-elevated text-right text-xs font-semibold text-text-primary rounded pr-2 focus:outline-none"
                />
                <span className="text-[10px] text-text-muted w-5">mm</span>
              </div>
            </div>
            <p className="text-[11px] text-text-muted leading-tight mt-1">
              Bins wider than this are automatically split into printable pieces.
            </p>
          </div>

          <div className="space-y-2 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-primary tracking-[0.3px]">Backup</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={getBackupExportUrl()}
                download
                className="glass-sm rounded-[7px] px-2.5 py-2 text-[11px] text-text-secondary flex items-center justify-center gap-1.5 hover:bg-glass-hover transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </a>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={restoring}
                className="glass-sm rounded-[7px] px-2.5 py-2 text-[11px] text-text-secondary flex items-center justify-center gap-1.5 hover:bg-glass-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Restore
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={handleRestoreFile}
            />
            {backupMessage && (
              <p className="text-[11px] text-green-400 leading-tight">{backupMessage}</p>
            )}
            {backupError && (
              <p className="text-[11px] text-red-400 leading-tight">{backupError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
