import type { BinDefaults } from '@/types'

export interface UserSettings {
  bedSize: number
  binDefaults?: Partial<BinDefaults>
}

const DEFAULTS: UserSettings = { bedSize: 256 }
const KEY = 'tracefinity-settings'

export function getSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export function saveSettings(partial: Partial<UserSettings>): void {
  if (typeof window === 'undefined') return
  try {
    const current = getSettings()
    const next: Record<string, unknown> = { ...current, ...partial }
    for (const key of Object.keys(next)) {
      if (next[key] === undefined) delete next[key]
    }
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // localStorage can be unavailable in private browsing or restricted contexts.
  }
}
