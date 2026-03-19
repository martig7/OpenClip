/** Settings sidebar: section ids, labels, and chip group for filter pills (includes Encoding). */

export const SETTINGS_CHIP_IDS = [
  'all',
  'paths',
  'automation',
  'view',
  'integrations',
  'encoding',
]

export const SETTINGS_CHIP_LABELS = {
  all: 'All',
  paths: 'Paths',
  automation: 'Automation',
  view: 'View',
  integrations: 'Integrations',
  encoding: 'Encoding',
}

/** @typedef {{ id: string, title: string, blurb: string, group: string }} SettingsSectionDef */

/** All settings areas (General subsections + Encoding). @type {SettingsSectionDef[]} */
export const SETTINGS_SECTIONS = [
  { id: 'paths', title: 'Recording Paths', blurb: 'OBS folder & destination', group: 'paths' },
  { id: 'watcher', title: 'Watcher', blurb: 'Startup behavior', group: 'automation' },
  { id: 'organize', title: 'Organize', blurb: 'Remux & move rules', group: 'automation' },
  { id: 'view', title: 'View', blurb: 'List, grid & waveforms', group: 'view' },
  { id: 'hotkey', title: 'Clip Marker Hotkey', blurb: 'In-game marker key', group: 'automation' },
  { id: 'autoclip', title: 'Auto-Clip', blurb: 'Markers to clips', group: 'automation' },
  { id: 'storage', title: 'Storage Management', blurb: 'Auto-delete & limits', group: 'automation' },
  { id: 'plugin', title: 'OBS Plugin', blurb: 'Install & path', group: 'integrations' },
  { id: 'updates', title: 'Updates', blurb: 'App updates', group: 'integrations' },
  { id: 'encoding', title: 'Encoding', blurb: 'OBS encoder & output', group: 'encoding' },
]

/** @deprecated use SETTINGS_SECTIONS */
export const GENERAL_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.id !== 'encoding')

export const DEFAULT_SECTION_ID = 'paths'

/** @deprecated use DEFAULT_SECTION_ID */
export const DEFAULT_GENERAL_SECTION_ID = DEFAULT_SECTION_ID

export function isValidSectionId(id) {
  return SETTINGS_SECTIONS.some((s) => s.id === id)
}

/** @deprecated use isValidSectionId */
export function isValidGeneralSectionId(id) {
  return isValidSectionId(id)
}

/**
 * @param {typeof SETTINGS_CHIP_IDS[number]} chipId
 * @param {string} searchQuery
 */
export function filterSettingsSections(chipId, searchQuery) {
  const q = searchQuery.trim().toLowerCase()
  let list = SETTINGS_SECTIONS
  if (chipId && chipId !== 'all') {
    list = list.filter((s) => s.group === chipId)
  }
  if (q) {
    list = list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.blurb.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
    )
  }
  return list
}

/** @deprecated use filterSettingsSections */
export function filterGeneralSections(chipId, searchQuery) {
  return filterSettingsSections(chipId, searchQuery)
}
