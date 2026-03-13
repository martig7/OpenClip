import { useEffect } from 'react';
import { ChevronDown, RefreshCw, Wand2, Check, AlertTriangle, Image, X, Settings } from 'lucide-react';
import api from '../../api';

export default function AddGameModal({
  newGame, setNewGame,
  showWindowPicker, setShowWindowPicker,
  visibleWindows, setVisibleWindows,
  loadingWindows, setLoadingWindows,
  autoCreateScene, setAutoCreateScene,
  createMode, setCreateMode,
  capturePref, setCapturePref,
  obsScenes, setObsScenes,
  loadingScenes, setLoadingScenes,
  scenesError, setScenesError,
  templateScene, setTemplateScene,
  sceneCreateStatus,
  onClose,
  onAddGame,
  onSceneConflictUseExisting,
  onSceneConflictOverwrite,
  onGoToSettings,
}) {
  useEffect(() => {
    refreshWindows();
    loadOBSScenes();
  }, []);

  async function refreshWindows() {
    setLoadingWindows(true);
    try {
      const windows = await api.getVisibleWindows();
      setVisibleWindows(windows);
    } catch {
      // silently fail on initial load
    } finally {
      setLoadingWindows(false);
    }
  }

  function selectWindow(win) {
    setNewGame(g => ({
      ...g,
      name: g.name || win.process,
      selector: win.title,
      exe: win.exe,
      windowClass: win.windowClass,
      windowMatchPriority: 0,
    }));
    setShowWindowPicker(false);
    api.extractWindowIcon(win.process).then(iconPath => {
      if (iconPath) setNewGame(g => ({ ...g, icon_path: iconPath }));
    });
  }

  async function loadOBSScenes() {
    setLoadingScenes(true);
    setScenesError(null);
    try {
      const scenes = await api.getOBSWSScenes();
      setObsScenes(scenes || []);
    } catch (err) {
      setObsScenes([]);
      setScenesError(err.message || 'Failed to load OBS scenes');
    } finally {
      setLoadingScenes(false);
    }
  }

  async function pickIcon() {
    const filePath = await api.openFileDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp', 'gif', 'webp'] }],
    });
    if (filePath) setNewGame(g => ({ ...g, icon_path: filePath }));
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Game</h2>
        <p>Add a game to monitor for automatic OBS recording.</p>
        <div className="form-group">
          <label className="form-label">Game Name</label>
          <input
            className="form-input"
            placeholder="e.g. Valorant"
            value={newGame.name}
            onChange={e => setNewGame({ ...newGame, name: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Window Selector</label>
          <div className="form-input-row">
            <input
              className="form-input"
              placeholder="e.g. VALORANT or valorant.exe"
              value={newGame.selector}
              onChange={e => setNewGame({ ...newGame, selector: e.target.value })}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const nextState = !showWindowPicker;
                setShowWindowPicker(nextState);
                if (nextState) {
                  setLoadingWindows(true);
                  try {
                    const windows = await api.getVisibleWindows();
                    setVisibleWindows(windows);
                  } finally {
                    setLoadingWindows(false);
                  }
                }
              }}
              title="Pick from running windows"
            >
              <ChevronDown size={13} />
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={refreshWindows}
              title="Refresh window list"
              disabled={loadingWindows}
            >
              <RefreshCw size={13} className={loadingWindows ? 'spinning' : ''} />
            </button>
            {showWindowPicker && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 200,
                marginTop: 4,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                maxHeight: 400,
                overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {visibleWindows.length === 0 ? (
                  <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {loadingWindows ? 'Loading...' : 'No windows found. Click refresh.'}
                  </div>
                ) : (
                  visibleWindows.map((win, i) => (
                    <div
                      key={i}
                      onClick={() => selectWindow(win)}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ color: 'var(--text-primary)' }}>{win.title}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{win.exe}] {win.windowClass !== win.process ? win.windowClass : ''}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          {newGame.selector && newGame.exe && (
            <span style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4, display: 'block' }}>
              ✓ Exact match binding set: {newGame.exe}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
            {newGame.exe ? (
              newGame.windowMatchPriority === 2 ? (
                <>Watcher detects by exact process name (<strong>{newGame.exe}</strong>), not window title.</>
              ) : newGame.windowMatchPriority === 1 ? (
                <>Watcher primarily matches window title; if not found, it may fall back to the process executable (<strong>{newGame.exe}</strong>).</>
              ) : (
                <>Watcher matches window title. The exe binding (<strong>{newGame.exe}</strong>) is mainly used for OBS Application Audio Capture window selection.</>
              )
            ) : (
              'Pick a running window (recommended) or type a process name / window title to match'
            )}
          </span>
        </div>
        {/* Window Match Priority */}
        <div className="form-group">
          <label className="form-label">Window Match Priority</label>
          <select
            className="form-input"
            value={newGame.windowMatchPriority !== undefined ? newGame.windowMatchPriority : 0}
            onChange={e => setNewGame({ ...newGame, windowMatchPriority: parseInt(e.target.value, 10) })}
          >
            <option value={0}>Match title, otherwise find window of same type</option>
            <option value={1}>Match title, otherwise find window of same executable</option>
            <option value={2}>Match executable</option>
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
            Controls how the watcher detects this game and how OBS Application Audio Capture picks its window.
          </span>
        </div>
        <div className="form-group">
          <label className="form-label">OBS Scene <span style={{ color: 'var(--danger)' }}>*</span></label>
          <input
            className="form-input"
            placeholder="e.g. Gaming Scene (required)"
            value={newGame.scene}
            onChange={e => setNewGame({ ...newGame, scene: e.target.value })}
            required
          />
        </div>

        {newGame.scene && (
          <div className="form-group" style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Wand2 size={13} /> Auto-create scene in OBS
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Create this scene in OBS with sources and audio inputs
                </div>
              </div>
              <button
                className={`toggle ${autoCreateScene ? 'on' : ''}`}
                onClick={() => {
                  const next = !autoCreateScene;
                  setAutoCreateScene(next);
                  if (next && createMode === 'template' && obsScenes.length === 0) loadOBSScenes();
                }}
              />
            </div>

            {autoCreateScene && (
              <div style={{ marginTop: 10 }}>
                {/* Mode selector */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button
                    className={`btn btn-sm ${createMode === 'scratch' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setCreateMode('scratch')}
                    style={{ flex: 1 }}
                  >
                    Build from scratch
                  </button>
                  <button
                    className={`btn btn-sm ${createMode === 'template' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setCreateMode('template'); if (obsScenes.length === 0) loadOBSScenes(); }}
                    style={{ flex: 1 }}
                  >
                    Copy from template
                  </button>
                </div>

                {createMode === 'scratch' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Capture type header row */}
                    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Check size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                      <span>
                        <span style={{ fontWeight: 500 }}>
                          {capturePref === 'window_capture' ? 'Window Capture' : 'Game Capture'}
                        </span>
                        {newGame.selector && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                            — <em>{newGame.selector}</em>
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Capture kind picker */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[
                        { key: 'game_capture', label: 'Game Capture' },
                        { key: 'window_capture', label: 'Window Capture' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          className={`btn btn-sm ${capturePref === key ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ flex: 1, fontSize: 11 }}
                          onClick={() => setCapturePref(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {capturePref === 'window_capture'
                        ? 'Cross-platform. Use if Game Capture doesn't work for this title.'
                        : 'Best for games on Windows. Fits source to canvas automatically.'}
                    </span>

                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Audio sources are managed in the <strong>Scene Audio Sources</strong> card on the main Games page.
                    </span>
                  </div>
                )}

                {createMode === 'template' && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <label className="form-label" style={{ margin: 0, flex: 1 }}>Template scene (optional)</label>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={loadOBSScenes}
                        disabled={loadingScenes}
                        title="Refresh scene list from OBS"
                      >
                        <RefreshCw size={12} className={loadingScenes ? 'spinning' : ''} />
                      </button>
                    </div>
                    {loadingScenes ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading scenes from OBS...</div>
                    ) : scenesError ? (
                      <div style={{
                        fontSize: 12,
                        color: 'var(--danger)',
                        padding: '6px 8px',
                        background: 'rgba(239,68,68,0.1)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid rgba(239,68,68,0.3)'
                      }}>
                        {scenesError}{' '}
                        <button
                          onClick={onGoToSettings}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--primary)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            padding: 0,
                            font: 'inherit',
                            display: 'inline',
                          }}
                        >
                          <Settings size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                          Configure WebSocket
                        </button>
                      </div>
                    ) : obsScenes.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        No scenes found. Make sure OBS is running and{' '}
                        <button
                          onClick={onGoToSettings}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--primary)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            padding: 0,
                            font: 'inherit',
                            display: 'inline',
                          }}
                        >
                          <Settings size={12} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                          WebSocket is configured
                        </button>
                        .
                      </div>
                    ) : (
                      <select
                        className="form-input"
                        value={templateScene}
                        onChange={e => setTemplateScene(e.target.value)}
                      >
                        <option value="">— Create empty scene —</option>
                        {obsScenes.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    )}
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                      All sources from the selected template will be copied into the new scene
                    </span>
                  </div>
                )}
              </div>
            )}

            {sceneCreateStatus && (
              <div style={{
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                background: sceneCreateStatus.type === 'conflict'
                  ? 'rgba(245,158,11,0.1)'
                  : sceneCreateStatus.type === 'success'
                    ? 'rgba(34,197,94,0.1)'
                    : sceneCreateStatus.type === 'loading'
                      ? 'rgba(99,102,241,0.1)'
                      : 'rgba(239,68,68,0.1)',
                color: sceneCreateStatus.type === 'conflict'
                  ? '#f59e0b'
                  : sceneCreateStatus.type === 'success'
                    ? 'var(--success)'
                    : sceneCreateStatus.type === 'loading'
                      ? 'var(--primary)'
                      : 'var(--danger)',
                border: `1px solid ${
                  sceneCreateStatus.type === 'conflict'
                    ? 'rgba(245,158,11,0.3)'
                    : sceneCreateStatus.type === 'success'
                      ? 'rgba(34,197,94,0.3)'
                      : sceneCreateStatus.type === 'loading'
                        ? 'rgba(99,102,241,0.3)'
                        : 'rgba(239,68,68,0.3)'
                }`,
              }}>
                {sceneCreateStatus.type === 'conflict' ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                      A scene named <strong style={{ margin: '0 3px' }}>{newGame.scene}</strong> already exists in OBS.
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: 11 }}
                        onClick={onSceneConflictUseExisting}
                      >
                        Use Existing
                      </button>
                      <button
                        className="btn btn-sm"
                        style={{ fontSize: 11, background: 'var(--danger)', color: '#fff', border: 'none' }}
                        onClick={onSceneConflictOverwrite}
                      >
                        Overwrite
                      </button>
                    </div>
                  </div>
                ) : sceneCreateStatus.type === 'loading' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={12} className="spinning" />
                    {sceneCreateStatus.message}
                  </div>
                ) : (
                  sceneCreateStatus.message
                )}
              </div>
            )}
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Icon (optional)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {newGame.icon_path && (
              <img
                src={`localfile:///${newGame.icon_path.replace(/\\/g, '/')}`}
                alt=""
                style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <button className="btn btn-secondary btn-sm" onClick={pickIcon} style={{ flex: 1 }}>
              <Image size={13} /> {newGame.icon_path ? 'Change Icon' : 'Choose Icon'}
            </button>
            {newGame.icon_path && (
              <button className="btn-icon" onClick={() => setNewGame(g => ({ ...g, icon_path: '' }))} title="Remove icon">
                <X size={13} />
              </button>
            )}
          </div>
          {newGame.icon_path && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
              {newGame.icon_path}
            </span>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onAddGame}>Add Game</button>
        </div>
      </div>
    </div>
  );
}
