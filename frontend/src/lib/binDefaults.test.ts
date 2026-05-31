import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildBinConfig,
  getDefaultBinConfig,
  getDefaultBinDefaults,
  resetDefaultBinConfig,
  saveDefaultBinConfig,
} from './binDefaults'

const SETTINGS_KEY = 'tracefinity-settings'

function installLocalStorage() {
  const data = new Map<string, string>()
  const storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  } as Storage

  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('localStorage', storage)
  return storage
}

describe('bin defaults', () => {
  let storage: Storage

  beforeEach(() => {
    storage = installLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses legacy bedSize when no full bin defaults are saved', () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ bedSize: 220 }))

    const defaults = getDefaultBinConfig()

    expect(defaults.bed_size).toBe(220)
    expect(defaults.magnet_diameter).toBe(6)
  })

  it('saves and restores magnet defaults', () => {
    saveDefaultBinConfig(buildBinConfig({
      magnet_diameter: 6.2,
      magnet_depth: 2.8,
      magnet_corners_only: true,
      bed_size: 230,
    }))

    const stored = JSON.parse(storage.getItem(SETTINGS_KEY) || '{}')
    const defaults = getDefaultBinDefaults()

    expect(stored.bedSize).toBe(230)
    expect(defaults.magnet_diameter).toBe(6.2)
    expect(defaults.magnet_depth).toBe(2.8)
    expect(defaults.magnet_corners_only).toBe(true)
  })

  it('keeps the legacy bedSize setting authoritative', () => {
    storage.setItem(SETTINGS_KEY, JSON.stringify({
      bedSize: 245,
      binDefaults: { magnet_diameter: 6.2, bed_size: 220 },
    }))

    const defaults = getDefaultBinDefaults()

    expect(defaults.bed_size).toBe(245)
    expect(defaults.magnet_diameter).toBe(6.2)
  })

  it('clears saved defaults without leaving a stale binDefaults key', () => {
    saveDefaultBinConfig(buildBinConfig({ magnet_diameter: 6.2 }))

    const reset = resetDefaultBinConfig()
    const stored = JSON.parse(storage.getItem(SETTINGS_KEY) || '{}')

    expect(reset.magnet_diameter).toBe(6)
    expect(stored.bedSize).toBe(256)
    expect(stored.binDefaults).toBeUndefined()
  })
})
