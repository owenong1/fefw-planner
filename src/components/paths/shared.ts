import { classPaths } from '../../data'

const { profile } = classPaths

/** What each profile axis measures, in a sentence. */
export const AXIS_TEXT: Record<string, string> = {
  physDmg: 'Kill speed with the best physical weapon: 100 ÷ the attacks it expects to need. 100 kills in one attack, 50 in two.',
  magDmg: 'The same with magic, averaged over a map of attacks because spells run out.',
  bestDmg: 'The larger of physical and magic damage.',
  safety: 'Share of its own HP the unit keeps while making that attack. 100 means the enemy cannot answer.',
  physBulk: 'Share of HP left after a physical enemy attacks, if every strike lands.',
  magBulk: 'The same against a magic enemy.',
  avoid: 'Chance an enemy strike misses.',
  physSurv: 'A full enemy phase of physical attackers, one after another: the share of those attacks the unit is still standing for.',
  magSurv: 'The same against magical attackers.',
  support: `HP healed per map (${profile.healBars} ally HP bars = 100). Being able to Dance counts ${profile.dance}.`,
  reach: `Movement, from Mov ${profile.movFloor} (0) to Mov ${profile.movCeil} (100). Fliers count ${profile.flyingMov} extra. No role weights it.`,
}

/** The x axis every chapter chart shares: the chapter's number, grouped by the part of the story it is in. */
export const chapterAxis = {
  xLabels: classPaths.checkpoints.map((c) => String(Number(c.id.split('-')[1]) || c.id)),
  groups: classPaths.checkpoints.map((c) => c.label.replace(/\s+\S+$/, '')),
}

/** A role's own weights as slider positions (percent, one per axis). */
export const defaultSliders = (roleId: string) => {
  const weights = classPaths.roles.find((r) => r.id === roleId)!.weights
  return classPaths.axes.map((a) => Math.round((weights[a.id] ?? 0) * 1000) / 10)
}
