import { vi } from 'vitest'

/**
 * Creates an in-memory store mock that mirrors the real store's get/set interface.
 * Supports dot-notation reads: get('settings.obsRecordingPath')
 */
export function makeMockStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial))

  function deepGet(obj, key) {
    return key.split('.').reduce((o, k) => o?.[k], obj)
  }

  return {
    get: vi.fn((key) => deepGet(data, key)),
    set: vi.fn((key, val) => {
      const parts = key.split('.')
      let obj = data
      for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] === undefined) obj[parts[i]] = {}
        obj = obj[parts[i]]
      }
      obj[parts[parts.length - 1]] = val
    }),
    _data: data,
  }
}
