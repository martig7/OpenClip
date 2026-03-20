# Plan: Implement Games Page — Prototype 4 (Compact Table + Side Drawer)

---

## ── DRAFT 1 — Initial Scope ──────────────────────────────────

### What's changing
Replace the current two-card stack (`Game Library` card + `Scene Audio Sources` card) in
`GamesPageBody.jsx` with:
1. A toolbar row (filter tabs + search + Add Game button)
2. A full-width data table of games
3. A slide-in detail drawer that opens when a row is clicked
4. The `SceneAudioSourcesCard` moved below the table as a collapsible panel

### New files
- `src/pages/games/GamesTable.jsx` — the table + toolbar
- `src/pages/games/GameDetailDrawer.jsx` — the right-side panel

### Modified files
- `src/pages/games/GamesPageBody.jsx` — wire new layout
- `src/App.css` — table + drawer CSS

### State changes
GamesPage already has `editGameModal` state which loads scene audio sources on open.
The drawer will reuse this pattern: clicking a row calls `openEditModal(game)` to populate
`editGameModal` (name, sceneAudioSources, loading).

---

## ── DRAFT 2 — Design Detail & Reuse Audit ──────────────────

*Circling back: refining component boundaries, exact CSS, and reuse decisions.*

### Layout shell
```
<div class="page-header">          ← unchanged .page-header (h1 + description)
<div class="games-page-layout">    ← new flex column
  <div class="games-toolbar">      ← filter tabs + search
  <div class="games-content">      ← flex row: table | drawer
    <div class="games-table-wrap"> ← flex-1, overflow-y auto
    <div class="game-detail-drawer [open]"> ← 380px, slide in/out
  <div class="games-audio-footer"> ← collapsible SceneAudioSourcesCard
```

### Table columns (exact)
| Col | Width | Content |
|-----|-------|---------|
| Toggle | 44px | `.toggle` (reuse existing class from App.css — exact same element as GameList) |
| Icon | 44px | 28×28 colored avatar (first letter, color from palette hash) |
| Name | flex-1 | `font-weight: 500` primary text |
| Scene | 180px | muted 11px, truncated |
| Status | 80px | `.badge .badge-success` or `.badge .badge-muted` (reuse existing badge classes) |
| Clips | 60px | tabular-nums, muted |
| Last Active | 100px | muted 11px |
| Actions | 64px | two `.btn-icon` (Edit2 + Trash2 from lucide — same as current GameList.jsx) |

**Row interaction:**
- Hover → `var(--bg-hover)` background (same as `.list-item:hover`)
- Selected → `var(--accent-muted)` background + `1px solid var(--accent-dim)` border on left (4px
  left border stripe — inspired by Settings bento active ring)
- Click row body → open drawer (calls existing `openEditModal(game)`)
- Click toggle → `toggleGame(id)` with `e.stopPropagation()`
- Click edit icon → `openEditModal(game)` (opens full EditGameModal, same as before)
- Click delete icon → `removeGame(id)` (same as before)

### Toolbar row
```jsx
<div className="games-toolbar">
  <div className="filter-tabs">
    <button className={`filter-tab ${filter==='all'?'active':''}`}>All (6)</button>
    <button className={`filter-tab ${filter==='enabled'?'active':''}`}>Enabled (4)</button>
    <button className={`filter-tab ${filter==='disabled'?'active':''}`}>Disabled (2)</button>
  </div>
  <div className="games-toolbar-right">
    <div className="search-wrap">…</div>  ← reuse .search-box pattern from viewer.css
    <button className="btn btn-primary btn-sm">+ Add Game</button>
  </div>
</div>
```

Filter tab active style: `background: var(--accent-muted); border-color: var(--accent); color: var(--accent-light)` — same as `.chip.active` in Settings page pills.

### Drawer
The drawer is positioned as a sibling to the table inside `games-content` (NOT `position:fixed`) so
it pushes the table width, avoiding z-index overlaps with existing modals/dropdowns.

```css
.game-detail-drawer {
  width: 0; overflow: hidden; flex-shrink: 0;
  border-left: 0px solid var(--border);
  background: var(--bg-secondary);
  transition: width 0.22s ease, border-left-width 0.22s ease;
  display: flex; flex-direction: column;
}
.game-detail-drawer.open {
  width: 380px; border-left-width: 1px;
}
```

**Drawer content:**
- Header: 40px avatar + game name + status badge + X close button
  (avatar uses same palette-hashed color as table row)
- Config section: 2×2 info grid (Selector, Scene, Clips, Last Active) — same `.form-group`-ish
  `--bg-tertiary` cells seen in Prototype 4
- Audio Sources section: loads from `editGameModal.sceneAudioSources` (same data as EditGameModal's
  audio tab). Shows `SceneAudioSourcesSection` component which already exists and is fully reusable.
- Track routing: use existing track chip rendering from `SceneAudioSourcesCard` — extract as
  `TrackChips` sub-component
- Footer actions: "Edit Game" button (opens full `EditGameModal`) + danger remove button

**Loading state:** While `editGameModal.loading === true`, show a spinner in the audio section
(reuse `RefreshCw` with `.spinning` class, same as AudioSourcesCard).

### SceneAudioSourcesCard placement
Move to a collapsible section below the table. Add a toggle button in its card-header:
```
[Scene Audio Sources ▼]    collapsed by default
```
State: `const [audioExpanded, setAudioExpanded] = useState(false)` in GamesPageBody.

### CSS additions to App.css (new classes only)
```css
.games-page-layout       /* flex col, flex:1, min-height:0, overflow:hidden */
.games-toolbar           /* flex row, padding, border-bottom, flex-shrink:0 */
.games-toolbar-right     /* flex row, gap, ml-auto */
.filter-tabs             /* flex row, border, border-radius, overflow:hidden */
.filter-tab              /* padding, font-size, border-left on siblings */
.filter-tab.active       /* accent-muted bg, accent border, accent-light text */
.games-content           /* flex row, flex:1, overflow:hidden */
.games-table-wrap        /* flex:1, overflow-y:auto */
.games-table             /* width:100%, border-collapse:collapse */
.games-table thead th    /* sticky, uppercase, muted, border-bottom */
.games-table tbody tr    /* hover bg-hover, selected accent-muted + left border */
.games-table td          /* font-size 12px, vertical-align middle */
.game-detail-drawer      /* width:0 collapsed, transition */
.game-detail-drawer.open /* width:380px */
.drawer-header           /* flex, padding, border-bottom */
.drawer-avatar           /* 40×40 rounded, colored */
.drawer-body             /* flex-1, overflow-y auto, padding */
.drawer-section          /* margin-bottom 18px */
.drawer-section-title    /* 10px uppercase muted label */
.drawer-info-grid        /* 2-col grid for config cells */
.drawer-info-cell        /* bg-tertiary, padding, border-radius */
.games-audio-section     /* margin-top, overflow hidden, max-height transition */
```

---

## ── DRAFT 3 — Final Plan (Production-Ready) ─────────────────

*Third pass: sharpening edge cases, precise file diffs, exact component API.*

### Context
The current `GamesPageBody.jsx` is a thin wrapper that renders two cards side by side in a
`.page-body` div. `GamesPage.jsx` owns all state and passes ~20 props down. The redesign:
- Keeps `GamesPage.jsx` as the orchestrator **unchanged** (all hooks, state, IPC stay the same)
- Replaces `GamesPageBody.jsx` with a new layout
- Adds two new components: `GamesTable.jsx` and `GameDetailDrawer.jsx`
- Adds one new isolated hook: `useGamesFilter.js` (search + filter derived state)
- Adds CSS to `App.css`

---

### New hook: `src/hooks/useGamesFilter.js`
```js
// Follows pattern of other hooks in /hooks/
export function useGamesFilter(games) {
  const [filter, setFilter]   = useState('all')   // 'all' | 'enabled' | 'disabled'
  const [search, setSearch]   = useState('')

  const filtered = useMemo(() => games.filter(g => {
    const matchFilter =
      filter === 'all'      ? true :
      filter === 'enabled'  ? g.enabled :
                              !g.enabled
    const matchSearch = !search ||
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      g.selector.toLowerCase().includes(search.toLowerCase())
    return matchFilter && matchSearch
  }), [games, filter, search])

  const counts = useMemo(() => ({
    all:      games.length,
    enabled:  games.filter(g => g.enabled).length,
    disabled: games.filter(g => !g.enabled).length,
  }), [games])

  return { filter, setFilter, search, setSearch, filtered, counts }
}
```

---

### `src/pages/games/GamesPageBody.jsx` — full replacement

```jsx
import { useState } from 'react'
import { GamesTable } from './GamesTable'
import { GameDetailDrawer } from './GameDetailDrawer'
import SceneAudioSourcesCard from './SceneAudioSourcesCard'
import { useGamesFilter } from '../../hooks/useGamesFilter'
import { ChevronDown } from 'lucide-react'

export function GamesPageBody({ games, openEditModal, /* ...all existing props */ }) {
  const { filter, setFilter, search, setSearch, filtered, counts } = useGamesFilter(games)
  const [drawerGameId, setDrawerGameId]   = useState(null)  // game id for drawer
  const [audioExpanded, setAudioExpanded] = useState(true)  // SceneAudioSourcesCard open

  // Drawer opens by calling openEditModal (loads sceneAudioSources) AND tracking which row
  function handleRowClick(game) {
    setDrawerGameId(game.id)
    openEditModal(game)   // reuse existing: sets editGameModal + loads scene audio async
  }

  function handleDrawerClose() {
    setDrawerGameId(null)
    // Don't call setEditGameModal(null) — EditGameModal may still be open separately
  }

  return (
    <div className="games-page-layout">
      {/* Toolbar: filter tabs + search + add */}
      <GamesToolbar
        filter={filter} setFilter={setFilter}
        search={search} setSearch={setSearch}
        counts={counts}
        onAdd={openAddModal}
      />

      {/* Main content: table + optional drawer */}
      <div className="games-content">
        <div className="games-table-wrap">
          <GamesTable
            games={filtered}
            selectedId={drawerGameId}
            onRowClick={handleRowClick}
            onToggle={toggleGame}
            onEdit={openEditModal}       // opens full EditGameModal (existing behavior)
            onDelete={removeGame}
          />
        </div>
        <GameDetailDrawer
          gameId={drawerGameId}
          editGameModal={editGameModal}  // from useGameWatcherState, has sceneAudioSources
          onClose={handleDrawerClose}
          onEditFull={openEditModal}     // opens full EditGameModal
          onDelete={removeGame}
          onToggle={toggleGame}
          trackData={trackData}
          trackLoading={trackLoading}
          trackLabels={trackLabels}
          onToggleTrack={toggleTrack}
        />
      </div>

      {/* Collapsible audio section */}
      <div className="games-audio-section">
        <button
          className="games-audio-toggle"
          onClick={() => setAudioExpanded(e => !e)}
        >
          Scene Audio Sources
          <ChevronDown
            size={14}
            style={{ transform: audioExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </button>
        {audioExpanded && (
          <SceneAudioSourcesCard
            /* ...all existing audio props (unchanged) */
          />
        )}
      </div>
    </div>
  )
}
```

**Key insight:** `drawerGameId` and `editGameModal` are separate concerns. `drawerGameId`
controls which row is highlighted and whether the drawer is visible. `editGameModal` holds
the loaded data. If the user clicks "Edit Game" inside the drawer, `openEditModal(game)` opens
the full `EditGameModal` overlay (existing behavior) while the drawer stays open.

---

### `src/pages/games/GamesTable.jsx`

**Props:** `{ games, selectedId, onRowClick, onToggle, onEdit, onDelete }`

**Icon generation:** Hash function on `game.id` → index into `GAME_PALETTE`
```js
const GAME_PALETTE = ['#7c3aed','#3b82f6','#06b6d4','#6366f1','#8b5cf6','#0ea5e9','#a78bfa','#818cf8','#2dd4bf','#c084fc','#60a5fa','#22d3ee','#4f46e5','#7e22ce','#0284c7','#0891b2']
const getColor = id => GAME_PALETTE[
  id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % GAME_PALETTE.length
]
```
If `game.icon_path` exists, render `<img>` instead of letter (same pattern as current `GameList.jsx`).

**Empty state:** Reuse `.empty-state` class:
```jsx
<tr><td colSpan={8}>
  <div className="empty-state">
    <Gamepad2 size={32} />
    <p>{search ? 'No games match your search' : 'No games added yet'}</p>
    {!search && <button className="btn btn-primary btn-sm">Add your first game</button>}
  </div>
</td></tr>
```

**Column: Last Active** — the `game` object currently doesn't carry a "last active" timestamp.
Either (a) derive it from recordings via a count API or (b) show "N clips" instead.
→ **Decision: show clip count in a combined cell ("24 clips"), remove Last Active column for now.**
This avoids adding a new API call. Can be added later.

**Sticky header:** Use `position: sticky; top: 0; z-index: 1; background: var(--bg-primary)`.

---

### `src/pages/games/GameDetailDrawer.jsx`

**Props:**
```js
{
  gameId,          // string | null — null = closed
  editGameModal,   // { game, sceneAudioSources, loading } | null — from GamesPage state
  onClose,
  onEditFull,      // () => void — opens EditGameModal
  onDelete,
  onToggle,
  trackData, trackLoading, trackLabels, onToggleTrack,
}
```

**Structure:**
```jsx
<div className={`game-detail-drawer ${gameId ? 'open' : ''}`}>
  {editGameModal && (
    <div className="drawer-inner">
      <div className="drawer-header">
        <div className="drawer-avatar" style={{ background: getColor(game.id) }}>
          {game.icon_path ? <img src="localfile:///…" /> : game.name[0]}
        </div>
        <div>
          <div className="drawer-name">{game.name}</div>
          <div className="drawer-scene">{game.scene || '—'}</div>
        </div>
        <button className="btn-icon" style={{ marginLeft:'auto' }} onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      <div className="drawer-body">
        {/* Config cells */}
        <section className="drawer-section">
          <div className="drawer-section-title">Configuration</div>
          <div className="drawer-info-grid">
            <div className="drawer-info-cell">
              <div className="drawer-info-label">Selector</div>
              <div className="drawer-info-val" style={{ fontFamily:'monospace', fontSize:11 }}>
                {game.selector}
              </div>
            </div>
            <div className="drawer-info-cell">…</div>
          </div>
        </section>

        {/* Per-scene audio sources */}
        <section className="drawer-section">
          <div className="drawer-section-title">Scene Audio Sources</div>
          {editGameModal.loading
            ? <LoadingSpinner />
            : <SceneAudioSourcesSection
                sceneName={game.scene}
                sources={editGameModal.sceneAudioSources}
                masterAudioSources={masterAudioSources}
                trackData={trackData}
                trackLoading={trackLoading}
                trackLabels={trackLabels}
                onAddSource={…}
                onRemoveSource={…}
                onToggleTrack={onToggleTrack}
              />
          }
        </section>

        {/* Footer actions */}
        <div className="drawer-actions">
          <button className="btn btn-primary btn-sm" onClick={() => onEditFull(game)}>
            <Edit2 size={12} /> Edit Game
          </button>
          <button className="toggle on={game.enabled}" onClick={() => onToggle(game.id)}>
            {/* reuse .toggle class from App.css */}
          </button>
          <button className="btn-icon" style={{ color:'var(--danger)' }}
            onClick={() => { onDelete(game.id); onClose(); }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )}
</div>
```

**Re: SceneAudioSourcesSection:** This component already exists at
`src/pages/games/SceneAudioSourcesSection.jsx` and handles per-scene source display with track
chips. The drawer reuses it directly — this is a significant reuse win. The only difference is
we need to pass `onAddSource` and `onRemoveSource` callbacks from `GamesPage.jsx` down through
`GamesPageBody` → `GameDetailDrawer` → `SceneAudioSourcesSection`.

---

### CSS additions to `src/App.css`

```css
/* ── Games Page Layout ── */
.games-page-layout {
  @apply flex-1 flex flex-col overflow-hidden;
}

/* Toolbar */
.games-toolbar {
  @apply flex items-center gap-3 px-8 py-2 flex-shrink-0 border-b border-[var(--border)];
  background: var(--bg-primary);
}
.games-toolbar-right {
  @apply flex items-center gap-2 ml-auto;
}
.filter-tabs {
  @apply flex overflow-hidden border border-[var(--border)] rounded-[var(--radius-sm)];
}
.filter-tab {
  @apply px-3 py-[5px] text-xs font-medium text-[var(--text-secondary)]
         bg-transparent border-none cursor-pointer transition-all duration-[120ms];
}
.filter-tab + .filter-tab {
  @apply border-l border-[var(--border)];
}
.filter-tab:hover {
  @apply bg-[var(--bg-hover)] text-[var(--text-primary)];
}
.filter-tab.active {
  @apply bg-[var(--accent-muted)] text-[var(--accent-light)];
  border-color: inherit; /* don't override sibling border */
}

/* Table + drawer area */
.games-content {
  @apply flex flex-1 overflow-hidden;
}
.games-table-wrap {
  @apply flex-1 overflow-y-auto;
}
.games-table-wrap::-webkit-scrollbar { width: 4px; }
.games-table-wrap::-webkit-scrollbar-thumb {
  background: var(--border-light); border-radius: 2px;
}

/* Table */
.games-table {
  width: 100%;
  border-collapse: collapse;
}
.games-table thead th {
  position: sticky; top: 0; z-index: 1;
  background: var(--bg-primary);
  padding: 8px 12px; text-align: left;
  @apply text-[10px] font-semibold uppercase tracking-[0.05em]
         text-[var(--text-muted)] border-b border-[var(--border)];
  white-space: nowrap;
}
.games-table thead th:first-child { padding-left: 32px; }
.games-table thead th:last-child  { padding-right: 24px; }
.games-table tbody tr {
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s;
}
.games-table tbody tr:hover { background: var(--bg-hover); }
.games-table tbody tr.selected {
  background: var(--accent-muted);
  box-shadow: inset 3px 0 0 var(--accent);
}
.games-table tbody td {
  padding: 9px 12px;
  font-size: 12px;
  vertical-align: middle;
  color: var(--text-secondary);
}
.games-table tbody td:first-child { padding-left: 32px; }
.games-table tbody td:last-child  { padding-right: 24px; }
.games-table-name { @apply text-[var(--text-primary)] font-medium; }
.games-table-scene {
  @apply text-[11px] text-[var(--text-muted)];
  max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Avatar cell */
.games-table-avatar {
  width: 28px; height: 28px;
  @apply rounded-[var(--radius-sm)] flex items-center justify-center
         text-[13px] font-bold text-white flex-shrink-0;
}

/* Drawer */
.game-detail-drawer {
  width: 0; overflow: hidden; flex-shrink: 0;
  background: var(--bg-secondary);
  border-left: 0px solid var(--border);
  display: flex; flex-direction: column;
  transition: width 0.22s ease, border-left-width 0.05s ease;
}
.game-detail-drawer.open {
  width: 380px; min-width: 380px;
  border-left-width: 1px;
}
.drawer-inner {
  width: 380px; display: flex; flex-direction: column; height: 100%; overflow: hidden;
}
.drawer-header {
  @apply flex items-start gap-3 p-4 flex-shrink-0 border-b border-[var(--border)];
}
.drawer-avatar {
  width: 40px; height: 40px;
  @apply rounded-[var(--radius-md)] flex items-center justify-center
         text-[20px] font-bold text-white flex-shrink-0 overflow-hidden;
}
.drawer-name { @apply text-[15px] font-semibold text-[var(--text-primary)]; }
.drawer-scene { @apply text-[11px] text-[var(--text-muted)] mt-0.5; }
.drawer-body {
  @apply flex-1 overflow-y-auto p-4;
}
.drawer-body::-webkit-scrollbar { width: 3px; }
.drawer-body::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 2px; }
.drawer-section { @apply mb-5; }
.drawer-section-title {
  @apply text-[10px] font-semibold uppercase tracking-[0.07em]
         text-[var(--text-muted)] mb-2;
}
.drawer-info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.drawer-info-cell {
  @apply p-2 bg-[var(--bg-tertiary)] rounded-[var(--radius-sm)];
}
.drawer-info-label {
  @apply text-[9px] text-[var(--text-muted)] uppercase tracking-[0.05em] mb-0.5;
}
.drawer-info-val { @apply text-[12px] font-medium text-[var(--text-primary)]; }
.drawer-actions {
  @apply flex items-center gap-2 pt-3 border-t border-[var(--border)];
}

/* Collapsible audio section */
.games-audio-section {
  @apply flex-shrink-0 border-t border-[var(--border)] bg-[var(--bg-primary)];
}
.games-audio-toggle {
  @apply flex items-center justify-between w-full px-8 py-3
         text-[12px] font-semibold text-[var(--text-secondary)]
         bg-transparent border-none cursor-pointer;
  transition: color 0.15s;
}
.games-audio-toggle:hover { @apply text-[var(--text-primary)]; }
```

---

### Files summary

| File | Action | Notes |
|------|--------|-------|
| `src/pages/games/GamesPageBody.jsx` | Rewrite | New layout shell, add useGamesFilter, drawer state |
| `src/pages/games/GamesTable.jsx` | Create | Table + toolbar as separate component |
| `src/pages/games/GameDetailDrawer.jsx` | Create | Slide-in drawer, reuses SceneAudioSourcesSection |
| `src/hooks/useGamesFilter.js` | Create | search + filter derived state |
| `src/App.css` | Append | ~80 lines of new CSS classes |
| `src/pages/GamesPage.jsx` | **Unchanged** | All state/hooks/IPC unchanged |
| `src/pages/games/GameList.jsx` | **Unused** | Superseded by GamesTable, keep for reference |
| `src/pages/games/SceneAudioSourcesCard.jsx` | **Unchanged** | Still used in collapsible footer |
| `src/pages/games/SceneAudioSourcesSection.jsx` | **Unchanged** | Reused inside GameDetailDrawer |
| `src/pages/games/EditGameModal.jsx` | **Unchanged** | Still opens from drawer + edit button |
| All hooks in `src/hooks/` | **Unchanged** | All state management preserved |

---

### Prop flow diagram
```
GamesPage.jsx (all state, IPC, hooks)
  └── GamesPageBody.jsx (layout + useGamesFilter + drawer state)
        ├── GamesTable.jsx
        │     props: games(filtered), selectedId, onRowClick, onToggle, onEdit, onDelete
        ├── GameDetailDrawer.jsx
        │     props: gameId, editGameModal, onClose, onEditFull, onDelete, onToggle,
        │            trackData, trackLoading, trackLabels, onToggleTrack,
        │            masterAudioSources, onAddSource, onRemoveSource
        │     reuses: SceneAudioSourcesSection (internal)
        └── SceneAudioSourcesCard.jsx (collapsible footer)
              props: all existing audio props (unchanged)
```

---

### Edge cases & decisions

1. **Drawer stays open after toggle/delete?**
   Toggle: keeps drawer open, badge updates reactively.
   Delete: `onDelete` + `handleDrawerClose()` called together.

2. **editGameModal mismatch?**
   `drawerGameId` tracks which row is visually selected. `editGameModal.game.id` holds
   the loaded data. These should always match; if user clicks a different row while drawer
   is open, `handleRowClick(newGame)` updates both simultaneously.

3. **Drawer width on small screens?**
   `games-content` is `overflow: hidden`. If viewport is narrow (<860px), drawer pushes
   table to near-zero width. Acceptable for Electron; add a media query at 800px to hide
   drawer and use the full EditGameModal instead if needed later.

4. **Empty search state:**
   When search is active and no results, show empty state inside `<tbody>` with "No games
   match your search" (using `.empty-state` class). "Clear search" button sets `setSearch('')`.

5. **Disabled games styling in table:**
   Disabled rows get `opacity: 0.65` on the name/scene cells only (not the toggle or actions).

6. **SceneAudioSourcesSection requires addSource/removeSource callbacks:**
   These are `addSourceToScene` and `removeSourceFromScene` defined in `GamesPage.jsx` and
   currently passed only to `EditGameModal`. Add them to the `GamesPageBody` prop list and
   thread through to `GameDetailDrawer`.

---

### Verification
1. Open app → Games page shows table with filter tabs and search working
2. Click a game row → drawer slides in (380px), table narrows, row highlighted with purple stripe
3. Drawer shows: game config cells, scene audio sources (loaded async with spinner), track chips
4. Toggle in table row → game enabled state updates, badge in drawer also updates
5. Click "Edit Game" in drawer → full `EditGameModal` opens on top (existing behavior)
6. Click X in drawer → drawer closes, table returns to full width
7. Scene Audio Sources section below table: collapsible chevron toggles visibility
8. Add Game button → opens `AddGameModal` (existing behavior, unchanged)
9. Filter tabs filter correctly, counts are accurate
10. Search filters by game name AND selector text
