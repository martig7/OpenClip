import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const TitleBarOverlayContext = createContext({
  overlayOverride: null,
  setTitleBarOverlayOverride: () => {},
})

export function TitleBarOverlayProvider({ children }) {
  const [overlayOverride, setOverlayState] = useState(null)
  const setTitleBarOverlayOverride = useCallback((value) => {
    setOverlayState(value)
  }, [])
  const value = useMemo(
    () => ({ overlayOverride, setTitleBarOverlayOverride }),
    [overlayOverride, setTitleBarOverlayOverride]
  )
  return (
    <TitleBarOverlayContext.Provider value={value}>{children}</TitleBarOverlayContext.Provider>
  )
}

export function useTitleBarOverlayOverride() {
  return useContext(TitleBarOverlayContext)
}
