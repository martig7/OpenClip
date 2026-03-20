import { Plus, Search, Edit2, Trash2, Gamepad2 } from 'lucide-react'
import { GameAvatar } from './GameAvatar'
import {
  useSidebarResize,
  STORAGE_KEY_GAMES_CAPTION_CLUSTER,
} from '../../hooks/useSidebarResize'

export function GamesToolbar({ filter, setFilter, search, setSearch, counts, onAdd }) {
  const { sidebarWidth: captionClusterMaxPx, handleMouseDown: onCaptionClusterResizeMouseDown } =
    useSidebarResize(STORAGE_KEY_GAMES_CAPTION_CLUSTER, {
      min: 260,
      max: 920,
      defaultW: 480,
    })

  return (
    <div className="games-toolbar">
      {/* One row: same height as Electron titleBarOverlay (36px) + inset for Windows system buttons */}
      <header className="games-caption-bar" aria-label="Games">
        {/* Bounded cluster: msb-search width:100% fills this box; max width persisted like drawer */}
        <div
          className="games-caption-bar__cluster"
          style={{ maxWidth: captionClusterMaxPx }}
        >
          <div className="msb-row1 games-caption-bar__row">
            <span className="msb-title">Games</span>
            <div className="msb-search">
              <span className="msb-search-icon" aria-hidden>
                <Search size={11} />
              </span>
              <input
                type="search"
                placeholder="Search games…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
          <div
            className="games-caption-bar__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Games search section"
            onMouseDown={onCaptionClusterResizeMouseDown}
          />
        </div>
        <div className="games-caption-bar__drag-fill" aria-hidden />
      </header>

      <div className="main-content-topbar-rule games-toolbar-top-rule" aria-hidden />

      <div className="games-toolbar-actions">
        <div className="msb-game-filter" aria-label="Game filter">
          {[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'enabled', label: 'Enabled', count: counts.enabled },
            { key: 'disabled', label: 'Disabled', count: counts.disabled },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              className={`msb-game-pill${filter === t.key ? ' active' : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <button className="games-add-btn" type="button" onClick={onAdd}>
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
  const cols = 6

  return (
    <table className="games-table">
      <thead className="games-table-thead">
        <tr>
          <th className="col-toggle" aria-label="Enabled toggle" />
          <th className="col-icon" aria-label="Game icon" />
          <th>Name</th>
          <th>Scene</th>
          <th className="col-status">Status</th>
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
          <>
            {games.map((game) => {
              const selected = selectedId === game.id
              const disabled = !game.enabled

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

                  <td className="col-status">
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
            })}
            <tr className="games-table-add-row" key="games-table-add-slot">
              <td colSpan={cols}>
                <div className="games-table-add-slot">
                  <button
                    type="button"
                    className="games-add-circle-btn"
                    onClick={() => onAdd()}
                    aria-label="Add game"
                    title="Add game"
                  >
                    <Plus size={18} strokeWidth={2.25} aria-hidden />
                  </button>
                </div>
              </td>
            </tr>
          </>
        )}
      </tbody>
    </table>
  )
}
