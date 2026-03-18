import { Edit2, Trash2 } from 'lucide-react'

export function GameList({ games, toggleGame, openEditModal, removeGame }) {
  return (
    <div>
      {games.map((game) => (
        <div key={game.id} className="list-item">
          <button
            className={`toggle ${game.enabled ? 'on' : ''}`}
            onClick={() => toggleGame(game.id)}
            title={game.enabled ? 'Enabled' : 'Disabled'}
          />
          {game.icon_path && (
            <img
              src={`localfile:///${game.icon_path.replace(/\\/g, '/')}`}
              alt=""
              style={{
                width: 24,
                height: 24,
                objectFit: 'contain',
                borderRadius: 4,
                flexShrink: 0,
              }}
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          )}
          <div className="list-item-info">
            <div className="list-item-title">{game.name}</div>
            <div className="list-item-subtitle">
              {game.selector}
              {game.scene && (
                <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                  · Scene: {game.scene}
                </span>
              )}
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={() => openEditModal(game)}
            title="Edit game"
          >
            <Edit2 size={14} />
          </button>
          <button
            className="btn-icon"
            onClick={() => removeGame(game.id)}
            title="Remove game"
            style={{ color: 'var(--danger)' }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
