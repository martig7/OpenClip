/**
 * Color palette and assignment utilities for the storage treemap.
 */

export const GAME_PALETTE = [
  '#7c3aed', // violet-700
  '#3b82f6', // blue-500
  '#06b6d4', // cyan-500
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#0ea5e9', // sky-500
  '#a78bfa', // violet-400
  '#818cf8', // indigo-400
  '#2dd4bf', // teal-400
  '#c084fc', // purple-400
  '#60a5fa', // blue-400
  '#22d3ee', // cyan-400
  '#4f46e5', // indigo-600
  '#7e22ce', // purple-700
  '#0284c7', // sky-600
  '#0891b2', // cyan-600
]

/**
 * Build a deterministic game→color map from a stats object.
 * Sorts game names alphabetically then assigns palette colors by index.
 */
export function buildGameColors(stats) {
  if (!stats) return {}
  const games = new Set()
  stats.recordings?.forEach(r => games.add(r.game_name))
  stats.clips?.forEach(c => games.add(c.game_name))
  const map = {}
  Array.from(games).sort().forEach((g, i) => {
    map[g] = GAME_PALETTE[i % GAME_PALETTE.length]
  })
  return map
}
