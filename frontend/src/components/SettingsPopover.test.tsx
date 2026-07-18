// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SettingsPopover } from './SettingsPopover'

const getAppVersion = vi.fn()

vi.mock('@/lib/api', () => ({
  getAppVersion: () => getAppVersion(),
}))

describe('SettingsPopover version display', () => {
  afterEach(() => {
    cleanup()
    getAppVersion.mockReset()
  })

  it('shows the app version when the popover opens', async () => {
    getAppVersion.mockResolvedValue('0.6.0')
    render(<SettingsPopover />)

    fireEvent.click(screen.getByTitle('Settings'))

    expect(await screen.findByText('Version 0.6.0')).toBeTruthy()
  })

  it('omits the version line when the fetch fails', async () => {
    getAppVersion.mockRejectedValue(new Error('offline'))
    render(<SettingsPopover />)

    fireEvent.click(screen.getByTitle('Settings'))

    expect(await screen.findByText('Settings')).toBeTruthy()
    expect(screen.queryByText(/^Version /)).toBeNull()
  })
})
