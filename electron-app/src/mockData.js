export const defaultSettings = {
  obsRecordingPath: '',
  destinationPath: '',
  startWatcherOnStartup: false,
  clipMarkerHotkey: 'F9',
  listView: true,
  autoClip: {
    enabled: false,
    bufferBefore: 15,
    bufferAfter: 15,
    removeMarkers: true,
    deleteFullRecording: false,
  },
  autoDelete: {
    enabled: false,
    maxStorageGB: 100,
    maxAgeDays: 30,
    excludeClips: true,
  },
};

export const mockGames = [
  {
    id: '1',
    name: 'Valorant',
    exe: 'VALORANT.exe',
    windowClass: 'RiotWindowClass',
    selector: 'valorant',
    scene: 'Valorant',
    icon_path: '',
    enabled: true,
  },
  {
    id: '2',
    name: 'Counter-Strike 2',
    exe: 'cs2.exe',
    windowClass: 'class512',
    selector: 'cs2',
    scene: 'CS2',
    icon_path: '',
    enabled: true,
  },
];

export const mockRecordings = [
  {
    id: '1',
    filename: 'Valorant_2024-01-15_20-30-45.mp4',
    path: 'C:/Videos/Valorant/Valorant_2024-01-15_20-30-45.mp4',
    game_name: 'Valorant',
    start_time: '2024-01-15T20:30:45Z',
    duration: 1823,
    size: 1500000000,
  },
  {
    id: '2',
    filename: 'CS2_2024-01-14_18-22-10.mp4',
    path: 'C:/Videos/CS2/CS2_2024-01-14_18-22-10.mp4',
    game_name: 'Counter-Strike 2',
    start_time: '2024-01-14T18:22:10Z',
    duration: 3600,
    size: 3200000000,
  },
];

export const mockClips = [
  {
    id: '1',
    filename: 'Valorant_highlight_001.mp4',
    path: 'C:/Videos/OpenClip/clips/Valorant_highlight_001.mp4',
    game_name: 'Valorant',
    start_time: '2024-01-15T20:45:00Z',
    duration: 30,
    size: 50000000,
  },
];

export const mockStorageStats = {
  totalSize: 4750000000,
  recordingCount: 2,
  clipCount: 1,
  byGame: {
    Valorant: 1500000000,
    'Counter-Strike 2': 3200000000,
    Clips: 50000000,
  },
};
