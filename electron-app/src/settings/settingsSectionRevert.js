import { stableStringify } from '../utils/stableStringify'

/** Top-level or dot-path keys copied from baseline when reverting a general-settings card. */
export const SETTINGS_SECTION_REVERT_PATHS = {
  watcher: ['startWatcherOnStartup'],
  'games-list': ['advancedGameAddition', 'autoRegisterFullscreenApps'],
  organize: ['organizeRemux'],
  view: ['listView', 'waveformResolution'],
  hotkey: ['clipMarkerHotkey'],
  autoclip: ['autoClip'],
  storage: ['destinationPath', 'autoDelete'],
  plugin: ['obsRecordingPath'],
  updates: [],
}

export function getNested(obj, path) {
  const keys = path.split('.')
  let o = obj
  for (const k of keys) {
    if (o == null || typeof o !== 'object') return undefined
    o = o[k]
  }
  return o
}

function setPathMutable(root, path, value) {
  const keys = path.split('.')
  let o = root
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const next = o[k]
    if (next == null || typeof next !== 'object') {
      o[k] = {}
    } else {
      o[k] = Array.isArray(next) ? [...next] : { ...next }
    }
    o = o[k]
  }
  o[keys[keys.length - 1]] = value
}

function cloneForState(v) {
  if (v === undefined) return undefined
  try {
    return structuredClone(v)
  } catch {
    return JSON.parse(JSON.stringify(v))
  }
}

/**
 * @param {string} sectionId
 * @param {object} settings
 * @param {string | null} baselineStr
 */
/** stableStringify(undefined) is not reliable; compare leaves deterministically. */
function leafSig(v) {
  if (v === undefined) return '__undefined__'
  try {
    return stableStringify(v)
  } catch {
    return String(v)
  }
}

export function isSettingsSectionDirty(sectionId, settings, baselineStr) {
  const paths = SETTINGS_SECTION_REVERT_PATHS[sectionId]
  if (!paths?.length) return false
  if (baselineStr == null || baselineStr === '') return false
  try {
    const baseline = JSON.parse(baselineStr)
    for (const path of paths) {
      const a = getNested(settings, path)
      const b = getNested(baseline, path)
      if (leafSig(a) !== leafSig(b)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * @param {object} settings
 * @param {string} baselineStr
 * @param {string} sectionId
 */
export function applySectionRevert(settings, baselineStr, sectionId) {
  const paths = SETTINGS_SECTION_REVERT_PATHS[sectionId]
  if (!paths?.length || !baselineStr) return settings
  const baseline = JSON.parse(baselineStr)
  const next = JSON.parse(JSON.stringify(settings))
  for (const path of paths) {
    const v = getNested(baseline, path)
    setPathMutable(next, path, cloneForState(v))
  }
  return next
}
