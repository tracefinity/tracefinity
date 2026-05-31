import type { BinConfig, BinDefaults } from '@/types'
import { getSettings, saveSettings } from './settings'

export const FACTORY_BIN_CONFIG: BinConfig = {
  grid_x: 2,
  grid_y: 2,
  height_units: 4,
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
  const merged = buildBinConfig(config)
  return {
    grid_x: merged.grid_x,
    grid_y: merged.grid_y,
    height_units: merged.height_units,
    magnets: merged.magnets,
    magnet_diameter: merged.magnet_diameter,
    magnet_depth: merged.magnet_depth,
    magnet_corners_only: merged.magnet_corners_only,
    stacking_lip: merged.stacking_lip,
    wall_thickness: merged.wall_thickness,
    cutout_depth: merged.cutout_depth,
    cutout_clearance: merged.cutout_clearance,
    cutout_chamfer: merged.cutout_chamfer,
    insert_enabled: merged.insert_enabled,
    insert_height: merged.insert_height,
    bed_size: merged.bed_size,
  }
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
