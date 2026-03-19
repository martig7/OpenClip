import { createContext, useContext, useState } from 'react'

const SettingsNavGuardContext = createContext({
  guard: null,
  setGuard: () => {},
})

export function SettingsNavGuardProvider({ children }) {
  const [guard, setGuard] = useState(null)
  return (
    <SettingsNavGuardContext.Provider value={{ guard, setGuard }}>
      {children}
    </SettingsNavGuardContext.Provider>
  )
}

export function useSettingsNavGuard() {
  return useContext(SettingsNavGuardContext)
}
