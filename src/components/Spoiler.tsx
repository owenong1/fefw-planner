import { useState, type ReactNode } from 'react'
import { SPOILER_LABELS } from '../lib/display'
import { useSettings } from '../lib/settings'

export function SpoilerToggle() {
  const { spoilerLevel, setSpoilerLevel } = useSettings()
  return (
    <label className="shrink-0 text-xs text-muted">
      <span className="sr-only">Spoilers</span>
      <select
        value={spoilerLevel}
        onChange={(e) => setSpoilerLevel(Number(e.target.value))}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
        title="Units that join in Part II/III, secret characters, and Master and Divine classes are hidden unless you allow spoilers"
      >
        {SPOILER_LABELS.map((l, i) => (
          <option key={l} value={i}>{l}</option>
        ))}
      </select>
    </label>
  )
}

/** Covers spoiler content until the reader opts in, for pages reached by direct link. */
export function SpoilerGate({ level, reason, children }: { level: number; reason?: string; children: ReactNode }) {
  const { spoilerLevel } = useSettings()
  const [revealed, setRevealed] = useState(false)
  if (level <= spoilerLevel || revealed) return <>{children}</>
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none blur-md select-none">{children}</div>
      <div className="absolute inset-0 flex items-start justify-center pt-24">
        <div className="max-w-sm rounded-xl border border-line bg-surface p-5 text-center shadow-lg">
          <p className="font-semibold">Story spoiler</p>
          <p className="mt-1 text-sm text-muted">
            {reason ?? (level === 1 ? 'This unit joins in Part II or III.' : 'This is a secret character.')}
          </p>
          <button onClick={() => setRevealed(true)} className="mt-3 rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink">
            Show anyway
          </button>
        </div>
      </div>
    </div>
  )
}
