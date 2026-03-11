import { useState, useRef, useEffect } from 'react';

/**
 * Manages master audio source list state and the "Add Source" dropdown.
 * Isolated so that audio-source changes (e.g. dropdown open/close, loading
 * indicators) don't trigger re-renders in the game-library or watcher trees.
 */
export function useAudioSourcesState() {
  // Master audio source list — sources applied to all game scenes
  const [masterAudioSources, setMasterAudioSources] = useState([]); // [{ kind, label, name, inputSettings }]
  const masterAudioLoadedRef = useRef(false); // guard against persisting before initial load
  const [applyingSource, setApplyingSource] = useState(null); // name of source currently being applied

  // Audio "Add Source" dropdown
  const [showAudioDropdown, setShowAudioDropdown] = useState(false);
  const [availableAudioInputs, setAvailableAudioInputs] = useState([]); // combined OBS + Windows + Apps
  const [loadingAudioInputs, setLoadingAudioInputs] = useState(false);
  const [audioDropdownError, setAudioDropdownError] = useState(null);
  const audioDropdownRef = useRef(null);

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

  return {
    masterAudioSources, setMasterAudioSources,
    masterAudioLoadedRef,
    applyingSource, setApplyingSource,
    showAudioDropdown, setShowAudioDropdown,
    availableAudioInputs, setAvailableAudioInputs,
    loadingAudioInputs, setLoadingAudioInputs,
    audioDropdownError, setAudioDropdownError,
    audioDropdownRef,
  };
}
