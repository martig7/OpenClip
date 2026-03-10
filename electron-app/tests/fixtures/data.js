export const sampleRecording = {
  path: 'C:\\Users\\Test\\Dest\\Halo - Week of Jan 13 2025\\Halo Session 2025-01-15 #1.mp4',
  filename: 'Halo Session 2025-01-15 #1.mp4',
  game_name: 'Halo',
  date: '2025-01-15',
  size_bytes: 2_147_483_648,
  size_formatted: '2.0 GB',
  mtime: 1705339800,
}

export const sampleClip = {
  path: 'C:\\Users\\Test\\Dest\\Clips\\Halo Clip 2025-01-15 #1.mp4',
  filename: 'Halo Clip 2025-01-15 #1.mp4',
  game_name: 'Halo',
  date: '2025-01-15',
  size_bytes: 104_857_600,
  size_formatted: '100.0 MB',
  mtime: 1705340000,
}

export const sampleAudioTracks = [
  {
    index: 0,
    stream_index: 0,
    codec_name: 'aac',
    channels: 2,
    channel_layout: 'stereo',
    sample_rate: '48000',
    title: 'Game Audio',
  },
  {
    index: 1,
    stream_index: 1,
    codec_name: 'opus',
    channels: 2,
    channel_layout: 'stereo',
    sample_rate: '48000',
    title: 'Discord',
  },
]

export const sampleStorageStats = {
  recordings: [sampleRecording],
  clips: [sampleClip],
  total_size: sampleRecording.size_bytes + sampleClip.size_bytes,
  total_size_formatted: '2.1 GB',
  recording_size: sampleRecording.size_bytes,
  recording_size_formatted: '2.0 GB',
  clip_size: sampleClip.size_bytes,
  clip_size_formatted: '100.0 MB',
  recording_count: 1,
  clip_count: 1,
  games: {
    Halo: {
      recordings: [sampleRecording],
      clips: [sampleClip],
      total_size: sampleRecording.size_bytes + sampleClip.size_bytes,
    },
  },
  disk_usage: null,
  locked_recordings: [],
}

export const sampleStorageSettings = {
  auto_delete_enabled: false,
  max_storage_gb: 100,
  max_age_days: 30,
  exclude_clips: true,
}
