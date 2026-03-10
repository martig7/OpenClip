import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import VideoPlayer from '../components/VideoPlayer'
import { apiFetch } from '../apiBase'

function RecordingsPage() {
  const [recordings, setRecordings] = useState([])
  const [selectedRecording, setSelectedRecording] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const fetchRecordings = useCallback(async () => {
    try {
      const response = await apiFetch('/api/recordings')
      const data = await response.json()
      setRecordings(data)
      return data
    } catch (error) {
      console.error('Failed to fetch recordings:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const initialPathParam = searchParams.get('path')

  useEffect(() => {
    fetchRecordings().then(data => {
      if (!data) return
      if (initialPathParam) {
        const recording = data.find(r => r.path === initialPathParam)
        if (recording) {
          setSelectedRecording(recording)
          setSearchParams({})
        }
      }
    })
  }, [fetchRecordings, initialPathParam, setSearchParams])

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
          {toast.type === 'success' ? <Check size={14} /> : <X size={14} />} {toast.message}
        </div>
      )}
    </div>
  )
}

export default RecordingsPage
