import { useCallback, useEffect, useState } from 'react'
import { routes } from '../data'

/** Units the player has chosen to recruit, per route id. Automatic and story joiners aren't stored. */
export type Army = Record<string, string[]>
/** Planned final class per route id, then unit id. */
export type FinalClasses = Record<string, Record<string, string>>

const ARMY_KEY = 'fefw:army'
const CLASSES_KEY = 'fefw:finalClasses'

function perRoute<T>(make: () => T): Record<string, T> {
  return Object.fromEntries(routes.map((r) => [r.id, make()]))
}

function readStored<T>(key: string, make: () => T, valid: (v: unknown) => v is T): Record<string, T> {
  const out = perRoute(make)
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}')
    for (const r of routes) if (valid(raw[r.id])) out[r.id] = raw[r.id]
  } catch {
    // storage unavailable or corrupt: start fresh
  }
  return out
}

function usePersisted<T>(key: string, initial: () => T) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // storage unavailable (private mode): the build just won't persist
    }
  }, [key, value])
  return [value, setValue] as const
}

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isIdMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v != null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string')

export function useArmy() {
  const [army, setArmy] = usePersisted(ARMY_KEY, () => readStored<string[]>(ARMY_KEY, () => [], isIdList))
  const [finalClasses, setFinalClasses] = usePersisted(CLASSES_KEY, () =>
    readStored<Record<string, string>>(CLASSES_KEY, () => ({}), isIdMap),
  )

  const toggle = useCallback((route: string, unit: string) => {
    setArmy((a) => ({
      ...a,
      [route]: a[route].includes(unit) ? a[route].filter((u) => u !== unit) : [...a[route], unit],
    }))
  }, [setArmy])

  const clear = useCallback((route?: string) => {
    setArmy((a) => (route ? { ...a, [route]: [] } : perRoute<string[]>(() => [])))
  }, [setArmy])

  /** An empty class id clears the plan for that copy. */
  const setFinalClass = useCallback((route: string, unit: string, cls: string) => {
    setFinalClasses((c) => {
      const next = { ...c[route] }
      if (cls) next[unit] = cls
      else delete next[unit]
      return { ...c, [route]: next }
    })
  }, [setFinalClasses])

  return { army, toggle, clear, finalClasses, setFinalClass }
}
