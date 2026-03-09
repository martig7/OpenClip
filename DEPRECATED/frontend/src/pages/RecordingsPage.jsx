import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import VideoPlayer from '../components/VideoPlayer'

function RecordingsPage() {
  const [recordings, setRecordings] = useState([])
  const [selectedRecording, setSelectedRecording] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const fetchRecordings = useCallback(async () => {
    try {
      const response = await fetch('/api/recordings')
      const data = await response.json()
      setRecordings(data)
      
      // Auto-select recording from URL parameter
      const pathParam = searchParams.get('path')
      if (pathParam && data.length > 0) {
        const recording = data.find(r => r.path === pathParam)
        if (recording) {
          setSelectedRecording(recording)
          // Clear the URL parameter
          setSearchParams({})
        }
      }
    } catch (error) {
      console.error('Failed to fetch recordings:', error)
    } finally {
      setLoading(false)
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    fetchRecordings()
  }, [fetchRecordings])

  const handleClipCreated = useCallback((clip) => {
    setToast({ type: 'success', message: `Clip created: ${clip.filename}` })
    setTimeout(() => setToast(null), 3000)
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

  return (
    <div className="page-content">
      <Sidebar
        items={recordings}
        selectedItem={selectedRecording}
        onSelect={setSelectedRecording}
        title="Recordings"
        emptyMessage="Record some gameplay to see them here"
      />
      <VideoPlayer
        recording={selectedRecording}
        onClipCreated={handleClipCreated}
      />

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '&#10004;' : '&#10006;'} {toast.message}
        </div>
      )}
    </div>
  )
}

export default RecordingsPage
