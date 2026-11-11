import { describe, expect, it } from 'vitest'

import { getProjectCollections, getUniqueBinTools } from './projectSelectors'
import type { BinProject, BinSummary, ToolSummary } from '@/types'

const tool = (id: string): ToolSummary => ({
  id,
  name: id,
  created_at: null,
  point_count: 0,
  points: [],
  interior_rings: [],
  smoothed: false,
  smooth_level: 0,
  thumbnail_url: null,
  image_transform: null,
  image_context: null,
  category: null,
  drawer: null,
  tags: [],
  project_ids: [],
  review_status: null,
  needs_cleanup: false,
})

const bin = (toolIds: string[]): BinSummary => ({
  id: 'bin-1',
  name: 'Bin 1',
  project_id: 'project-1',
  created_at: null,
  tool_ids: toolIds,
  tool_count: toolIds.length,
  has_stl: false,
  grid_x: 2,
  grid_y: 2,
  height_units: 4,
  half_grid_base: false,
  preview_tools: [],
})

const project: BinProject = {
  id: 'project-1',
  name: 'Project 1',
  description: null,
  status: 'active',
  tool_ids: ['tool-1', 'tool-2'],
  bin_ids: ['bin-1'],
  placed_tool_ids: ['tool-1'],
  unplaced_tool_ids: ['tool-2'],
  sketches: [],
  default_bin_config: null,
  notes: null,
  created_at: null,
  updated_at: null,
}

describe('project selectors', () => {
  it('deduplicates repeated tool placements for linked-bin display', () => {
    const toolById = new Map([tool('tool-1'), tool('tool-2')].map(item => [item.id, item]))

    expect(getUniqueBinTools(bin(['tool-1', 'tool-1', 'tool-2']), toolById).map(item => item.id))
      .toEqual(['tool-1', 'tool-2'])
  })

  it('counts a bin once per tool when building project tool metadata', () => {
    const toolOne = tool('tool-1')
    const collections = getProjectCollections(project, [toolOne, tool('tool-2')], [bin(['tool-1', 'tool-1'])], {
      projectSearch: '',
      addToolSearch: '',
      statusFilter: 'all',
      allowReassignBins: false,
    })

    expect(collections.toolBins.get(toolOne.id)?.map(item => item.id)).toEqual(['bin-1'])
  })

  const taggedTools = [
    { ...tool('tool-1'), name: 'Short key', tags: ['Hex keys'] },
    { ...tool('tool-2'), name: 'Long key', tags: ['HEX KEYS', 'Metric'] },
    { ...tool('tool-3'), name: 'Metric driver', tags: ['Screwdrivers', 'Metric'] },
    { ...tool('tool-4'), name: 'Pliers', tags: ['Pliers'] },
    tool('tool-5'),
  ]
  const filters = { projectSearch: '', addToolSearch: '', statusFilter: 'all' as const, allowReassignBins: false }

  it('composes project tag, name and placement filters without changing project membership or available tools', () => {
    const collections = getProjectCollections(project, taggedTools, [], {
      ...filters, projectTags: ['hex keys'], projectSearch: 'long', statusFilter: 'unplaced',
    })
    expect(collections.filteredProjectTools.map(item => item.id)).toEqual(['tool-2'])
    expect(collections.actionableVisibleToolIds).toEqual(['tool-2'])
    expect(collections.projectTools).toHaveLength(2)
    expect(collections.availableTools.map(item => item.id)).toEqual(['tool-3', 'tool-4', 'tool-5'])
    expect(collections.projectToolTags).toEqual(['Hex keys', 'Metric'])
  })

  it('filters available tools by any selected tag and name, excluding assigned tools', () => {
    const collections = getProjectCollections(project, taggedTools, [], {
      ...filters, addToolTags: ['METRIC', 'Pliers'], addToolSearch: 'driver',
    })
    expect(collections.availableTools.map(item => item.id)).toEqual(['tool-3'])
    expect(collections.filteredProjectTools).toHaveLength(2)
    expect(collections.availableToolTags).toEqual(['Metric', 'Pliers', 'Screwdrivers'])
  })

  it('keeps selection limited to visible unplaced tools and restores untagged tools after clearing', () => {
    const matching = getProjectCollections(project, taggedTools, [], { ...filters, projectTags: ['hex keys'] })
    expect(matching.filteredProjectTools).toHaveLength(2)
    expect(matching.actionableVisibleToolIds).toEqual(['tool-2'])
    const missing = getProjectCollections(project, taggedTools, [], { ...filters, projectTags: ['missing'], addToolTags: ['missing'] })
    expect(missing.filteredProjectTools).toEqual([])
    expect(missing.availableTools).toEqual([])
    const cleared = getProjectCollections(project, taggedTools, [], { ...filters, projectTags: [], addToolTags: [] })
    expect(cleared.availableTools.map(item => item.id)).toContain('tool-5')
  })
})
