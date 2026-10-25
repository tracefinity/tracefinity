import type { ToolSummary } from '@/types'

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.map(tag => tag.trim()).filter(tag => {
    const key = tag.toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function libraryTags(tools: Pick<ToolSummary, 'tags'>[]): string[] {
  return normalizeTags(tools.flatMap(tool => tool.tags)).sort((a, b) => a.localeCompare(b))
}

export function matchesToolTags(tool: Pick<ToolSummary, 'tags'>, tags: string[]): boolean {
  const selected = new Set(tags.map(tag => tag.trim().toLowerCase()))
  return selected.size === 0 || tool.tags.some(tag => selected.has(tag.trim().toLowerCase()))
}
