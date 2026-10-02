import { canUseClass, classes, classSpoiler } from '../data'
import { CLASS_TIERS } from '../data/constants'
import type { Unit } from '../data/schema'
import { TIER_INFO } from '../lib/display'
import { useSettings } from '../lib/settings'

/**
 * Picks a unit's planned final class from the classes it can use; an empty value means no class.
 * Text is 16px below `md` because iOS Safari zooms the page when a smaller form control takes focus.
 */
export function ClassSelect({
  unit, value, onChange, emptyLabel = 'No class (personal growths)', className = '',
}: { unit: Unit; value: string; onChange: (v: string) => void; emptyLabel?: string; className?: string }) {
  const { spoilerLevel } = useSettings()
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`${unit.name}'s final class`}
      className={`min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-base text-ink md:text-xs focus:outline-2 focus:outline-accent ${className}`}
    >
      <option value="">{emptyLabel}</option>
      {CLASS_TIERS.filter((t) => t !== 'base').map((tier) => {
        // A class picked before spoilers were turned down stays selectable.
        const list = classes.filter(
          (c) => c.tier === tier && canUseClass(unit, c) && (classSpoiler(c) <= spoilerLevel || c.id === value),
        )
        return list.length > 0 && (
          <optgroup key={tier} label={TIER_INFO[tier].label}>
            {list.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
        )
      })}
    </select>
  )
}
