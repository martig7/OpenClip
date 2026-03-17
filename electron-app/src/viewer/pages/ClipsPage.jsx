import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Folder, Calendar, HardDrive, FolderOpen, Trash2, Film, Check, X, Play } from 'lucide-react'
import MediaSidebar from '../components/MediaSidebar'
import Modal from '../components/Modal'
import VideoPlayer from '../components/VideoPlayer'
import { apiFetch, apiPost, getBase } from '../apiBase'
import api from '../../api'

function ClipsPage() {
  const [clips, setClips] = useState([])
  const [selectedClip, setSelectedClip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleteModal, setDeleteModal] = useState(false)
  const [toast, setToast] = useState(null)
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
      if (p.phase === 'complete') fetchClips()
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
      <MediaSidebar
        items={clips}
        selectedItem={selectedClip}
        onSelect={setSelectedClip}
        title="Clips"
        emptyMessage="Create clips from your recordings"
      />

      <div className="main-content">
        {selectedClip ? (
          <VideoPlayer clip={selectedClip} onDelete={() => setDeleteModal(true)} />
        ) : (
          <>
            <div className="h-[36px] w-full shrink-0 border-b border-[var(--border)] relative z-50" style={{ WebkitAppRegion: "drag", backgroundColor: "var(--bg-primary)" }} />
            <div className="player-container">
              <div className="player-placeholder">
                <div className="icon"><Film size={40} /></div>
                <p>Select a clip to play</p>
              </div>
            </div>
          </>
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

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />} {toast.message}
        </div>
      )}
    </div>
  )
}

export default ClipsPage
