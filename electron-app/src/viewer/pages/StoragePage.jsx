import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from 'react'
import { useNavigate } from 'react-router-dom'
import { HardDrive, Film, Scissors, Trash2, Check, X } from 'lucide-react'
import Modal from '../components/Modal'
import { apiFetch, apiPost } from '../apiBase'
import api from '../../api'
import { buildGameColors } from '../utils/storageColors'
import StorageTreemap from '../components/StorageTreemap'
import StorageList from '../components/StorageList'
import ReencodeModal from '../components/ReencodeModal'

const DEFAULT_SORT_DIR = { date: 'desc', size: 'desc', name: 'asc', game: 'asc' }

function normPath(p) {
  return p.replace(/\\/g, '/')
}

function StoragePage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [listView, setListView] = useState(true)
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [deleteModal, setDeleteModal] = useState(false)
  const [reencodeModal, setReencodeModal] = useState(false)
  const [reencodeSettings, setReencodeSettings] = useState({
    codec: 'h265',
    crf: 23,
    preset: 'medium',
    replaceOriginal: false,
  })
  const [isReencoding, setIsReencoding] = useState(false)
  const [reencodeProgress, setReencodeProgress] = useState({
    current: 0,
    total: 0,
    currentFile: '',
  })
  const [reencodeAudioTracks, setReencodeAudioTracks] = useState([])
  const [reencodeSelectedTracks, setReencodeSelectedTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [toast, setToast] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [filterGame, setFilterGame] = useState('all')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [lockedRecordings, setLockedRecordings] = useState(new Set())
  const [, startTransition] = useTransition()
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
      setLockedRecordings(new Set((data.locked_recordings || []).map(normPath)))
      if (s) setListView(s.listView ?? true)
    } catch (error) {
      console.error('Failed to fetch storage stats:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const showToast = useCallback((type, message) => {
    setToast({ type, message })
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const toggleSelection = useCallback((path) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(path)) newSet.delete(path)
      else newSet.add(path)
      return newSet
    })
  }, [])

  const toggleLock = useCallback(
    async (e, path) => {
      e.stopPropagation()
      const normalizedPath = normPath(path)
      const isLocked = lockedRecordings.has(normalizedPath)
      try {
        const response = await apiPost('/api/storage/lock', { path, locked: !isLocked })
        if (response.ok) {
          setLockedRecordings((prev) => {
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
    },
    [lockedRecordings, showToast]
  )

  const handleBatchDelete = useCallback(async () => {
    if (selectedItems.size === 0) return
    try {
      const response = await apiPost('/api/storage/delete-batch', {
        paths: Array.from(selectedItems),
      })
      const data = await response.json()
      if (response.ok) {
        setSelectedItems(new Set())
        setDeleteModal(false)
        fetchStats()
        let message = `Deleted ${data.deleted_count} item(s)`
        if (data.skipped_locked_count > 0)
          message += `, skipped ${data.skipped_locked_count} locked`
        if (data.failed_count > 0) message += `, ${data.failed_count} failed`
        showToast('success', message)
      }
    } catch {
      showToast('error', 'Failed to delete items')
    }
  }, [selectedItems, fetchStats, showToast])

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
    setReencodeSelectedTracks((prev) => {
      if (prev.includes(index)) {
        if (prev.length <= 1) return prev
        return prev.filter((i) => i !== index)
      }
      return [...prev, index].sort((a, b) => a - b)
    })
  }, [])

  const items = useMemo(() => {
    if (!stats) return []
    let result = []
    if (filterType === 'all' || filterType === 'recordings')
      result = [...result, ...stats.recordings.map((r) => ({ ...r, type: 'recording' }))]
    if (filterType === 'all' || filterType === 'clips')
      result = [...result, ...stats.clips.map((c) => ({ ...c, type: 'clip' }))]
    if (filterGame !== 'all') result = result.filter((item) => item.game_name === filterGame)
    const dir = sortDir === 'asc' ? 1 : -1
    result.sort((a, b) => {
      if (sortBy === 'date') return dir * (a.mtime - b.mtime)
      if (sortBy === 'size') return dir * (a.size_bytes - b.size_bytes)
      if (sortBy === 'game') {
        const gc = a.game_name.localeCompare(b.game_name)
        return gc !== 0 ? dir * gc : b.mtime - a.mtime
      }
      return dir * a.filename.localeCompare(b.filename)
    })
    return result
  }, [stats, filterType, filterGame, sortBy, sortDir])

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B'
    const k = 1024,
      sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  const handleReencode = useCallback(async () => {
    if (selectedItems.size === 0) return
    setIsReencoding(true)
    const paths = Array.from(selectedItems)
    const totalFiles = paths.length
    let successCount = 0,
      failCount = 0,
      totalSavings = 0
    const audioTracksParam =
      reencodeAudioTracks.length > 1 && reencodeSelectedTracks.length < reencodeAudioTracks.length
        ? reencodeSelectedTracks
        : null
    setReencodeProgress({ current: 0, total: totalFiles, currentFile: '' })
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      const item = items.find((it) => it.path === path)
      const filename = item?.filename || path.split(/[\\/]/).pop()
      setReencodeProgress({ current: i + 1, total: totalFiles, currentFile: filename })
      try {
        const response = await apiPost('/api/reencode', {
          source_path: path,
          codec: reencodeSettings.codec,
          crf: reencodeSettings.crf,
          preset: reencodeSettings.preset,
          replace_original: reencodeSettings.replaceOriginal,
          original_size: item?.size_bytes || 0,
          audio_tracks: audioTracksParam,
        })
        const data = await response.json()
        if (response.ok) {
          successCount++
          totalSavings += data.savings || 0
        } else failCount++
      } catch {
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
    showToast(
      'success',
      `${label} ${successCount} file(s)${savingsFormatted}${failCount > 0 ? `, ${failCount} failed` : ''}`
    )
  }, [
    items,
    selectedItems,
    reencodeSettings,
    reencodeAudioTracks,
    reencodeSelectedTracks,
    fetchStats,
    showToast,
  ])

  const handleColumnSort = useCallback(
    (col) => {
      if (sortBy === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortBy(col)
        setSortDir(DEFAULT_SORT_DIR[col] || 'asc')
      }
    },
    [sortBy]
  )

  const handleItemClick = useCallback(
    (item) => {
      if (item.type === 'clip') navigate(`/clips?path=${encodeURIComponent(item.path)}`)
      else navigate(`/recordings?path=${encodeURIComponent(item.path)}`)
    },
    [navigate]
  )

  const gameColors = useMemo(() => buildGameColors(stats), [stats])

  const byGameBytes = useMemo(() => {
    if (!stats) return {}
    const map = {}
    ;[...(stats.recordings || []), ...(stats.clips || [])].forEach((item) => {
      map[item.game_name] = (map[item.game_name] || 0) + item.size_bytes
    })
    return map
  }, [stats])

  const totalBytes = useMemo(
    () => Object.values(byGameBytes).reduce((s, v) => s + v, 0),
    [byGameBytes]
  )

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="spinner" />
        </div>
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
                      background: gameColors[game] || '#666',
                    }}
                    title={`${game}: ${formatBytes(bytes)}`}
                  />
                ))}
              {stats?.disk_usage && stats.disk_usage.used - totalBytes > 0 && (
                <div
                  className="sv2-usage-seg"
                  style={{
                    width: `${((stats.disk_usage.used - totalBytes) / stats.disk_usage.total) * 100}%`,
                    background: '#3a3a3a',
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
            <>
              <span className="sv2-sel-pill">{selectedCount} selected</span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedItems(new Set())}
              >
                Clear
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setReencodeModal(true)
                  fetchReencodeTracks()
                }}
              >
                <Film size={12} /> Reencode
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => setDeleteModal(true)}>
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Game legend + view toggle ── */}
      <div className="sv2-legend">
        {Object.keys(gameColors).length > 0 && (
          <>
            <button
              className={`sv2-legend-all${filterGame === 'all' ? ' active' : ''}`}
              onClick={() => setFilterGame('all')}
            >
              All
            </button>
            {Object.entries(gameColors).map(([game, color]) => (
              <button
                key={game}
                className={`sv2-legend-item${filterGame === game ? ' active' : ''}`}
                onClick={() => setFilterGame(filterGame === game ? 'all' : game)}
              >
                <span className="sv2-legend-dot" style={{ background: color }} />
                {game}
              </button>
            ))}
          </>
        )}
        <div className="sv2-legend-spacer" />
        <div className="sv2-view-toggle">
          {[
            { value: 'all', label: 'All' },
            { value: 'recordings', label: 'Recordings' },
            { value: 'clips', label: 'Clips' },
          ].map(({ value, label }) => (
            <button
              key={value}
              className={`sv2-view-btn${filterType === value ? ' active' : ''}`}
              onClick={() => setFilterType(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="sv2-view-toggle" style={{ marginLeft: 6 }}>
          <button
            className={`sv2-view-btn${listView ? ' active' : ''}`}
            onClick={() => {
              startTransition(() => setListView(true))
              api.setStore('settings.listView', true)
            }}
          >
            List
          </button>
          <button
            className={`sv2-view-btn${!listView ? ' active' : ''}`}
            onClick={() => {
              startTransition(() => setListView(false))
              api.setStore('settings.listView', false)
            }}
          >
            Treemap
          </button>
        </div>
      </div>

      {/* ── File list / Treemap ── */}
      {listView ? (
        <StorageList
          items={items}
          selectedItems={selectedItems}
          onSelect={toggleSelection}
          lockedRecordings={lockedRecordings}
          onLock={toggleLock}
          gameColors={gameColors}
          onNavigate={handleItemClick}
          sortBy={sortBy}
          sortDir={sortDir}
          onColumnSort={handleColumnSort}
        />
      ) : (
        <StorageTreemap
          items={items}
          selectedItems={selectedItems}
          onSelect={toggleSelection}
          lockedRecordings={lockedRecordings}
          onLock={toggleLock}
          gameColors={gameColors}
          onNavigate={handleItemClick}
          sortBy={sortBy}
          sortDir={sortDir}
          onColumnSort={handleColumnSort}
        />
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
