import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Play, Square, Circle, Edit2, Check, X, Gamepad2, RefreshCw, ChevronDown, Image, Wand2, Settings, AlertTriangle, Music, Mic, Save } from 'lucide-react';
import api from '../api';

// Human-readable metadata for known OBS audio input kinds
const AUDIO_KIND_META = {
  magic_game_audio: { label: 'Auto Game Audio', icon: 'app', description: 'Automatically captures the respective game window' },
  wasapi_output_capture: { label: 'Desktop Audio', icon: 'music', description: 'Captures all system/game audio output' },
  wasapi_input_capture: { label: 'Microphone / Input', icon: 'mic', description: 'Captures microphone or audio input device' },
  wasapi_process_output_capture: { label: 'Application Audio', icon: 'app', description: 'Captures audio from a specific application' },
  coreaudio_output_capture: { label: 'Desktop Audio (Mac)', icon: 'music', description: 'Captures macOS system audio output' },
  coreaudio_input_capture: { label: 'Microphone (Mac)', icon: 'mic', description: 'Captures macOS audio input device' },
  pulse_output_capture: { label: 'Desktop Audio (Linux)', icon: 'music', description: 'Captures PulseAudio output' },
  pulse_input_capture: { label: 'Microphone (Linux)', icon: 'mic', description: 'Captures PulseAudio input device' },
};

/**
 * Extract the exe filename from an OBS wasapi_process_output_capture window string.
 * Handles formats:
 *   "[exe.exe]:WindowClass:Window Title"
 *   "Window Title:WindowClass:exe.exe"
 *   "Window Title::exe.exe"
 */
function extractExeFromWindowStr(windowStr) {
  if (!windowStr) return null;
  // Format: [exe.exe]:class:title
  const bracketMatch = windowStr.match(/^\[([^\]]+\.exe)\]/i);
  if (bracketMatch) return bracketMatch[1].toLowerCase();
  // Format: title:class:exe.exe  or  title::exe.exe
  const parts = windowStr.split(':').map(p => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].toLowerCase().endsWith('.exe')) return parts[i].toLowerCase();
  }
  return null;
}

/**
 * Return a comparable window key for an application audio source.
 * Used to detect two sources targeting the same window/process.
 *
 * Priority:
 *  1. "Game Audio (X)" → "x"  (magic_game_audio or derived sources)
 *  2. OBS window string exe → stripped exe name
 *  3. Source name ending in .exe → stripped
 *  4. Source name as-is (lowercased)
 */
function getAppAudioWindowKey(sourceName, inputSettingsWindow) {
  // "Game Audio (GameName)" → game name as the key
  const gameAudioMatch = sourceName.match(/^Game Audio \((.+)\)$/i);
  if (gameAudioMatch) return gameAudioMatch[1].toLowerCase();

  // Extract exe from OBS window string and strip the .exe suffix
  if (inputSettingsWindow) {
    const exe = extractExeFromWindowStr(inputSettingsWindow);
    if (exe) return exe.replace(/\.exe$/i, '');
  }

  // Source name itself ends in .exe
  const lc = sourceName.toLowerCase();
  if (lc.endsWith('.exe')) return lc.slice(0, -4);

  return lc;
}

/** Returns true for OBS input kinds that capture per-application audio. */
function isAppAudioKind(kind) {
  return kind === 'wasapi_process_output_capture' || kind === 'magic_game_audio';
}

function AudioIcon({ kind, size = 15 }) {
  const meta = AUDIO_KIND_META[kind];
  if (!meta) return <Music size={size} />;
  if (meta.icon === 'mic') return <Mic size={size} />;
  if (meta.icon === 'app') return <ChevronDown size={size} style={{ transform: 'rotate(-90deg)' }} />;
  return <Music size={size} />;
}

export default function GamesPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [watcherStatus, setWatcherStatus] = useState({ running: false, currentGame: null, startedAt: null, gameState: null });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGame, setNewGame] = useState({ name: '', selector: '', scene: '', icon_path: '' });
  const [visibleWindows, setVisibleWindows] = useState([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [autoCreateScene, setAutoCreateScene] = useState(false);
  const [createMode, setCreateMode] = useState('scratch'); // 'scratch' | 'template'
  const [obsScenes, setObsScenes] = useState([]);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [scenesError, setScenesError] = useState(null);
  const [templateScene, setTemplateScene] = useState('');
  const [sceneCreateStatus, setSceneCreateStatus] = useState(null); // { type: 'success'|'error', message }
  const [toast, setToast] = useState(null);

  // Master audio source list — sources the user wants in all game scenes
  const [masterAudioSources, setMasterAudioSources] = useState([]); // [{ kind, label, name }]
  const masterAudioLoadedRef = useRef(false); // guard against persisting before the initial load
  const [applyingSource, setApplyingSource] = useState(null); // kind being applied

  // Audio dropdown state
  const [showAudioDropdown, setShowAudioDropdown] = useState(false);
  const [availableAudioInputs, setAvailableAudioInputs] = useState([]); // combined OBS + Windows
  const [loadingAudioInputs, setLoadingAudioInputs] = useState(false);
  const [audioDropdownError, setAudioDropdownError] = useState(null);
  const audioDropdownRef = useRef(null);

  // Edit game modal
  const [editGameModal, setEditGameModal] = useState(null); // { game, sceneAudioSources, loading }

  // Track parity and labels
  const [trackLabels, setTrackLabels] = useState(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6']);
  const [showTrackEditor, setShowTrackEditor] = useState(false);
  const [tempTrackLabels, setTempTrackLabels] = useState([]);
  const [savingTrackLabels, setSavingTrackLabels] = useState(false);
  const [trackData, setTrackData] = useState({});
  const [trackLoading, setTrackLoading] = useState({}); // { [inputName]: bool }

  // Load track info whenever scene audio sources or master audio sources change
  useEffect(() => {
    const allInputNames = new Set([
      ...(editGameModal?.sceneAudioSources || []).map(s => s.inputName),
      ...masterAudioSources.map(s => s.name)
    ]);
    const namesArray = Array.from(allInputNames);
    if (namesArray.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        namesArray.map(async name => {
          if (name === 'Game Audio') {
            for (const game of games) {
              if (game.scene) {
                try {
                  const tracks = await api.getInputAudioTracks(`Game Audio (${game.name})`);
                  return { name, tracks };
                } catch { continue; }
              }
            }
            return { name, tracks: {} };
          }
          return api.getInputAudioTracks(name)
            .then(tracks => ({ name, tracks }))
            .catch(() => ({ name, tracks: {} }));
        })
      );
      if (cancelled) return;
      setTrackData(prev => {
        const next = { ...prev };
        for (const { name, tracks } of results) next[name] = tracks;
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [editGameModal?.sceneAudioSources, masterAudioSources, games]);

  async function toggleTrack(inputName, trackNum) {
    const current = trackData[inputName] || {};
    const newVal = !current[String(trackNum)];
    const updated = { ...current, [String(trackNum)]: newVal };
    // Optimistic update
    setTrackData(prev => ({ ...prev, [inputName]: updated }));
    setTrackLoading(prev => ({ ...prev, [inputName]: true }));
    try {
      if (inputName === 'Game Audio') {
        const promises = [];
        for (const game of games) {
          if (game.scene) {
            promises.push(api.setInputAudioTracks(`Game Audio (${game.name})`, updated).catch(() => {}));
          }
        }
        await Promise.all(promises);
      } else {
        await api.setInputAudioTracks(inputName, updated);
      }
    } catch {
      // Revert on failure
      setTrackData(prev => ({ ...prev, [inputName]: current }));
    } finally {
      setTrackLoading(prev => ({ ...prev, [inputName]: false }));
    }
  }

  useEffect(() => {
    loadGames();
    loadTrackLabels();
    // Restore persisted master audio sources
    api.getStore('masterAudioSources').then(saved => {
      masterAudioLoadedRef.current = true;
      if (Array.isArray(saved) && saved.length > 0) setMasterAudioSources(saved);
    }).catch(() => { masterAudioLoadedRef.current = true; });
    api.getWatcherStatus().then(s => {
      setWatcherStatus(s);
      if (s.running) {
        api.isOBSScriptLoaded().then(loaded => {
          if (!loaded) setScriptWarning(true);
        }).catch(() => {});
      }
    }).catch(() => {});
    const unsub = api.onWatcherStatusPush((status) => setWatcherStatus(status));
    return () => unsub();
  }, []);

  // Persist master audio sources whenever the list changes
  useEffect(() => {
    if (!masterAudioLoadedRef.current) return; // skip until initial load has resolved
    api.setStore('masterAudioSources', masterAudioSources).catch(() => {});
  }, [masterAudioSources]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAudioDropdown) return;
    const handler = (e) => {
      if (audioDropdownRef.current && !audioDropdownRef.current.contains(e.target)) {
        setShowAudioDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAudioDropdown]);

  async function loadGames() {
    setGames(await api.getGames());
  }

  async function loadTrackLabels() {
    try {
      const labels = await api.getTrackNames();
      if (labels && labels.length === 6) setTrackLabels(labels);
    } catch {}
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
        let result;
        if (createMode === 'scratch') {
          result = await api.createOBSSceneFromScratch(newGame.scene, {
            windowTitle: newGame.selector,
            addWindowCapture: true,
          });
        } else {
          result = await api.createOBSScene(newGame.scene, templateScene || null);
        }
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
      exe: win.exe,
      windowClass: win.windowClass,
      windowMatchPriority: 0,
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
    setNewGame({ name: '', selector: '', exe: '', windowClass: '', windowMatchPriority: 0, scene: '', icon_path: '' });
    setAutoCreateScene(false);
    setCreateMode('scratch');
    setTemplateScene('');
    setObsScenes([]);
    setScenesError(null);
    setSceneCreateStatus(null);
  }

  /** Collect all scene names from games that have a scene set. */
  function getGameSceneNames() {
    return games.map(g => g.scene).filter(Boolean);
  }

  async function loadAudioInputsForDropdown() {
    setLoadingAudioInputs(true);
    setAudioDropdownError(null);
    try {
      // Fetch OBS audio inputs, Windows audio devices, running apps, and visible windows in parallel
      const [obsInputs, winDevices, runningApps, visibleWindows] = await Promise.all([
        api.getOBSAudioInputs().catch(() => []),
        api.listWindowsAudioDevices().catch(() => []),
        api.listRunningApps().catch(() => []),
        api.getVisibleWindows().catch(() => []),
      ]);

      // Build process name → window title map for constructing the OBS window selector
      // OBS wasapi_process_output_capture expects: "[Executable.exe]: Window Title"
      const windowTitleMap = new Map();
      for (const w of (visibleWindows || [])) {
        const proc = (w.process || '').toLowerCase();
        if (!windowTitleMap.has(proc)) windowTitleMap.set(proc, w.title || '');
      }

      // OBS entries first (already registered in OBS)
      const combined = [];
      const obsNames = new Set();
      for (const inp of (obsInputs || [])) {
        combined.push({ name: inp.inputName, kind: inp.inputKind, source: 'obs' });
        obsNames.add(inp.inputName);
      }
      // Windows audio devices (output/input) not already in OBS
      for (const dev of (winDevices || [])) {
        if (!obsNames.has(dev.name)) {
          const kind = dev.type === 'input' ? 'wasapi_input_capture' : 'wasapi_output_capture';
          combined.push({ name: dev.name, kind, source: 'windows' });
        }
      }
      // Running applications for application audio capture
      const obsAppNames = new Set(
        (obsInputs || [])
          .filter(i => i.inputKind === 'wasapi_process_output_capture')
          .map(i => i.inputName)
      );

      combined.unshift({
        name: 'Game Audio',
        kind: 'magic_game_audio',
        source: 'app',
      });

      for (const app of (runningApps || [])) {
        if (!obsAppNames.has(app.name) && !obsNames.has(app.name)) {
          const windowTitle = windowTitleMap.get(app.name.toLowerCase()) || '';
          combined.push({
            name: app.name,
            kind: 'wasapi_process_output_capture',
            source: 'app',
            exe: app.exe,
            hasWindow: app.hasWindow,
            inputSettings: { window: `${windowTitle}::${app.exe}` },
          });
        }
      }
      setAvailableAudioInputs(combined);
    } catch (err) {
      setAudioDropdownError(err.message || 'Failed to load audio sources');
    } finally {
      setLoadingAudioInputs(false);
    }
  }

  async function addMasterSource(entry) {
    // Don't add duplicates (by name)
    if (masterAudioSources.some(s => s.name === entry.name)) {
      setShowAudioDropdown(false);
      return;
    }
    const meta = AUDIO_KIND_META[entry.kind];
    const newSource = { name: entry.name, kind: entry.kind, label: meta?.label || entry.name, inputSettings: entry.inputSettings || {} };
    setMasterAudioSources(prev => [...prev, newSource]);
    setShowAudioDropdown(false);

    // Warn if this new app audio source would duplicate another master source targeting the same window
    if (isAppAudioKind(entry.kind)) {
      const newKey = getAppAudioWindowKey(entry.name, entry.inputSettings?.window);
      const conflict = masterAudioSources.find(s =>
        isAppAudioKind(s.kind) &&
        getAppAudioWindowKey(s.name, s.inputSettings?.window) === newKey
      );
      if (conflict) {
        showToast(`⚠ OBS doesn't support two Application Audio sources for the same window — OBS will default to "${conflict.name}" (the first source added).`);
      }
    }

    // Apply to all game scenes immediately, skipping any that already have this source
    const sceneNames = getGameSceneNames();
    if (sceneNames.length > 0) {
      setApplyingSource(entry.name);
      try {
        if (entry.kind === 'magic_game_audio') {
          for (const game of games) {
            if (game.scene) {
              const exeGuess = game.exe || (game.selector.toLowerCase().endsWith('.exe') ? game.selector : `${game.selector}.exe`);
              const windowClassGuess = game.windowClass || game.selector;
              const titleGuess = game.selector;
              await api.addAudioSourceToScenes(
                [game.scene], 
                'wasapi_process_output_capture', 
                `Game Audio (${game.name})`, 
                { window: `${titleGuess}:${windowClassGuess}:${exeGuess}`, window_match_priority: game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0 }
              ).catch(() => {});
            }
          }
          showToast(`"Game Audio" applied to scenes`);
        } else {
          const result = await api.addAudioSourceToScenes(sceneNames, entry.kind, entry.name, entry.inputSettings || {});
          showToast(result.message || `"${entry.name}" applied to scenes`);
        }
      } catch (err) {
        showToast(`Failed to add to scenes: ${err.message}`);
      } finally {
        setApplyingSource(null);
      }
    }
  }

  async function removeMasterSource(sourceName) {
    setMasterAudioSources(prev => prev.filter(s => s.name !== sourceName));
    // Optionally remove from all scenes — let user decide by removing individually per-scene
  }

  async function openEditModal(game) {
    setEditGameModal({ game: { ...game }, sceneAudioSources: [], loading: !!game.scene });
    if (game.scene) {
      try {
        const sources = await api.getSceneAudioSources(game.scene);
        setEditGameModal(prev => prev ? { ...prev, sceneAudioSources: sources || [], loading: false } : null);
      } catch {
        setEditGameModal(prev => prev ? { ...prev, sceneAudioSources: [], loading: false } : null);
      }
    }
  }

  async function addSourceToScene(sceneName, source) {
    if (!sceneName) return;
    console.log('[debug] addSourceToScene:', sceneName, JSON.stringify(source));
    try {
      const result = await api.addAudioSourceToScenes([sceneName], source.kind, source.name, source.inputSettings || {});
      if (result.success) {
        let conflictWarning = null;
        setEditGameModal(prev => {
          if (!prev) return null;
          const already = prev.sceneAudioSources.some(s => s.inputName === source.name);
          if (already) return prev;
          // Warn if this new app audio source duplicates an existing one for the same window in this scene
          if (isAppAudioKind(source.kind)) {
            const newKey = getAppAudioWindowKey(source.name, source.inputSettings?.window);
            const duplicate = prev.sceneAudioSources.find(s =>
              isAppAudioKind(s.inputKind) &&
              getAppAudioWindowKey(s.inputName, s.inputSettings?.window) === newKey
            );
            if (duplicate) conflictWarning = duplicate.inputName;
          }
          return {
            ...prev,
            sceneAudioSources: [...prev.sceneAudioSources, { inputName: source.name, inputKind: source.kind, inputSettings: source.inputSettings || {} }],
          };
        });
        if (conflictWarning) {
          showToast(`⚠ OBS doesn't support two Application Audio sources for the same window — OBS will default to "${conflictWarning}" (the first source added).`);
        } else {
          showToast(`"${source.name}" added to scene`);
        }
      } else {
        showToast(`Warning: ${result.message}`);
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  }

  async function removeSourceFromScene(sceneName, inputName) {
    if (!sceneName) return;
    try {
      const result = await api.removeAudioSourceFromScenes([sceneName], inputName);
      if (result.success) {
        setEditGameModal(prev => prev ? {
          ...prev,
          sceneAudioSources: prev.sceneAudioSources.filter(s => s.inputName !== inputName),
        } : null);
        showToast(`"${inputName}" removed from scene`);
      } else {
        showToast(`Warning: ${result.message}`);
      }
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  }

  async function saveEditModal() {
    if (!editGameModal) return;
    const { game } = editGameModal;
    await api.updateGame(game.id, { name: game.name, selector: game.selector, scene: game.scene });
    setEditGameModal(null);
    loadGames();
    showToast('Game saved');
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
        {/* Watcher Status Card */}
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
                      {game.selector}
                      {game.scene && <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>· Scene: {game.scene}</span>}
                    </div>
                  </div>
                  <button
                    className="btn-icon"
                    onClick={() => openEditModal(game)}
                    title="Edit game"
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

        {/* Scene Audio Sources card */}
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
                    loadAudioInputsForDropdown();
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
                                key={i}
                                onClick={() => !alreadyAdded && addMasterSource(entry)}
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
                                key={i}
                                onClick={() => !alreadyAdded && addMasterSource(entry)}
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
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{entry.type === 'input' ? 'Input device' : 'Output device'}</div>
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
                                key={i}
                                onClick={() => !alreadyAdded && addMasterSource(entry)}
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
                          onClick={() => toggleTrack(src.name, num)}
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
                      onClick={() => removeMasterSource(src.name)}
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
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>[{win.exe}] {win.windowClass !== win.process ? win.windowClass : ''}</div>
                      </div>
                    ))
                  )}
                </div>
              )}
              {newGame.selector && newGame.exe && (
                <span style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4, display: 'block' }}>
                  ✓ Exact match binding set: {newGame.exe}
                </span>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                Pick a running window or type a window title / process name to match
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
                      Create this scene in OBS with sources and audio inputs
                    </div>
                  </div>
                  <button
                    className={`toggle ${autoCreateScene ? 'on' : ''}`}
                    onClick={() => {
                      const next = !autoCreateScene;
                      setAutoCreateScene(next);
                      setSceneCreateStatus(null);
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
                        <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Check size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                          <span>
                            <span style={{ fontWeight: 500 }}>Window / game capture</span>
                            {newGame.selector && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                                — <em>{newGame.selector}</em>
                              </span>
                            )}
                          </span>
                        </div>
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

      {/* Track Editor Modal */}
      {showTrackEditor && (
        <div className="modal-overlay" onClick={() => !savingTrackLabels && setShowTrackEditor(false)}>
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
                  } catch (err) {
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

      {/* Edit Game Modal */}
      {editGameModal && (
        <EditGameModal
          modal={editGameModal}
          masterAudioSources={masterAudioSources}
          otherGameScenes={new Set(games.filter(g => g.id !== editGameModal.game.id).map(g => g.scene).filter(Boolean))}
          onChangeGame={updates => setEditGameModal(prev => prev ? { ...prev, game: { ...prev.game, ...updates } } : null)}
          onSave={saveEditModal}
          onClose={() => setEditGameModal(null)}
          onAddSourceToScene={addSourceToScene}
          onRemoveSourceFromScene={removeSourceFromScene}
          onAddMasterSource={addMasterSource}
          trackData={trackData}
          trackLoading={trackLoading}
          toggleTrack={toggleTrack}
          trackLabels={trackLabels}
          setTrackLabels={async (newLabels) => {
            setTrackLabels(newLabels);
            await api.setTrackNames(newLabels).catch(() => {});
          }}
        />
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

/**
 * EditGameModal — allows editing game name, selector, OBS scene, and per-scene audio sources.
 * Features:
 *  1. Duplicate-scene warning if the scene is already used by another game.
 *  2. Full audio-source add dropdown (same as master list) to add any source directly to this scene.
 *  3. Per-source track-routing toggles (tracks 1–6) via OBS WebSocket.
 */
function EditGameModal({
  modal, masterAudioSources, otherGameScenes, onChangeGame, onSave, onClose,
  onAddSourceToScene, onRemoveSourceFromScene, onAddMasterSource,
  trackData, trackLoading, toggleTrack, trackLabels, setTrackLabels
}) {
  const { game, sceneAudioSources, loading } = modal;
  const masterNames = new Set(masterAudioSources.map(s => s.name));


  // ── Feature 1: duplicate scene detection ─────────────────────────────────
  const isDuplicateScene = game.scene && otherGameScenes && otherGameScenes.has(game.scene);

  // ── Feature 2: add-source dropdown (local to modal) ──────────────────────
  const [showModalAudioDropdown, setShowModalAudioDropdown] = useState(false);
  const [modalAudioInputs, setModalAudioInputs] = useState([]);
  const [loadingModalAudio, setLoadingModalAudio] = useState(false);
  const [modalAudioError, setModalAudioError] = useState(null);
  const modalAudioDropdownRef = useRef(null);

  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [visibleWindows, setVisibleWindows] = useState([]);

  // Close modal audio dropdown on outside click
  useEffect(() => {
    if (!showModalAudioDropdown) return;
    const handler = (e) => {
      if (modalAudioDropdownRef.current && !modalAudioDropdownRef.current.contains(e.target)) {
        setShowModalAudioDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModalAudioDropdown]);

  async function loadModalAudioInputs() {
    setLoadingModalAudio(true);
    setModalAudioError(null);
    try {
      const [obsInputs, winDevices, runningApps, visibleWindows] = await Promise.all([
        api.getOBSAudioInputs().catch(() => []),
        api.listWindowsAudioDevices().catch(() => []),
        api.listRunningApps().catch(() => []),
        api.getVisibleWindows().catch(() => []),
      ]);

      // Build process name → window title map
      const windowTitleMap = new Map();
      for (const w of (visibleWindows || [])) {
        const proc = (w.process || '').toLowerCase();
        if (!windowTitleMap.has(proc)) windowTitleMap.set(proc, w.title || '');
      }

      const combined = [];
      const obsNames = new Set();
      for (const inp of (obsInputs || [])) {
        combined.push({ name: inp.inputName, kind: inp.inputKind, source: 'obs' });
        obsNames.add(inp.inputName);
      }
      for (const dev of (winDevices || [])) {
        if (!obsNames.has(dev.name)) {
          combined.push({ name: dev.name, kind: dev.type === 'input' ? 'wasapi_input_capture' : 'wasapi_output_capture', source: 'windows' });
        }
      }
      const obsAppNames = new Set(
        (obsInputs || []).filter(i => i.inputKind === 'wasapi_process_output_capture').map(i => i.inputName)
      );

      combined.unshift({
        name: 'Game Audio',
        kind: 'magic_game_audio',
        source: 'app',
      });

      for (const app of (runningApps || [])) {
        if (!obsAppNames.has(app.name) && !obsNames.has(app.name)) {
          const windowTitle = windowTitleMap.get(app.name.toLowerCase()) || '';
          combined.push({ name: app.name, kind: 'wasapi_process_output_capture', source: 'app', exe: app.exe, hasWindow: app.hasWindow, inputSettings: { window: `${windowTitle}::${app.exe}` } });
        }
      }
      setModalAudioInputs(combined);
    } catch (err) {
      setModalAudioError(err.message || 'Failed to load audio sources');
    } finally {
      setLoadingModalAudio(false);
    }
  }

  // ── Feature 3: audio track routing ───────────────────────────────────────
  // Passed down as props: trackData, trackLoading, toggleTrack


  // State for 'add from master' dropdown inside the modal
  const [addFromMaster, setAddFromMaster] = useState('');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2>Edit Game</h2>
        <p>Edit game details and manage audio sources for this scene.</p>

        {/* Name */}
        <div className="form-group">
          <label className="form-label">Game Name</label>
          <input
            className="form-input"
            value={game.name || ''}
            onChange={e => onChangeGame({ name: e.target.value })}
            placeholder="e.g. Valorant"
          />
        </div>

        {/* Selector */}
        <div className="form-group">
          <label className="form-label">Window Selector</label>
          <div className="form-input-row">
            <input
              className="form-input"
              value={game.selector || ''}
              onChange={e => onChangeGame({ selector: e.target.value, exe: '', windowClass: '' })}
              placeholder="e.g. VALORANT or valorant.exe"
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                if (!showWindowPicker) {
                  setLoadingWindows(true);
                  const windows = await api.getVisibleWindows();
                  setVisibleWindows(windows);
                  setLoadingWindows(false);
                }
                setShowWindowPicker(!showWindowPicker);
              }}
              title="Pick from running windows"
            >
              <ChevronDown size={13} />
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
                  {loadingWindows ? 'Loading...' : 'No windows found. Click again to refresh.'}
                </div>
              ) : (
                visibleWindows.map((win, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      onChangeGame({ 
                        selector: win.title, 
                        exe: win.exe, 
                        windowClass: win.windowClass,
                        windowMatchPriority: game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0
                      });
                      setShowWindowPicker(false);
                    }}
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
          {game.selector && game.exe && (
            <span style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4, display: 'block' }}>
              ✓ Exact match binding set: {game.exe}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
            Window title or process name to match for auto-recording
          </span>
        </div>

        {/* Window Match Priority */}
        <div className="form-group">
          <label className="form-label">Window Match Priority</label>
          <select
            className="form-input"
            value={game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0}
            onChange={e => onChangeGame({ windowMatchPriority: parseInt(e.target.value, 10) })}
          >
            <option value={0}>Match title, otherwise find window of same type</option>
            <option value={1}>Match title, otherwise find window of same executable</option>
            <option value={2}>Match executable</option>
          </select>
        </div>

        {/* Scene */}
        <div className="form-group">
          <label className="form-label">OBS Scene</label>
          <input
            className="form-input"
            value={game.scene || ''}
            onChange={e => onChangeGame({ scene: e.target.value })}
            placeholder="e.g. Gaming Scene (optional)"
            style={isDuplicateScene ? { borderColor: '#f59e0b' } : {}}
          />
          {isDuplicateScene && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 5, padding: '5px 9px',
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11, color: '#f59e0b',
            }}>
              <AlertTriangle size={12} style={{ flexShrink: 0 }} />
              This scene is already assigned to another game. Both games will share it.
            </div>
          )}
        </div>

        {/* Audio Sources section */}
        <div style={{ marginTop: 4, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Music size={13} />
            Scene Audio Sources
            {game.scene && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                — {game.scene}
              </span>
            )}
            {/* Feature 2: Add Source button in modal */}
            {game.scene && !loading && (
              <div style={{ marginLeft: 'auto', position: 'relative' }} ref={modalAudioDropdownRef}>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: 11, padding: '3px 9px' }}
                  onClick={() => {
                    if (!showModalAudioDropdown) {
                      setShowModalAudioDropdown(true);
                      loadModalAudioInputs();
                    } else {
                      setShowModalAudioDropdown(false);
                    }
                  }}
                >
                  <Plus size={12} /> Add Source
                </button>

                {showModalAudioDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    right: 0,
                    zIndex: 300,
                    minWidth: 280,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                    overflow: 'hidden',
                  }}>
                    <div style={{ padding: '7px 12px', fontSize: 10, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Add to Scene
                    </div>
                    {loadingModalAudio ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                        <RefreshCw size={12} className="spinning" /> Loading…
                      </div>
                    ) : modalAudioError ? (
                      <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>{modalAudioError}</div>
                    ) : modalAudioInputs.length === 0 ? (
                      <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No audio sources found.</div>
                    ) : (
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {['obs', 'windows', 'app'].map(group => {
                          const items = modalAudioInputs.filter(a => a.source === group);
                          if (items.length === 0) return null;
                          const groupLabel = { obs: 'OBS Inputs', windows: 'Windows Devices', app: 'Applications' }[group];
                          return (
                            <div key={group}>
                              <div style={{ padding: '5px 12px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', borderTop: group !== 'obs' ? '1px solid var(--border)' : 'none', marginTop: group !== 'obs' ? 3 : 0 }}>
                                {groupLabel}
                              </div>
                              {items.map((entry, i) => {
                                const alreadyInScene = sceneAudioSources.some(s => s.inputName === entry.name || (entry.kind === 'magic_game_audio' && s.inputName.startsWith('Game Audio (')));
                                const meta = AUDIO_KIND_META[entry.kind];
                                return (
                                  <button
                                    key={i}
                                    disabled={alreadyInScene}
                                    onClick={() => {
                                      if (!alreadyInScene) {
                                        if (entry.kind === 'magic_game_audio') {
                                          const exeGuess = game.exe || (game.selector.toLowerCase().endsWith('.exe') ? game.selector : `${game.selector}.exe`);
                                          const windowClassGuess = game.windowClass || game.selector;
                                          const titleGuess = game.selector;
                                          onAddSourceToScene(game.scene, { name: `Game Audio (${game.name})`, kind: 'wasapi_process_output_capture', inputSettings: { window: `${titleGuess}:${windowClassGuess}:${exeGuess}`, window_match_priority: game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0 } });
                                        } else {
                                          onAddSourceToScene(game.scene, { name: entry.name, kind: entry.kind, inputSettings: entry.inputSettings || {} });
                                        }
                                        setShowModalAudioDropdown(false);
                                      }
                                    }}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                                      padding: '6px 14px', background: 'none', border: 'none',
                                      cursor: alreadyInScene ? 'default' : 'pointer', textAlign: 'left',
                                      opacity: alreadyInScene ? 0.45 : 1,
                                    }}
                                    onMouseEnter={e => { if (!alreadyInScene) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                                  >
                                    <AudioIcon kind={entry.kind} size={13} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta?.label || entry.kind}</div>
                                    </div>
                                    {alreadyInScene && <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>In scene</span>}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {!game.scene ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
              Set an OBS scene name above to manage audio sources.
            </div>
          ) : loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
              <RefreshCw size={13} className="spinning" /> Loading scene audio sources…
            </div>
          ) : (
            <>
              {/* Warn if two Application Audio sources share the same window in this scene */}
              {(() => {
                const appSources = sceneAudioSources.filter(s => isAppAudioKind(s.inputKind));
                if (appSources.length < 2) return null;
                const keyGroups = {};
                for (const s of appSources) {
                  const key = getAppAudioWindowKey(s.inputName, s.inputSettings?.window);
                  if (!keyGroups[key]) keyGroups[key] = [];
                  keyGroups[key].push(s.inputName);
                }
                const duplicated = Object.values(keyGroups).filter(g => g.length >= 2);
                if (duplicated.length === 0) return null;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 7,
                    padding: '7px 10px', marginBottom: 8,
                    background: 'rgba(245,158,11,0.10)',
                    border: '1px solid rgba(245,158,11,0.35)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12, color: '#f59e0b',
                  }}>
                    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      This scene has two Application Audio sources targeting the same window
                      {duplicated.map(g => ` (${g.join(' and ')})`).join(', ')}.
                      {' '}OBS doesn't support this — it will default to the first source added.
                    </span>
                  </div>
                );
              })()}

              {/* List of existing scene audio sources */}
              {sceneAudioSources.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  No audio sources found in this OBS scene.
                </div>
              ) : (
                <div style={{ background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: 10 }}>
                  {/* Track label header row */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', padding: '5px 12px 2px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 5, marginRight: 32 }}>
                      {[1, 2, 3, 4, 5, 6].map(num => (
                        <div key={num} style={{ width: 22, textAlign: 'center', fontSize: 9, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          {trackLabels?.[num - 1] || `T${num}`}
                        </div>
                      ))}
                    </div>
                  </div>

                  {sceneAudioSources.map((src, i) => {
                    const isInMaster = masterNames.has(src.inputName) || (src.inputName.startsWith('Game Audio (') && masterNames.has('Game Audio'));
                    const meta = AUDIO_KIND_META[src.inputKind];
                    const tracks = trackData[src.inputName] || {};
                    const isTrackLoading = trackLoading[src.inputName];
                    const displayName = src.inputName.startsWith('Game Audio (') ? 'Game Audio' : src.inputName;
                    return (
                      <div
                        key={i}
                        style={{
                          borderBottom: i < sceneAudioSources.length - 1 ? '1px solid var(--border)' : 'none',
                          padding: '7px 12px',
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}
                      >
                        <AudioIcon kind={src.inputKind} size={14} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayName}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta?.label || src.inputKind}</div>
                        </div>
                        {!isInMaster && (
                          <span style={{
                            fontSize: 10, fontWeight: 500,
                            color: '#f59e0b',
                            background: 'rgba(245,158,11,0.12)',
                            border: '1px solid rgba(245,158,11,0.3)',
                            borderRadius: 4,
                            padding: '1px 6px',
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            Not in master list
                            <button
                              className="btn-icon"
                              onClick={() => { onAddMasterSource({ name: src.inputName, kind: src.inputKind }); }}
                              title="Add to Master List"
                              style={{ color: '#d97706', padding: 0, marginLeft: 2, marginRight: -2, width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Plus size={11} strokeWidth={3} />
                            </button>
                          </span>
                        )}

                        {/* Track routing chips — inline */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                          {[1, 2, 3, 4, 5, 6].map(num => {
                            const active = tracks[String(num)] === true;
                            return (
                              <button
                                key={num}
                                title={`${trackLabels?.[num - 1] || `Track ${num}`}: ${active ? 'active' : 'inactive'}`}
                                disabled={isTrackLoading}
                                onClick={() => toggleTrack(src.inputName, num)}
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
                          {isTrackLoading && <RefreshCw size={11} className="spinning" style={{ color: 'var(--text-muted)' }} />}
                        </div>

                        <button
                          className="btn-icon"
                          onClick={() => onRemoveSourceFromScene(game.scene, src.inputName)}
                          title="Remove from scene"
                          style={{ color: 'var(--danger)', flexShrink: 0 }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add from master list */}
              {masterAudioSources.length > 0 && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="form-input"
                    value={addFromMaster}
                    onChange={e => setAddFromMaster(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Add from master list…</option>
                    {masterAudioSources
                      .filter(s => !sceneAudioSources.some(sc => sc.inputName === s.name || (s.kind === 'magic_game_audio' && sc.inputName.startsWith('Game Audio ('))))
                      .map((s, i) => (
                        <option key={i} value={s.name}>{s.name}</option>
                      ))}
                  </select>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={!addFromMaster}
                    onClick={() => {
                      const src = masterAudioSources.find(s => s.name === addFromMaster);
                      if (src) {
                        if (src.kind === 'magic_game_audio') {
                          const exeGuess = game.exe || (game.selector.toLowerCase().endsWith('.exe') ? game.selector : `${game.selector}.exe`);
                          const windowClassGuess = game.windowClass || game.selector;
                          const titleGuess = game.selector;
                          onAddSourceToScene(game.scene, { name: `Game Audio (${game.name})`, kind: 'wasapi_process_output_capture', inputSettings: { window: `[${exeGuess}]:${windowClassGuess}:${titleGuess}`, window_match_priority: game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0 } });
                        } else {
                          onAddSourceToScene(game.scene, { name: src.name, kind: src.kind, inputSettings: src.inputSettings || {} });
                        }
                        setAddFromMaster('');
                      }
                    }}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>
            <Save size={13} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
