import { useState, useEffect } from 'react';
import { Film, Loader, Package } from 'lucide-react';

export default function ReencodeModal({
  isOpen,
  selectedCount,
  reencodeSettings,
  setReencodeSettings,
  reencodeAudioTracks,
  reencodeSelectedTracks,
  loadingTracks,
  toggleReencodeTrack,
  isReencoding,
  reencodeProgress,
  onReencode,
  onClose,
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !isReencoding) onClose(); }}>
      <div className="modal-content reencode-modal" onClick={e => e.stopPropagation()}>
        <h2>Reencode Videos</h2>
        <p>Reencode {selectedCount} selected video(s) to a different codec</p>
        <div className="reencode-settings">
          <div className="setting-row">
            <label>Codec:</label>
            <select value={reencodeSettings.codec} onChange={e => setReencodeSettings({ ...reencodeSettings, codec: e.target.value })} disabled={isReencoding}>
              <option value="h264">H.264 (widely compatible)</option>
              <option value="h265">H.265/HEVC (better compression)</option>
              <option value="av1">AV1 (best compression, slower)</option>
              <option value="copy">Stream Copy (track removal only, instant)</option>
            </select>
          </div>
          {reencodeSettings.codec !== 'copy' && (
            <>
              <div className="setting-row">
                <label>Quality (CRF):</label>
                <input type="range" min="18" max="28" value={reencodeSettings.crf} onChange={e => setReencodeSettings({ ...reencodeSettings, crf: parseInt(e.target.value) })} disabled={isReencoding} />
                <span>{reencodeSettings.crf} {reencodeSettings.crf < 20 ? '(high)' : reencodeSettings.crf < 24 ? '(medium)' : '(low)'}</span>
              </div>
              <div className="setting-row">
                <label>Speed Preset:</label>
                <select value={reencodeSettings.preset} onChange={e => setReencodeSettings({ ...reencodeSettings, preset: e.target.value })} disabled={isReencoding}>
                  <option value="veryfast">Very Fast (larger file)</option>
                  <option value="fast">Fast</option>
                  <option value="medium">Medium (recommended)</option>
                  <option value="slow">Slow (smaller file)</option>
                  <option value="veryslow">Very Slow (smallest file)</option>
                </select>
              </div>
            </>
          )}
          {reencodeAudioTracks.length > 1 && (
            <div className="clip-tracks">
              <label className="clip-tracks-label">Audio Tracks</label>
              {loadingTracks
                ? <div className="track-loading">Loading tracks...</div>
                : (
                  <div className="track-list">
                    {reencodeAudioTracks.map((track, i) => (
                      <label key={i} className="track-item">
                        <input type="checkbox" checked={reencodeSelectedTracks.includes(i)} onChange={() => toggleReencodeTrack(i)} disabled={isReencoding} />
                        <span className="track-name">{track.title || `Track ${i + 1}`}</span>
                        <span className="track-detail">{track.codec_name} · {track.channels}ch</span>
                      </label>
                    ))}
                  </div>
                )
              }
            </div>
          )}
          <label className="checkbox-label">
            <input type="checkbox" checked={reencodeSettings.replaceOriginal} onChange={e => setReencodeSettings({ ...reencodeSettings, replaceOriginal: e.target.checked })} disabled={isReencoding} />
            Replace original files (saves space)
          </label>
          <p className="modal-note">
            {reencodeSettings.codec === 'copy'
              ? 'Stream copy re-exports the video without re-encoding. Use this to quickly remove unwanted audio tracks.'
              : 'Reencoding may take several minutes per video. Lower CRF = better quality but larger files. H.265 typically saves 30-50% space compared to H.264.'}
          </p>
        </div>
        {isReencoding && (
          <div className="reencode-progress">
            <div className="progress-info">
              <span>Reencoding {reencodeProgress.current} of {reencodeProgress.total}</span>
              <span className="progress-filename">{reencodeProgress.currentFile}</span>
            </div>
            <div className="progress-bar-container">
              <div className="progress-bar-fill" style={{ width: `${reencodeProgress.total > 0 ? (reencodeProgress.current / reencodeProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={isReencoding}>Cancel</button>
          <button className="btn btn-primary" onClick={onReencode} disabled={isReencoding}>
            {isReencoding ? <><Loader size={14} /> Processing...</> : reencodeSettings.codec === 'copy' ? <><Package size={14} /> Re-export</> : <><Film size={14} /> Start Reencoding</>}
          </button>
        </div>
      </div>
    </div>
  );
}
