import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Empty, PageHeader, Segmented } from '../components/ui'
import { skillOwners, skills } from '../data'
import type { Skill } from '../data/schema'
import { useSettings } from '../lib/settings'

type Filter = 'all' | Skill['type']

const TYPE_LABEL: Record<Skill['type'], string> = {
  personal: 'Personal', level: 'Level', bloodmark: 'Bloodmark', class: 'Class', mastery: 'Mastery',
}

export function SkillsPage() {
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  const type = (params.get('type') as Filter) ?? 'all'
  const q = params.get('q') ?? ''

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (!v || v === 'all') next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    const needle = q.toLowerCase()
    return skills
      .filter((s) => type === 'all' || s.type === type)
      .map((s) => {
        const owners = skillOwners(s.id)
        return { skill: s, units: owners.units.filter((u) => u.spoiler <= spoilerLevel), classes: owners.classes }
      })
      // Hide unit-only skills whose every owner is hidden by the spoiler setting.
      .filter((r) => r.units.length > 0 || r.classes.length > 0)
      .filter(
        (r) =>
          !needle ||
          r.skill.name.toLowerCase().includes(needle) ||
          (r.skill.effect ?? '').toLowerCase().includes(needle) ||
          r.units.some((u) => u.name.toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.skill.name.localeCompare(b.skill.name))
  }, [type, q, spoilerLevel])

  return (
    <div>
      <PageHeader title="Skills" subtitle="Personal, level-up, bloodmark, class and mastery abilities. Search matches names, effects and owners.">
        <input
          value={q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search skills…"
          aria-label="Search skills"
          className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          label="Skill type"
          value={type}
          onChange={(v) => set('type', v)}
          options={[{ value: 'all', label: 'All' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value: value as Filter, label }))]}
        />
        <span className="ml-auto text-sm text-muted">{rows.length} skills</span>
      </div>
      {rows.length === 0 ? (
        <Empty>No skills match.</Empty>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map(({ skill, units, classes }) => (
            <div key={skill.id} className="grid gap-1 p-3 sm:grid-cols-[14rem_1fr_14rem] sm:gap-4">
              <div>
                <p className="font-semibold">{skill.name}</p>
                <p className="text-xs text-muted">{TYPE_LABEL[skill.type]}{skill.crest ? ` · Crest: ${skill.crest}` : ''}</p>
              </div>
              <p className="text-sm">{skill.effect ?? <span className="text-muted">Effect not documented yet.</span>}</p>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-sm sm:justify-end">
                {units.map((u) => (
                  <Link key={u.id} to={`/units/${u.id}`} className="font-medium text-accent hover:underline">{u.name}</Link>
                ))}
                {classes.map((c) => (
                  <Link key={c.id} to={`/classes/${c.id}`} className="text-muted hover:text-ink hover:underline">{c.name}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
