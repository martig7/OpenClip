import { useMemo, useState } from 'react'

/** Toolbar filter + search; returns filtered list and tab counts. */
export function useGamesFilter(games) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase()

    return (games || []).filter((g) => {
      const matchFilter =
        filter === 'all' ? true : filter === 'enabled' ? !!g?.enabled : !g?.enabled

      if (!q) return matchFilter

      const name = (g?.name || '').toLowerCase()
      const selector = (g?.selector || '').toLowerCase()
      const matchSearch = name.includes(q) || selector.includes(q)

      return matchFilter && matchSearch
    })
  }, [games, filter, search])

  const counts = useMemo(() => {
    const all = (games || []).length
    const enabled = (games || []).filter((g) => !!g?.enabled).length
    const disabled = all - enabled
    return { all, enabled, disabled }
  }, [games])

  return { filter, setFilter, search, setSearch, filtered, counts }
}

