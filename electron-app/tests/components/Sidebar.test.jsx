// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import Sidebar from '../../src/viewer/components/Sidebar.jsx'

// Fixed timestamp: 2025-01-15 12:00:00 UTC (avoids flaky bucket assignments at day boundaries)
const NOW = 1736942400

beforeAll(() => { vi.useFakeTimers({ now: NOW * 1000 }) })
afterAll(() => { vi.useRealTimers() })
const HOUR = 3600
const DAY  = 86_400

function makeItem({ filename, game_name = 'Halo', mtime = NOW - HOUR, size_bytes = 1_000_000, path }) {
  return {
    path: path ?? `/recordings/${filename}`,
    filename,
    game_name,
    date: '2025-01-15',
    size_bytes,
    size_formatted: `${(size_bytes / 1_000_000).toFixed(1)} MB`,
    mtime,
  }
}

// Items with realistic mtimes for time-bucket grouping
const todayItem    = makeItem({ filename: 'Today.mp4',    mtime: NOW - HOUR })
const thisWeekItem = makeItem({ filename: 'ThisWeek.mp4', mtime: NOW - 3 * DAY })
const olderItem    = makeItem({ filename: 'Older.mp4',    mtime: NOW - 60 * DAY })

// Items for name/size testing (stable mtimes so sort is deterministic)
const alpha = makeItem({ filename: 'Alpha.mp4', mtime: NOW - 1 * HOUR, size_bytes:   500_000 })
const mid   = makeItem({ filename: 'Mid.mp4',   mtime: NOW - 2 * HOUR, size_bytes: 1_000_000 })
const zeta  = makeItem({ filename: 'Zeta.mp4',  mtime: NOW - 3 * HOUR, size_bytes: 2_000_000 })

function renderSidebar(props = {}) {
  return render(
    <Sidebar
      items={[alpha, mid, zeta]}
      selectedItem={null}
      onSelect={() => {}}
      title="Recordings"
      emptyMessage="No recordings"
      {...props}
    />
  )
}

function getItemOrder() {
  return [...document.querySelectorAll('.item-name')].map(el => el.textContent)
}

function getGroupHeaders() {
  return [...document.querySelectorAll('.group-header')].map(el => el.textContent.trim())
}

// ── Default sort ─────────────────────────────────────────────────────────────

describe('Sidebar — default sort (newest first)', () => {
  it('renders a sort dropdown defaulting to Newest first', () => {
    renderSidebar()
    expect(screen.getByRole('combobox', { name: /sort/i }).value).toBe('time-desc')
  })

  it('orders items newest → oldest', () => {
    renderSidebar()
    expect(getItemOrder()).toEqual(['Alpha.mp4', 'Mid.mp4', 'Zeta.mp4'])
  })
})

// ── Time grouping ─────────────────────────────────────────────────────────────

describe('Sidebar — time sort groups by period', () => {
  it('groups today/this-week/older items into separate buckets', () => {
    renderSidebar({ items: [todayItem, thisWeekItem, olderItem] })
    const headers = getGroupHeaders()
    expect(headers.some(h => h.startsWith('Today'))).toBe(true)
    expect(headers.some(h => h.startsWith('This Week'))).toBe(true)
    expect(headers.some(h => h.startsWith('Older'))).toBe(true)
  })

  it('does NOT group by game name when time-sorted', () => {
    const haloToday = makeItem({ filename: 'Halo.mp4',  game_name: 'Halo', mtime: NOW - HOUR })
    const csToday   = makeItem({ filename: 'CS.mp4',    game_name: 'CS',   mtime: NOW - 2 * HOUR, path: '/cs' })
    renderSidebar({ items: [haloToday, csToday] })
    const headers = getGroupHeaders()
    expect(headers.some(h => h.startsWith('Today'))).toBe(true)
    expect(headers.every(h => h !== 'Halo (1)' && h !== 'CS (1)')).toBe(true)
  })

  it('shows game name in item meta when not grouping by game', () => {
    const haloToday = makeItem({ filename: 'Halo.mp4', game_name: 'Halo', mtime: NOW - HOUR })
    renderSidebar({ items: [haloToday] })
    expect(screen.getByText('Halo')).toBeInTheDocument()
  })

  it('time-desc: Today group appears before Older group', () => {
    renderSidebar({ items: [todayItem, olderItem] })
    const headers = getGroupHeaders()
    const todayIndex = headers.findIndex(h => h.startsWith('Today'))
    const olderIndex = headers.findIndex(h => h.startsWith('Older'))
    expect(todayIndex).not.toBe(-1)
    expect(olderIndex).not.toBe(-1)
    expect(todayIndex).toBeLessThan(olderIndex)
  })

  it('time-asc: Older group appears before Today group', () => {
    renderSidebar({ items: [todayItem, olderItem] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'time-asc' } })
    const headers = getGroupHeaders()
    const olderIndex = headers.findIndex(h => h.startsWith('Older'))
    const todayIndex = headers.findIndex(h => h.startsWith('Today'))
    expect(olderIndex).not.toBe(-1)
    expect(todayIndex).not.toBe(-1)
    expect(olderIndex).toBeLessThan(todayIndex)
  })
})

// ── Name sort — still groups by game ─────────────────────────────────────────

describe('Sidebar — name sort groups by game', () => {
  it('name-asc groups by game name', () => {
    const halo = makeItem({ filename: 'Halo.mp4', game_name: 'Halo', path: '/halo' })
    const cs   = makeItem({ filename: 'CS.mp4',   game_name: 'CS',   path: '/cs' })
    renderSidebar({ items: [halo, cs] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'name-asc' } })
    const headers = getGroupHeaders()
    expect(headers.some(h => h.includes('Halo'))).toBe(true)
    expect(headers.some(h => h.includes('CS'))).toBe(true)
  })

  it('name-asc sorts items alphabetically within each group', () => {
    renderSidebar()
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'name-asc' } })
    expect(getItemOrder()).toEqual(['Alpha.mp4', 'Mid.mp4', 'Zeta.mp4'])
  })

  it('name-desc sorts items reverse-alphabetically within each group', () => {
    renderSidebar()
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'name-desc' } })
    expect(getItemOrder()).toEqual(['Zeta.mp4', 'Mid.mp4', 'Alpha.mp4'])
  })

  it('does NOT show game name in item meta when grouping by game', () => {
    renderSidebar()
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'name-asc' } })
    // No .item-meta span should contain the game name — it's already in the group header
    const metaGameSpans = [...document.querySelectorAll('.item-meta span')]
      .filter(el => el.textContent.includes('Halo'))
    expect(metaGameSpans).toHaveLength(0)
  })
})

// ── Size grouping ─────────────────────────────────────────────────────────────

describe('Sidebar — size sort groups by size range', () => {
  const huge   = makeItem({ filename: 'Huge.mp4',   size_bytes: 15 * 1_073_741_824, path: '/huge' })
  const large  = makeItem({ filename: 'Large.mp4',  size_bytes:  2 * 1_073_741_824, path: '/large' })
  const medium = makeItem({ filename: 'Medium.mp4', size_bytes:    500_000_000,      path: '/medium' })
  const small  = makeItem({ filename: 'Small.mp4',  size_bytes:     50_000_000,      path: '/small' })

  it('size-desc: groups items into correct size buckets', () => {
    renderSidebar({ items: [huge, large, medium, small] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'size-desc' } })
    const headers = getGroupHeaders()
    expect(headers.some(h => h.startsWith('Huge'))).toBe(true)
    expect(headers.some(h => h.startsWith('Large'))).toBe(true)
    expect(headers.some(h => h.startsWith('Medium'))).toBe(true)
    expect(headers.some(h => h.startsWith('Small'))).toBe(true)
  })

  it('size-desc: Huge bucket appears before Small bucket', () => {
    renderSidebar({ items: [huge, small] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'size-desc' } })
    const headers = getGroupHeaders()
    const hugeIndex = headers.findIndex(h => h.startsWith('Huge'))
    const smallIndex = headers.findIndex(h => h.startsWith('Small'))
    expect(hugeIndex).not.toBe(-1)
    expect(smallIndex).not.toBe(-1)
    expect(hugeIndex).toBeLessThan(smallIndex)
  })

  it('size-asc: Small bucket appears before Huge bucket', () => {
    renderSidebar({ items: [huge, small] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'size-asc' } })
    const headers = getGroupHeaders()
    const smallIndex = headers.findIndex(h => h.startsWith('Small'))
    const hugeIndex = headers.findIndex(h => h.startsWith('Huge'))
    expect(smallIndex).not.toBe(-1)
    expect(hugeIndex).not.toBe(-1)
    expect(smallIndex).toBeLessThan(hugeIndex)
  })

  it('size-desc: items within a bucket ordered largest first', () => {
    const big   = makeItem({ filename: 'Big.mp4',   size_bytes: 3 * 1_073_741_824, path: '/big' })
    const small2 = makeItem({ filename: 'Small2.mp4', size_bytes: 1_073_741_824,    path: '/small2' })
    renderSidebar({ items: [small2, big] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'size-desc' } })
    const order = getItemOrder()
    expect(order.indexOf('Big.mp4')).toBeLessThan(order.indexOf('Small2.mp4'))
  })
})

// ── Search + sort interaction ─────────────────────────────────────────────────

describe('Sidebar — search filters before sort/group', () => {
  it('filtered results are still grouped correctly', () => {
    renderSidebar({ items: [todayItem, thisWeekItem, olderItem] })
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'Today' } })
    const headers = getGroupHeaders()
    expect(headers.some(h => h.startsWith('Today'))).toBe(true)
    expect(headers.every(h => !h.startsWith('Older'))).toBe(true)
  })
})

// ── Unorganized items ─────────────────────────────────────────────────────────

describe('Sidebar — unorganized item styling', () => {
  it('unorganized items have amber card class regardless of sort mode', () => {
    const unorg = makeItem({ filename: 'Raw.mp4', game_name: '(Unorganized)', mtime: NOW - HOUR, path: '/raw' })
    renderSidebar({ items: [unorg] })
    expect(document.querySelector('.item-card--unorganized')).toBeInTheDocument()
  })

  it('name sort: (Unorganized) group header has amber class', () => {
    const unorg = makeItem({ filename: 'Raw.mp4', game_name: '(Unorganized)', mtime: NOW - HOUR, path: '/raw' })
    renderSidebar({ items: [unorg] })
    fireEvent.change(screen.getByRole('combobox', { name: /sort/i }), { target: { value: 'name-asc' } })
    expect(document.querySelector('.group-header--unorganized')).toBeInTheDocument()
  })

  it('time sort: no amber group header (unorganized items are in time buckets)', () => {
    const unorg = makeItem({ filename: 'Raw.mp4', game_name: '(Unorganized)', mtime: NOW - HOUR, path: '/raw' })
    renderSidebar({ items: [unorg] })
    // Default is time-desc
    expect(document.querySelector('.group-header--unorganized')).not.toBeInTheDocument()
  })
})
