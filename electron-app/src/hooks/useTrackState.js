import { useState } from 'react';

/**
 * Manages OBS audio track labels, the track-label editor modal, per-input
 * track-routing data, and per-input loading flags.
 * Isolated so that toggling a track chip or saving label names does not
 * re-render the game list or the "Add Source" dropdown.
 */
export function useTrackState() {
  const [trackLabels, setTrackLabels] = useState(['Track 1', 'Track 2', 'Track 3', 'Track 4', 'Track 5', 'Track 6']);

  // Track label editor modal
  const [showTrackEditor, setShowTrackEditor] = useState(false);
  const [tempTrackLabels, setTempTrackLabels] = useState([]);
  const [savingTrackLabels, setSavingTrackLabels] = useState(false);

  // Per-input track routing: { [inputName]: { '1': bool, '2': bool, ... } }
  const [trackData, setTrackData] = useState({});
  // Per-input loading flag while a track toggle API call is in-flight
  const [trackLoading, setTrackLoading] = useState({}); // { [inputName]: bool }

  return {
    trackLabels, setTrackLabels,
    showTrackEditor, setShowTrackEditor,
    tempTrackLabels, setTempTrackLabels,
    savingTrackLabels, setSavingTrackLabels,
    trackData, setTrackData,
    trackLoading, setTrackLoading,
  };
}
