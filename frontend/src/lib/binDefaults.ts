import type { BinConfig, BinDefaults } from '@/types'
import { getSettings, saveSettings } from './settings'

export const FACTORY_BIN_CONFIG: BinConfig = {
  grid_x: 2,
  grid_y: 2,
  height_units: 4,
  freeform: false,
  width_mm: 0,
  depth_mm: 0,
  height_mm: 0,
  no_base: true,
  magnets: true,
  magnet_diameter: 6.0,
  magnet_depth: 2.4,
  magnet_corners_only: false,
  stacking_lip: true,
  wall_thickness: 1.6,
  cutout_depth: 20,
  cutout_clearance: 1.0,
  cutout_chamfer: 0,
  insert_enabled: false,
  insert_height: 1.0,
  bed_size: 256,
  text_labels: [],
}

export function buildBinConfig(overrides: Partial<BinDefaults> | null = null): BinConfig {
  return {
    ...FACTORY_BIN_CONFIG,
    ...(overrides || {}),
    text_labels: [],
  }
}

export function binDefaultsFromConfig(config: Partial<BinConfig>): BinDefaults {
  const { text_labels: _textLabels, ...defaults } = buildBinConfig(config)
  return defaults
}

/** Ensure height_mm has a value derived from height_units if not set. */
const GF_HEIGHT_UNIT = 7.0
export function normalizeBinConfig(config: BinConfig): BinConfig {
  if (config.height_mm === 0) {
    return { ...config, height_mm: config.height_units * GF_HEIGHT_UNIT }
  }
  return config
}

export function getDefaultBinConfig(): BinConfig {
  const settings = getSettings()
  return buildBinConfig({
    ...(settings.binDefaults || {}),
    bed_size: settings.bedSize,
  })
}

export function getDefaultBinDefaults(): BinDefaults {
  return binDefaultsFromConfig(getDefaultBinConfig())
}

export function saveDefaultBinConfig(config: BinConfig): BinDefaults {
  const defaults = binDefaultsFromConfig(config)
  saveSettings({ bedSize: defaults.bed_size, binDefaults: defaults })
  return defaults
}

export function resetDefaultBinConfig(): BinConfig {
  saveSettings({ bedSize: FACTORY_BIN_CONFIG.bed_size, binDefaults: undefined })
  return buildBinConfig()
}
