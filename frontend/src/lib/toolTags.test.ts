import { describe, expect, it } from 'vitest'
import { libraryTags, matchesToolTags, normalizeTags } from './toolTags'

describe('tool tags', () => {
  it('trims, removes empty values and deduplicates without losing multi-word tags', () => {
    expect(normalizeTags([' Hex keys ', '', 'hex KEYS', 'Sockets', '  '])).toEqual(['Hex keys', 'Sockets'])
  })

  it('collects unique tags across projects for the library filter', () => {
    expect(libraryTags([{ tags: ['Sockets', 'Hex keys'] }, { tags: ['sockets', 'Measuring'] }, { tags: [] }]))
      .toEqual(['Hex keys', 'Measuring', 'Sockets'])
  })

  it('matches any full selected tag without case sensitivity, while no selection includes untagged tools', () => {
    expect(matchesToolTags({ tags: ['Hex keys'] }, ['Sockets', 'HEX KEYS'])).toBe(true)
    expect(matchesToolTags({ tags: ['Hex keys'] }, ['hex'])).toBe(false)
    expect(matchesToolTags({ tags: [] }, ['hex keys'])).toBe(false)
    expect(matchesToolTags({ tags: [] }, [])).toBe(true)
  })
})
