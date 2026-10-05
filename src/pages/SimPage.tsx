import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { SimDoc } from '../components/SimDoc'
import { SpoilerGate } from '../components/Spoiler'
import { Card, PageHeader, Select } from '../components/ui'
import { units } from '../data'
import { useSettings } from '../lib/settings'
import { describeSim, runSim, SimError, stopSim, type Block, type SimMeta } from '../sim/client'

/** The simulator's commands, in its own words (`help` lists the same ones). */
const COMMANDS = [
  { id: 'char', label: 'Unit', blurb: 'The recommended class path for each role. Pick a role for the ranked list and chapter-by-chapter numbers.' },
  { id: 'path', label: 'Path', blurb: 'Profile one specific class path chapter by chapter.' },
  { id: 'all', label: 'Whole cast', blurb: 'Every unit: the role it fits best and the path for it. Pick a role for that role’s leaderboard.', slow: true },
  { id: 'classes', label: 'Classes', blurb: 'Which classes help the most units, per tier and role.', slow: true },
  { id: 'refs', label: 'Reference enemies', blurb: 'The reference enemies every profile is measured against.' },
  { id: 'enemies', label: 'Enemy roster', blurb: 'The full enemy roster (used by the duel role) and the enemy model.' },
  { id: 'visuals', label: 'Visuals', blurb: 'One page showing how every number is made, and the results, colour-coded.', slow: true },
  { id: 'export', label: 'Export', blurb: 'The whole-cast results as JSON for other tools.', slow: true },
  { id: 'list', label: 'List', blurb: 'Units and classes in the simulator’s data.' },
  { id: 'help', label: 'Help', blurb: 'Every command and option, as the command-line version describes them.' },
] as const
type CommandId = (typeof COMMANDS)[number]['id']

/** Which fields each command reads. Search options apply to everything that searches or scores paths. */
const USES: Record<string, CommandId[]> = {
  unit: ['char', 'path'],
  path: ['path'],
  role: ['char', 'path', 'all', 'classes'],
  at: ['path', 'refs', 'enemies'],
  csv: ['char', 'all'],
  search: ['char', 'path', 'all', 'classes', 'visuals', 'export'],
  hard: ['char', 'path', 'all', 'classes', 'visuals', 'export', 'refs', 'enemies'],
  json: ['char', 'path', 'all', 'classes', 'refs', 'enemies', 'list'],
}

/** Form state. Everything is a string because it lives in the URL; '' means "leave the option off". */
type Fields = {
  cmd: CommandId; unit: string; path: string; role: string; at: string; top: string
  route: string; hard: string; divine: string; maxGap: string; free: string; detours: string
  from: string; to: string; runs: string; offense: string; json: string; csv: string
}
const EMPTY: Fields = {
  cmd: 'char', unit: '', path: '', role: '', at: '', top: '', route: '', hard: '', divine: '', maxGap: '', free: '',
  detours: '', from: '', to: '', runs: '', offense: '', json: '', csv: '',
}
const KEYS = Object.keys(EMPTY) as (keyof Fields)[]

function readFields(params: URLSearchParams): Fields {
  const f = { ...EMPTY }
  for (const k of KEYS) {
    const v = params.get(k)
    if (v != null) (f[k] as string) = v
  }
  if (!COMMANDS.some((c) => c.id === f.cmd)) f.cmd = 'char'
  return f
}

/** The command line the form stands for, as the simulator's CLI would take it. */
function buildArgv(f: Fields): string[] {
  const uses = (field: string) => USES[field].includes(f.cmd)
  const argv: string[] = [f.cmd]
  if (uses('unit')) argv.push(f.unit)
  if (uses('path')) argv.push(f.path)
  if (f.cmd === 'export') argv.push('paths.json')
  const opt = (flag: string, value: string) => value !== '' && argv.push(`--${flag}`, value)
  const flag = (name: string, value: string) => value !== '' && argv.push(`--${name}`)
  if (uses('role')) opt('role', f.role)
  if (uses('at')) opt('at', f.at)
  if (f.cmd === 'all' || (f.cmd === 'char' && f.role)) opt('top', f.top)
  if (uses('hard')) flag('hard', f.hard)
  if (uses('search')) {
    opt('route', f.route)
    flag('divine', f.divine)
    if (f.free) flag('free-reclass', f.free)
    else opt('max-gap', f.maxGap)
    opt('detours', f.detours)
    opt('from', f.from)
    opt('to', f.to)
    opt('runs', f.runs)
    if (f.role === 'duel') opt('offense', f.offense)
  }
  if (f.cmd === 'visuals') argv.push('--out', 'visuals.html')
  if (uses('json')) flag('json', f.json)
  // A role's ranked list (char) or a table (all) can also be saved as CSV; --json replaces the tables.
  if (uses('csv') && f.csv && !f.json && (f.cmd === 'all' || f.role)) argv.push('--csv', f.cmd === 'all' ? 'all_units.csv' : `${f.unit}_${f.role}.csv`)
  return argv
}

const shellQuote = (a: string) => (/^[\w@.,:/+-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`)

const INPUT = 'rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-accent'

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`flex flex-col gap-1 text-xs font-medium text-muted ${className}`}>{label}{children}</label>
}

function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label title={title} className="inline-flex items-center gap-1.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-(--accent)" />
      {label}
    </label>
  )
}

type Result = { doc: Block[]; text: string; seconds: number; argv: string[] }

export function SimPage() {
  return (
    <SpoilerGate level={1} reason="The simulator names Master classes and units that join in Part II and III.">
      <Simulator />
    </SpoilerGate>
  )
}

function Simulator() {
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  const fields = readFields(params)
  const [meta, setMeta] = useState<SimMeta | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ slow: boolean; done: number; total: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const runId = useRef(0)

  const command = COMMANDS.find((c) => c.id === fields.cmd)!
  const slow = 'slow' in command
  const uses = (field: string) => USES[field].includes(fields.cmd)

  const run = (f: Fields) => {
    const argv = buildArgv(f)
    const id = ++runId.current
    setError(null)
    setCopied(false)
    setBusy({ slow: 'slow' in COMMANDS.find((c) => c.id === f.cmd)!, done: 0, total: 0 })
    runSim(argv, (done, total) => id === runId.current && setBusy((b) => b && { ...b, done, total }))
      .then((r) => {
        if (id !== runId.current) return
        setResult({ ...r, argv })
        setBusy(null)
      })
      .catch((err: unknown) => {
        if (id !== runId.current) return
        setBusy(null)
        // A mistake in the command keeps the last result on screen; a crash should not look like a result.
        if (!(err instanceof SimError && err.usage)) setResult(null)
        setError(err instanceof Error ? err.message : String(err))
      })
  }

  /** Change fields in the URL and, for commands that answer in a few seconds, run straight away. */
  const update = (patch: Partial<Fields>, { rerun = true } = {}) => {
    const next = { ...fields, ...patch }
    const p = new URLSearchParams()
    for (const k of KEYS) if (next[k] !== EMPTY[k]) p.set(k, next[k])
    setParams(p, { replace: true })
    const nextSlow = 'slow' in COMMANDS.find((c) => c.id === next.cmd)!
    if (rerun && !nextSlow && !busy?.slow && ready(next)) run(next)
  }
  const ready = (f: Fields) => (!USES.unit.includes(f.cmd) || f.unit !== '') && (f.cmd !== 'path' || f.path.trim() !== '')

  // A link into the simulator (?cmd=char&unit=Sofia) shows its answer without a click, unless it would take a minute.
  const onLoad = useRef(() => {
    if (!slow && ready(fields) && (params.has('cmd') || params.has('unit'))) run(fields)
  })
  useEffect(() => {
    let live = true
    describeSim().then(
      (m) => {
        if (!live) return
        setMeta(m)
        onLoad.current()
      },
      (err: Error) => live && setError(err.message),
    )
    return () => {
      live = false
    }
  }, [])

  const stop = () => {
    runId.current++
    stopSim()
    setBusy(null)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (ready(fields)) run(fields)
  }

  const shownUnits = (meta?.units ?? []).filter((u) => {
    const spoiler = units.find((x) => x.name === u.name)?.spoiler ?? 0
    return spoiler <= spoilerLevel || u.name === fields.unit
  })
  const checkpoints = [{ value: '', label: '–' }, ...(meta?.checkpoints ?? []).map((c) => ({ value: c.id, label: `${c.id} · ${c.label}` }))]
  const num = (key: keyof Fields, label: string, placeholder: number | string, props: { step?: string; max?: string; title?: string } = {}) => (
    <Field label={label} className="w-24">
      <input
        type="number" min="0" inputMode="decimal" {...props}
        value={fields[key]} placeholder={String(placeholder)}
        onChange={(e) => update({ [key]: e.target.value }, { rerun: false })}
        className={`${INPUT} tabular`}
      />
    </Field>
  )
  const line = `npm run sim -- ${buildArgv(fields).map(shellQuote).join(' ')}`

  return (
    <div>
      <PageHeader
        title="Simulator"
        subtitle="The growth simulator behind the Class Paths page, running in your browser: search a unit's class paths, profile a path of your own, or re-run the whole cast with different rules."
      >
        <Link to="/paths" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">Class Paths leaderboard</Link>
      </PageHeader>

      <Card className="mb-4">
        <form onSubmit={submit} className="grid gap-4">
          <div role="radiogroup" aria-label="Command" className="flex flex-wrap gap-1">
            {COMMANDS.map((c) => (
              <button
                key={c.id} type="button" role="radio" aria-checked={c.id === fields.cmd}
                onClick={() => update({ cmd: c.id, at: '' })}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  c.id === fields.cmd ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted">{command.blurb}{slow && ' Searches every unit, which takes about a minute.'}</p>

          <div className="flex flex-wrap items-end gap-3">
            {uses('unit') && (
              <Select
                label="Unit" value={fields.unit} onChange={(unit) => update({ unit, at: '' })}
                options={[{ value: '', label: meta ? 'Choose a unit…' : 'Loading…' }, ...shownUnits.map((u) => ({ value: u.name, label: `${u.name} · Lv ${u.level} ${u.class}` }))]}
              />
            )}
            {uses('role') && (
              <Select
                label="Role" value={fields.role} onChange={(role) => update({ role })}
                options={[
                  { value: '', label: fields.cmd === 'path' ? 'Every role (no rolled playthroughs)' : 'Every role' },
                  ...(meta?.roles ?? []).map((r) => ({ value: r.id, label: r.id === 'duel' ? 'Duel: the old single score (slow)' : r.label })),
                ]}
              />
            )}
            {uses('at') && <Select label={fields.cmd === 'path' ? 'Chapter in detail' : 'Only this chapter'} value={fields.at} onChange={(at) => update({ at })} options={checkpoints} />}
            {(fields.cmd === 'all' || (fields.cmd === 'char' && fields.role)) && num('top', 'Rows to show', fields.cmd === 'all' ? 'all' : meta?.defaults.top ?? 10)}
          </div>

          {uses('path') && (
            <Field label="Class path">
              <input
                value={fields.path} onChange={(e) => update({ path: e.target.value }, { rerun: false })}
                placeholder="Gladiator>Brigand>Warrior>Battlemaster   or   Gladiator@5>Brigand@20>Warrior@38"
                list="sim-classes" spellCheck={false} className={`${INPUT} font-mono`}
              />
              <span className="font-normal">
                One class per decision in order, with <code>stay</code> to keep the current class; or give every change its level as <code>Class@Level</code> to change at any level.
              </span>
            </Field>
          )}

          {(uses('search') || uses('hard') || uses('json')) && (
            <details className="rounded-lg border border-line px-3 py-2" open={KEYS.some((k) => !['cmd', 'unit', 'path', 'role', 'at', 'top'].includes(k) && fields[k] !== '')}>
              <summary className="cursor-pointer text-sm font-medium">Options</summary>
              <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
                {uses('search') && (
                  <Select
                    label="Route" value={fields.route} onChange={(route) => update({ route })}
                    options={[
                      { value: '', label: 'Common: classes every route unlocks' },
                      ...(meta?.routes ?? []).map((r) => ({ value: r, label: `${r[0].toUpperCase()}${r.slice(1)}: add that route's classes` })),
                      { value: 'any', label: 'Any: every route-exclusive class' },
                    ]}
                  />
                )}
                {uses('search') && <Select label="From chapter" value={fields.from} onChange={(from) => update({ from })} options={checkpoints} />}
                {uses('search') && <Select label="To chapter" value={fields.to} onChange={(to) => update({ to })} options={checkpoints} />}
                {uses('search') && !fields.free && num('maxGap', 'Exam gap (ranks)', meta?.defaults.maxGap ?? 1, { step: 'any', title: 'Largest exam shortfall, in skill ranks, a class change may have' })}
                {uses('search') && num('detours', 'Sideways changes', meta?.defaults.detours ?? 1, { title: 'Class changes within a tier a path may make' })}
                {uses('search') && num('runs', 'Rolled playthroughs', meta?.defaults.runs ?? 100, { title: "Level-up playthroughs rolled for each role's leading paths; 0 = do not roll" })}
                {uses('search') && fields.role === 'duel' && num('offense', 'Duel offense share', '0.6', { step: '0.05', max: '1' })}
                <div className="flex flex-wrap gap-x-4 gap-y-2 pb-1.5">
                  {uses('hard') && <Check label="Hard difficulty" checked={!!fields.hard} onChange={(v) => update({ hard: v ? '1' : '' })} />}
                  {uses('search') && <Check label="Divine classes" checked={!!fields.divine} onChange={(v) => update({ divine: v ? '1' : '' })} title="Also search Divine classes (one more decision late in Part III)" />}
                  {uses('search') && <Check label="Free reclassing" checked={!!fields.free} onChange={(v) => update({ free: v ? '1' : '' })} title="Allow any class change regardless of skill ranks" />}
                  {uses('csv') && (fields.cmd === 'all' || fields.role) && !fields.json && <Check label="Also as CSV" checked={!!fields.csv} onChange={(v) => update({ csv: v ? '1' : '' })} />}
                  {uses('json') && <Check label="JSON output" checked={!!fields.json} onChange={(v) => update({ json: v ? '1' : '' })} title="Machine-readable output instead of tables" />}
                </div>
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {busy ? (
              <button type="button" onClick={stop} className="rounded-lg border border-line bg-surface px-4 py-1.5 text-sm font-semibold hover:border-accent">Stop</button>
            ) : (
              <button type="submit" disabled={!meta || !ready(fields)} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-ink disabled:opacity-50">Run</button>
            )}
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title="The same run from a terminal, in a checkout of this site">{line}</code>
          </div>
          <datalist id="sim-classes">{meta?.classes.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        </form>
      </Card>

      {busy && (
        <div className="mb-4" role="status">
          <p className="mb-1 text-sm text-muted">
            {busy.total ? `Searched ${busy.done} of ${busy.total} units…` : busy.slow ? 'Starting the search…' : 'Working…'}
          </p>
          {busy.slow && (
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${busy.total ? (100 * busy.done) / busy.total : 0}%` }} />
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {result && (
        <div className={busy ? 'opacity-50' : ''}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span className="tabular">{result.argv.map(shellQuote).join(' ')} · {result.seconds.toFixed(1)}s</span>
            {result.text && (
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(result.text).then(() => setCopied(true), () => setCopied(false))}
                className="rounded-md border border-line bg-surface px-2 py-1 font-medium hover:border-accent"
              >
                {copied ? 'Copied' : 'Copy as text'}
              </button>
            )}
          </div>
          <SimDoc
            doc={result.doc}
            actions={{
              onUnit: (name) => update({ cmd: 'char', unit: name, at: '', csv: '' }),
              onCheckpoint: ['path', 'refs', 'enemies'].includes(result.argv[0]) ? (at) => update({ at }) : undefined,
            }}
          />
        </div>
      )}
    </div>
  )
}
