/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CapturePage from './page'

const mocks = vi.hoisted(() => ({
  getAvailableKeys: vi.fn(),
  getPhotoStation: vi.fn(),
  getPreferredTracerId: vi.fn(),
  getSession: vi.fn(),
  getUserMedia: vi.fn(),
  listPhotoStations: vi.fn(),
  push: vi.fn(),
  searchParams: new URLSearchParams(),
  setCorners: vi.fn(),
  traceTools: vi.fn(),
  uploadImage: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('@/lib/api', () => ({
  getAvailableKeys: mocks.getAvailableKeys,
  getImageUrl: (path: string) => path,
  getPhotoStation: mocks.getPhotoStation,
  getSession: mocks.getSession,
  listPhotoStations: mocks.listPhotoStations,
  setCorners: mocks.setCorners,
  traceTools: mocks.traceTools,
  uploadImage: mocks.uploadImage,
}))

vi.mock('@/lib/tracerPreference', () => ({
  getPreferredTracerId: mocks.getPreferredTracerId,
}))

function fakeMediaStream() {
  const stop = vi.fn()
  const stream = {
    getTracks: () => [{ stop }],
  } as unknown as MediaStream
  return { stop, stream }
}

function mockReadyVideo() {
  const video = document.querySelector('video')
  if (!video) throw new Error('camera preview was not rendered')
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 640 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 480 })
}

function mockCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    drawImage: vi.fn(),
  }) as unknown as CanvasRenderingContext2D)
}

describe('capture workflow races', () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams()
    mocks.getAvailableKeys.mockReset().mockResolvedValue({
      google: true,
      photo_stations: false,
      tracers: [{ id: 'gemini', label: 'Gemini API' }],
    })
    mocks.getPhotoStation.mockReset()
    mocks.getPreferredTracerId.mockReset().mockReturnValue(null)
    mocks.getSession.mockReset()
    mocks.getUserMedia.mockReset()
    mocks.listPhotoStations.mockReset().mockResolvedValue([])
    mocks.push.mockReset()
    mocks.setCorners.mockReset()
    mocks.traceTools.mockReset()
    mocks.uploadImage.mockReset()

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('stops a camera stream that resolves after unmount', async () => {
    let resolveStream: (stream: MediaStream) => void = () => {}
    mocks.getUserMedia.mockReturnValue(new Promise<MediaStream>((resolve) => {
      resolveStream = resolve
    }))
    const { stop, stream } = fakeMediaStream()

    const view = render(<CapturePage />)
    await waitFor(() => expect(mocks.getUserMedia).toHaveBeenCalledTimes(1))
    view.unmount()

    await act(async () => {
      resolveStream(stream)
      await Promise.resolve()
    })

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('encodes and uploads only one frame for a double click', async () => {
    const { stream } = fakeMediaStream()
    mocks.getUserMedia.mockResolvedValue(stream)
    mocks.uploadImage.mockResolvedValue({
      session_id: 'session-1',
      corner_source: 'detected',
      station_id: null,
    })
    mockCanvas()
    let finishEncoding: BlobCallback = () => {}
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      finishEncoding = callback
    })

    render(<CapturePage />)
    const capture = await screen.findByRole('button', { name: /^Capture$/ })
    await waitFor(() => expect((capture as HTMLButtonElement).disabled).toBe(false))
    mockReadyVideo()

    fireEvent.click(capture)
    fireEvent.click(capture)

    expect(toBlob).toHaveBeenCalledTimes(1)
    expect(mocks.uploadImage).not.toHaveBeenCalled()

    await act(async () => {
      finishEncoding(new Blob(['image'], { type: 'image/jpeg' }))
      await Promise.resolve()
    })

    await waitFor(() => expect(mocks.uploadImage).toHaveBeenCalledTimes(1))
  })

  it('keeps the live camera available when Skip to Save fails', async () => {
    mocks.searchParams = new URLSearchParams('station=station-1&loop=1')
    mocks.getAvailableKeys.mockResolvedValue({
      google: true,
      photo_stations: true,
      tracers: [{ id: 'gemini', label: 'Gemini API' }],
    })
    mocks.getPreferredTracerId.mockReturnValue('gemini')
    mocks.listPhotoStations.mockResolvedValue([{ id: 'station-1', name: 'Desk station' }])
    mocks.getPhotoStation.mockResolvedValue({ capture_crop: null })
    mocks.uploadImage.mockResolvedValue({
      session_id: 'session-1',
      corner_source: 'station',
      station_id: 'station-1',
    })
    mocks.getSession.mockRejectedValue(new Error('quick processing failed'))
    const { stop, stream } = fakeMediaStream()
    mocks.getUserMedia.mockResolvedValue(stream)
    mockCanvas()
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['image'], { type: 'image/jpeg' }))
    })

    render(<CapturePage />)
    const skip = await screen.findByRole('button', { name: /^Skip to Save$/ })
    await waitFor(() => expect((skip as HTMLButtonElement).disabled).toBe(false))
    mockReadyVideo()

    fireEvent.click(skip)

    await screen.findByText('quick processing failed')
    expect(stop).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: /^Capture$/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})
