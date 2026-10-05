// What a unit can use at a point on its path: estimated skill ranks, the
// weapons and spells those ranks unlock, and one combat loadout per weapon.

import { SKILLS, WEAPON_SKILL, rankValue } from './data.js';
import { makeLoadout } from './combat.js';
import { withClassBonus } from './growth.js';
import { effectsAt, effectsFor } from './abilities.js';

const NS = SKILLS.length;
const MAX_PER_TYPE = 2;

/** Exposure needed for each rank on the ladder, and each rank's size in whole ranks (E+ is half a rank). */
function ladder(data) {
  if (!data.rankLadder) {
    const ranks = data.mechanics.skills.ranks;
    data.rankLadder = {
      need: ranks.map((r) => r.exposure),
      size: ranks.map((r, i) => (i < 2 ? i * 0.5 : i - 1)),
      names: ranks.map((r) => r.rank),
    };
  }
  return data.rankLadder;
}

/** Rank (ladder position) reached with `exposure`. */
export function rankAt(data, exposure) {
  const { need } = ladder(data);
  let r = 0;
  while (r + 1 < need.length && exposure >= need[r + 1] - 1e-9) r++;
  return r;
}

export function rankName(data, r) {
  return ladder(data).names[r];
}

const TIER_RANK = { base: 'E', beginner: 'D', specialty: 'C', advanced: 'B', master: 'A', divine: 'S' };

/**
 * Skill exposure a unit joins with: its Commoner levels train every weapon,
 * and a unit that joins in a class holds the ranks that class's tier and exam
 * imply, plus the levels spent in it since.
 */
export function initialExposure(data, char) {
  const { need } = ladder(data);
  const expo = new Float64Array(NS);
  const cls = data.classes.get(char.base.class);
  const level = char.base.level;
  for (const i of Object.values(WEAPON_SKILL)) expo[i] = Math.min(level - 1, 4) * char.skillRate[i];
  if (cls.tier === 'base') return expo;
  const tier = data.mechanics.progression.tiers.find((t) => t.tier === cls.tier);
  const since = Math.max(0, level - (tier ? tier.level : level));
  const floor = need[rankValue(data.mechanics, TIER_RANK[cls.tier])];
  for (let i = 0; i < NS; i++) if (cls.trains[i]) expo[i] = Math.max(expo[i], floor + since * char.skillRate[i]);
  for (const req of [...(cls.exam?.primary || []), ...(cls.exam?.secondary || [])]) {
    const i = SKILLS.indexOf(req.skill);
    if (i >= 0 && cls.trains[i]) expo[i] = Math.max(expo[i], need[rankValue(data.mechanics, req.rank)] + since * char.skillRate[i]);
  }
  return expo;
}

/** Exposure after `levels` more levels in `cls` (writes into `out`). */
export function trainExposure(char, cls, expo, levels, out = new Float64Array(NS)) {
  for (let i = 0; i < NS; i++) out[i] = expo[i] + (cls.trains[i] ? levels * char.skillRate[i] : 0);
  return out;
}

/**
 * What passing `cls`'s exam would take with the current exposure.
 * Returns { gap, worst, skills, expo }: total and largest rank shortfall, the
 * skills that fall short, and the exposure after training up to pass.
 * Every primary skill is required, and the easiest one of the secondary skills.
 */
export function examNeed(data, char, cls, expo) {
  const { need, size } = ladder(data);
  const after = Float64Array.from(expo);
  let gap = 0, worst = 0;
  const skills = [];
  const short = (req) => {
    const i = SKILLS.indexOf(req.skill);
    if (i < 0) return { i, d: 0, want: 0 };
    const want = rankValue(data.mechanics, req.rank);
    return { i, want, d: Math.max(0, size[want] - size[rankAt(data, expo[i])]), req };
  };
  const take = (s) => {
    if (s.d <= 0) return;
    gap += s.d;
    if (s.d > worst) worst = s.d;
    skills.push(`${s.req.skill} ${s.req.rank}`);
    after[s.i] = Math.max(after[s.i], need[s.want]);
  };
  if (cls.exam) {
    for (const req of cls.exam.primary || []) take(short(req));
    const secondary = (cls.exam.secondary || []).map(short);
    if (secondary.length) take(secondary.reduce((a, b) => (b.d < a.d ? b : a)));
  }
  return { gap, worst, skills, expo: after };
}

/** A unit's Build at a level (grows slowly with level; see mechanics.json). */
export function bldAt(data, char, level) {
  const per = data.mechanics.formulas.playerBldPerLevel.value;
  return Math.round(char.base.bld + per * (level - char.base.level));
}

const burden = (w, bld) => Math.max(0, w.wt - bld);
const eff = (w, k) => (w.effective && w.effective[k]) || 1;
const dominates = (a, b, bld) =>
  a !== b && a.type === b.type && !!a.magical === !!b.magical && a.targets === b.targets &&
  a.mt >= b.mt && a.hit >= b.hit && a.crit >= b.crit && burden(a, bld) <= burden(b, bld) &&
  a.range[0] <= b.range[0] && a.range[1] >= b.range[1] &&
  eff(a, 'flying') >= eff(b, 'flying') && eff(a, 'cavalry') >= eff(b, 'cavalry') && eff(a, 'armored') >= eff(b, 'armored') &&
  (a.avo || 0) >= (b.avo || 0) &&
  (a.mt > b.mt || a.hit > b.hit || a.crit > b.crit || burden(a, bld) < burden(b, bld) || a.name < b.name);

/**
 * Standard gear the unit can use in `cls` at `level` with skill exposure `expo`:
 *   weapons - physical weapons (the two newest melee and two newest thrown per
 *             type, strictly worse ones dropped) and attack spells, each as { weapon, uses } where uses
 *             is casts per map (Infinity for physical weapons)
 *   heals   - [{ heal, uses }]
 * Spells come from the unit's own spell list; a unit without a published list
 * uses the standard spell lines.
 */
export function unitGear(data, char, cls, level, expo) {
  const bld = bldAt(data, char, level);
  const rank = (type) => rankAt(data, expo[WEAPON_SKILL[type]]);
  const physical = [];
  const spells = [];
  const heals = [];
  for (const e of data.playerArsenal) {
    const w = e.weapon;
    if (e.level > level || !cls.weapons.includes(w.type) || w.rankValue > rank(w.type)) continue;
    if (w.type === 'black' || w.type === 'white') { if (!char.spellBook) spells.push(w); }
    else physical.push({ w, unlock: e.level });
  }
  if (char.spellBook) {
    for (const sp of char.spellBook) {
      if (!cls.weapons.includes(sp.school) || sp.rank > rank(sp.school)) continue;
      if (sp.weapon) spells.push(sp.weapon);
      if (sp.heal) heals.push(sp.heal);
    }
  } else if (cls.weapons.includes('white')) {
    for (const [name, r] of Object.entries(data.mechanics.arsenal.fallbackHeals)) {
      const heal = data.heals.get(name);
      if (heal && rankValue(data.mechanics, r) <= rank('white')) heals.push(heal);
    }
  }
  const all = physical.map((p) => p.w);
  const perType = new Map();
  const kept = physical
    .filter((p) => !all.some((o) => dominates(o, p.w, bld)))
    .sort((a, b) => b.unlock - a.unlock || b.w.mt - a.w.mt)
    .filter((p) => {
      // Melee and thrown weapons of a type are counted separately, so a unit keeps both.
      const key = p.w.range[0] === 1 && p.w.range[1] > 1 ? `${p.w.type} thrown` : p.w.type;
      const n = perType.get(key) || 0;
      perType.set(key, n + 1);
      return n < MAX_PER_TYPE;
    });
  return {
    bld,
    weapons: [
      ...kept.map((p) => ({ weapon: p.w, uses: Infinity })),
      ...spells.map((w) => ({ weapon: w, uses: (w.uses || Infinity) * cls.usesMult[w.type] })),
    ],
    heals: heals.map((h) => ({ heal: h, uses: h.uses * cls.usesMult.white })),
  };
}

// Stand-in for a unit whose class has nothing usable yet: it cannot hurt anyone.
const UNARMED = { name: '(unarmed)', type: 'none', mt: 0, hit: -999, crit: 0, wt: 0, range: [1, 1], effective: {} };

/**
 * One loadout per usable weapon (each tagged with `uses`), plus the heals.
 * `personal` are personal stats (class bonus not yet added); `vars` their variance or null.
 * Pass `gear` (unitGear output) to reuse it across several stat lines.
 */
export function unitLoadouts(data, char, cls, level, personal, vars, expo, gear = unitGear(data, char, cls, level, expo)) {
  const stats = withClassBonus(personal, cls);
  const effects = effectsAt(char, level);
  const list = gear.weapons.length ? gear.weapons : [{ weapon: UNARMED, uses: Infinity }];
  const loadouts = list.map(({ weapon, uses }) => {
    const L = makeLoadout(stats, vars, gear.bld, cls, weapon, data.formulas, effectsFor(effects, cls, weapon));
    L.uses = uses;
    return L;
  });
  return { loadouts, heals: gear.heals, stats, effects, bld: gear.bld };
}
