import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPreferredTracerId, rememberTracerId } from './tracerPreference'

function installLocalStorage(overrides: Partial<Storage> = {}) {
  const data = new Map<string, string>()
  const storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
    ...overrides,
  } as Storage

  vi.stubGlobal('window', { localStorage: storage })
  return storage
}

describe('tracer preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a saved tracer only while it remains available', () => {
    const storage = installLocalStorage()
    rememberTracerId('isnet')

    expect(storage.getItem('tracefinity.trace.preferredTracer')).toBe('isnet')
    expect(getPreferredTracerId([{ id: 'isnet' }, { id: 'gemini' }])).toBe('isnet')
    expect(getPreferredTracerId([{ id: 'gemini' }])).toBeNull()
  })

  it('treats blocked reads as no saved preference', () => {
    installLocalStorage({
      getItem: () => {
        throw new Error('localStorage blocked')
      },
    })

    expect(getPreferredTracerId([{ id: 'isnet' }])).toBeNull()
  })

  it('does not throw when writes are blocked', () => {
    installLocalStorage({
      setItem: () => {
        throw new Error('localStorage blocked')
      },
    })

    expect(() => rememberTracerId('isnet')).not.toThrow()
  })
})
