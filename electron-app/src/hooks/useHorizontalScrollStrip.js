import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Horizontal overflow strip (e.g. game filter pills): scroll chevrons + smooth scroll.
 * `remountKey` should change when strip contents or width context changes so we re-measure.
 */
export function useHorizontalScrollStrip(remountKey) {
  const scrollRef = useRef(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  const scrollBy = useCallback((dir) => {
    const el = scrollRef.current
    if (el) el.scrollBy({ left: dir * 80, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    updateScrollState()
  }, [remountKey, updateScrollState])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => updateScrollState())
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateScrollState])

  return { scrollRef, canScrollLeft, canScrollRight, updateScrollState, scrollBy }
}
