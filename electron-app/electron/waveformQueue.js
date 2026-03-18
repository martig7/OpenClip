const EventEmitter = require('events')
const { generateWaveforms, getWaveformStatus } = require('./waveformCache')

const MAX_CONCURRENT = 2
const MAX_QUEUE_SIZE = 50

const queue = []
let activeJobs = 0
let isProcessing = false
const eventEmitter = new EventEmitter()

const listeners = new Set()

function emit(event, data) {
  for (const listener of listeners) {
    try {
      listener(event, data)
    } catch (err) {
      console.error('Waveform queue listener error:', err)
    }
  }
  eventEmitter.emit(event, data)
}

function addListener(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getStatus() {
  return {
    queueLength: queue.length,
    activeJobs,
    isProcessing,
    jobs: queue.map((job) => ({
      id: job.id,
      videoPath: job.videoPath,
      status: job.status,
      progress: job.progress,
      zoomLevel: job.currentZoom,
      resolution: job.resolution,
      error: job.error,
      addedAt: job.addedAt,
    })),
  }
}

async function processQueue() {
  if (isProcessing) return
  isProcessing = true

  while (queue.length > 0 && activeJobs < MAX_CONCURRENT) {
    const job = queue.shift()
    if (!job) break

    activeJobs++
    processJob(job).catch((err) => {
      console.error('Job processing error:', err)
    })
  }

  if (queue.length === 0 && activeJobs === 0) {
    isProcessing = false
  }
}

async function processJob(job) {
  const { id, videoPath, resolution, numTracks, onProgress, onComplete, onError } = job

  try {
    job.status = 'processing'

    const status = getWaveformStatus(videoPath, resolution)
    const zoomLevels = status.missing

    if (zoomLevels.length === 0) {
      job.status = 'complete'
      job.progress = 100
      emit('job_complete', { id, videoPath, success: true })
      onComplete?.({ success: true, videoPath })
      activeJobs--
      processQueue()
      return
    }

    for (let i = 0; i < zoomLevels.length; i++) {
      job.currentZoom = zoomLevels[i]
      job.progress = Math.round((i / zoomLevels.length) * 100)

      emit('job_progress', {
        id,
        videoPath,
        progress: job.progress,
        currentZoom: job.currentZoom,
        zoomLevels,
        completed: i,
        total: zoomLevels.length,
      })
      onProgress?.({
        progress: job.progress,
        currentZoom: job.currentZoom,
        completed: i,
        total: zoomLevels.length,
      })

      await generateWaveformForZoom(videoPath, zoomLevels[i], numTracks)
    }

    job.status = 'complete'
    job.progress = 100
    emit('job_complete', { id, videoPath, success: true })
    onComplete?.({ success: true, videoPath })
  } catch (err) {
    job.status = 'error'
    job.error = err.message
    emit('job_error', { id, videoPath, error: err.message })
    onError?.({ error: err.message, videoPath })
  }

  activeJobs--
  processQueue()
}

function enqueue(videoPath, options = {}) {
  const { resolution = 'medium', numTracks = 1 } = options

  const existing = queue.findIndex(
    (job) => job.videoPath.toLowerCase() === videoPath.toLowerCase()
  )
  if (existing !== -1) {
    return { success: false, reason: 'already_queued', jobId: queue[existing].id }
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    return { success: false, reason: 'queue_full' }
  }

  const job = {
    id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    videoPath,
    resolution,
    numTracks,
    status: 'queued',
    progress: 0,
    currentZoom: null,
    error: null,
    addedAt: Date.now(),
    onProgress: null,
    onComplete: null,
    onError: null,
  }

  queue.push(job)
  emit('job_added', { id: job.id, videoPath, resolution })

  processQueue()

  return { success: true, jobId: job.id }
}

function cancel(jobId) {
  const index = queue.findIndex((job) => job.id === jobId)
  if (index !== -1) {
    const job = queue.splice(index, 1)[0]
    emit('job_cancelled', { id: job.id, videoPath: job.videoPath })
    return { success: true }
  }
  return { success: false, reason: 'not_found' }
}

function cancelAll() {
  const jobs = [...queue]
  queue.length = 0
  emit('queue_cleared', { count: jobs.length })
  return { success: true, count: jobs.length }
}

function removeCompleted(beforeTimestamp = Date.now()) {
  const before = beforeTimestamp || Date.now()
  const removed = queue.filter(
    (job) => job.addedAt < before && (job.status === 'complete' || job.status === 'error')
  )
  for (const job of removed) {
    const index = queue.indexOf(job)
    if (index !== -1) queue.splice(index, 1)
  }
  return { success: true, count: removed.length }
}

module.exports = {
  addListener,
  getStatus,
  enqueue,
  cancel,
  cancelAll,
  removeCompleted,
  MAX_CONCURRENT,
  MAX_QUEUE_SIZE,
}
