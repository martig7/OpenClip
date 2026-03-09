import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'

function ClipsPage() {
  const [clips, setClips] = useState([])
  const [selectedClip, setSelectedClip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleteModal, setDeleteModal] = useState(false)
  const [toast, setToast] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const fetchClips = useCallback(async () => {
    try {
      const response = await fetch('/api/clips')
      const data = await response.json()
      setClips(data)
      
      // Auto-select clip from URL parameter
      const pathParam = searchParams.get('path')
      if (pathParam && data.length > 0) {
        const clip = data.find(c => c.path === pathParam)
        if (clip) {
          setSelectedClip(clip)
          // Clear the URL parameter
          setSearchParams({})
        }
      }
    } catch (error) {
      console.error('Failed to fetch clips:', error)
    } finally {
      setLoading(false)
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    fetchClips()
  }, [fetchClips])

  const handleDelete = useCallback(async () => {
    if (!selectedClip) return

    try {
      const response = await fetch('/api/clips/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedClip.path })
      })

      if (response.ok) {
        setSelectedClip(null)
        fetchClips()
        setToast({ type: 'success', message: 'Clip deleted' })
        setTimeout(() => setToast(null), 3000)
      } else {
        const data = await response.json()
        setToast({ type: 'error', message: `Failed to delete: ${data.error}` })
        setTimeout(() => setToast(null), 3000)
      }
    } catch (error) {
      setToast({ type: 'error', message: `Error: ${error.message}` })
      setTimeout(() => setToast(null), 3000)
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
                src={`/api/video?path=${encodeURIComponent(selectedClip.path)}`}
                controls
              />
            </div>

            <div className="video-info-bar">
              <h2 className="video-title">{selectedClip.filename}</h2>
              <div className="video-meta">
                <span>&#128193; {selectedClip.game_name}</span>
                <span>&#128197; {selectedClip.date}</span>
                <span>&#128190; {selectedClip.size_formatted}</span>
              </div>
              <div className="action-buttons">
                <button
                  className="btn btn-secondary"
                  onClick={() => fetch('/api/open-external', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: selectedClip.path })
                  })}
                >
                  &#9654; Open in Player
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => fetch('/api/show-in-explorer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: selectedClip.path })
                  })}
                >
                  &#128194; Show in Explorer
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteModal(true)}
                >
                  &#128465; Delete
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="player-container">
            <div className="player-placeholder">
              <div className="icon">&#127916;</div>
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

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '&#10004;' : '&#10006;'} {toast.message}
        </div>
      )}
    </div>
  )
}

export default ClipsPage
