import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { routeById } from '../data'
import { ROUTE_COLOR } from '../lib/display'

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>{children}</section>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted uppercase">{children}</h2>
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'bad'; title?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink',
    accent: 'bg-accent/15 text-accent',
    good: 'bg-good/15 text-good',
    bad: 'bg-bad/15 text-bad',
  }
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  )
}

export function RouteDot({ route }: { route: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: ROUTE_COLOR[route] ?? 'var(--muted)' }} />
}

export function RouteName({ route, link = false }: { route: string; link?: boolean }) {
  const r = routeById.get(route)
  const label = r ? r.name : 'All routes'
  const inner = (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <RouteDot route={route} />
      {label}
    </span>
  )
  return link && r ? <Link to={`/routes/${r.id}`} className="hover:underline">{inner}</Link> : inner
}

/** Unit icons fetched by scripts/import/fetch_portraits.py, keyed by unit id. */
const PORTRAITS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/portraits/*.{webp,png}', { eager: true, query: '?url', import: 'default' }),
  ).map(([path, url]) => [path.replace(/^.*\/|\.\w+$/g, ''), url]),
)

/** The unit's portrait cropped to a circle on its face, or a deterministic initials avatar when there is none. */
export function Avatar({ name, id, size = 40 }: { name: string; id?: string; size?: number }) {
  const portrait = id ? PORTRAITS[id] : undefined
  if (portrait) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full bg-surface-2 bg-no-repeat"
        // Icons are 334×270 in a slanted frame; zoom past the frame and centre on the face.
        style={{ width: size, height: size, backgroundImage: `url(${portrait})`, backgroundSize: '160% auto', backgroundPosition: '32% 22%' }}
      />
    )
  }
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  const initials = name.split(' ').map((p) => p[0]).join('').slice(0, 2)
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `oklch(0.55 0.12 ${h})` }}
    >
      {initials}
    </span>
  )
}

export function Select<T extends string>({
  label, value, onChange, options,
}: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-2 focus:outline-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            value === o.value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>
}
