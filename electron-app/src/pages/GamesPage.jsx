import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, Gamepad2 } from 'lucide-react';
import api from '../api';
import { useGameWatcherState } from '../hooks/useGameWatcherState';
import { useAudioSourcesState } from '../hooks/useAudioSourcesState';
import { useToastState } from '../hooks/useToastState';
import { useAddGameModalState } from '../hooks/useAddGameModalState';
import { useTrackState } from '../hooks/useTrackState';
import {
  AUDIO_KIND_META,
  buildAvailableAudioInputs,
  getAppAudioWindowKey,
  isAppAudioKind,
} from './games/audioSourceUtils';
import WatcherStatusCard from './games/WatcherStatusCard';
import EditGameModal from './games/EditGameModal';
import AddGameModal from './games/AddGameModal';
import SceneAudioSourcesCard from './games/SceneAudioSourcesCard';
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog';


export default function GamesPage() {
  const navigate = useNavigate();

  const {
    games, setGames,
    watcherStatus, setWatcherStatus,
    scriptWarning, setScriptWarning,
    confirmDeleteGame, setConfirmDeleteGame,
    editGameModal, setEditGameModal,
  } = useGameWatcherState();

  const {
    masterAudioSources, setMasterAudioSources,
    masterAudioLoadedRef,
    applyingSource, setApplyingSource,
    showAudioDropdown, setShowAudioDropdown,
    availableAudioInputs, setAvailableAudioInputs,
    loadingAudioInputs, setLoadingAudioInputs,
    audioDropdownError, setAudioDropdownError,
    audioDropdownRef,
  } = useAudioSourcesState();

  const { toast, showToast } = useToastState();

  const {
    showAddModal, setShowAddModal,
    newGame, setNewGame,
    visibleWindows, setVisibleWindows,
    loadingWindows, setLoadingWindows,
    showWindowPicker, setShowWindowPicker,
    autoCreateScene, setAutoCreateScene,
    createMode, setCreateMode,
    capturePref, setCapturePref,
    obsScenes, setObsScenes,
    loadingScenes, setLoadingScenes,
    scenesError, setScenesError,
    templateScene, setTemplateScene,
    sceneCreateStatus, setSceneCreateStatus,
    resetAddModal,
  } = useAddGameModalState();

  const {
    trackLabels, setTrackLabels,
    trackData, setTrackData,
    trackLoading, setTrackLoading,
  } = useTrackState();

  // Guards the initial load of persisted track data — same pattern as masterAudioLoadedRef
  const trackDataLoadedRef = useRef(false);

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
          // 'Game Audio' track routing is stored locally — intentionally not fetched from
          // OBS, because the source may not exist in every scene (user may have removed it
          // from some games on purpose). The persisted value is loaded on mount.
          if (name === 'Game Audio') return null;
          const tracks = await api.getInputAudioTracks(name).catch(() => ({}));
          // Only use OBS data when it returns something — if OBS is closed or the source
          // isn't found it returns {}, in which case we keep the persisted value.
          if (Object.keys(tracks).length === 0) return null;
          return { name, tracks };
        })
      );
      if (cancelled) return;
      const fresh = {};
      for (const entry of results) {
        if (entry) fresh[entry.name] = entry.tracks;
      }
      if (Object.keys(fresh).length > 0) {
        setTrackData(prev => ({ ...prev, ...fresh }));
      }
    })();
    return () => { cancelled = true; };
  }, [editGameModal?.sceneAudioSources, masterAudioSources]);

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
    // Restore all persisted track routing so tracks appear even when OBS is closed
    api.getStore('audioTracks').then(saved => {
      trackDataLoadedRef.current = true;
      if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
        setTrackData(prev => ({ ...prev, ...saved }));
      }
    }).catch(() => { trackDataLoadedRef.current = true; });
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

  // Persist track data whenever it changes — covers both OBS-fetched and user-toggled values
  useEffect(() => {
    if (!trackDataLoadedRef.current) return; // skip until initial load has resolved
    api.setStore('audioTracks', trackData).catch(() => {});
  }, [trackData]);


  async function loadGames() {
    try {
      setGames(await api.getGames());
    } catch (err) {
      showToast(err?.message || 'Failed to load games');
    }
  }

  async function loadTrackLabels() {
    try {
      const labels = await api.getTrackNames();
      if (labels && labels.length === 6) setTrackLabels(labels);
    } catch (err) {
      showToast(err?.message || 'Failed to load track labels');
    }
  }

  async function loadWatcherStatus() {
    try {
      setWatcherStatus(await api.getWatcherStatus());
    } catch (err) {
      showToast(err?.message || 'Failed to load watcher status');
    }
  }

  async function addGame() {
    const missing = ['name', 'selector', 'scene'].filter(f => !newGame[f]);
    if (missing.length > 0) {
      showToast(`Required fields missing: ${missing.join(', ')}.`);
      return;
    }

    // Auto-create the OBS scene before saving the game
    if (autoCreateScene && newGame.scene) {
      setSceneCreateStatus(null);
      try {
        let result;
        if (createMode === 'scratch') {
          result = await api.createOBSSceneFromScratch(newGame.scene, {
            windowTitle: newGame.selector,
            exe: newGame.exe,
            windowClass: newGame.windowClass,
            addWindowCapture: true,
            captureKind: capturePref,
          });
        } else {
          result = await api.createOBSScene(newGame.scene, templateScene || null);
        }
        if (!result.success) {
          if (result.message?.includes('already exists')) {
            setSceneCreateStatus({ type: 'conflict', message: result.message });
            return; // wait for user to resolve
          }
          setSceneCreateStatus({ type: 'error', message: result.message });
          return;
        }
        await finalizeGameSave(result.message || `Scene "${newGame.scene}" created in OBS`);
      } catch (err) {
        setSceneCreateStatus({ type: 'error', message: err.message || 'Failed to create OBS scene' });
        return;
      }
    } else {
      await finalizeGameSave(null);
    }
  }

  /**
   * Apply master audio sources + track routing to the new game's scene, show a toast,
   * persist the game, and close the modal.
   * @param {string|null} sceneMsg - Base message for the toast (null = no scene created)
   */
  async function finalizeGameSave(sceneMsg) {
    const masterToAdd = masterAudioSources;
    if (newGame.scene && masterToAdd.length > 0) {
      await Promise.all(masterToAdd.map(source => {
        if (source.kind === 'magic_game_audio') {
          const exeGuess = newGame.exe || (newGame.selector.toLowerCase().endsWith('.exe') ? newGame.selector : `${newGame.selector}.exe`);
          const windowClassGuess = newGame.windowClass || newGame.selector;
          const titleGuess = newGame.selector;
          return api.addAudioSourceToScenes(
            [newGame.scene],
            'wasapi_process_output_capture',
            `Game Audio (${newGame.name})`,
            { window: `${titleGuess}:${windowClassGuess}:${exeGuess}`, window_match_priority: newGame.windowMatchPriority ?? 0 }
          ).catch(() => {});
        }
        return api.addAudioSourceToScenes(
          [newGame.scene],
          source.kind,
          source.name,
          source.inputSettings || {}
        ).catch(() => {});
      }));

      // Apply master-list track routing. Game Audio (GameName) is always fresh — must be set explicitly.
      await Promise.all(masterToAdd.map(source => {
        const masterKey = source.kind === 'magic_game_audio' ? 'Game Audio' : source.name;
        const tracks = trackData[masterKey];
        if (!tracks || Object.keys(tracks).length === 0) return Promise.resolve();
        const obsInputName = source.kind === 'magic_game_audio'
          ? `Game Audio (${newGame.name})`
          : source.name;
        return api.setInputAudioTracks(obsInputName, tracks).catch(() => {});
      }));
    }

    if (sceneMsg) {
      const sourceNote = newGame.scene && masterToAdd.length > 0
        ? ` + ${masterToAdd.length} master source${masterToAdd.length > 1 ? 's' : ''}`
        : '';
      showToast(sceneMsg + sourceNote);
    }
    await api.addGame(newGame);
    resetAddModal();
    setShowAddModal(false);
    loadGames();
  }

  async function handleSceneConflictUseExisting() {
    setSceneCreateStatus(null);
    try {
      await finalizeGameSave(`Using existing OBS scene "${newGame.scene}"`);
    } catch (err) {
      setSceneCreateStatus({ type: 'error', message: err.message || 'Failed to save game' });
    }
  }

  async function handleSceneConflictOverwrite() {
    setSceneCreateStatus({ type: 'loading', message: `Deleting "${newGame.scene}" from OBS…` });
    try {
      await api.deleteOBSScene(newGame.scene);
      let result;
      if (createMode === 'scratch') {
        result = await api.createOBSSceneFromScratch(newGame.scene, {
          windowTitle: newGame.selector,
          exe: newGame.exe,
          windowClass: newGame.windowClass,
          addWindowCapture: true,
          captureKind: capturePref,
        });
      } else {
        result = await api.createOBSScene(newGame.scene, templateScene || null);
      }
      if (!result.success) {
        setSceneCreateStatus({ type: 'error', message: result.message });
        return;
      }
      await finalizeGameSave(result.message || `Scene "${newGame.scene}" overwritten in OBS`);
    } catch (err) {
      setSceneCreateStatus({ type: 'error', message: err.message || 'Failed to overwrite scene' });
    }
  }

  async function removeGame(id) {
    const game = games.find(g => g.id === id);
    if (!game) return;
    if (game.scene) {
      setConfirmDeleteGame({ game });
    } else {
      await api.removeGame(id);
      loadGames();
    }
  }

  async function doRemoveGame(includeScene) {
    const { game } = confirmDeleteGame;
    setConfirmDeleteGame(null);
    if (includeScene && game.scene) {
      await api.deleteOBSScene(game.scene).catch(() => {});
    }
    await api.removeGame(game.id);
    loadGames();
  }

  async function toggleGame(id) {
    await api.toggleGame(id);
    loadGames();
  }

  /** Collect all scene names from games that have a scene set. */
  function getGameSceneNames() {
    return games.map(g => g.scene).filter(Boolean);
  }

  async function loadAudioInputsForDropdown() {
    setLoadingAudioInputs(true);
    setAudioDropdownError(null);
    try {
      const combined = await buildAvailableAudioInputs();
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
          const addPromises = games
            .filter(game => game.scene)
            .map(game => {
              const exeGuess = game.exe || (game.selector.toLowerCase().endsWith('.exe') ? game.selector : `${game.selector}.exe`);
              const windowClassGuess = game.windowClass || game.selector;
              const titleGuess = game.selector;
              return api.addAudioSourceToScenes(
                [game.scene],
                'wasapi_process_output_capture',
                `Game Audio (${game.name})`,
                { window: `${titleGuess}:${windowClassGuess}:${exeGuess}`, window_match_priority: game.windowMatchPriority !== undefined ? game.windowMatchPriority : 0 }
              ).catch(() => {});
            });
          await Promise.all(addPromises);
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
    try {
      const isVideoCapture = source.kind === 'game_capture' || source.kind === 'window_capture';
      const result = await api.addAudioSourceToScenes([sceneName], source.kind, source.name, source.inputSettings || {}, isVideoCapture ? { fitToCanvas: true } : {});
      if (result.success) {
        if (isVideoCapture) {
          // Video sources are not audio — don't add them to the audio tracks list
          showToast(`"${source.name}" added to scene`);
        } else {
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
    if (!game.name || !game.selector || !game.scene) {
      showToast('Game name, window selector, and scene are required.');
      return;
    }
    const payload = {
      name: game.name,
      selector: game.selector,
      scene: game.scene,
      exe: game.exe,
      windowClass: game.windowClass,
      windowMatchPriority: game.windowMatchPriority,
    };
    if (game.icon_path !== undefined) {
      payload.icon_path = game.icon_path;
    }
    await api.updateGame(game.id, payload);
    setEditGameModal(null);
    loadGames();
    showToast('Game saved');
  }

  function openAddModal() {
    resetAddModal();
    setShowAddModal(true);
    // Windows and OBS scenes are loaded by AddGameModal's useEffect on mount
  }

  function goToSettings() {
    setShowAddModal(false);
    resetAddModal();
    navigate('/settings');
  }

  const toggleWatcher = useCallback(async () => {
    try {
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
    } catch (err) {
      showToast(err?.message || 'Failed to toggle watcher');
    }
    loadWatcherStatus();
  }, [watcherStatus.running, showToast]);

  const handleDismissWarning = useCallback(() => setScriptWarning(null), [setScriptWarning]);
  const handleGoToSettings = useCallback(() => navigate('/settings'), [navigate]);
  const handleOpenOBS = useCallback(() => api.launchOBS(), []);

  return (
    <>
      <div className="page-header">
        <h1>Games</h1>
        <p>Manage games to automatically record with OBS</p>
      </div>

      <div className="page-body">
        {/* Watcher Status Card */}
        <WatcherStatusCard status={watcherStatus} onToggle={toggleWatcher} scriptWarning={scriptWarning} onDismissWarning={handleDismissWarning} onGoToSettings={handleGoToSettings} onOpenOBS={handleOpenOBS} />

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

        <SceneAudioSourcesCard
          masterAudioSources={masterAudioSources}
          applyingSource={applyingSource}
          showAudioDropdown={showAudioDropdown}
          setShowAudioDropdown={setShowAudioDropdown}
          audioDropdownRef={audioDropdownRef}
          availableAudioInputs={availableAudioInputs}
          loadingAudioInputs={loadingAudioInputs}
          audioDropdownError={audioDropdownError}
          trackLabels={trackLabels}
          setTrackLabels={setTrackLabels}
          trackData={trackData}
          trackLoading={trackLoading}
          onLoadAudioInputs={loadAudioInputsForDropdown}
          onAddSource={addMasterSource}
          onRemoveSource={removeMasterSource}
          onToggleTrack={toggleTrack}
          showToast={showToast}
        />
      </div>

      {showAddModal && (
        <AddGameModal
          newGame={newGame}
          setNewGame={setNewGame}
          showWindowPicker={showWindowPicker}
          setShowWindowPicker={setShowWindowPicker}
          visibleWindows={visibleWindows}
          setVisibleWindows={setVisibleWindows}
          loadingWindows={loadingWindows}
          setLoadingWindows={setLoadingWindows}
          autoCreateScene={autoCreateScene}
          setAutoCreateScene={setAutoCreateScene}
          createMode={createMode}
          setCreateMode={setCreateMode}
          capturePref={capturePref}
          setCapturePref={setCapturePref}
          obsScenes={obsScenes}
          setObsScenes={setObsScenes}
          loadingScenes={loadingScenes}
          setLoadingScenes={setLoadingScenes}
          scenesError={scenesError}
          setScenesError={setScenesError}
          templateScene={templateScene}
          setTemplateScene={setTemplateScene}
          sceneCreateStatus={sceneCreateStatus}
          onClose={() => { resetAddModal(); setShowAddModal(false); }}
          onAddGame={addGame}
          onSceneConflictUseExisting={handleSceneConflictUseExisting}
          onSceneConflictOverwrite={handleSceneConflictOverwrite}
          onGoToSettings={goToSettings}
        />
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

      <ConfirmDeleteDialog
        confirmDeleteGame={confirmDeleteGame}
        onConfirm={doRemoveGame}
        onCancel={() => setConfirmDeleteGame(null)}
      />
    </>
  );
}
