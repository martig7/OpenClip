import { useState } from 'react';
import { Plus, Edit2, Trash2, RefreshCw, ChevronDown, Music, Mic } from 'lucide-react';
import api from '../../api';
import { AUDIO_KIND_META, AudioIcon } from './audioSourceUtils';

export default function SceneAudioSourcesCard({
  masterAudioSources,
  applyingSource,
  showAudioDropdown,
  setShowAudioDropdown,
  audioDropdownRef,
  availableAudioInputs,
  loadingAudioInputs,
  audioDropdownError,
  trackLabels,
  setTrackLabels,
  trackData,
  trackLoading,
  onLoadAudioInputs,
  onAddSource,
  onRemoveSource,
  onToggleTrack,
  showToast,
}) {
  const [showTrackEditor, setShowTrackEditor] = useState(false);
  const [tempTrackLabels, setTempTrackLabels] = useState([]);
  const [savingTrackLabels, setSavingTrackLabels] = useState(false);

  return (
    <>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="card-title">Scene Audio Sources</span>
            <button
              className="btn btn-secondary btn-sm"
              style={{ padding: '3px 8px', fontSize: 10 }}
              onClick={() => {
                setTempTrackLabels([...trackLabels]);
                setShowTrackEditor(true);
              }}
            >
              <Edit2 size={10} style={{ marginRight: 4 }} /> Edit Track Labels
            </button>
          </div>
          <div style={{ position: 'relative' }} ref={audioDropdownRef}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (!showAudioDropdown) {
                  setShowAudioDropdown(true);
                  onLoadAudioInputs();
                } else {
                  setShowAudioDropdown(false);
                }
              }}
            >
              <Plus size={13} /> Add Source
            </button>

            {showAudioDropdown && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 200,
                minWidth: 300,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                overflow: 'hidden',
              }}>
                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Select Audio Source
                </div>
                {loadingAudioInputs ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                    <RefreshCw size={13} className="spinning" /> Loading audio sources…
                  </div>
                ) : audioDropdownError ? (
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>{audioDropdownError}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Make sure OBS is running and WebSocket is configured.</div>
                  </div>
                ) : availableAudioInputs.length === 0 ? (
                  <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                    No audio sources found. Ensure OBS is running.
                  </div>
                ) : (
                  <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                    {/* Group: OBS sources */}
                    {availableAudioInputs.filter(a => a.source === 'obs').length > 0 && (
                      <>
                        <div style={{ padding: '6px 12px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>OBS Inputs</div>
                        {availableAudioInputs.filter(a => a.source === 'obs').map((entry, i) => {
                          const alreadyAdded = masterAudioSources.some(s => s.name === entry.name);
                          const meta = AUDIO_KIND_META[entry.kind];
                          return (
                            <button
                              key={entry.name}
                              onClick={() => !alreadyAdded && onAddSource(entry)}
                              disabled={alreadyAdded}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                padding: '7px 14px', background: 'none', border: 'none',
                                cursor: alreadyAdded ? 'default' : 'pointer', textAlign: 'left',
                                opacity: alreadyAdded ? 0.5 : 1,
                                transition: 'background 0.1s',
                              }}
                              onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                            >
                              <AudioIcon kind={entry.kind} size={14} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta?.label || entry.kind}</div>
                              </div>
                              {alreadyAdded && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Added</span>}
                            </button>
                          );
                        })}
                      </>
                    )}
                    {/* Group: Windows devices not in OBS */}
                    {availableAudioInputs.filter(a => a.source === 'windows').length > 0 && (
                      <>
                        <div style={{ padding: '6px 12px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', borderTop: '1px solid var(--border)', marginTop: 4 }}>Windows Audio Devices</div>
                        {availableAudioInputs.filter(a => a.source === 'windows').map((entry, i) => {
                          const alreadyAdded = masterAudioSources.some(s => s.name === entry.name);
                          return (
                            <button
                              key={entry.name}
                              onClick={() => !alreadyAdded && onAddSource(entry)}
                              disabled={alreadyAdded}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                padding: '7px 14px', background: 'none', border: 'none',
                                cursor: alreadyAdded ? 'default' : 'pointer', textAlign: 'left',
                                opacity: alreadyAdded ? 0.5 : 1,
                                transition: 'background 0.1s',
                              }}
                              onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                            >
                              {entry.kind === 'wasapi_input_capture' ? <Mic size={14} /> : <Music size={14} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.kind === 'wasapi_input_capture' ? 'Input device' : 'Output device'}</div>
                              </div>
                              {alreadyAdded && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Added</span>}
                            </button>
                          );
                        })}
                      </>
                    )}
                    {/* Group: Running Applications (Application Audio Capture) */}
                    {availableAudioInputs.filter(a => a.source === 'app').length > 0 && (
                      <>
                        <div style={{ padding: '6px 12px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', borderTop: '1px solid var(--border)', marginTop: 4 }}>Applications</div>
                        {availableAudioInputs.filter(a => a.source === 'app').map((entry, i) => {
                          const alreadyAdded = masterAudioSources.some(s => s.name === entry.name);
                          return (
                            <button
                              key={entry.name}
                              onClick={() => !alreadyAdded && onAddSource(entry)}
                              disabled={alreadyAdded}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                padding: '7px 14px', background: 'none', border: 'none',
                                cursor: alreadyAdded ? 'default' : 'pointer', textAlign: 'left',
                                opacity: alreadyAdded ? 0.5 : 1,
                                transition: 'background 0.1s',
                              }}
                              onMouseEnter={e => { if (!alreadyAdded) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                            >
                              <ChevronDown size={14} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Application Audio Capture</div>
                              </div>
                              {alreadyAdded && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>Added</span>}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        <div style={{ padding: '4px 16px 10px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          Audio sources added here are applied to all game scenes. Use the Edit button on a game to manage per-scene sources.
        </div>

        {/* Master source list */}
        {masterAudioSources.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', gap: 8 }}>
            <Music size={28} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>No audio sources added yet.</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', opacity: 0.7 }}>Click <strong>Add Source</strong> to pick from OBS inputs or Windows audio devices.</div>
          </div>
        ) : (
          <>
            {/* Track label header row */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '5px 16px 2px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 5, marginRight: 82 }}>
                {[1, 2, 3, 4, 5, 6].map(num => (
                  <div key={num} style={{ width: 22, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>
                    {trackLabels[num - 1] || `T${num}`}
                  </div>
                ))}
              </div>
            </div>

            {masterAudioSources.map(src => {
              const meta = AUDIO_KIND_META[src.kind];
              const isApplying = applyingSource === src.name;
              const tracks = trackData[src.name] || {};
              const isTrackLoading = trackLoading[src.name];

              return (
                <div key={src.name} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '9px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 'var(--radius-sm)', background: 'var(--bg-tertiary)', flexShrink: 0 }}>
                    <AudioIcon kind={src.kind} size={15} />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta?.label || src.kind}</div>
                  </div>

                  {/* Track routing chips */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0' }}>
                    {[1, 2, 3, 4, 5, 6].map(num => {
                      const active = tracks[String(num)] === true;
                      return (
                        <button
                          key={num}
                          title={`${trackLabels[num - 1] || `Track ${num}`}: ${active ? 'active' : 'inactive'}`}
                          disabled={isTrackLoading}
                          onClick={() => onToggleTrack(src.name, num)}
                          style={{
                            width: 22, height: 22,
                            borderRadius: 4,
                            border: active ? '1.5px solid var(--primary)' : '1.5px solid var(--border-light)',
                            background: active ? 'var(--primary)' : 'var(--bg-secondary)',
                            color: active ? '#fff' : 'var(--text-muted)',
                            fontSize: 10, fontWeight: 600,
                            cursor: isTrackLoading ? 'default' : 'pointer',
                            opacity: isTrackLoading ? 0.6 : 1,
                            transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            lineHeight: 1,
                          }}
                        >
                          {num}
                        </button>
                      );
                    })}
                    {isTrackLoading && <RefreshCw size={11} className="spinning" style={{ color: 'var(--text-muted)', marginLeft: 2 }} />}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 70, justifyContent: 'flex-end' }}>
                    {isApplying && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <RefreshCw size={11} className="spinning" /> Applying…
                      </span>
                    )}
                    <button
                      className="btn-icon"
                      onClick={() => onRemoveSource(src.name)}
                      title="Remove from master list"
                      style={{ color: 'var(--danger)', marginLeft: 8 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {masterAudioSources.length > 0 && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
            OBS must be running with WebSocket enabled. Removing from this list does not remove from existing scenes.
          </div>
        )}
      </div>

      {/* Track Editor Modal */}
      {showTrackEditor && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingTrackLabels) setShowTrackEditor(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Edit Track Labels</h2>
            <p>Customize the names of OBS audio tracks to easily identify them (e.g. "Stream Mix", "VOD Track"). These names will be saved to your OBS profile.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
              {[0, 1, 2, 3, 4, 5].map(idx => (
                <div key={idx} className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Track {idx + 1}</label>
                  <input
                    className="form-input"
                    value={tempTrackLabels[idx] || ''}
                    placeholder={`Track ${idx + 1}`}
                    disabled={savingTrackLabels}
                    onChange={e => {
                      const newArr = [...tempTrackLabels];
                      newArr[idx] = e.target.value;
                      setTempTrackLabels(newArr);
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setShowTrackEditor(false)} disabled={savingTrackLabels}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={savingTrackLabels}
                onClick={async () => {
                  setSavingTrackLabels(true);
                  try {
                    await api.setTrackNames(tempTrackLabels);
                    setTrackLabels(tempTrackLabels);
                    showToast('Track labels updated successfully');
                    setShowTrackEditor(false);
                  } catch {
                    showToast('Failed to save track labels');
                  } finally {
                    setSavingTrackLabels(false);
                  }
                }}
              >
                {savingTrackLabels ? <RefreshCw size={14} className="spinning" /> : 'Save Labels'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
