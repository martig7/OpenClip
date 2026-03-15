import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import Sidebar from '../components/Sidebar'
import VideoPlayer from '../components/VideoPlayer'
import { apiFetch } from '../apiBase'
import api from '../../api'

function RecordingsPage() {
  const [recordings, setRecordings] = useState([])
  const [selectedRecording, setSelectedRecording] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [games, setGames] = useState([])
  const [organizeRemux, setOrganizeRemux] = useState(true)
  const [sessionProgress, setSessionProgress] = useState(null)
  const toastTimerRef = useRef(null)

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current)
  }, [])

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

  // Capture the path param once on mount. Using a ref prevents setSearchParams({})
  // from changing initialPathParam → re-triggering this effect → double fetch.
  const initialPathParamRef = useRef(searchParams.get('path'))

  useEffect(() => {
    fetchRecordings().then(data => {
      if (!data) return
      const param = initialPathParamRef.current
      if (param) {
        const recording = data.find(r => r.path === param)
        if (recording) {
          initialPathParamRef.current = null
          setSelectedRecording(recording)
          setSearchParams({})
        }
      }
    })
    api.getGames().then(g => setGames(g || [])).catch(() => {})
    api.getStore('settings').then(s => setOrganizeRemux(s?.organizeRemux !== false)).catch(() => {})
  }, [fetchRecordings, setSearchParams])

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
  }, [fetchRecordings])

  const handleOrganizeError = useCallback((msg) => {
    setToast({ type: 'error', message: msg })
    clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 5000)
  }, [])

  useEffect(() => {
    const unsub = api.onSessionProgress?.((p) => {
      if (p.phase === 'complete') {
        setSessionProgress(null)
        fetchRecordings()
      } else if (p.phase === 'recording') {
        setSessionProgress(p)
      }
    })
    return () => unsub?.()
  }, [fetchRecordings])

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
        games={games}
        onOrganized={handleOrganized}
        onOrganizeError={handleOrganizeError}
        organizeRemux={organizeRemux}
      />

      {sessionProgress && (
        <div className="session-progress-banner">
          <div className="session-progress-label">
            <div className="spinner-sm" style={{ borderColor: 'rgba(245,158,11,0.25)', borderTopColor: 'var(--amber)' }} />
            {sessionProgress.label}
          </div>
          <div className="progress-bar-container session-progress-bar">
            <div
              className="progress-bar-fill session-progress-fill"
              style={{ width: `${sessionProgress.stage === 'remuxing' ? 65 : sessionProgress.stage === 'moving' ? 90 : 20}%` }}
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

export default RecordingsPage
