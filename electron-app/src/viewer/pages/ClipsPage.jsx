import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Folder, Calendar, HardDrive, Play, FolderOpen, Trash2, Film, Check, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch, apiPost, getBase } from '../apiBase'
import api from '../../api'

function getSessionProgressWidth(p) {
  if (!p) return 0
  if (p.phase === 'recording') {
    if (p.stage === 'moving') return 45
    if (p.stage === 'remuxing') return 32
    return 10
  }
  if (p.phase === 'clipping') {
    return 50 + (((p.clipIndex ?? 0) + 1) / (p.clipTotal ?? 1)) * 45
  }
  return 100
}

function ClipsPage() {
  const [clips, setClips] = useState([])
  const [selectedClip, setSelectedClip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleteModal, setDeleteModal] = useState(false)
  const [toast, setToast] = useState(null)
  const [sessionProgress, setSessionProgress] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const toastTimerRef = useRef(null)

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current)
  }, [])

  const fetchClips = useCallback(async () => {
    try {
      const response = await apiFetch('/api/clips')
      const data = await response.json()
      setClips(data)
      return data
    } catch (error) {
      console.error('Failed to fetch clips:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Capture the path param once on mount. Using a ref prevents setSearchParams({})
  // from changing initialPathParam → re-triggering this effect → double fetch.
  const initialPathParamRef = useRef(searchParams.get('path'))

  useEffect(() => {
    fetchClips().then(data => {
      if (!data) return
      const param = initialPathParamRef.current
      if (param) {
        const clip = data.find(c => c.path === param)
        if (clip) {
          initialPathParamRef.current = null
          setSelectedClip(clip)
          setSearchParams({})
        }
      }
    })
  }, [fetchClips, setSearchParams])

  useEffect(() => {
    const unsub = api.onSessionProgress?.((p) => {
      if (p.phase === 'complete') {
        setSessionProgress(null)
        fetchClips()
      } else {
        setSessionProgress(p)
      }
    })
    return () => unsub?.()
  }, [fetchClips])

  const handleDelete = useCallback(async () => {
    if (!selectedClip) return

    try {
      const response = await apiPost('/api/clips/delete', { path: selectedClip.path })

      if (response.ok) {
        setSelectedClip(null)
        fetchClips()
        setToast({ type: 'success', message: 'Clip deleted' })
        clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(() => setToast(null), 3000)
      } else {
        const data = await response.json()
        setToast({ type: 'error', message: `Failed to delete: ${data.error}` })
        clearTimeout(toastTimerRef.current)
        toastTimerRef.current = setTimeout(() => setToast(null), 3000)
      }
    } catch (error) {
      setToast({ type: 'error', message: `Error: ${error.message}` })
      clearTimeout(toastTimerRef.current)
      toastTimerRef.current = setTimeout(() => setToast(null), 3000)
    }

    setDeleteModal(false)
  }, [selectedClip, fetchClips])

  if (loading) {
    return (
      <div className="page-content">
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <Sidebar
        items={clips}
        selectedItem={selectedClip}
        onSelect={setSelectedClip}
        title="Clips"
        emptyMessage="Create clips from your recordings"
      />

      <div className="main-content">
        {selectedClip ? (
          <>
            <div className="player-container">
              <video
                key={selectedClip.path}
                src={`${getBase()}/api/video?path=${encodeURIComponent(selectedClip.path)}`}
                controls
              />
            </div>

            <div className="video-info-bar">
              <h2 className="video-title">{selectedClip.filename}</h2>
              <div className="video-meta">
                <span><Folder size={13} /> {selectedClip.game_name}</span>
                <span><Calendar size={13} /> {selectedClip.date}</span>
                <span><HardDrive size={13} /> {selectedClip.size_formatted}</span>
              </div>
              <div className="action-buttons">
                <button
                  className="btn btn-secondary"
                  onClick={() => apiPost('/api/open-external', { path: selectedClip.path })}
                >
                  <Play size={13} /> Open in Player
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => apiPost('/api/show-in-explorer', { path: selectedClip.path })}
                >
                  <FolderOpen size={13} /> Show in Explorer
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteModal(true)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="player-container">
            <div className="player-placeholder">
              <div className="icon"><Film size={40} /></div>
              <p>Select a clip to play</p>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={deleteModal}
        title="Delete Clip?"
        message={`Are you sure you want to delete "${selectedClip?.filename}"? This cannot be undone.`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteModal(false)}
        confirmText="Delete"
        danger
      />

      {sessionProgress && (
        <div className="session-progress-banner">
          <div className="session-progress-label">
            <div className="spinner-sm" style={{ borderColor: 'rgba(245,158,11,0.25)', borderTopColor: 'var(--amber)' }} />
            {sessionProgress.phase === 'recording'
              ? `Processing session — ${sessionProgress.label}`
              : sessionProgress.label}
          </div>
          <div className="progress-bar-container session-progress-bar">
            <div
              className="progress-bar-fill session-progress-fill"
              style={{ width: `${getSessionProgressWidth(sessionProgress)}%` }}
            />
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />} {toast.message}
        </div>
      )}
    </div>
  )
}

export default ClipsPage
