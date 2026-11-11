// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ToolPage from './page'

const mocks = vi.hoisted(() => ({ toolId: 'first', getTool: vi.fn(), updateTool: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: mocks.toolId }) }))
vi.mock('@/hooks/useProjectSource', () => ({ useProjectSource: () => ({ rootLabel: 'Tools', rootHref: '/' }) }))
vi.mock('@/components/ToolEditor', () => ({ ToolEditor: () => null }))
vi.mock('@/components/Breadcrumb', () => ({ Breadcrumb: ({ segments }: { segments: { label: string; onEdit?: (name: string) => void }[] }) => (
  <button onClick={() => segments[1].onEdit?.('Renamed')}>{segments[1].label}</button>
) }))
vi.mock('@/lib/api', () => ({
  getTool: mocks.getTool, updateTool: mocks.updateTool, listProjects: async () => [],
  getImageUrl: (url: string) => url, getToolSvgUrl: () => '/tool.svg', autoRotateTool: vi.fn(),
}))

function tool(id: string) {
  return { id, name: id, points: [], height_mm: null, tags: [], project_ids: [], finger_holes: [], interior_rings: [], smoothed: false, smooth_level: 0.5 }
}

afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.toolId = 'first' })

it('flushes a pending edit when leaving before the debounce fires', async () => {
  mocks.getTool.mockResolvedValue(tool('first'))
  mocks.updateTool.mockResolvedValue(undefined)
  const { unmount } = render(<ToolPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'first' }))
  unmount()
  await waitFor(() => expect(mocks.updateTool).toHaveBeenCalledWith('first', expect.objectContaining({ name: 'Renamed' })))
})

it('does not apply a stale load to a different tool after navigation', async () => {
  let resolveFirst!: (value: ReturnType<typeof tool>) => void
  const first = new Promise<ReturnType<typeof tool>>(resolve => { resolveFirst = resolve })
  mocks.getTool.mockImplementation((id: string) => id === 'first' ? first : Promise.resolve(tool(id)))
  const { rerender } = render(<ToolPage />)
  mocks.toolId = 'second'
  rerender(<ToolPage />)
  await screen.findByRole('button', { name: 'second' })
  await act(async () => { resolveFirst(tool('first')); await first })
  expect(screen.getByRole('button', { name: 'second' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'first' })).toBeNull()
  expect(mocks.updateTool).not.toHaveBeenCalled()
})
