/**
 * Audio source utilities for the GamesPage.
 * Pure functions and constants — no React dependencies.
 */
import { Music, Mic, ChevronDown } from 'lucide-react';
import api from '../../api';

// Human-readable metadata for known OBS audio input kinds
export const AUDIO_KIND_META = {
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
 * Module-level LRU cache for extractExeFromWindowStr.
 * Capped at 256 entries with true LRU eviction.
 */
const _extractExeCache = new Map();
const _EXTRACT_EXE_CACHE_MAX = 256;

/**
 * Extract the exe filename from an OBS wasapi_process_output_capture window string.
 * Handles formats:
 *   "[exe.exe]:WindowClass:Window Title"
 *   "Window Title:WindowClass:exe.exe"
 *   "Window Title::exe.exe"
 */
export function extractExeFromWindowStr(windowStr) {
  if (!windowStr) return null;
  if (_extractExeCache.has(windowStr)) {
    const cached = _extractExeCache.get(windowStr);
    _extractExeCache.delete(windowStr);
    _extractExeCache.set(windowStr, cached);
    return cached;
  }
  let result = null;
  const bracketMatch = windowStr.match(/^\[([^\]]+\.exe)\]/i);
  if (bracketMatch) {
    result = bracketMatch[1].toLowerCase();
  } else {
    const parts = windowStr.split(':').map(p => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].toLowerCase().endsWith('.exe')) {
        result = parts[i].toLowerCase();
        break;
      }
    }
  }
  _extractExeCache.set(windowStr, result);
  if (_extractExeCache.size > _EXTRACT_EXE_CACHE_MAX) {
    _extractExeCache.delete(_extractExeCache.keys().next().value);
  }
  return result;
}

/**
 * Return a comparable window key for an application audio source.
 * Used to detect two sources targeting the same window/process.
 */
export function getAppAudioWindowKey(sourceName, inputSettingsWindow) {
  const gameAudioMatch = sourceName.match(/^Game Audio \((.+)\)$/i);
  if (gameAudioMatch) return gameAudioMatch[1].toLowerCase();

  if (inputSettingsWindow) {
    const exe = extractExeFromWindowStr(inputSettingsWindow);
    if (exe) return exe.replace(/\.exe$/i, '');
  }

  const lc = sourceName.toLowerCase();
  if (lc.endsWith('.exe')) return lc.slice(0, -4);

  return lc;
}

/** Returns true for OBS input kinds that capture per-application audio. */
export function isAppAudioKind(kind) {
  return kind === 'wasapi_process_output_capture' || kind === 'magic_game_audio';
}

/**
 * Fetch and combine all available audio inputs into a single list.
 * Groups: OBS inputs already registered, Windows audio devices not in OBS,
 * and running application processes (for per-app audio capture).
 */
export async function buildAvailableAudioInputs() {
  const [obsInputs, winDevices, runningApps, windows] = await Promise.all([
    api.getOBSAudioInputs().catch(() => []),
    api.listWindowsAudioDevices().catch(() => []),
    api.listRunningApps().catch(() => []),
    api.getVisibleWindows().catch(() => []),
  ]);

  const windowTitleMap = new Map();
  const windowClassMap = new Map();
  for (const w of (windows || [])) {
    const proc = (w.process || '').toLowerCase();
    if (!windowTitleMap.has(proc)) windowTitleMap.set(proc, w.title || '');
    if (!windowClassMap.has(proc)) windowClassMap.set(proc, w.windowClass || '');
  }

  const combined = [];
  const obsNames = new Set();
  for (const inp of (obsInputs || [])) {
    combined.push({ name: inp.inputName, kind: inp.inputKind, source: 'obs' });
    obsNames.add(inp.inputName);
  }

  for (const dev of (winDevices || [])) {
    if (!obsNames.has(dev.name)) {
      const kind = dev.type === 'input' ? 'wasapi_input_capture' : 'wasapi_output_capture';
      combined.push({ name: dev.name, kind, source: 'windows' });
    }
  }

  combined.unshift({ name: 'Game Audio', kind: 'magic_game_audio', source: 'app' });

  const obsAppNames = new Set(
    (obsInputs || [])
      .filter(i => i.inputKind === 'wasapi_process_output_capture')
      .map(i => i.inputName)
  );
  for (const app of (runningApps || [])) {
    if (!obsAppNames.has(app.name) && !obsNames.has(app.name)) {
      const windowTitle = windowTitleMap.get(app.name.toLowerCase()) || '';
      const windowClass = windowClassMap.get(app.name.toLowerCase()) || '';
      combined.push({
        name: app.name,
        kind: 'wasapi_process_output_capture',
        source: 'app',
        exe: app.exe,
        hasWindow: app.hasWindow,
        inputSettings: { window: `${windowTitle}:${windowClass}:${app.exe}` },
      });
    }
  }

  return combined;
}

/** Small icon component that renders the appropriate icon for an OBS audio input kind. */
export function AudioIcon({ kind, size = 15 }) {
  const meta = AUDIO_KIND_META[kind];
  if (!meta) return <Music size={size} />;
  if (meta.icon === 'mic') return <Mic size={size} />;
  if (meta.icon === 'app') return <ChevronDown size={size} style={{ transform: 'rotate(-90deg)' }} />;
  return <Music size={size} />;
}
