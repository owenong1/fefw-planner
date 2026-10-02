export const STAT_KEYS = ['hp', 'str', 'mag', 'spd', 'dex', 'def', 'res', 'lck', 'cha'] as const
export type StatKey = (typeof STAT_KEYS)[number]

export const STAT_LABELS: Record<StatKey, string> = {
  hp: 'HP', str: 'Str', mag: 'Mag', spd: 'Spd', dex: 'Dex', def: 'Def', res: 'Res', lck: 'Lck', cha: 'Cha',
}

export const APTITUDES = [
  'sword', 'spear', 'axe', 'bow', 'gauntlet', 'whiteMagic', 'blackMagic',
  'riding', 'flying', 'heavyArmor', 'authority', 'infantry',
] as const
export type Aptitude = (typeof APTITUDES)[number]

export const CLASS_TIERS = ['base', 'beginner', 'specialty', 'advanced', 'master', 'divine'] as const
export type ClassTier = (typeof CLASS_TIERS)[number]
