import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, FileVideo } from 'lucide-react'
import MediaList from './MediaList'
import { buildGameColors } from '../utils/storageColors'

const SORT_DIR_DEFAULTS = { date: 'desc', name: 'asc', size: 'desc', game: 'asc' }
const SORT_KEYS = ['date', 'name', 'size', 'game']

function MediaSidebar({ items, selectedItem, onSelect, title, emptyMessage }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterGame, setFilterGame] = useState('all')
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const filterScrollRef = useRef(null)

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth')
    return saved ? parseInt(saved, 10) : 320
  })
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const prevWidthRef = useRef(sidebarWidth)

  const handleMouseMove = useCallback((e) => {
    if (!isDraggingRef.current) return
    const delta = e.clientX - startXRef.current
    const newWidth = Math.max(280, Math.min(800, prevWidthRef.current + delta))
    setSidebarWidth(newWidth)
  }, [])

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      localStorage.setItem('sidebarWidth', sidebarWidth.toString())
    }
  }, [sidebarWidth])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const handleMouseDown = useCallback(
    (e) => {
      isDraggingRef.current = true
      startXRef.current = e.clientX
      prevWidthRef.current = sidebarWidth
      document.body.style.cursor = 'col-resize'
    },
    [sidebarWidth]
  )

  const updateScrollState = useCallback(() => {
    const el = filterScrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  const scrollFilter = (dir) => {
    const el = filterScrollRef.current
    if (el) el.scrollBy({ left: dir * 80, behavior: 'smooth' })
  }

  // Reset filterGame if the selected game disappears from the item list
  useEffect(() => {
    if (filterGame === 'all') return
    const gameNames = new Set(items.map((i) => i.game_name))
    if (!gameNames.has(filterGame)) setFilterGame('all')
  }, [items, filterGame])

  const gameColors = useMemo(() => buildGameColors({ recordings: items, clips: [] }), [items])

  // Re-check scroll overflow when game list changes or container resizes
  useEffect(() => {
    updateScrollState()
  }, [gameColors, updateScrollState])

  useEffect(() => {
    const el = filterScrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => updateScrollState())
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateScrollState])

  const filteredItems = useMemo(() => {
    let result = items

    // 1. Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (item) =>
          (item.filename || '').toLowerCase().includes(q) ||
          (item.game_name || '').toLowerCase().includes(q)
      )
    }

    // 2. Game filter
    if (filterGame !== 'all') {
      result = result.filter((item) => item.game_name === filterGame)
    }

    // 3. Sort (flat, no grouping)
    const dir = sortDir === 'asc' ? 1 : -1
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return dir * (a.mtime - b.mtime)
        case 'name':
          return dir * a.filename.localeCompare(b.filename)
        case 'size':
          return dir * (a.size_bytes - b.size_bytes)
        case 'game':
          return dir * a.game_name.localeCompare(b.game_name) || b.mtime - a.mtime
        default:
          return dir * (a.mtime - b.mtime)
      }
    })

    return result
  }, [items, searchQuery, filterGame, sortBy, sortDir])

  const handleSortKey = (key) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir(SORT_DIR_DEFAULTS[key])
    }
  }

  return (
    <aside className="sidebar" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      {/* ── Header ── */}
      <div className="msb-header">
        {/* Row 1: title + search */}
        <div className="msb-row1">
          <span className="msb-title">{title}</span>
          <div className="msb-search">
            <span className="msb-search-icon">
              <Search size={11} />
            </span>
            <input
              type="search"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Row 2: game filter pills (only when multiple games present) */}
        {Object.keys(gameColors).length > 0 && (
          <div className="msb-game-filter-wrap">
            {canScrollLeft && (
              <button
                className="msb-game-scroll-btn msb-game-scroll-left"
                onClick={() => scrollFilter(-1)}
              >
                <ChevronLeft size={12} />
              </button>
            )}
            <div className="msb-game-filter" ref={filterScrollRef} onScroll={updateScrollState}>
              <button
                className={`msb-game-pill${filterGame === 'all' ? ' active' : ''}`}
                onClick={() => setFilterGame('all')}
              >
                All
              </button>
              {Object.entries(gameColors).map(([game, color]) => (
                <button
                  key={game}
                  className={`msb-game-pill${filterGame === game ? ' active' : ''}`}
                  onClick={() => setFilterGame(filterGame === game ? 'all' : game)}
                >
                  <span className="msb-game-dot" style={{ background: color }} />
                  {game}
                </button>
              ))}
            </div>
            {canScrollRight && (
              <button
                className="msb-game-scroll-btn msb-game-scroll-right"
                onClick={() => scrollFilter(1)}
              >
                <ChevronRight size={12} />
              </button>
            )}
          </div>
        )}

        {/* Row 3: sort controls */}
        <div className="msb-sort-row">
          <span className="msb-sort-label">Sort</span>
          <div className="sv2-view-toggle">
            {SORT_KEYS.map((key) => (
              <button
                key={key}
                className={`sv2-view-btn${sortBy === key ? ' active' : ''}`}
                onClick={() => handleSortKey(key)}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
            <button
              className="msb-dir-btn"
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            >
              {sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── List area ── */}
      <div className="msb-list-area">
        <MediaList
          items={filteredItems}
          selectedItem={selectedItem}
          onSelect={onSelect}
          gameColors={gameColors}
          sortBy={sortBy}
          sortDir={sortDir}
        />
        {filteredItems.length === 0 && (
          <div className="msb-empty">
            <FileVideo size={32} />
            <p>{emptyMessage || 'No items found'}</p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="msb-footer">
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
      </div>
      <div className="sidebar-resizer" onMouseDown={handleMouseDown} />
    </aside>
  )
}

export default MediaSidebar
