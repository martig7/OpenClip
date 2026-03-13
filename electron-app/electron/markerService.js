/**
 * Marker file persistence: read/write clip_markers.json.
 */
const fs = require('fs');
const { MARKERS_FILE } = require('./constants');

function loadMarkers() {
  try {
    return JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf-8'));
  } catch {}
  return { markers: [] };
}

function saveMarkers(data) {
  try {
    fs.writeFileSync(MARKERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

module.exports = { loadMarkers, saveMarkers };
