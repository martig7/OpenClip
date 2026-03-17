# Media Sidebar Redesign — Clips & Recordings Pages

**Date:** 2026-03-16
**Status:** Approved

---

## Overview

Replace the DOM-based `Sidebar` component used in `ClipsPage` and `RecordingsPage` with a storage-style canvas list and compact filter bar. Extract the canvas list into a shared `MediaList` component so both pages use the same rendering path.

---

## Goals

- List style matches `StorageList` (canvas, 33px rows, dot | name | date | size columns)
- Filtering parity with `StoragePage`: game color pills, sort by date/name/size/game with asc/desc direction
- Search bar retained but made compact (26px, inline with title)
- Flat list — no time bucket grouping headers
- Single shared canvas component (`MediaList`) used by both pages
- All interactive elements use Lucide icons; no unicode emoji

---

## Files

### New

| File | Purpose |
|------|---------|
| `src/viewer/components/MediaList.jsx` | Canvas list component (shared) |
| `src/viewer/components/MediaSidebar.jsx` | Sidebar wrapper with filter bar + MediaList |

### Modified

| File | Change |
|------|--------|
| `src/viewer/pages/ClipsPage.jsx` | Replace `Sidebar` import/usage with `MediaSidebar` |
| `src/viewer/pages/RecordingsPage.jsx` | Replace `Sidebar` import/usage with `MediaSidebar` |
| `src/viewer/viewer.css` | Add styles for MediaSidebar header controls |

### Unchanged

| File | Notes |
|------|-------|
| `src/viewer/components/Sidebar.jsx` | Left in place, no longer used by Clips or Recordings |
| `src/viewer/components/StorageList.jsx` | Reference implementation; not modified |

---

## Component: MediaList

Canvas-rendered flat list of media items (clips or recordings).

### Props

```js
{
  items: Array,           // filtered + sorted items from MediaSidebar
  selectedItem: Object,   // currently selected item (matched by .path)
  onSelect: Function,     // (item) => void — receives full item object (not path string)
  gameColors: Object,     // { [game_name]: hexColor } from buildGameColors()
  sortBy: String,         // 'date' | 'name' | 'size' | 'game' — for header highlight only
  sortDir: String,        // 'asc' | 'desc' — for header chevron direction
}
```

Note: `onSelect` receives the full item object. This differs from `StorageList.onSelect` which receives a path string. Do not copy the `onSelect(item.path)` call from StorageList.

### Canvas constants

```js
const HEADER_H = 26   // differs from StorageList's 30 — do not copy that value
const ROW_H    = 33
const SB_W     = 8

const COL_DOT  = 22
const COL_DATE = 70
const COL_SIZE = 52
```

### Layout function

```js
function getLayout(cssW) {
  const nameW = Math.max(60, cssW - COL_DOT - COL_DATE - COL_SIZE - SB_W)
  return {
    xDot:  0,
    xName: COL_DOT,
    nameW,
    xDate: COL_DOT + nameW,
    xSize: COL_DOT + nameW + COL_DATE,
  }
}
```

Dot center-x within column: `L.xDot + 11` (centered in 22px column).

Column math at 320px: `22 + 168(flex) + 70 + 52 + 8 = 320px` ✓

### Behavior

- **ResizeObserver** keeps canvas dimensions in sync with container
- **RAF scheduling** (`scheduleDraw` / `flushDraw`) — same pattern as StorageList
- **Virtual rendering** — only visible rows drawn (r0/r1 window as in StorageList)
- **Scrollbar drag** — same drag logic as StorageList
- **Wheel scroll** — `passive: false`, clamp to content bounds
- **Single click** — calls `onSelect(item)` with full item object
- **Hover** — row highlight `#1f1f1f`
- **Selected row** — `rgba(99,102,241,0.12)` background; dot becomes filled violet circle with checkmark
- **Props mirrored to refs** — avoids stale closures; `const selRef = useRef(selectedItem)` holds the full item Object (not a Set — unlike StorageList's `selRef` which holds a Set); also mirrors `sortBy`, `sortDir`, `gameColors`, `items`
- **No lock column, no type column, no multi-select, no globalAlpha dimming** — all rows render at full opacity (no `globalAlpha` changes anywhere in the draw loop)
- **Header cursor** — remains `default` at all times; no `onColumnSort` prop means no pointer cursor over header columns (do not copy StorageList's pointer-cursor-on-hover logic for the header)

### Canvas draw — row rendering

```
isSel = item.path === selRef.current?.path   // selRef holds Object, compare by .path

Background:
  selected → rgba(99,102,241,0.12)
  hover    → #1f1f1f  (intentionally darker than StorageList's #2a2a2a — do not change)
  default  → transparent

Row border: 1px #232323 at bottom  (intentionally darker than StorageList's #333333 — do not change)

Dot column (center-x = L.xDot + 11, center-y = y + ROW_H/2):
  selected → filled circle #7c3aed (r=7) + white checkmark path (same coords as StorageList)
  default  → filled circle, color = gameColors[item.game_name] || '#888' (r=3.5)

Name: #ffffff, 12px system-ui, truncated with truncText()
Date: #555555, 11px system-ui
Size: #555555, 11px "Courier New" monospace

Header:
  background #181818, border-bottom 1px #333
  column labels: NAME · DATE · SIZE (10px, weight 600, uppercase, left-aligned within column)
  active sort column (matches sortByRef.current) → color #a78bfa
  inactive columns → color #444444
  active column: draw single chevron (up if sortDirRef.current==='asc', down if 'desc')
  inactive columns: no chevron (header is display-only; sort is controlled by DOM buttons)
```

### Empty state

When `items.length === 0`, `MediaList` still renders (canvas with just the header bar). The empty state UI is rendered by `MediaSidebar` as a DOM overlay positioned over the canvas area (see MediaSidebar empty state section).

---

## Component: MediaSidebar

Wrapper that owns filter state and passes processed items to `MediaList`.

### Props

```js
{
  items: Array,         // raw items array (all clips or all recordings)
  selectedItem: Object,
  onSelect: Function,   // (item) => void
  title: String,        // "Clips" or "Recordings"
  emptyMessage: String,
}
```

### State

| State | Type | Default | Description |
|-------|------|---------|-------------|
| `searchQuery` | string | `''` | Filename/game text filter |
| `filterGame` | string | `'all'` | Selected game name or `'all'` |
| `sortBy` | string | `'date'` | `'date' \| 'name' \| 'size' \| 'game'` |
| `sortDir` | string | `'desc'` | `'asc' \| 'desc'` |

### filterGame reset effect

```js
useEffect(() => {
  if (filterGame === 'all') return
  const gameNames = new Set(items.map(i => i.game_name))
  if (!gameNames.has(filterGame)) setFilterGame('all')
}, [items, filterGame])
```

### Filter pipeline (useMemo)

1. **Search** — case-insensitive match on `filename` or `game_name`
2. **Game filter** — if `filterGame !== 'all'`, keep only items where `item.game_name === filterGame`
3. **Sort** — flat sort by selected key + direction

```js
const dir = sortDir === 'asc' ? 1 : -1
// Sort comparators:
date: dir * (a.mtime - b.mtime)
name: dir * a.filename.localeCompare(b.filename)
size: dir * (a.size_bytes - b.size_bytes)
game: dir * a.game_name.localeCompare(b.game_name) || (b.mtime - a.mtime)
```

### Sort direction defaults

| sortBy | default sortDir on selection |
|--------|------------------------------|
| date | desc |
| name | asc |
| size | desc |
| game | asc |

Clicking the currently active sort key toggles direction. Clicking a different key sets it + applies the default direction above.

### Game colors

```js
const gameColors = useMemo(
  () => buildGameColors({ recordings: items, clips: [] }),
  [items]
)
```

`buildGameColors` extracts unique game names from both arrays and assigns palette colors alphabetically by index. Passing all items under `recordings` is safe — the function only reads `.game_name` from each item regardless of which array it comes from. Color index assignments are consistent within this page's item pool. They may differ from StoragePage's assignments (StoragePage combines recordings + clips from all games), but each page is self-consistent and the divergence is acceptable.

### Header layout

```
┌─────────────────────────────────────────┐
│ CLIPS          [ Search...            ] │  ← row 1: title + search (26px)
├─────────────────────────────────────────┤
│ [All] [● Valorant] [● Minecraft] [● Ap…]│  ← row 2: game filter pills
├─────────────────────────────────────────┤
│ Sort [Date][Name][Size][Game] [↑/↓]      │  ← row 3: sort toggles + direction
└─────────────────────────────────────────┘
```

**Row 1 — title + search:**
- Title: `0.75rem`, `700` weight, uppercase, `--text-muted`, `flex-shrink: 0`
- Search: `<input>` 26px height, `background: #212121`, `border: 1px solid #2e2e2e`, `border-radius: 5px`, `font-size: 0.78rem`; Lucide `Search` icon at 11px positioned absolutely left at 7px

**Row 2 — game filter pills:**
- "All" pill + one pill per unique game in `items` with color dot
- Pills derived from `Object.entries(gameColors)` — same games that have colors
- Active pill: `background: #212121`, `border: 1px solid #3a3a3a`, `color: #fff`
- Inactive: `background: transparent`, `color: #555`
- Clicking a game pill: sets `filterGame` to that game (or back to `'all'` if already active)

**Row 3 — sort controls:**
- Label "Sort" (`0.65rem`, uppercase, muted)
- Toggle buttons in `sv2-view-toggle` / `sv2-view-btn` style: `[Date][Name][Size][Game]`
- Direction button (`.msb-dir-btn`): Lucide `ChevronDown` when `sortDir==='desc'`, `ChevronUp` when `sortDir==='asc'`, size 12px; clicking toggles direction only

### Empty state

When `filteredItems.length === 0`, render a DOM overlay over the canvas list area:

```jsx
<div className="msb-empty">
  <FileVideo size={32} />
  <p>{emptyMessage}</p>
</div>
```

`.msb-empty`: `position: absolute`, `inset: 0`, `display: flex`, `flex-direction: column`, `align-items: center`, `justify-content: center`, `gap: 10px`, `color: var(--text-muted)`, `font-size: 0.85rem`, `pointer-events: none`

The canvas list area wrapper needs `position: relative` for this overlay to work.

### Footer

```jsx
<div className="msb-footer">
  {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
</div>
// e.g. "1 item", "6 items", "0 items"
```

---

## CSS additions (viewer.css)

New classes for `MediaSidebar`. The outer wrapper uses `.sidebar` to inherit the existing 320px width, border, and responsive breakpoint rule (`@media (max-width: 700px)`). Inner header uses all-new `msb-` classes.

```css
/* MediaSidebar header */
.msb-header      { padding: 8px 10px; border-bottom: 1px solid var(--border);
                   display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.msb-row1        { display: flex; align-items: center; gap: 8px; }
.msb-title       { font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
                   letter-spacing: 0.06em; color: var(--text-muted); flex-shrink: 0; }
.msb-search      { position: relative; flex: 1; min-width: 0; }
.msb-search input { width: 100%; height: 26px; padding: 0 8px 0 26px;
                    background: #212121; border: 1px solid #2e2e2e; border-radius: 5px;
                    color: var(--text-primary); font-size: 0.78rem; outline: none; }
.msb-search input:focus { border-color: var(--accent); }
.msb-search input::placeholder { color: var(--text-muted); }
.msb-search-icon { position: absolute; left: 7px; top: 50%; transform: translateY(-50%);
                   color: #444; pointer-events: none; }
.msb-game-filter { display: flex; align-items: center; gap: 3px; flex-wrap: nowrap;
                   overflow: hidden; }
.msb-game-pill   { display: flex; align-items: center; gap: 4px; padding: 2px 7px;
                   border-radius: 20px; border: 1px solid transparent;
                   background: transparent; color: #555; font-size: 0.68rem;
                   cursor: pointer; white-space: nowrap;
                   transition: background 0.1s, color 0.1s, border-color 0.1s; }
.msb-game-pill:hover        { background: var(--bg-hover); color: var(--text-primary); }
.msb-game-pill.active       { background: #212121; border-color: #3a3a3a; color: #fff; }
.msb-game-dot               { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.msb-sort-row               { display: flex; align-items: center; gap: 4px; }
.msb-sort-label             { font-size: 0.65rem; color: var(--text-muted);
                              text-transform: uppercase; letter-spacing: 0.04em; }
.msb-dir-btn                { padding: 3px 6px; border-left: 1px solid var(--border);
                              display: flex; align-items: center; }

/* MediaSidebar list area */
.msb-list-area   { flex: 1; overflow: hidden; position: relative; }

/* MediaSidebar empty overlay */
.msb-empty       { position: absolute; inset: 0; display: flex; flex-direction: column;
                   align-items: center; justify-content: center; gap: 10px;
                   color: var(--text-muted); font-size: 0.85rem; pointer-events: none; }

/* MediaSidebar footer */
.msb-footer      { padding: 5px 10px; border-top: 1px solid var(--border);
                   font-size: 0.68rem; color: var(--text-muted); flex-shrink: 0; }
```

Reuses existing: `.sidebar` (outer wrapper), `sv2-view-toggle`, `sv2-view-btn` (sort key buttons).

---

## Integration changes

### ClipsPage.jsx

```jsx
// Remove:
import Sidebar from '../components/Sidebar'

// Add:
import MediaSidebar from '../components/MediaSidebar'

// Replace:
<Sidebar
  items={clips}
  selectedItem={selectedClip}
  onSelect={setSelectedClip}
  title="Clips"
  emptyMessage="Create clips from your recordings"
/>

// With:
<MediaSidebar
  items={clips}
  selectedItem={selectedClip}
  onSelect={setSelectedClip}
  title="Clips"
  emptyMessage="Create clips from your recordings"
/>
```

Verify action buttons already use Lucide (`Play`, `FolderOpen`, `Trash2`) — they do per current code. No unicode to replace here.

### RecordingsPage.jsx

Same import swap: `Sidebar` → `MediaSidebar`. No other changes.

---

## Out of scope

- StoragePage changes (none)
- VideoPlayer changes (none)
- Sidebar.jsx deletion (leave in place)
- Treemap view for clips/recordings (not requested)
- Multi-select for clips/recordings (not requested)

---

## Resolved decisions

| Question | Decision |
|----------|----------|
| Flat vs grouped | Flat list — no time bucket headers |
| Canvas vs DOM | Canvas (shared with storage) |
| Sidebar width | Unchanged (320px via `.sidebar` class) |
| Icons | Lucide only, no unicode |
| Empty state | DOM overlay rendered by MediaSidebar |
| Sort header in canvas | Read-only highlight via sortBy/sortDir props |
| globalAlpha | Not used — all rows full opacity |
| Responsive breakpoint | Inherited from `.sidebar` class on outer wrapper |
