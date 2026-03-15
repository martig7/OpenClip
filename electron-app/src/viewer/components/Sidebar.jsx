import { useState, useMemo } from 'react'
import { Search, FileVideo, Calendar, HardDrive, Folder, AlertTriangle } from 'lucide-react'

const SORT_OPTIONS = [
  { value: 'time-desc', label: 'Newest first' },
  { value: 'time-asc',  label: 'Oldest first' },
  { value: 'name-asc',  label: 'Name A→Z' },
  { value: 'name-desc', label: 'Name Z→A' },
  { value: 'size-desc', label: 'Largest first' },
  { value: 'size-asc',  label: 'Smallest first' },
]

// ── Time grouping ────────────────────────────────────────────────────────────

const TIME_BUCKETS = ['Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Older']

function getTimeBucket(mtime) {
  const days = (Date.now() - mtime * 1000) / 86_400_000
  if (days < 1)  return 'Today'
  if (days < 2)  return 'Yesterday'
  if (days < 7)  return 'This Week'
  if (days < 14) return 'Last Week'
  if (days < 30) return 'This Month'
  return 'Older'
}

// ── Size grouping ────────────────────────────────────────────────────────────

const SIZE_BUCKETS = ['Huge (>10 GB)', 'Large (1–10 GB)', 'Medium (100 MB–1 GB)', 'Small (<100 MB)']

function getSizeBucket(bytes) {
  if (bytes >= 10 * 1_073_741_824) return SIZE_BUCKETS[0]
  if (bytes >= 1_073_741_824)      return SIZE_BUCKETS[1]
  if (bytes >= 104_857_600)        return SIZE_BUCKETS[2]
  return SIZE_BUCKETS[3]
}

// ── Core sort + group logic ──────────────────────────────────────────────────

function sortItems(items, sortKey) {
  return [...items].sort((a, b) => {
    switch (sortKey) {
      case 'time-asc':  return a.mtime - b.mtime
      case 'time-desc': return b.mtime - a.mtime
      case 'name-asc':  return a.filename.localeCompare(b.filename)
      case 'name-desc': return b.filename.localeCompare(a.filename)
      case 'size-asc':  return a.size_bytes - b.size_bytes
      case 'size-desc': return b.size_bytes - a.size_bytes
      default:          return b.mtime - a.mtime
    }
  })
}

function buildGroups(sortedItems, sortKey) {
  const groups = {}
  for (const item of sortedItems) {
    let key
    if (sortKey.startsWith('time')) {
      key = getTimeBucket(item.mtime)
    } else if (sortKey.startsWith('size')) {
      key = getSizeBucket(item.size_bytes)
    } else {
      key = item.game_name || '(Unorganized)'
    }
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return groups
}

function orderGroups(groups, sortKey) {
  const entries = Object.entries(groups)

  if (sortKey.startsWith('time')) {
    const order = sortKey === 'time-asc' ? [...TIME_BUCKETS].reverse() : TIME_BUCKETS
    return entries.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }

  if (sortKey.startsWith('size')) {
    const order = sortKey === 'size-asc' ? [...SIZE_BUCKETS].reverse() : SIZE_BUCKETS
    return entries.sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
  }

  // name sort: alphabetical by game, (Unorganized) always last
  return entries.sort(([a], [b]) => {
    if (a === '(Unorganized)') return 1
    if (b === '(Unorganized)') return -1
    return a.localeCompare(b)
  })
}

// ── Component ────────────────────────────────────────────────────────────────

function Sidebar({ items, selectedItem, onSelect, title, emptyMessage }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('time-desc')

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items
    const query = searchQuery.toLowerCase()
    return items.filter(item =>
      (item.filename || '').toLowerCase().includes(query) ||
      (item.game_name || '').toLowerCase().includes(query)
    )
  }, [items, searchQuery])

  const sortedGroups = useMemo(() => {
    const sorted = sortItems(filteredItems, sortKey)
    const groups = buildGroups(sorted, sortKey)
    return orderGroups(groups, sortKey)
  }, [filteredItems, sortKey])

  const groupingByGame = sortKey.startsWith('name')

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
        <div className="sort-row">
          <label className="sort-label" htmlFor="sidebar-sort">Sort</label>
          <select
            id="sidebar-sort"
            className="sort-select"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
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
          sortedGroups.map(([groupKey, groupItems]) => {
            const isUnorganizedGroup = groupingByGame && groupKey === '(Unorganized)'
            return (
              <div key={groupKey} className="item-group">
                <div className={`group-header${isUnorganizedGroup ? ' group-header--unorganized' : ''}`}>
                  {isUnorganizedGroup && <AlertTriangle size={11} />}
                  {isUnorganizedGroup ? 'Unorganized' : groupKey} ({groupItems.length})
                </div>
                {groupItems.map((item) => {
                  const isUnorganizedItem = item.game_name === '(Unorganized)'
                  return (
                    <div
                      key={item.path}
                      className={`item-card${selectedItem?.path === item.path ? ' active' : ''}${isUnorganizedItem ? ' item-card--unorganized' : ''}`}
                      onClick={() => onSelect(item)}
                    >
                      <div className="item-name">{item.filename}</div>
                      <div className="item-meta">
                        {!groupingByGame && (
                          <span><Folder size={11} /> {item.game_name}</span>
                        )}
                        <span><Calendar size={11} /> {item.date}</span>
                        <span><HardDrive size={11} /> {item.size_formatted}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      <div className="sidebar-footer">
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
      </div>
    </aside>
  )
}

export default Sidebar
