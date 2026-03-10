import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export function createTestServer(...handlers) {
  return setupServer(...handlers)
}

// Reusable MSW handler factories for common API endpoints
export const handlers = {
  recordings: (data = []) =>
    http.get('/api/recordings', () => HttpResponse.json(data)),

  clips: (data = []) =>
    http.get('/api/clips', () => HttpResponse.json(data)),

  deleteClip: (success = true) =>
    http.post('/api/clips/delete', () =>
      success
        ? HttpResponse.json({ success: true })
        : HttpResponse.json({ error: 'Forbidden' }, { status: 403 })
    ),

  storageStats: (data = {}) =>
    http.get('/api/storage/stats', () => HttpResponse.json(data)),

  storageSettings: (data = {}) =>
    http.get('/api/storage/settings', () => HttpResponse.json(data)),

  saveStorageSettings: (success = true) =>
    http.post('/api/storage/settings', () =>
      HttpResponse.json({ success })
    ),

  videoTracks: (tracks = []) =>
    http.get('/api/video/tracks', () => HttpResponse.json({ tracks })),

  markers: (data = { markers: [] }) =>
    http.get('/api/markers', () => HttpResponse.json(data)),

  createClip: (result = {}) =>
    http.post('/api/clips/create', () => HttpResponse.json(result)),

  openExternal: () =>
    http.post('/api/open-external', () => HttpResponse.json({ success: true })),

  showInExplorer: () =>
    http.post('/api/show-in-explorer', () => HttpResponse.json({ success: true })),

  storageLock: () =>
    http.post('/api/storage/lock', () => HttpResponse.json({ success: true })),

  deleteBatch: (result = {}) =>
    http.post('/api/storage/delete-batch', () => HttpResponse.json({ success: true, ...result })),

  reencode: (result = {}) =>
    http.post('/api/reencode', () => HttpResponse.json({ success: true, ...result })),
}
