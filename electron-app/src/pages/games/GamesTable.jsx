import { Plus, Search, Edit2, Trash2, Gamepad2 } from 'lucide-react'

const GAME_PALETTE = [
  '#7c3aed',
  '#3b82f6',
  '#06b6d4',
  '#6366f1',
  '#8b5cf6',
  '#0ea5e9',
  '#a78bfa',
  '#818cf8',
  '#2dd4bf',
  '#c084fc',
  '#60a5fa',
  '#22d3ee',
  '#4f46e5',
  '#7e22ce',
  '#0284c7',
  '#0891b2',
]

function getColor(id) {
  const str = String(id || '')
  if (!str) return GAME_PALETTE[0]
  const sum = str.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return GAME_PALETTE[sum % GAME_PALETTE.length]
}

function GameAvatar({ game, size = 28 }) {
  const bg = getColor(game?.id)
  const letter = (game?.name || '?').trim().slice(0, 1).toUpperCase()

  if (game?.icon_path) {
    return (
      <img
        src={`localfile:///${game.icon_path.replace(/\\/g, '/')}`}
        alt=""
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          borderRadius: 4,
          flexShrink: 0,
        }}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  return (
    <div
      className="games-table-avatar"
      style={{
        width: size,
        height: size,
        background: bg,
      }}
    >
      {letter}
    </div>
  )
}

export function GamesToolbar({ filter, setFilter, search, setSearch, counts, onAdd }) {
  return (
    <div className="games-toolbar">
      <div className="filter-tabs" aria-label="Game filter">
        {[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'enabled', label: 'Enabled', count: counts.enabled },
          { key: 'disabled', label: 'Disabled', count: counts.disabled },
        ].map((t) => (
          <button
            key={t.key}
            className={`filter-tab ${filter === t.key ? 'active' : ''}`}
            onClick={() => setFilter(t.key)}
            type="button"
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      <div className="games-toolbar-right">
        <div className="search-box games-search-box">
          <span className="search-icon" aria-hidden>
            <Search size={14} />
          </span>
          <input
            type="search"
            placeholder="Search games…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>

        <button className="btn btn-primary btn-sm" type="button" onClick={onAdd}>
          <Plus size={13} /> Add Game
        </button>
      </div>
    </div>
  )
}

export function GamesTable({
  games,
  selectedId,
  search,
  totalCount,
  onClearSearch,
  onAdd,
  onRowClick,
  onToggle,
  onEdit,
  onDelete,
}) {
  const cols = 7

  return (
    <table className="games-table">
      <thead>
        <tr>
          <th className="col-toggle" aria-label="Enabled toggle" />
          <th className="col-icon" aria-label="Game icon" />
          <th>Name</th>
          <th>Scene</th>
          <th>Status</th>
          <th className="col-clips">Clips</th>
          <th className="col-actions" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {games.length === 0 ? (
          <tr>
            <td colSpan={cols}>
              <div className="empty-state">
                <Gamepad2 size={32} />
                <p>
                  {totalCount === 0
                    ? 'No games added yet. Click "Add Game" to get started.'
                    : search
                      ? 'No games match your search.'
                      : 'No games match your filter.'}
                </p>
                {totalCount === 0 ? (
                  <button className="btn btn-primary btn-sm" type="button" onClick={onAdd}>
                    Add your first game
                  </button>
                ) : search ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={onClearSearch}
                  >
                    Clear search
                  </button>
                ) : null}
              </div>
            </td>
          </tr>
        ) : (
          games.map((game) => {
            const selected = selectedId === game.id
            const disabled = !game.enabled
            const clips = game.clips ?? '—'

            return (
              <tr
                key={game.id}
                className={`${selected ? 'selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                onClick={() => onRowClick(game)}
              >
                <td className="col-toggle">
                  <button
                    className={`toggle ${game.enabled ? 'on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggle(game.id)
                    }}
                    title={game.enabled ? 'Enabled' : 'Disabled'}
                    type="button"
                  />
                </td>

                <td className="col-icon">
                  <GameAvatar game={game} size={28} />
                </td>

                <td className="games-table-name">
                  {game.name}
                </td>
                <td className="games-table-scene">{game.scene || '—'}</td>

                <td>
                  <span className={`badge ${game.enabled ? 'badge-success' : 'badge-muted'}`}>
                    <span
                      className="badge-dot"
                      style={{
                        background: game.enabled ? 'var(--success)' : 'var(--text-muted)',
                      }}
                    />
                    {game.enabled ? 'Active' : 'Off'}
                  </span>
                </td>

                <td className="col-clips">{clips}</td>

                <td className="col-actions">
                  <div className="games-table-actions">
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(game)
                      }}
                      title="Edit game"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="btn-icon"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(game.id)
                      }}
                      title="Remove game"
                      style={{ color: 'var(--danger)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })
        )}
      </tbody>
    </table>
  )
}

