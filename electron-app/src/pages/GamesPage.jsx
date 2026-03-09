import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Play, Square, Circle, Edit2, Check, X, Gamepad2, RefreshCw, ChevronDown, Image, Wand2, Settings, AlertTriangle } from 'lucide-react';
import api from '../api';

export default function GamesPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [watcherStatus, setWatcherStatus] = useState({ running: false, currentGame: null, startedAt: null, gameState: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editScene, setEditScene] = useState('');
  const [newGame, setNewGame] = useState({ name: '', selector: '', scene: '', icon_path: '' });
  const [visibleWindows, setVisibleWindows] = useState([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [autoCreateScene, setAutoCreateScene] = useState(false);
  const [obsScenes, setObsScenes] = useState([]);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [scenesError, setScenesError] = useState(null);
  const [templateScene, setTemplateScene] = useState('');
  const [sceneCreateStatus, setSceneCreateStatus] = useState(null); // { type: 'success'|'error', message }
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadGames();
    loadWatcherStatus();
    // If the watcher is already running (e.g. auto-start on startup), check the script
    api.getWatcherStatus().then(s => {
      if (s.running) {
        api.isOBSScriptLoaded().then(loaded => {
          if (!loaded) setScriptWarning(true);
        });
      }
    });
    // Replace polling with server-push: main process sends full status on any watcher state change
    const unsub = api.onWatcherStatusPush((status) => setWatcherStatus(status));
    return () => unsub();
  }, []);

  async function loadGames() {
    setGames(await api.getGames());
  }

  async function loadWatcherStatus() {
    setWatcherStatus(await api.getWatcherStatus());
  }

  async function addGame() {
    if (!newGame.name || !newGame.selector) return;

    // Auto-create the OBS scene before saving the game
    if (autoCreateScene && newGame.scene) {
      setSceneCreateStatus(null);
      try {
        const result = await api.createOBSScene(newGame.scene, templateScene || null);
        if (!result.success) {
          setSceneCreateStatus({ type: 'error', message: result.message });
          return;
        }
        // Show success as a toast after the modal closes so the user sees it
        showToast(result.message || `Scene "${newGame.scene}" created in OBS`);
      } catch (err) {
        setSceneCreateStatus({ type: 'error', message: err.message || 'Failed to create OBS scene' });
        return;
      }
    }

    await api.addGame(newGame);
    resetAddModal();
    setShowAddModal(false);
    loadGames();
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function pickIcon() {
    const filePath = await api.openFileDialog({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp', 'gif', 'webp'] }],
    });
    if (filePath) setNewGame(g => ({ ...g, icon_path: filePath }));
  }

  async function removeGame(id) {
    await api.removeGame(id);
    loadGames();
  }

  async function toggleGame(id) {
    await api.toggleGame(id);
    loadGames();
  }

  async function saveScene(id) {
    await api.updateGame(id, { scene: editScene });
    setEditingId(null);
    loadGames();
  }

  async function refreshWindows() {
    setLoadingWindows(true);
    const windows = await api.getVisibleWindows();
    setVisibleWindows(windows);
    setLoadingWindows(false);
  }

  function selectWindow(win) {
    setNewGame(g => ({
      ...g,
      name: g.name || win.process,
      selector: win.title,
    }));
    setShowWindowPicker(false);
    // Try to extract the exe icon in the background
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

  function resetAddModal() {
    setNewGame({ name: '', selector: '', scene: '', icon_path: '' });
    setAutoCreateScene(false);
    setTemplateScene('');
    setObsScenes([]);
    setScenesError(null);
    setSceneCreateStatus(null);
  }

  function openAddModal() {
    resetAddModal();
    setShowAddModal(true);
    refreshWindows();
  }

  function goToSettings() {
    setShowAddModal(false);
    resetAddModal();
    navigate('/settings');
  }

  const [scriptWarning, setScriptWarning] = useState(null);

  async function toggleWatcher() {
    if (watcherStatus.running) {
      await api.stopWatcher();
      setScriptWarning(null);
    } else {
      await api.startWatcher();
      // Check if the OBS script is loaded (non-blocking)
      api.isOBSScriptLoaded().then(loaded => {
        if (!loaded) setScriptWarning(true);
      });
    }
    loadWatcherStatus();
  }

  return (
    <>
      <div className="page-header">
        <h1>Games</h1>
        <p>Manage games to automatically record with OBS</p>
      </div>

      <div className="page-body">
        {/* Watcher Status Card - always visible */}
        <WatcherStatusCard status={watcherStatus} onToggle={toggleWatcher} scriptWarning={scriptWarning} onDismissWarning={() => setScriptWarning(null)} onGoToSettings={() => navigate('/settings')} />

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <span className="card-title">Game Library ({games.length})</span>
            <button className="btn btn-primary btn-sm" onClick={openAddModal}>
              <Plus size={14} /> Add Game
            </button>
          </div>

          {games.length === 0 ? (
            <div className="empty-state">
              <Gamepad2 size={40} />
              <p>No games added yet. Click "Add Game" to get started.</p>
            </div>
          ) : (
            <div>
              {games.map(game => (
                <div key={game.id} className="list-item">
                  <button
                    className={`toggle ${game.enabled ? 'on' : ''}`}
                    onClick={() => toggleGame(game.id)}
                    title={game.enabled ? 'Enabled' : 'Disabled'}
                  />
                  {game.icon_path && (
                    <img
                      src={`localfile:///${game.icon_path.replace(/\\/g, '/')}`}
                      alt=""
                      style={{ width: 24, height: 24, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
                      onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <div className="list-item-info">
                    <div className="list-item-title">{game.name}</div>
                    <div className="list-item-subtitle">
                      Selector: {game.selector}
                      {editingId === game.id ? (
                        <span style={{ marginLeft: 8 }}>
                          <input
                            className="form-input"
                            style={{ width: 120, display: 'inline', padding: '2px 6px', fontSize: 11 }}
                            value={editScene}
                            onChange={e => setEditScene(e.target.value)}
                            placeholder="Scene name"
                          />
                          <button className="btn-icon" onClick={() => saveScene(game.id)}>
                            <Check size={12} />
                          </button>
                          <button className="btn-icon" onClick={() => setEditingId(null)}>
                            <X size={12} />
                          </button>
                        </span>
                      ) : (
                        game.scene && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>| Scene: {game.scene}</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => { setEditingId(game.id); setEditScene(game.scene || ''); }}
                    title="Edit scene"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="btn-icon"
                    onClick={() => removeGame(game.id)}
                    title="Remove game"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={() => { resetAddModal(); setShowAddModal(false); }}>
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
                  onClick={() => setShowWindowPicker(!showWindowPicker)}
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
              </div>
              {showWindowPicker && (
                <div style={{
                  marginTop: 4,
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-sm)',
                  maxHeight: 180,
                  overflowY: 'auto',
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
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{win.process}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                Pick a running window or type a window title / process name to match
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">OBS Scene (optional)</label>
              <input
                className="form-input"
                placeholder="e.g. Gaming Scene"
                value={newGame.scene}
                onChange={e => setNewGame({ ...newGame, scene: e.target.value })}
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
                      Create this scene in OBS, copying sources from a template
                    </div>
                  </div>
                  <button
                    className={`toggle ${autoCreateScene ? 'on' : ''}`}
                    onClick={() => {
                      const next = !autoCreateScene;
                      setAutoCreateScene(next);
                      setSceneCreateStatus(null);
                      if (next && obsScenes.length === 0) loadOBSScenes();
                    }}
                  />
                </div>

                {autoCreateScene && (
                  <div style={{ marginTop: 10 }}>
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
                          onClick={goToSettings}
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
                          onClick={goToSettings}
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

                {sceneCreateStatus && (
                  <div style={{
                    marginTop: 8,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    background: sceneCreateStatus.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    color: sceneCreateStatus.type === 'success' ? 'var(--success)' : 'var(--danger)',
                    border: `1px solid ${sceneCreateStatus.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  }}>
                    {sceneCreateStatus.message}
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
              <button className="btn btn-secondary" onClick={() => { resetAddModal(); setShowAddModal(false); }}>Cancel</button>
              <button className="btn btn-primary" onClick={addGame}>Add Game</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function formatUptime(startedAt) {
  if (!startedAt) return '';
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function parseGameState(gameState) {
  if (!gameState) return { label: 'No state file', color: 'var(--text-muted)' };
  if (gameState.startsWith('RECORDING')) {
    const parts = gameState.split('|');
    const game = parts[1] || 'Unknown';
    const scene = parts[2] || '';
    return {
      label: `Recording ${game}${scene ? ` (Scene: ${scene})` : ''}`,
      color: 'var(--danger)',
      recording: true,
      game,
    };
  }
  if (gameState === 'IDLE') return { label: 'Idle - watching for games', color: 'var(--text-secondary)' };
  return { label: gameState, color: 'var(--text-muted)' };
}

function WatcherStatusCard({ status, onToggle, scriptWarning, onDismissWarning, onGoToSettings }) {
  const state = parseGameState(status.gameState);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Watcher Status</span>
        <button
          className={`btn btn-sm ${status.running ? 'btn-danger' : 'btn-primary'}`}
          onClick={onToggle}
        >
          {status.running ? <><Square size={13} /> Stop Watcher</> : <><Play size={13} /> Start Watcher</>}
        </button>
      </div>

      {scriptWarning && status.running && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 12, borderRadius: 'var(--radius-sm)',
          background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          fontSize: 12, color: 'var(--warning, #f59e0b)',
        }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>
            OBS script not detected. Add it in OBS under Tools → Scripts for automatic recording.{' '}
            <button
              onClick={onGoToSettings}
              style={{
                background: 'none', border: 'none', color: 'var(--primary)',
                textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit',
              }}
            >
              <Settings size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              Setup guide
            </button>
          </span>
          <button
            className="btn-icon"
            onClick={onDismissWarning}
            title="Dismiss"
            style={{ flexShrink: 0 }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', fontSize: 13 }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>STATUS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Circle
              size={8}
              fill={status.running ? 'var(--success)' : 'var(--text-muted)'}
              color={status.running ? 'var(--success)' : 'var(--text-muted)'}
            />
            <span style={{ color: status.running ? 'var(--success)' : 'var(--text-muted)', fontWeight: 500 }}>
              {status.running ? 'Running' : 'Stopped'}
            </span>
          </div>
        </div>

        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>UPTIME</div>
          <span style={{ color: 'var(--text-secondary)' }}>
            {status.running && status.startedAt ? formatUptime(status.startedAt) : '--'}
          </span>
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 2 }}>STATE</div>
          <span style={{ color: state.color, fontWeight: state.recording ? 500 : 400 }}>
            {state.recording && (
              <Circle size={7} fill="var(--danger)" color="var(--danger)" style={{ marginRight: 4, display: 'inline' }} />
            )}
            {state.label}
          </span>
        </div>
      </div>
    </div>
  );
}
