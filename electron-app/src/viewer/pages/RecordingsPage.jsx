import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, X, Loader2 } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import VideoPlayer from '../components/VideoPlayer'
import { apiFetch } from '../apiBase'
import api from '../../api'

const PROCESSING_POLL_MS = 3000

function RecordingsPage() {
  const [recordings, setRecordings] = useState([])
  const [selectedRecording, setSelectedRecording] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [games, setGames] = useState([])
  const [processingJobs, setProcessingJobs] = useState([])
  const toastTimerRef = useRef(null)
  const processingTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      clearTimeout(toastTimerRef.current)
      clearTimeout(processingTimerRef.current)
    }
  }, [])

  // Poll /api/processing while jobs are active; refresh recordings list when processing ends
  const pollProcessing = useCallback(async () => {
    try {
      const res = await apiFetch('/api/processing')
      const data = await res.json()
      const jobs = data.jobs || []
      setProcessingJobs(prev => {
        if (prev.length > 0 && jobs.length === 0) {
          // Jobs just finished — refresh recordings list
          fetchRecordings()
        }
        return jobs
      })
      if (jobs.length > 0) {
        processingTimerRef.current = setTimeout(pollProcessing, PROCESSING_POLL_MS)
      }
    } catch {
      // Silently ignore — API may not be ready yet
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    api.getGames().then(g => setGames(g || [])).catch(() => {})
    pollProcessing()
  }, [fetchRecordings, initialPathParam, setSearchParams, pollProcessing])

  const handleClipCreated = useCallback((clip) => {
    setToast({ type: 'success', message: `Clip created: ${clip.filename}` })
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const handleOrganized = useCallback((result) => {
    setToast({ type: 'success', message: `Organized: ${result.filename}` })
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4000)
    setSelectedRecording(null)
    fetchRecordings()
    // Restart processing poll — the organize may have kicked off a remux
    clearTimeout(processingTimerRef.current)
    processingTimerRef.current = setTimeout(pollProcessing, 500)
  }, [fetchRecordings, pollProcessing])

  const handleOrganizeError = useCallback((msg) => {
    setToast({ type: 'error', message: msg })
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 5000)
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
      {processingJobs.length > 0 && (
        <div className="processing-banner">
          <Loader2 size={14} className="processing-spinner" />
          {processingJobs.length === 1
            ? `Converting "${processingJobs[0].filename}" to MP4…`
            : `Converting ${processingJobs.length} recordings to MP4…`}
        </div>
      )}
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
        games={games}
        onOrganized={handleOrganized}
        onOrganizeError={handleOrganizeError}
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
