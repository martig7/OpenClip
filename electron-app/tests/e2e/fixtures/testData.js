/**
 * Test fixtures for E2E tests.
 * Provides mock data and utilities for Playwright tests.
 */

export const testGames = [
  {
    id: 'test-1',
    name: 'Test Game 1',
    exe: 'testgame1.exe',
    selector: 'Test Game 1',
    enabled: true,
    scene: 'GameCapture',
  },
  {
    id: 'test-2',
    name: 'Test Game 2',
    exe: 'testgame2.exe',
    selector: 'Test Game 2 Window',
    enabled: true,
    scene: 'Scene',
  },
];

export const testSettings = {
  obsRecordingPath: 'C:\\Users\\TestUser\\Videos\\OBS',
  destinationPath: 'C:\\Users\\TestUser\\Videos\\OpenClip',
  startWatcherOnStartup: false,
  clipMarkerHotkey: 'F9',
  listView: true,
};

// API response shapes for /api/recordings and /api/clips
export const testRecordings = [
  {
    filename: 'Valorant_2024-01-15_20-30-45.mp4',
    path: 'C:/Videos/Valorant/Valorant_2024-01-15_20-30-45.mp4',
    game_name: 'Valorant',
    date: '2024-01-15',
    size_formatted: '1.40 GB',
    size_bytes: 1500000000,
    mtime: 1705349445000,
  },
  {
    filename: 'CS2_2024-01-14_18-22-10.mp4',
    path: 'C:/Videos/CS2/CS2_2024-01-14_18-22-10.mp4',
    game_name: 'Counter-Strike 2',
    date: '2024-01-14',
    size_formatted: '2.98 GB',
    size_bytes: 3200000000,
    mtime: 1705256530000,
  },
];

export const testClips = [
  {
    filename: 'Valorant_highlight_001.mp4',
    path: 'C:/Videos/OpenClip/clips/Valorant_highlight_001.mp4',
    game_name: 'Valorant',
    date: '2024-01-15',
    size_formatted: '47.68 MB',
    size_bytes: 50000000,
    mtime: 1705350300000,
  },
];

// API response shape for /api/storage/stats
export const testStorageStats = {
  total_size_formatted: '4.43 GB',
  recording_count: 2,
  clip_count: 1,
  recordings: [
    {
      filename: 'Valorant_2024-01-15_20-30-45.mp4',
      path: 'C:/Videos/Valorant/Valorant_2024-01-15_20-30-45.mp4',
      game_name: 'Valorant',
      date: '2024-01-15',
      size_formatted: '1.40 GB',
      size_bytes: 1500000000,
      mtime: 1705349445000,
      type: 'recording',
    },
    {
      filename: 'CS2_2024-01-14_18-22-10.mp4',
      path: 'C:/Videos/CS2/CS2_2024-01-14_18-22-10.mp4',
      game_name: 'Counter-Strike 2',
      date: '2024-01-14',
      size_formatted: '2.98 GB',
      size_bytes: 3200000000,
      mtime: 1705256530000,
      type: 'recording',
    },
  ],
  clips: [
    {
      filename: 'Valorant_highlight_001.mp4',
      path: 'C:/Videos/OpenClip/clips/Valorant_highlight_001.mp4',
      game_name: 'Valorant',
      date: '2024-01-15',
      size_formatted: '47.68 MB',
      size_bytes: 50000000,
      mtime: 1705350300000,
      type: 'clip',
    },
  ],
  locked_recordings: [],
};

// API response shape for /api/storage/settings
export const testStorageSettings = {
  auto_delete_enabled: false,
  max_storage_gb: 100,
  max_age_days: 30,
  exclude_clips: true,
};

export async function setupTestGames(page) {
  await page.evaluate((games) => {
    window.__testGames = games;
  }, testGames);
}
