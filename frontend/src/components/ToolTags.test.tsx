// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToolTagsEditor, ToolTagFilter } from './ToolTags'

afterEach(cleanup)

function Editor() {
  const [tags, setTags] = useState(['Sockets'])
  return <ToolTagsEditor tags={tags} onChange={setTags} />
}

it('adds a multi-word tag with Enter, prevents duplicates, and removes tags', () => {
  render(<Editor />)
  const input = screen.getByLabelText('Tags')
  fireEvent.change(input, { target: { value: '  Hex keys  ' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByRole('button', { name: 'Remove tag Hex keys' })).toBeTruthy()
  fireEvent.change(input, { target: { value: 'hex KEYS' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
  expect(screen.getAllByRole('button', { name: /Remove tag/ })).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag Sockets' }))
  fireEvent.click(screen.getByRole('button', { name: 'Remove tag Hex keys' }))
  expect(screen.queryByRole('button', { name: /Remove tag/ })).toBeNull()
})

it('searches tags, selects multiple values, and clears without resetting the search', () => {
  function Filter() {
    const [value, setValue] = useState<string[]>([])
    return <ToolTagFilter tags={['Sockets', 'Hex keys', 'Pliers']} value={value} onChange={setValue} />
  }
  render(<Filter />)
  fireEvent.click(screen.getByRole('button', { name: 'Tags' }))
  const search = screen.getByRole('searchbox', { name: 'Search tags' }) as HTMLInputElement
  expect(document.activeElement).toBe(search)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sockets' }))
  fireEvent.change(search, { target: { value: 'HEX' } })
  expect(screen.queryByRole('checkbox', { name: 'Sockets' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Hex keys' }))
  expect(screen.getByRole('button', { name: 'Tags (2 selected)' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Clear tags' }))
  expect(screen.getByRole('button', { name: 'Tags' })).toBeTruthy()
  expect(search.value).toBe('HEX')
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tags' }))
})

it('keeps removed tags selectable and clears them, and dismisses on an outside click', () => {
  function Filter() {
    const [value, setValue] = useState(['sockets'])
    return <ToolTagFilter tags={[]} value={value} onChange={setValue} />
  }
  render(<Filter />)
  fireEvent.click(screen.getByRole('button', { name: 'Tags (1 selected)' }))
  const selected = screen.getByRole('checkbox', { name: 'sockets' }) as HTMLInputElement
  expect(selected.checked).toBe(true)
  fireEvent.click(selected)
  expect(screen.getByText('No tags yet.')).toBeTruthy()
  fireEvent.mouseDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
})
