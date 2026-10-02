import { STAT_KEYS, STAT_LABELS } from '../data/constants'
import type { Stats } from '../data/schema'
import { growthColor } from '../lib/display'

export function GrowthBars({ growths, base, compareTo }: { growths: Stats; base?: Stats; compareTo?: Stats }) {
  return (
    <div className="grid gap-1.5">
      {STAT_KEYS.map((k) => {
        const v = growths[k]
        const delta = compareTo ? v - compareTo[k] : 0
        return (
          <div key={k} className="grid grid-cols-[2.5rem_1fr_3.5rem] items-center gap-2 text-sm">
            <span className="text-xs font-semibold text-muted">{STAT_LABELS[k]}</span>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(v, 100))}%`, background: growthColor(v) }} />
            </div>
            <span className="tabular text-right font-semibold">
              {v}%
              {delta !== 0 && (
                <span className={`ml-1 text-xs ${delta > 0 ? 'text-good' : 'text-bad'}`}>
                  {delta > 0 ? '+' : ''}
                  {delta}
                </span>
              )}
              {base && <span className="sr-only"> base {base[k]}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function StatRow({ stats, signed = false, colorize = false }: { stats: Stats; signed?: boolean; colorize?: boolean }) {
  return (
    <>
      {STAT_KEYS.map((k) => {
        const v = stats[k]
        const tone = colorize ? (v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-muted') : ''
        return (
          <td key={k} className={`tabular px-2 py-2 text-right ${tone}`}>
            {signed && v > 0 ? '+' : ''}
            {v}
          </td>
        )
      })}
    </>
  )
}

export function StatHeaders({ onSort, sortKey, dir }: { onSort?: (k: StatKey | 'total') => void; sortKey?: string; dir?: 'asc' | 'desc' }) {
  return (
    <>
      {STAT_KEYS.map((k) => (
        <th key={k} className="px-2 py-2 text-right" aria-sort={sortKey === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
          {onSort ? (
            <button onClick={() => onSort(k)} className="font-semibold hover:text-ink">
              {STAT_LABELS[k]}
              {sortKey === k && (dir === 'asc' ? ' ▲' : ' ▼')}
            </button>
          ) : (
            STAT_LABELS[k]
          )}
        </th>
      ))}
    </>
  )
}

type StatKey = (typeof STAT_KEYS)[number]
