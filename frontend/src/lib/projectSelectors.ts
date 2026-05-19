import type { BinProject, BinProjectSummary, BinSummary, ProjectStatus, ToolSummary } from '@/types'

export const projectStatusLabels: Record<ProjectStatus, string> = {
  active: 'Active',
  ready_to_print: 'Ready to print',
  printed: 'Printed',
  archived: 'Archived',
}

export function binLabel(bin: BinSummary) {
  return bin.name || `Bin ${bin.id.slice(0, 8)}`
}

export function toolProjectLabel(
  projectIds: string[],
  projectNameById: Map<string, string>,
) {
  if (projectIds.length === 0) return null
  if (projectIds.length > 1) return `${projectIds.length} Projects`
  return projectNameById.get(projectIds[0]) || 'Project'
}

export function toolProjectTitle(
  projectIds: string[],
  projectNameById: Map<string, string>,
) {
  if (projectIds.length === 0) return undefined
  return projectIds.map(projectId => projectNameById.get(projectId) || 'Project').join(', ')
}

export function projectNameMap(projects: BinProjectSummary[]) {
  return new Map(projects.map(project => [project.id, project.name]))
}

export type ProjectToolFilter = 'all' | 'unplaced' | 'placed'

export function getProjectCollections(
  project: BinProject | null,
  tools: ToolSummary[],
  bins: BinSummary[],
  options: {
    projectSearch: string
    addToolSearch: string
    statusFilter: ProjectToolFilter
    allowReassignBins: boolean
  },
) {
  const projectToolIds = new Set(project?.tool_ids || [])
  const placedToolIds = new Set(project?.placed_tool_ids || [])
  const unplacedToolIds = new Set(project?.unplaced_tool_ids || [])
  const projectTools = tools.filter(tool => projectToolIds.has(tool.id))
  const projectBins = project
    ? bins.filter(bin => bin.project_id === project.id || project.bin_ids.includes(bin.id))
    : []
  const projectBinIds = new Set(projectBins.map(bin => bin.id))
  const toolById = new Map(tools.map(tool => [tool.id, tool]))

  let filteredProjectTools = projectTools
  if (options.statusFilter === 'unplaced') {
    filteredProjectTools = filteredProjectTools.filter(tool => unplacedToolIds.has(tool.id))
  }
  if (options.statusFilter === 'placed') {
    filteredProjectTools = filteredProjectTools.filter(tool => placedToolIds.has(tool.id))
  }
  if (options.projectSearch.trim()) {
    const q = options.projectSearch.toLowerCase()
    filteredProjectTools = filteredProjectTools.filter(tool => tool.name.toLowerCase().includes(q))
  }

  const toolBins = new Map<string, BinSummary[]>()
  for (const bin of projectBins) {
    for (const toolId of bin.tool_ids || []) {
      const current = toolBins.get(toolId) || []
      current.push(bin)
      toolBins.set(toolId, current)
    }
  }

  const existingBinOptions = bins.filter(bin => (
    !projectBinIds.has(bin.id) && (options.allowReassignBins || !bin.project_id)
  ))

  let availableTools = tools.filter(tool => !projectToolIds.has(tool.id))
  if (options.addToolSearch.trim()) {
    const q = options.addToolSearch.toLowerCase()
    availableTools = availableTools.filter(tool => tool.name.toLowerCase().includes(q))
  }

  const actionableVisibleToolIds = project
    ? filteredProjectTools
      .filter(tool => !placedToolIds.has(tool.id))
      .map(tool => tool.id)
    : []

  return {
    projectToolIds,
    placedToolIds,
    unplacedToolIds,
    projectTools,
    filteredProjectTools,
    projectBins,
    projectBinIds,
    toolById,
    toolBins,
    existingBinOptions,
    availableTools,
    actionableVisibleToolIds,
  }
}
