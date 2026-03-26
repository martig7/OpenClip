import { Copy, Check, ExternalLink } from 'lucide-react'

/**
 * ShareModal — shown while a clip is being uploaded and after it completes.
 *
 * Props
 *   phase    'uploading' | 'done' | 'error' | null  (null = hidden)
 *   url      string | null   (set when phase === 'done')
 *   error    string | null   (set when phase === 'error')
 *   percent  number | null   (0-100, set when phase === 'compressing')
 *   onClose  () => void
 *   onCopy   () => void
 *   copied   boolean
 */
export default function ShareModal({ phase, url, error, percent, onClose, onCopy, copied }) {
  if (!phase) return null

  const isCompressing = phase === 'compressing'
  const isUploading   = phase === 'uploading'
  const isDone        = phase === 'done'
  const isError       = phase === 'error'

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !isUploading && !isCompressing) onClose() }}
    >
      <div className="modal share-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: '6px' }}>
          {isCompressing && 'Compressing…'}
          {isUploading   && 'Uploading…'}
          {isDone        && 'Ready to Share'}
          {isError       && 'Upload Failed'}
        </h2>

        {isCompressing && (
          <>
            <p style={{ marginBottom: '20px' }}>Optimizing your clip for sharing…</p>
            <div className="share-progress-track">
              <div
                className="share-progress-bar-determinate"
                style={{ width: `${Math.round(percent || 0)}%` }}
              />
            </div>
          </>
        )}

        {isUploading && (
          <>
            <p style={{ marginBottom: '20px' }}>Your clip is being uploaded. This may take a moment.</p>
            <div className="share-progress-track">
              <div className="share-progress-bar" />
            </div>
          </>
        )}

        {isDone && (
          <>
            <p style={{ marginBottom: '14px' }}>Your clip has been uploaded successfully.</p>
            <div className="share-url-row">
              <input
                className="share-url-input form-input"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
              />
              <button
                className={`btn ${copied ? 'btn-secondary' : 'btn-primary'} share-copy-btn`}
                onClick={onCopy}
                title="Copy link"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                className="btn btn-secondary share-open-btn"
                onClick={() => window.open(url, '_blank')}
                title="Open link"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          </>
        )}

        {isError && (
          <p className="share-error-msg">{error}</p>
        )}

        <div className="modal-actions" style={{ marginTop: '20px' }}>
          {(isUploading || isCompressing) ? (
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  )
}
