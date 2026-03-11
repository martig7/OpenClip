import { useState } from 'react';

/**
 * Manages all state for the "Add Game" modal flow, including the window picker,
 * OBS scene creation, capture preferences, and scene conflict resolution.
 * Groups the 13 modal-related state variables and the resetAddModal helper
 * in one place for easier maintenance.
 */
export function useAddGameModalState() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGame, setNewGame] = useState({ name: '', selector: '', exe: '', windowClass: '', windowMatchPriority: 0, scene: '', icon_path: '' });

  // Window picker
  const [visibleWindows, setVisibleWindows] = useState([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [showWindowPicker, setShowWindowPicker] = useState(false);

  // OBS scene auto-creation
  const [autoCreateScene, setAutoCreateScene] = useState(false);
  const [createMode, setCreateMode] = useState('scratch'); // 'scratch' | 'template'
  const [capturePref, setCapturePref] = useState('game_capture'); // 'game_capture' | 'window_capture'
  const [obsScenes, setObsScenes] = useState([]);
  const [loadingScenes, setLoadingScenes] = useState(false);
  const [scenesError, setScenesError] = useState(null);
  const [templateScene, setTemplateScene] = useState('');
  const [sceneCreateStatus, setSceneCreateStatus] = useState(null); // { type: 'success'|'error'|'conflict'|'loading', message }

  function resetAddModal() {
    setNewGame({ name: '', selector: '', exe: '', windowClass: '', windowMatchPriority: 0, scene: '', icon_path: '' });
    setAutoCreateScene(false);
    setCreateMode('scratch');
    setCapturePref('game_capture');
    setTemplateScene('');
    setObsScenes([]);
    setScenesError(null);
    setSceneCreateStatus(null);
  }

  return {
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
  };
}
