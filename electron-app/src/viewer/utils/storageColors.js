/**
 * Color palette and assignment utilities for the storage treemap.
 */

export const GAME_PALETTE = [
  '#7c3aed', // violet-600
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
  '#5eead4', // teal-300 
  '#14b8a6', // teal-500
  '#67e8f9', // cyan-300
  '#0e7490', // cyan-700
  '#38bdf8', // sky-400
  '#7dd3fc', // sky-300
  '#0369a1', // sky-700
  '#93c5fd', // blue-300 
  '#2563eb', // blue-600 
  '#a5b4fc', // indigo-300
  '#4338ca', // indigo-700 
  '#c4b5fd', // violet-300
  '#6d28d9', // violet-700 
  '#a855f7', // purple-500
  '#9333ea', // purple-600
  '#d946ef', // fuchsia-500 
]

/**
 * Returns a palette color deterministically derived from a game name.
 * Uses a simple character-code hash so the same name always maps to the
 * same color regardless of how many other games are present.
 */
function gameNameToColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return GAME_PALETTE[hash % GAME_PALETTE.length]
}

/**
 * Build a deterministic game→color map from a stats object.
 *
 * @param {object} stats - { recordings, clips } arrays
 * @param {string[]} [knownGameNames] - Authoritative ordered list of all configured
 *   game names (e.g. from the games API). When provided these are assigned colors by
 *   alphabetical index (no collisions possible). Any game found in stats but not in
 *   this list falls back to the hash-based assignment.
 */
export function buildGameColors(stats, knownGameNames) {
  const map = {}
  const fromItems = new Set()
  stats?.recordings?.forEach((r) => r.game_name && fromItems.add(r.game_name))
  stats?.clips?.forEach((c) => c.game_name && fromItems.add(c.game_name))

  if (knownGameNames?.length) {
    const sorted = [...new Set(knownGameNames)].sort()
    sorted.forEach((g, i) => {
      map[g] = GAME_PALETTE[i % GAME_PALETTE.length]
    })
    fromItems.forEach((g) => {
      if (!map[g]) map[g] = gameNameToColor(g)
    })
  } else {
    Array.from(fromItems).sort().forEach((g, i) => {
      map[g] = GAME_PALETTE[i % GAME_PALETTE.length]
    })
  }

  return map
}
