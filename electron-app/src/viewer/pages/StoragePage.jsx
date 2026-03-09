import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardDrive, Film, Scissors, BarChart2, Trash2, Settings, Save, Info, Lock, Unlock, Loader, Package, Check, X } from 'lucide-react'
import Modal from '../components/Modal'
import { apiFetch } from '../apiBase'

function StoragePage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [settings, setSettings] = useState(null)
  const [editedSettings, setEditedSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [deleteModal, setDeleteModal] = useState(false)
  const [reencodeModal, setReencodeModal] = useState(false)
  const [reencodeSettings, setReencodeSettings] = useState({
    codec: 'h265',
    crf: 23,
    preset: 'medium',
    replaceOriginal: false
  })
  const [isReencoding, setIsReencoding] = useState(false)
  const [reencodeProgress, setReencodeProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const [reencodeAudioTracks, setReencodeAudioTracks] = useState([])
  const [reencodeSelectedTracks, setReencodeSelectedTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [toast, setToast] = useState(null)
  const [filterType, setFilterType] = useState('all') // 'all', 'recordings', 'clips'
  const [filterGame, setFilterGame] = useState('all') // 'all' or specific game name
  const [sortBy, setSortBy] = useState('date') // 'date', 'size', 'name', 'game'
  const [lockedRecordings, setLockedRecordings] = useState(new Set())

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiFetch('/api/storage/stats')
      const data = await response.json()
      setStats(data)
      setLockedRecordings(new Set(data.locked_recordings || []))
    } catch (error) {
      console.error('Failed to fetch storage stats:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const response = await apiFetch('/api/storage/settings')
      const data = await response.json()
      setSettings(data)
      setEditedSettings(data)
    } catch (error) {
      console.error('Failed to fetch storage settings:', error)
    }
  }, [])

  useEffect(() => {
    fetchStats()
    fetchSettings()
  }, [fetchStats, fetchSettings])

  const showToast = useCallback((type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const toggleSelection = useCallback((path) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(path)) {
        newSet.delete(path)
      } else {
        newSet.add(path)
      }
      return newSet
    })
  }, [])

  const toggleLock = useCallback(async (path) => {
    const normalizedPath = path.replace(/\//g, '\\')
    const isLocked = lockedRecordings.has(normalizedPath)

    try {
      const response = await apiFetch('/api/storage/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, locked: !isLocked })
      })

      if (response.ok) {
        setLockedRecordings(prev => {
          const newSet = new Set(prev)
          if (isLocked) {
            newSet.delete(normalizedPath)
          } else {
            newSet.add(normalizedPath)
          }
          return newSet
        })
        showToast('success', isLocked ? 'Recording unlocked' : 'Recording locked')
      }
    } catch (error) {
      showToast('error', 'Failed to toggle lock')
    }
  }, [lockedRecordings, showToast])

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return

    try {
      const response = await apiFetch('/api/storage/delete-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: Array.from(selectedItems) })
      })

      const data = await response.json()

      if (response.ok) {
        setSelectedItems(new Set())
        setDeleteModal(false)
        fetchStats()

        let message = `Deleted ${data.deleted_count} item(s)`
        if (data.skipped_locked_count > 0) {
          message += `, skipped ${data.skipped_locked_count} locked`
        }
        if (data.failed_count > 0) {
          message += `, ${data.failed_count} failed`
        }
        showToast('success', message)
      }
    } catch (error) {
      showToast('error', 'Failed to delete items')
    }
  }, [selectedItems, fetchStats, showToast])

  const updateSettings = useCallback(async (newSettings) => {
    try {
      const response = await apiFetch('/api/storage/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_settings: newSettings })
      })

      if (response.ok) {
        setSettings(newSettings)
        setEditedSettings(newSettings)
        showToast('success', 'Settings saved')
      }
    } catch (error) {
      showToast('error', 'Failed to save settings')
    }
  }, [showToast])

  const handleSaveSettings = useCallback(() => {
    if (!editedSettings) return

    // Validate and sanitize settings before saving
    const validatedSettings = {
      ...editedSettings,
      max_storage_gb: Math.max(1, parseInt(editedSettings.max_storage_gb) || 100),
      max_age_days: Math.max(1, parseInt(editedSettings.max_age_days) || 30)
    }

    updateSettings(validatedSettings)
  }, [editedSettings, updateSettings])

  const hasUnsavedChanges = useCallback(() => {
    if (!settings || !editedSettings) return false
    return JSON.stringify(settings) !== JSON.stringify(editedSettings)
  }, [settings, editedSettings])

  const fetchReencodeTracks = useCallback(async () => {
    const paths = Array.from(selectedItems)
    if (paths.length === 0) return

    setLoadingTracks(true)
    try {
      const response = await apiFetch(`/api/video/tracks?path=${encodeURIComponent(paths[0])}`)
      const data = await response.json()
      if (response.ok && data.tracks) {
        setReencodeAudioTracks(data.tracks)
        setReencodeSelectedTracks(data.tracks.map((_, i) => i))
      } else {
        setReencodeAudioTracks([])
        setReencodeSelectedTracks([])
      }
    } catch {
      setReencodeAudioTracks([])
      setReencodeSelectedTracks([])
    } finally {
      setLoadingTracks(false)
    }
  }, [selectedItems])

  const toggleReencodeTrack = useCallback((index) => {
    setReencodeSelectedTracks(prev => {
      if (prev.includes(index)) {
        if (prev.length <= 1) return prev
        return prev.filter(i => i !== index)
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }, [])

  const handleReencode = useCallback(async () => {
    if (selectedItems.size === 0) return

    setIsReencoding(true)
    const paths = Array.from(selectedItems)
    const totalFiles = paths.length
    let successCount = 0
    let failCount = 0
    let totalSavings = 0

    const audioTracksParam = reencodeAudioTracks.length > 1 && reencodeSelectedTracks.length < reencodeAudioTracks.length
      ? reencodeSelectedTracks : null

    setReencodeProgress({ current: 0, total: totalFiles, currentFile: '' })

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      const item = getAllItems().find(item => item.path === path)
      const filename = item?.filename || path.split(/[\\/]/).pop()

      setReencodeProgress({ current: i + 1, total: totalFiles, currentFile: filename })

      try {
        const response = await apiFetch('/api/reencode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_path: path,
            codec: reencodeSettings.codec,
            crf: reencodeSettings.crf,
            preset: reencodeSettings.preset,
            replace_original: reencodeSettings.replaceOriginal,
            original_size: item?.size_bytes || 0,
            audio_tracks: audioTracksParam
          })
        })

        const data = await response.json()

        if (response.ok) {
          successCount++
          totalSavings += data.savings || 0
        } else {
          failCount++
        }
      } catch (error) {
        failCount++
      }
    }

    setIsReencoding(false)
    setReencodeModal(false)
    setReencodeProgress({ current: 0, total: 0, currentFile: '' })
    setSelectedItems(new Set())
    fetchStats()

    const label = reencodeSettings.codec === 'copy' ? 'Re-exported' : 'Reencoded'
    const savingsFormatted = totalSavings > 0 ? ` (saved ${formatBytes(totalSavings)})` : ''
    showToast('success', `${label} ${successCount} file(s)${savingsFormatted}${failCount > 0 ? `, ${failCount} failed` : ''}`)
  }, [selectedItems, reencodeSettings, reencodeAudioTracks, reencodeSelectedTracks, fetchStats, showToast])

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleItemClick = useCallback((item) => {
    if (item.type === 'clip') {
      navigate(`/clips?path=${encodeURIComponent(item.path)}`)
    } else {
      navigate(`/recordings?path=${encodeURIComponent(item.path)}`)
    }
  }, [navigate])

  const getUniqueGames = useCallback(() => {
    if (!stats) return []
    const games = new Set()
    stats.recordings.forEach(r => games.add(r.game_name))
    stats.clips.forEach(c => games.add(c.game_name))
    return Array.from(games).sort()
  }, [stats])

  const getAllItems = useCallback(() => {
    if (!stats) return []

    let items = []

    if (filterType === 'all' || filterType === 'recordings') {
      items = [...items, ...stats.recordings.map(r => ({ ...r, type: 'recording' }))]
    }

    if (filterType === 'all' || filterType === 'clips') {
      items = [...items, ...stats.clips.map(c => ({ ...c, type: 'clip' }))]
    }

    // Filter by game
    if (filterGame !== 'all') {
      items = items.filter(item => item.game_name === filterGame)
    }

    // Sort items
    items.sort((a, b) => {
      if (sortBy === 'date') {
        return b.mtime - a.mtime
      } else if (sortBy === 'size') {
        return b.size_bytes - a.size_bytes
      } else if (sortBy === 'game') {
        // Sort by game name, then by date within each game
        const gameCompare = a.game_name.localeCompare(b.game_name)
        if (gameCompare !== 0) return gameCompare
        return b.mtime - a.mtime
      } else {
        return a.filename.localeCompare(b.filename)
      }
    })

    return items
  }, [stats, filterType, filterGame, sortBy])

  const getSizeClass = useCallback((sizeBytes) => {
    const gb = sizeBytes / (1024 ** 3)
    if (gb < 0.5) return 'small'
    if (gb < 2) return 'medium'
    return 'large'
  }, [])

  const formatDuration = useCallback((seconds) => {
    if (!seconds) return 'Unknown'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hours > 0) return `${hours}h ${mins}m`
    return `${mins}m`
  }, [])

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  const items = getAllItems()
  const selectedCount = selectedItems.size
  const lockedCount = items.filter(item => {
    const normalized = item.path.replace(/\//g, '\\')
    return lockedRecordings.has(normalized)
  }).length

  return (
    <div className="page-content storage-page">
      {/* Header Stats */}
      <div className="storage-header">
        <div className="storage-stats-grid">
          <div className="stat-card">
            <div className="stat-icon"><HardDrive size={22} /></div>
            <div className="stat-content">
              <div className="stat-label">Total Storage</div>
              <div className="stat-value">{stats?.total_size_formatted || '0 B'}</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon"><Film size={22} /></div>
            <div className="stat-content">
              <div className="stat-label">Recordings</div>
              <div className="stat-value">{stats?.recording_count || 0}</div>
              <div className="stat-detail">{stats?.recording_size_formatted || '0 B'}</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon"><Scissors size={22} /></div>
            <div className="stat-content">
              <div className="stat-label">Clips</div>
              <div className="stat-value">{stats?.clip_count || 0}</div>
              <div className="stat-detail">{stats?.clip_size_formatted || '0 B'}</div>
            </div>
          </div>

          {stats?.disk_usage && (
            <div className="stat-card">
              <div className="stat-icon"><BarChart2 size={22} /></div>
              <div className="stat-content">
                <div className="stat-label">Disk Space</div>
                <div className="stat-value">{stats.disk_usage.free_formatted} free</div>
                <div className="stat-detail">{stats.disk_usage.used_formatted} / {stats.disk_usage.total_formatted}</div>
              </div>
            </div>
          )}
        </div>

        {/* Controls Bar */}
        <div className="storage-controls">
          <div className="control-group">
            <label>Filter:</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All</option>
              <option value="recordings">Recordings Only</option>
              <option value="clips">Clips Only</option>
            </select>
          </div>

          <div className="control-group">
            <label>Game:</label>
            <select value={filterGame} onChange={(e) => setFilterGame(e.target.value)}>
              <option value="all">All Games</option>
              {getUniqueGames().map(game => (
                <option key={game} value={game}>{game}</option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>Sort by:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date">Date (Newest First)</option>
              <option value="size">Size (Largest First)</option>
              <option value="name">Name</option>
              <option value="game">Game</option>
            </select>
          </div>

          <div className="control-group">
            <span className="selection-info">
              {selectedCount > 0 ? `${selectedCount} selected` : `${items.length} items`}
              {lockedCount > 0 && ` • ${lockedCount} locked`}
            </span>
          </div>

          <div className="control-actions">
            {selectedCount > 0 && (
              <>
                <button className="btn btn-secondary" onClick={() => setSelectedItems(new Set())}>
                  Clear Selection
                </button>
                <button className="btn btn-primary" onClick={() => { setReencodeModal(true); fetchReencodeTracks() }}>
                  <Film size={14} /> Reencode Selected ({selectedCount})
                </button>
                <button className="btn btn-danger" onClick={() => setDeleteModal(true)}>
                  <Trash2 size={14} /> Delete Selected ({selectedCount})
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Auto-Delete Settings */}
      {editedSettings && (
        <div className="settings-panel">
          <h3><Settings size={15} /> Auto-Delete Settings</h3>
          <div className="settings-grid">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editedSettings.auto_delete_enabled || false}
                onChange={(e) => setEditedSettings({ ...editedSettings, auto_delete_enabled: e.target.checked })}
              />
              Enable automatic deletion
            </label>

            <div className="setting-row">
              <label>Max Storage (GB):</label>
              <input
                type="text"
                value={editedSettings.max_storage_gb ?? ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '')
                  setEditedSettings({ ...editedSettings, max_storage_gb: val })
                }}
                disabled={!editedSettings.auto_delete_enabled}
                placeholder="100"
              />
            </div>

            <div className="setting-row">
              <label>Max Age (days):</label>
              <input
                type="text"
                value={editedSettings.max_age_days ?? ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '')
                  setEditedSettings({ ...editedSettings, max_age_days: val })
                }}
                disabled={!editedSettings.auto_delete_enabled}
                placeholder="30"
              />
            </div>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={editedSettings.exclude_clips !== false}
                onChange={(e) => setEditedSettings({ ...editedSettings, exclude_clips: e.target.checked })}
                disabled={!editedSettings.auto_delete_enabled}
              />
              Don't auto-delete clips
            </label>
          </div>
          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={handleSaveSettings}
              disabled={!hasUnsavedChanges()}
            >
              <Save size={14} /> Save Settings
            </button>
          </div>
          <p className="settings-note">
            <Info size={13} /> Auto-deletion runs when starting the game watcher. Locked recordings are never deleted.
          </p>
        </div>
      )}

      {/* Masonry Grid */}
      <div className="storage-grid-container">
        <div className="storage-grid">
          {items.map((item) => {
            const isSelected = selectedItems.has(item.path)
            const normalizedPath = item.path.replace(/\//g, '\\')
            const isLocked = lockedRecordings.has(normalizedPath)
            const sizeClass = getSizeClass(item.size_bytes)

            return (
              <div
                key={item.path}
                className={`storage-item ${sizeClass} ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
              >
                <div className="item-checkbox">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(item.path)}
                  />
                </div>

                <div className="item-lock" onClick={() => toggleLock(item.path)} title={isLocked ? 'Unlock' : 'Lock'}>
                  {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                </div>

                <div className="item-type-badge">{item.type === 'clip' ? <Scissors size={12} /> : <Film size={12} />}</div>

                <div className="item-content">
                  <div className="item-clickable" onClick={() => handleItemClick(item)}>
                    <div className="item-game">{item.game_name}</div>
                    <div className="item-filename">{item.filename}</div>
                    <div className="item-meta">
                      <span className="item-size">{item.size_formatted}</span>
                      <span className="item-date">{item.date}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Reencode Modal */}
      {reencodeModal && (
        <div className="modal-overlay" onClick={() => !isReencoding && setReencodeModal(false)}>
          <div className="modal-content reencode-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Reencode Videos</h2>
            <p>Reencode {selectedCount} selected video(s) to a different codec</p>

            <div className="reencode-settings">
              <div className="setting-row">
                <label>Codec:</label>
                <select
                  value={reencodeSettings.codec}
                  onChange={(e) => setReencodeSettings({...reencodeSettings, codec: e.target.value})}
                  disabled={isReencoding}
                >
                  <option value="h264">H.264 (widely compatible)</option>
                  <option value="h265">H.265/HEVC (better compression)</option>
                  <option value="av1">AV1 (best compression, slower)</option>
                  <option value="copy">Stream Copy (track removal only, instant)</option>
                </select>
              </div>

              {reencodeSettings.codec !== 'copy' && (
                <>
                  <div className="setting-row">
                    <label>Quality (CRF):</label>
                    <input
                      type="range"
                      min="18"
                      max="28"
                      value={reencodeSettings.crf}
                      onChange={(e) => setReencodeSettings({...reencodeSettings, crf: parseInt(e.target.value)})}
                      disabled={isReencoding}
                    />
                    <span>{reencodeSettings.crf} {reencodeSettings.crf < 20 ? '(high)' : reencodeSettings.crf < 24 ? '(medium)' : '(low)'}</span>
                  </div>

                  <div className="setting-row">
                    <label>Speed Preset:</label>
                    <select
                      value={reencodeSettings.preset}
                      onChange={(e) => setReencodeSettings({...reencodeSettings, preset: e.target.value})}
                      disabled={isReencoding}
                    >
                      <option value="veryfast">Very Fast (larger file)</option>
                      <option value="fast">Fast</option>
                      <option value="medium">Medium (recommended)</option>
                      <option value="slow">Slow (smaller file)</option>
                      <option value="veryslow">Very Slow (smallest file)</option>
                    </select>
                  </div>
                </>
              )}

              {reencodeAudioTracks.length > 1 && (
                <div className="clip-tracks">
                  <label className="clip-tracks-label">Audio Tracks</label>
                  {loadingTracks ? (
                    <div className="track-loading">Loading tracks...</div>
                  ) : (
                    <div className="track-list">
                      {reencodeAudioTracks.map((track, i) => (
                        <label key={i} className="track-item">
                          <input
                            type="checkbox"
                            checked={reencodeSelectedTracks.includes(i)}
                            onChange={() => toggleReencodeTrack(i)}
                            disabled={isReencoding}
                          />
                          <span className="track-name">{track.title || `Track ${i + 1}`}</span>
                          <span className="track-detail">{track.codec_name} · {track.channels}ch</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reencodeSettings.replaceOriginal}
                  onChange={(e) => setReencodeSettings({...reencodeSettings, replaceOriginal: e.target.checked})}
                  disabled={isReencoding}
                />
                Replace original files (saves space)
              </label>

              <p className="modal-note">
                {reencodeSettings.codec === 'copy'
                  ? 'Stream copy re-exports the video without re-encoding. Use this to quickly remove unwanted audio tracks.'
                  : 'Reencoding may take several minutes per video. Lower CRF = better quality but larger files. H.265 typically saves 30-50% space compared to H.264.'}
              </p>
            </div>

            {isReencoding && (
              <div className="reencode-progress">
                <div className="progress-info">
                  <span>Reencoding {reencodeProgress.current} of {reencodeProgress.total}</span>
                  <span className="progress-filename">{reencodeProgress.currentFile}</span>
                </div>
                <div className="progress-bar-container">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${(reencodeProgress.current / reencodeProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setReencodeModal(false)}
                disabled={isReencoding}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleReencode}
                disabled={isReencoding}
              >
                {isReencoding ? <><Loader size={14} /> Processing...</> : reencodeSettings.codec === 'copy' ? <><Package size={14} /> Start Re-export</> : <><Film size={14} /> Start Reencoding</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal}
        title="Delete Selected Items?"
        message={`Are you sure you want to delete ${selectedCount} item(s)? This action cannot be undone.`}
        onConfirm={handleBatchDelete}
        onCancel={() => setDeleteModal(false)}
        confirmText="Delete"
        cancelText="Cancel"
        danger
      />

      {/* Toast Notification */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />} {toast.message}
        </div>
      )}
    </div>
  )
}

export default StoragePage
