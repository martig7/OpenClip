/**
 * Test-mode HTTP API server.
 *
 * Starts a real HTTP server on the same port as the dev API (47531) so that:
 *  - The Vite proxy (/api → 127.0.0.1:47531) works during manual dev:test sessions
 *  - RecordingsPage, ClipsPage, and StoragePage receive deterministic mock data
 *
 * The mock data mirrors src/mockData.js (browser fallback) so both code paths
 * behave consistently in test mode.
 */
const http = require('http');

const MOCK_RECORDINGS = [
  {
    filename: 'Valorant_2024-01-15_20-30-45.mp4',
    path: 'C:/Videos/Valorant/Valorant_2024-01-15_20-30-45.mp4',
    game_name: 'Valorant',
    date: '2024-01-15',
    size_bytes: 1500000000,
    size_formatted: '1.40 GB',
    mtime: 1705349445,
  },
  {
    filename: 'CS2_2024-01-14_18-22-10.mp4',
    path: 'C:/Videos/CS2/CS2_2024-01-14_18-22-10.mp4',
    game_name: 'Counter-Strike 2',
    date: '2024-01-14',
    size_bytes: 3200000000,
    size_formatted: '2.98 GB',
    mtime: 1705256530,
  },
];

const MOCK_CLIPS = [
  {
    filename: 'Valorant_highlight_001.mp4',
    path: 'C:/Videos/OpenClip/clips/Valorant_highlight_001.mp4',
    game_name: 'Valorant',
    date: '2024-01-15',
    size_bytes: 50000000,
    size_formatted: '47.68 MB',
    mtime: 1705350300,
  },
];

const MOCK_STORAGE_STATS = {
  recordings: MOCK_RECORDINGS,
  clips: MOCK_CLIPS,
  total_size: 4750000000,
  total_size_formatted: '4.43 GB',
  recording_size: 4700000000,
  recording_size_formatted: '4.38 GB',
  clip_size: 50000000,
  clip_size_formatted: '47.68 MB',
  recording_count: MOCK_RECORDINGS.length,
  clip_count: MOCK_CLIPS.length,
  games: {},
  disk_usage: null,
  locked_recordings: [],
};

const MOCK_STORAGE_SETTINGS = {
  auto_delete_enabled: false,
  max_storage_gb: 100,
  max_age_days: 30,
  exclude_clips: true,
};

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function startApiServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const pathname = req.url.split('?')[0];

    if (pathname === '/api/recordings' && req.method === 'GET') {
      return json(res, MOCK_RECORDINGS);
    }
    if (pathname === '/api/clips' && req.method === 'GET') {
      return json(res, MOCK_CLIPS);
    }
    if (pathname === '/api/storage/stats' && req.method === 'GET') {
      return json(res, MOCK_STORAGE_STATS);
    }
    if (pathname === '/api/storage/settings' && req.method === 'GET') {
      return json(res, MOCK_STORAGE_SETTINGS);
    }
    if (pathname === '/api/markers' && req.method === 'GET') {
      return json(res, { markers: [], duration: 0 });
    }
    if (pathname === '/api/video/tracks' && req.method === 'GET') {
      return json(res, { tracks: [] });
    }
    if (pathname === '/api/video/waveform' && req.method === 'GET') {
      return json(res, { peaks: [], duration: 0 });
    }
    if (pathname === '/api/ffmpeg-check' && req.method === 'GET') {
      return json(res, { available: false });
    }

    // All POST mutations succeed silently
    if (req.method === 'POST') {
      return json(res, { success: true });
    }

    json(res, { error: 'Not found' }, 404);
  });

  server.listen(47531, '127.0.0.1', () => {
    console.log('[test] Mock API server listening on http://127.0.0.1:47531');
  });

  return server;
}

module.exports = { startApiServer };
