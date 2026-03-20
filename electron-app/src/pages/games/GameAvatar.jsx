const GAME_PALETTE = [
  '#7c3aed', '#3b82f6', '#06b6d4', '#6366f1',
  '#8b5cf6', '#0ea5e9', '#a78bfa', '#818cf8',
  '#2dd4bf', '#c084fc', '#60a5fa', '#22d3ee',
  '#4f46e5', '#7e22ce', '#0284c7', '#0891b2',
]

function getColor(id) {
  const str = String(id || '')
  if (!str) return GAME_PALETTE[0]
  const sum = str.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return GAME_PALETTE[sum % GAME_PALETTE.length]
}

export function GameAvatar({ game, size = 28, className = '' }) {
  const bg = getColor(game?.id)
  const letter = (game?.name || '?').trim().slice(0, 1).toUpperCase()

  if (game?.icon_path) {
    return (
      <img
        src={`localfile:///${game.icon_path.replace(/\\/g, '/')}`}
        alt=""
        className={className}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          flexShrink: 0,
          borderRadius: size > 32 ? 'var(--radius-md)' : 4,
        }}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  return (
    <div
      className={`game-avatar ${className}`}
      style={{ width: size, height: size, background: bg, fontSize: size > 32 ? 20 : 13 }}
    >
      {letter}
    </div>
  )
}
