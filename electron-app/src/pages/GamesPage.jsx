import { useState, useEffect } from 'react';
import { Plus, Trash2, Play, Square, Circle, Edit2, Check, X, Gamepad2, RefreshCw, ChevronDown } from 'lucide-react';
import api from '../api';

export default function GamesPage() {
  const [games, setGames] = useState([]);
  const [watcherStatus, setWatcherStatus] = useState({ running: false, currentGame: null, startedAt: null, gameState: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editScene, setEditScene] = useState('');
  const [newGame, setNewGame] = useState({ name: '', selector: '', scene: '' });
  const [visibleWindows, setVisibleWindows] = useState([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);

  useEffect(() => {
    loadGames();
    loadWatcherStatus();
    const unsub = api.onWatcherState((state) => {
      setWatcherStatus(prev => ({ ...prev, currentGame: state.currentGame }));
    });
    // Auto-refresh watcher status every 2 seconds
    const interval = setInterval(loadWatcherStatus, 2000);
    return () => { unsub(); clearInterval(interval); };
  }, []);

  async function loadGames() {
    setGames(await api.getGames());
  }

  async function loadWatcherStatus() {
    setWatcherStatus(await api.getWatcherStatus());
  }

  async function addGame() {
    if (!newGame.name || !newGame.selector) return;
    await api.addGame(newGame);
    setNewGame({ name: '', selector: '', scene: '' });
    setShowAddModal(false);
    loadGames();
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
    setNewGame({
      name: newGame.name || win.process,
      selector: win.title,
      scene: newGame.scene,
    });
    setShowWindowPicker(false);
  }

  function openAddModal() {
    setShowAddModal(true);
    refreshWindows();
  }

  async function toggleWatcher() {
    if (watcherStatus.running) {
      await api.stopWatcher();
    } else {
      await api.startWatcher();
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
        <WatcherStatusCard status={watcherStatus} onToggle={toggleWatcher} />

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
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
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
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addGame}>Add Game</button>
            </div>
          </div>
        </div>
      )}
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

function WatcherStatusCard({ status, onToggle }) {
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
