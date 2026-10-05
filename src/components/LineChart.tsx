import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface Series {
  color: string
  /** [x index, value] pairs; a unit that joins late simply starts later. */
  points: [number, number][]
  dashed?: boolean
}

/**
 * Lines over the story's chapters, one x position per chapter. `groups` names the part each chapter belongs to
 * (a rule and a label where it changes), `refs` are dotted horizontal guides, and `band` shades a range of chapters.
 * Hovering shows a crosshair and `tip(i)` for the nearest chapter.
 */
export function LineChart({
  label, xLabels, groups, y0, y1, ticks, series, refs = [], band, tip, height = 240,
}: {
  label: string
  xLabels: string[]
  groups: string[]
  y0: number
  y1: number
  ticks: number[]
  series: Series[]
  refs?: { value: number; label: string }[]
  band?: [number, number]
  tip: (i: number) => ReactNode
  height?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  useEffect(() => {
    const el = box.current!
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const W = Math.max(260, width), H = height
  const m = { t: 24, r: 14, b: 26, l: 34 }
  const n = xLabels.length, iw = W - m.l - m.r, ih = H - m.t - m.b
  const gap = n > 1 ? iw / (n - 1) : iw
  const x = (i: number) => m.l + (n === 1 ? iw / 2 : i * gap)
  const y = (v: number) => m.t + ih - ((v - y0) / (y1 - y0)) * ih
  const step = Math.ceil(n / Math.max(1, Math.floor(iw / 26)))
  const move = (clientX: number, clientY: number) => {
    const b = box.current!.getBoundingClientRect()
    const i = Math.max(0, Math.min(n - 1, Math.round((clientX - b.left - m.l) / gap)))
    setHover({ i, x: clientX - b.left, y: clientY - b.top })
  }

  return (
    <div ref={box} className="relative min-w-0">
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block text-[11px]">
          {band && <rect x={x(band[0]) - gap / 2} width={(band[1] - band[0] + 1) * gap} y={m.t} height={ih} fill="var(--surface-2)" />}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
              <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fill="var(--muted)" className="tabular">{t}</text>
            </g>
          ))}
          {groups.map((g, i) => (i === 0 || g !== groups[i - 1]) && (
            <g key={i}>
              {i > 0 && <line x1={x(i) - gap / 2} x2={x(i) - gap / 2} y1={m.t - 12} y2={m.t + ih} stroke="var(--muted)" strokeOpacity={0.5} />}
              <text x={i ? x(i) - gap / 2 + 6 : m.l} y={m.t - 10} fill="var(--ink)" fontWeight={500}>{g}</text>
            </g>
          ))}
          {xLabels.map((l, i) => i % step === 0 && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fill="var(--muted)" className="tabular">{l}</text>)}
          {refs.map((r) => (
            <g key={r.label}>
              <line x1={m.l} x2={W - m.r} y1={y(r.value)} y2={y(r.value)} stroke="var(--muted)" strokeDasharray="2 4" />
              <text x={W - m.r} y={y(r.value) - 4} textAnchor="end" fill="var(--muted)">{r.label}</text>
            </g>
          ))}
          {series.map((s, k) => s.points.length > 0 && (
            <g key={k}>
              <path
                d={s.points.map((p, j) => `${j ? 'L' : 'M'}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join('')}
                fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '4 4' : undefined}
              />
              {s.points.length === 1 && <circle cx={x(s.points[0][0])} cy={y(s.points[0][1])} r={4} fill={s.color} />}
            </g>
          ))}
          {hover && (
            <g>
              <line x1={x(hover.i)} x2={x(hover.i)} y1={m.t} y2={m.t + ih} stroke="var(--muted)" />
              {series.map((s, k) => {
                const p = s.points.find((q) => q[0] === hover.i)
                return p && <circle key={k} cx={x(hover.i)} cy={y(p[1])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              })}
            </g>
          )}
          <rect
            x={m.l} y={m.t} width={iw} height={ih} fill="transparent"
            onPointerMove={(e) => move(e.clientX, e.clientY)} onPointerDown={(e) => move(e.clientX, e.clientY)} onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[18rem] rounded-md border border-line bg-surface px-2.5 py-2 text-xs shadow-lg"
          style={{ top: Math.max(0, hover.y - 10), ...(hover.x > W / 2 ? { right: W - hover.x + 14 } : { left: hover.x + 14 }) }}
        >
          {tip(hover.i)}
        </div>
      )}
    </div>
  )
}

/** One row of a chart tooltip: a colour key, a label and its value. */
export function TipRow({ label, value, color }: { label: ReactNode; value: ReactNode; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        {color && <i className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />}
        {label}
      </span>
      <span className="tabular font-medium">{value}</span>
    </div>
  )
}

/** A chart's legend: what each colour is. */
export function Legend({ items }: { items: { label: ReactNode; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-muted">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-[3px]" style={it.dashed ? { border: `1px dashed ${it.color}` } : { background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
