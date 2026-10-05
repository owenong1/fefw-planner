import { useEffect, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { classes, units } from '../data'
import type { Block } from '../sim/client'

const UNIT_ID = new Map(units.map((u) => [u.name, u.id]))
const CLASS_ID = new Map(classes.map((c) => [c.name, c.id]))

function useBlobUrl(text: string, type: string) {
  const url = useMemo(() => URL.createObjectURL(new Blob([text], { type })), [text, type])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return url
}

const BUTTON = 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent'

/** A file the command wrote: the terminal saves it to disk, here it is a download (and a preview, for a page). */
function FileBlock({ name, text }: { name: string; text: string }) {
  const base = name.replace(/^.*[\\/]/, '')
  const html = /\.html?$/i.test(base)
  const type = html ? 'text/html' : /\.csv$/i.test(base) ? 'text/csv' : /\.json$/i.test(base) ? 'application/json' : 'text/plain'
  const url = useBlobUrl(text, type)
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{base}</span>
        <span className="tabular text-xs text-muted">{(text.length / 1024).toFixed(0)} KB</span>
        <a href={url} download={base} className={BUTTON}>Download</a>
        {html && <a href={url} target="_blank" rel="noreferrer" className={BUTTON}>Open in a new tab</a>}
      </div>
      {html && <iframe title={base} src={url} className="h-[80vh] w-full rounded-xl border border-line bg-white" />}
    </div>
  )
}

export type DocActions = {
  /** Clicking a unit's name (re-run for that unit). Without it, names link to the unit's page. */
  onUnit?: (name: string) => void
  /** Clicking a checkpoint id (show that chapter in detail). */
  onCheckpoint?: (id: string) => void
}

function Table({ block, actions }: { block: Extract<Block, { t: 'table' }>; actions: DocActions }) {
  const cell = (h: string, v: string): ReactNode => {
    const link = 'font-semibold hover:text-accent'
    if (h === 'Unit' && UNIT_ID.has(v)) {
      return actions.onUnit
        ? <button type="button" onClick={() => actions.onUnit!(v)} className={link}>{v}</button>
        : <Link to={`/units/${UNIT_ID.get(v)}`} className={link}>{v}</Link>
    }
    if (h === 'Class' && CLASS_ID.has(v)) return <Link to={`/classes/${CLASS_ID.get(v)}`} className="hover:text-accent">{v}</Link>
    if (h === 'Id' && v && actions.onCheckpoint) {
      return <button type="button" onClick={() => actions.onCheckpoint!(v)} className="underline decoration-dotted hover:text-accent" title="Show this chapter in detail">{v}</button>
    }
    return v
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-surface-2 text-xs text-muted">
          <tr>
            {block.cols.map((c, i) => (
              <th key={i} className={`px-2 py-2 font-semibold whitespace-nowrap ${c.right ? 'text-right' : 'text-left'}`}>{c.h.replace(/^\| /, '')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-0 hover:bg-surface-2/60">
              {row.map((v, i) => {
                const c = block.cols[i]
                // The terminal draws a "|" where a table changes subject; here that is a column rule.
                const rule = c.h.startsWith('| ') ? 'border-l border-line' : ''
                return (
                  <td key={i} className={`px-2 py-1.5 whitespace-nowrap ${c.right ? 'tabular text-right' : ''} ${rule}`}>
                    {cell(c.h.replace(/^\| /, ''), rule ? v.replace(/^\| /, '') : v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A simulator command's output. Tables become tables and files become downloads;
 * text keeps the terminal's line breaks and spacing, since some of it is laid out in columns.
 */
export function SimDoc({ doc, actions = {} }: { doc: Block[]; actions?: DocActions }) {
  // Consecutive lines of text read as one passage.
  const groups: (Block | { t: 'lines'; text: string })[] = []
  for (const b of doc) {
    if (b.t !== 'text') groups.push(b)
    else if (!b.cli) {
      const last = groups[groups.length - 1]
      if (last?.t === 'lines') last.text += `\n${b.text}`
      else groups.push({ t: 'lines', text: b.text })
    }
  }
  return (
    <div className="grid gap-3">
      {groups.map((g, i) => {
        if (g.t === 'table') return <Table key={i} block={g} actions={actions} />
        if (g.t === 'file') return <FileBlock key={i} name={g.name} text={g.text} />
        if (g.t !== 'lines') return null
        const text = g.text.replace(/^\n+|\n+$/g, '')
        return text && <pre key={i} className="overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">{text}</pre>
      })}
    </div>
  )
}
