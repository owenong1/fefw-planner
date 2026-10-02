import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Settings = {
  /** Highest spoiler level shown in lists (0 = Part I only, 1 = + Part II/III recruits, 2 = everything). */
  spoilerLevel: number
  setSpoilerLevel: (n: number) => void
}

const SettingsContext = createContext<Settings | null>(null)
const KEY = 'fefw:spoilerLevel'

function readStored(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isInteger(v) && v >= 0 && v <= 2 ? v : 0
  } catch {
    return 0
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [spoilerLevel, setSpoilerLevel] = useState(readStored)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(spoilerLevel))
    } catch {
      // storage unavailable (private mode): setting just won't persist
    }
  }, [spoilerLevel])
  return <SettingsContext.Provider value={{ spoilerLevel, setSpoilerLevel }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
