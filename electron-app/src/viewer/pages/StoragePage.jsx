import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardDrive, Film, Scissors, Lock, Unlock, Trash2, Save, Info, Loader, Package, Check, X, Filter } from 'lucide-react'
import Modal from '../components/Modal'
import { apiFetch, apiPost } from '../apiBase'
import api from '../../api'
import { buildGameColors } from '../utils/storageColors'
import StorageTreemap from '../components/StorageTreemap'
import ReencodeModal from '../components/ReencodeModal'


function normPath(p) {
  return p.replace(/\\/g, '/')
}

function StoragePage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [settings, setSettings] = useState(null)
  const [editedSettings, setEditedSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listView, setListView] = useState(true)
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [deleteModal, setDeleteModal] = useState(false)
  const [reencodeModal, setReencodeModal] = useState(false)
  const [reencodeSettings, setReencodeSettings] = useState({
    codec: 'h265', crf: 23, preset: 'medium', replaceOriginal: false
  })
  const [isReencoding, setIsReencoding] = useState(false)
  const [reencodeProgress, setReencodeProgress] = useState({ current: 0, total: 0, currentFile: '' })
  const [reencodeAudioTracks, setReencodeAudioTracks] = useState([])
  const [reencodeSelectedTracks, setReencodeSelectedTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [toast, setToast] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [filterGame, setFilterGame] = useState('all')
  const [sortBy, setSortBy] = useState('date')
  const [lockedRecordings, setLockedRecordings] = useState(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const toastTimerRef = useRef(null)

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current)
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const [response, s] = await Promise.all([
        apiFetch('/api/storage/stats'),
        api.getStore('settings').catch(() => null),
      ])
      const data = await response.json()
      setStats(data)
      setLockedRecordings(new Set(data.locked_recordings || []))
      if (s) setListView(s.listView ?? true)
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
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const toggleSelection = useCallback((path) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(path)) newSet.delete(path)
      else newSet.add(path)
      return newSet
    })
  }, [])

  const toggleLock = useCallback(async (e, path) => {
    e.stopPropagation()
    const normalizedPath = normPath(path)
    const isLocked = lockedRecordings.has(normalizedPath)
    try {
      const response = await apiPost('/api/storage/lock', { path, locked: !isLocked })
      if (response.ok) {
        setLockedRecordings(prev => {
          const newSet = new Set(prev)
          if (isLocked) newSet.delete(normalizedPath)
          else newSet.add(normalizedPath)
          return newSet
        })
        showToast('success', isLocked ? 'Recording unlocked' : 'Recording locked')
      }
    } catch {
      showToast('error', 'Failed to toggle lock')
    }
  }, [lockedRecordings, showToast])

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return
    try {
      const response = await apiPost('/api/storage/delete-batch', { paths: Array.from(selectedItems) })
      const data = await response.json()
      if (response.ok) {
        setSelectedItems(new Set())
        setDeleteModal(false)
        fetchStats()
        let message = `Deleted ${data.deleted_count} item(s)`
        if (data.skipped_locked_count > 0) message += `, skipped ${data.skipped_locked_count} locked`
        if (data.failed_count > 0) message += `, ${data.failed_count} failed`
        showToast('success', message)
      }
    } catch {
      showToast('error', 'Failed to delete items')
    }
  }, [selectedItems, fetchStats, showToast])

  const updateSettings = useCallback(async (newSettings) => {
    try {
      const response = await apiPost('/api/storage/settings', { storage_settings: newSettings })
      if (response.ok) {
        setSettings(newSettings)
        setEditedSettings(newSettings)
        showToast('success', 'Settings saved')
      }
    } catch {
      showToast('error', 'Failed to save settings')
    }
  }, [showToast])

  const handleSaveSettings = useCallback(() => {
    if (!editedSettings) return
    updateSettings({
      ...editedSettings,
      max_storage_gb: Math.max(1, parseInt(editedSettings.max_storage_gb) || 100),
      max_age_days: Math.max(1, parseInt(editedSettings.max_age_days) || 30)
    })
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

  const items = useMemo(() => {
    if (!stats) return []
    let result = []
    if (filterType === 'all' || filterType === 'recordings')
      result = [...result, ...stats.recordings.map(r => ({ ...r, type: 'recording' }))]
    if (filterType === 'all' || filterType === 'clips')
      result = [...result, ...stats.clips.map(c => ({ ...c, type: 'clip' }))]
    if (filterGame !== 'all')
      result = result.filter(item => item.game_name === filterGame)
    result.sort((a, b) => {
      if (sortBy === 'date') return b.mtime - a.mtime
      if (sortBy === 'size') return b.size_bytes - a.size_bytes
      if (sortBy === 'game') {
        const gc = a.game_name.localeCompare(b.game_name)
        return gc !== 0 ? gc : b.mtime - a.mtime
      }
      return a.filename.localeCompare(b.filename)
    })
    return result
  }, [stats, filterType, filterGame, sortBy])

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const handleReencode = useCallback(async () => {
    if (selectedItems.size === 0) return
    setIsReencoding(true)
    const paths = Array.from(selectedItems)
    const totalFiles = paths.length
    let successCount = 0, failCount = 0, totalSavings = 0
    const audioTracksParam = reencodeAudioTracks.length > 1 && reencodeSelectedTracks.length < reencodeAudioTracks.length
      ? reencodeSelectedTracks : null
    setReencodeProgress({ current: 0, total: totalFiles, currentFile: '' })
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      const item = items.find(it => it.path === path)
      const filename = item?.filename || path.split(/[\\/]/).pop()
      setReencodeProgress({ current: i + 1, total: totalFiles, currentFile: filename })
      try {
        const response = await apiPost('/api/reencode', {
          source_path: path, codec: reencodeSettings.codec, crf: reencodeSettings.crf,
          preset: reencodeSettings.preset, replace_original: reencodeSettings.replaceOriginal,
          original_size: item?.size_bytes || 0, audio_tracks: audioTracksParam
        })
        const data = await response.json()
        if (response.ok) { successCount++; totalSavings += data.savings || 0 }
        else failCount++
      } catch { failCount++ }
    }
    setIsReencoding(false)
    setReencodeModal(false)
    setReencodeProgress({ current: 0, total: 0, currentFile: '' })
    setSelectedItems(new Set())
    fetchStats()
    const label = reencodeSettings.codec === 'copy' ? 'Re-exported' : 'Reencoded'
    const savingsFormatted = totalSavings > 0 ? ` (saved ${formatBytes(totalSavings)})` : ''
    showToast('success', `${label} ${successCount} file(s)${savingsFormatted}${failCount > 0 ? `, ${failCount} failed` : ''}`)
  }, [items, selectedItems, reencodeSettings, reencodeAudioTracks, reencodeSelectedTracks, fetchStats, showToast])

  const handleItemClick = useCallback((item) => {
    if (item.type === 'clip') navigate(`/clips?path=${encodeURIComponent(item.path)}`)
    else navigate(`/recordings?path=${encodeURIComponent(item.path)}`)
  }, [navigate])

  const gameColors = useMemo(() => buildGameColors(stats), [stats])

  const byGameBytes = useMemo(() => {
    if (!stats) return {}
    const map = {}
    ;[...(stats.recordings || []), ...(stats.clips || [])].forEach(item => {
      map[item.game_name] = (map[item.game_name] || 0) + item.size_bytes
    })
    return map
  }, [stats])

  const totalBytes = useMemo(() => Object.values(byGameBytes).reduce((s, v) => s + v, 0), [byGameBytes])

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading"><div className="spinner" /></div>
      </div>
    )
  }

  const selectedCount = selectedItems.size

  return (
    <div className="storage-v2">
      {/* ── Top bar ── */}
      <div className="sv2-topbar">
        <div className="sv2-title-group">
          <HardDrive size={16} />
          <span className="sv2-title">Storage</span>
          <span className="sv2-pill">{stats?.total_size_formatted}</span>
          <span className="sv2-pill">{stats?.recording_count} rec</span>
          <span className="sv2-pill">{stats?.clip_count} clips</span>
        </div>

        {totalBytes > 0 && (
          <div className="sv2-usage-bar-wrap">
            <div className="sv2-usage-bar">
              {Object.entries(byGameBytes)
                .sort((a, b) => b[1] - a[1])
                .map(([game, bytes]) => (
                  <div
                    key={game}
                    className="sv2-usage-seg"
                    style={{
                      width: `${(bytes / (stats?.disk_usage?.total || totalBytes)) * 100}%`,
                      background: gameColors[game] || '#666'
                    }}
                    title={`${game}: ${formatBytes(bytes)}`}
                  />
                ))}
              {stats?.disk_usage && stats.disk_usage.used - totalBytes > 0 && (
                <div
                  className="sv2-usage-seg"
                  style={{
                    width: `${((stats.disk_usage.used - totalBytes) / stats.disk_usage.total) * 100}%`,
                    background: '#3a3a3a'
                  }}
                  title={`Other: ${formatBytes(stats.disk_usage.used - totalBytes)}`}
                />
              )}
            </div>
            {stats?.disk_usage && (
              <div className="sv2-disk-note">
                {stats.disk_usage.free_formatted} free of {stats.disk_usage.total_formatted}
              </div>
            )}
          </div>
        )}

        <div className="sv2-topbar-right">
          {selectedCount > 0 && (
            <span className="sv2-sel-pill">{selectedCount} selected</span>
          )}
          <button className="sv2-options-btn" onClick={() => setSettingsOpen(true)}>
            <Filter size={13} /> Options
          </button>
        </div>
      </div>

      {/* ── Game legend ── */}
      {Object.keys(gameColors).length > 0 && (
        <div className="sv2-legend">
          <button
            className={`sv2-legend-all ${filterGame === 'all' ? 'active' : ''}`}
            onClick={() => setFilterGame('all')}
          >All</button>
          {Object.entries(gameColors).map(([game, color]) => (
            <button
              key={game}
              className={`sv2-legend-item ${filterGame === game ? 'active' : ''}`}
              onClick={() => setFilterGame(filterGame === game ? 'all' : game)}
            >
              <span className="sv2-legend-dot" style={{ background: color }} />
              {game}
            </button>
          ))}
        </div>
      )}

      {/* ── File list / Treemap ── */}
      {listView ? (
        <div className="sv2-list-container">
          {items.length === 0
            ? <div className="sv2-empty">No files match the current filter</div>
            : (
              <table className="sv2-list-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Name</th>
                    <th>Game</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Size</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const isSelected = selectedItems.has(item.path)
                    const isLocked = lockedRecordings.has(item.path.replace(/\//g, '\\'))
                    const color = gameColors[item.game_name] || '#888'
                    return (
                      <tr
                        key={item.path}
                        className={`sv2-list-row${isSelected ? ' sel' : ''}${isLocked ? ' locked' : ''}`}
                        onClick={() => toggleSelection(item.path)}
                        onDoubleClick={() => handleItemClick(item)}
                        title={isLocked ? '🔒 Locked' : undefined}
                      >
                        <td className="sv2-list-color-cell">
                          <span className="sv2-list-color-dot" style={{ background: color }} />
                        </td>
                        <td className="sv2-list-name">{item.filename}</td>
                        <td className="sv2-list-game" style={{ color }}>{item.game_name}</td>
                        <td className="sv2-list-type">
                          {item.type === 'clip' ? <><Scissors size={11} /> Clip</> : <><Film size={11} /> Recording</>}
                        </td>
                        <td className="sv2-list-date">{item.date}</td>
                        <td className="sv2-list-size">{item.size_formatted}</td>
                        <td className="sv2-list-actions">
                          <button
                            className="sv2-list-lockbtn"
                            onClick={(e) => toggleLock(e, item.path)}
                            title={isLocked ? 'Unlock' : 'Lock'}
                          >
                            {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
                          </button>
                          {isSelected && <Check size={12} className="sv2-list-check" />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          }
        </div>
      ) : (
        <StorageTreemap
          items={items}
          selectedItems={selectedItems}
          onSelect={toggleSelection}
          lockedRecordings={lockedRecordings}
          onLock={toggleLock}
          gameColors={gameColors}
          onNavigate={handleItemClick}
        />
      )}

      {/* ── Settings / Options Modal ── */}
      {settingsOpen && (
        <>
          <div className="sv2-modal-bd" onClick={() => setSettingsOpen(false)} />
          <div className="sv2-settings-modal">
            <div className="ssm-head">
              <span>Options</span>
              <button className="ssm-close" onClick={() => setSettingsOpen(false)}><X size={14} /></button>
            </div>

            <div className="ssm-sect">
              <div className="ssm-sect-label">Filter &amp; Sort</div>
              <div className="ssm-row">
                <label>Type</label>
                <select value={filterType} onChange={e => setFilterType(e.target.value)}>
                  <option value="all">All</option>
                  <option value="recordings">Recordings</option>
                  <option value="clips">Clips</option>
                </select>
              </div>
              <div className="ssm-row">
                <label>Sort by</label>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="date">Newest first</option>
                  <option value="size">Largest first</option>
                  <option value="name">Name</option>
                  <option value="game">Game</option>
                </select>
              </div>
              <div className="ssm-row">
                <label>View</label>
                <select value={listView ? 'list' : 'treemap'} onChange={e => setListView(e.target.value === 'list')}>
                  <option value="list">List</option>
                  <option value="treemap">Treemap</option>
                </select>
              </div>
            </div>

            {selectedCount > 0 && (
              <div className="ssm-sect">
                <div className="ssm-sect-label">{selectedCount} Selected</div>
                <div className="ssm-action-row">
                  <button className="btn btn-secondary btn-sm" onClick={() => setSelectedItems(new Set())}>Clear</button>
                  <button className="btn btn-primary btn-sm" onClick={() => { setReencodeModal(true); fetchReencodeTracks(); setSettingsOpen(false) }}>
                    <Film size={12} /> Reencode
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => { setDeleteModal(true); setSettingsOpen(false) }}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            )}

            {editedSettings && (
              <div className="ssm-sect">
                <div className="ssm-sect-label">Auto-Delete</div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editedSettings.auto_delete_enabled || false}
                    onChange={e => setEditedSettings({ ...editedSettings, auto_delete_enabled: e.target.checked })}
                  />
                  Enable automatic deletion
                </label>
                <div className="ssm-row">
                  <label>Max storage (GB)</label>
                  <input
                    type="text"
                    value={editedSettings.max_storage_gb ?? ''}
                    onChange={e => setEditedSettings({ ...editedSettings, max_storage_gb: e.target.value.replace(/[^0-9]/g, '') })}
                    disabled={!editedSettings.auto_delete_enabled}
                    placeholder="100"
                  />
                </div>
                <div className="ssm-row">
                  <label>Max age (days)</label>
                  <input
                    type="text"
                    value={editedSettings.max_age_days ?? ''}
                    onChange={e => setEditedSettings({ ...editedSettings, max_age_days: e.target.value.replace(/[^0-9]/g, '') })}
                    disabled={!editedSettings.auto_delete_enabled}
                    placeholder="30"
                  />
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editedSettings.exclude_clips !== false}
                    onChange={e => setEditedSettings({ ...editedSettings, exclude_clips: e.target.checked })}
                    disabled={!editedSettings.auto_delete_enabled}
                  />
                  Exclude clips from auto-delete
                </label>
                <p className="ssm-note"><Info size={11} /> Runs on watcher start. Locked files are never deleted.</p>
                {hasUnsavedChanges() && (
                  <button className="btn btn-primary btn-sm" onClick={handleSaveSettings} style={{ marginTop: 10 }}>
                    <Save size={12} /> Save Settings
                  </button>
                )}
              </div>
            )}

            {stats?.disk_usage && (
              <div className="ssm-sect ssm-disk">
                <div className="ssm-sect-label">Disk</div>
                <div className="ssm-disk-row">
                  <HardDrive size={12} />
                  <span>{stats.disk_usage.used_formatted} used / {stats.disk_usage.total_formatted} total</span>
                </div>
                <div className="ssm-disk-row">
                  <span className="ssm-free">{stats.disk_usage.free_formatted} free</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Reencode Modal ── */}
      <ReencodeModal
        isOpen={reencodeModal}
        selectedCount={selectedCount}
        reencodeSettings={reencodeSettings}
        setReencodeSettings={setReencodeSettings}
        reencodeAudioTracks={reencodeAudioTracks}
        reencodeSelectedTracks={reencodeSelectedTracks}
        loadingTracks={loadingTracks}
        toggleReencodeTrack={toggleReencodeTrack}
        isReencoding={isReencoding}
        reencodeProgress={reencodeProgress}
        onReencode={handleReencode}
        onClose={() => setReencodeModal(false)}
      />

      <Modal
        isOpen={deleteModal}
        title="Delete Selected Items?"
        message={`Delete ${selectedCount} item(s)? This cannot be undone.`}
        onConfirm={handleBatchDelete}
        onCancel={() => setDeleteModal(false)}
        confirmText="Delete"
        cancelText="Cancel"
        danger
      />

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />} {toast.message}
        </div>
      )}
    </div>
  )
}

export default StoragePage
