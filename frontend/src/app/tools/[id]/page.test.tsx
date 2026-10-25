// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ToolPage from './page'

const { updateTool, getTool } = vi.hoisted(() => ({ updateTool: vi.fn(), getTool: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'tool-1' }) }))
vi.mock('@/hooks/useProjectSource', () => ({ useProjectSource: () => ({ rootLabel: 'Tools', rootHref: '/' }) }))
vi.mock('@/components/ToolEditor', () => ({ ToolEditor: () => null }))
vi.mock('@/components/Breadcrumb', () => ({ Breadcrumb: () => null }))
vi.mock('@/lib/api', () => ({
  updateTool, getTool, listProjects: async () => [], getImageUrl: (url: string) => url,
  getToolSvgUrl: () => '/tool.svg', autoRotateTool: vi.fn(),
}))

afterEach(() => { cleanup(); vi.resetAllMocks() })

it('does not rewrite a tool merely by opening it', async () => {
  getTool.mockResolvedValue({ id: 'tool-1', name: 'Hex key', points: [], tags: ['Metric'], project_ids: [], finger_holes: [], interior_rings: [], smoothed: false, smooth_level: 0.5 })
  render(<ToolPage />)
  await screen.findByLabelText('Tags')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)) })
  expect(updateTool).not.toHaveBeenCalled()
})

it('saves tag edits with the current outline and makes a failed save retryable', async () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]
  getTool.mockResolvedValue({ id: 'tool-1', name: 'Hex key', points, tags: [], project_ids: [], finger_holes: [], interior_rings: [], smoothed: false, smooth_level: 0.5 })
  updateTool.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
  render(<ToolPage />)
  const input = await screen.findByLabelText('Tags')
  // An edit immediately after load must not fall into the old arming delay.
  fireEvent.change(input, { target: { value: 'Hex keys' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(updateTool).toHaveBeenLastCalledWith('tool-1', expect.objectContaining({ tags: ['Hex keys'], points }))
  fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  expect(updateTool).toHaveBeenCalledTimes(2)
})
