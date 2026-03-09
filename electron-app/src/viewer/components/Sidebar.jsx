import { useState, useMemo } from 'react'
import { Search, FileVideo, Calendar, HardDrive } from 'lucide-react'

function Sidebar({ items, selectedItem, onSelect, title, emptyMessage }) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items
    const query = searchQuery.toLowerCase()
    return items.filter(item =>
      item.filename.toLowerCase().includes(query) ||
      item.game_name.toLowerCase().includes(query)
    )
  }, [items, searchQuery])

  const groupedItems = useMemo(() => {
    const groups = {}
    for (const item of filteredItems) {
      const game = item.game_name || 'Unknown'
      if (!groups[game]) {
        groups[game] = []
      }
      groups[game].push(item)
    }
    return groups
  }, [filteredItems])

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>{title}</h2>
        <div className="search-box">
          <span className="search-icon"><Search size={14} /></span>
          <input
            type="search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="items-list">
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <div className="icon"><FileVideo size={40} /></div>
            <h3>No items found</h3>
            <p>{emptyMessage || 'No recordings available'}</p>
          </div>
        ) : (
          Object.entries(groupedItems).map(([game, gameItems]) => (
            <div key={game} className="item-group">
              <div className="group-header">{game} ({gameItems.length})</div>
              {gameItems.map((item) => (
                <div
                  key={item.path}
                  className={`item-card ${selectedItem?.path === item.path ? 'active' : ''}`}
                  onClick={() => onSelect(item)}
                >
                  <div className="item-name">{item.filename}</div>
                  <div className="item-meta">
                    <span><Calendar size={11} /> {item.date}</span>
                    <span><HardDrive size={11} /> {item.size_formatted}</span>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="sidebar-footer">
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
      </div>
    </aside>
  )
}

export default Sidebar
