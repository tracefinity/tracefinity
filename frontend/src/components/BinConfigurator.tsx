'use client'

import type { BinConfig } from '@/types'

interface Props {
  config: BinConfig
  onChange: (config: BinConfig) => void
}

export function BinConfigurator({ config, onChange }: Props) {
  function update(partial: Partial<BinConfig>) {
    onChange({ ...config, ...partial })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Grid Width
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={config.grid_x}
            onChange={(e) => update({ grid_x: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{config.grid_x * 42}mm</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Grid Depth
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={config.grid_y}
            onChange={(e) => update({ grid_y: parseInt(e.target.value) || 1 })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{config.grid_y * 42}mm</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Height Units
        </label>
        <input
          type="number"
          min={1}
          max={20}
          value={config.height_units}
          onChange={(e) => update({ height_units: parseInt(e.target.value) || 1 })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">{config.height_units * 7}mm (7mm per unit)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Cutout Depth (mm)
        </label>
        <input
          type="number"
          min={5}
          max={100}
          step={0.5}
          value={config.cutout_depth}
          onChange={(e) => update({ cutout_depth: parseFloat(e.target.value) || 20 })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Cutout Clearance (mm)
        </label>
        <input
          type="number"
          min={0}
          max={5}
          step={0.1}
          value={config.cutout_clearance}
          onChange={(e) => update({ cutout_clearance: parseFloat(e.target.value) || 0 })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">Extra space around tool outlines</p>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.magnets}
            onChange={(e) => update({ magnets: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Magnet holes</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.stacking_lip}
            onChange={(e) => update({ stacking_lip: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Stacking lip</span>
        </label>
      </div>
    </div>
  )
}
