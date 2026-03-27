export function clampPlaybackTime(time, duration, trimStart = null, trimEnd = null) {
  const safeDuration = Number.isFinite(duration) && duration >= 0 ? duration : 0
  const baseClamped = Math.max(0, Math.min(safeDuration, time))

  if (trimStart === null || trimEnd === null) {
    return baseClamped
  }

  return Math.max(trimStart, Math.min(trimEnd, baseClamped))
}
