// Normalises the contents of src/sim/data/*.json into the shapes the simulator uses:
// stat blocks become 9-element arrays indexed by the constants below. Free of
// Node, so the site can run it; scripts/sim/load.js reads the files from disk.

import { prepareAbilities, classLocks } from './abilities.js';

export const STATS = ['hp', 'str', 'mag', 'spd', 'dex', 'def', 'res', 'lck', 'cha'];
export const HP = 0, STR = 1, MAG = 2, SPD = 3, DEX = 4, DEF = 5, RES = 6, LCK = 7, CHA = 8;
export const TIERS = ['base', 'beginner', 'specialty', 'advanced', 'master', 'divine'];
export const ROUTES = ['cai', 'dietrich', 'theodora', 'leda'];
// Skills a class exam can ask for. Weapon skills are trained by wielding the
// weapon, the rest by being in a class of that type.
export const SKILLS = ['Sword', 'Spear', 'Axe', 'Bow', 'Gauntlet', 'Black Magic', 'White Magic', 'Riding', 'Flying', 'Heavy Armor', 'Infantry'];
export const WEAPON_SKILL = { sword: 0, spear: 1, axe: 2, bow: 3, gauntlet: 4, black: 5, white: 6 };
const TYPE_SKILL = { cavalry: 7, flying: 8, armored: 9, infantry: 10 };
const EXP_SKILL = { riding: 7, flying: 8, armor: 9, 'heavy armor': 9, infantry: 10 };

const WEAPON_LABEL = { sword: 'Sword', spear: 'Spear', axe: 'Axe', bow: 'Bow', gauntlet: 'Gauntlets' };

export function statArray(obj, fallback = 0) {
  return Float64Array.from(STATS, (s) => (obj && obj[s] != null ? obj[s] : fallback));
}

function normSkill(key) {
  const k = key.trim().toLowerCase();
  if (k === 'black magic') return 'black';
  if (k === 'white magic') return 'white';
  return k.replace(/s$/, '');
}

function normClass(raw, mech) {
  const cls = {
    ...raw,
    tierRank: TIERS.indexOf(raw.tier),
    growthArr: statArray(raw.growths),
    bonusArr: statArray(raw.bonus),
    flying: raw.types.includes('flying'),
    cavalry: raw.types.includes('cavalry'),
    armored: raw.types.includes('armored'),
    infantry: raw.types.includes('infantry'),
    weaponMods: {},   // weapon type -> {hit, crit, avo} from always-on class abilities
    guardPrt: 0,      // Prt/Rsl gained when the foe attacks first
    guardRsl: 0,
    avoBonus: 0,      // flat Avo from a class ability
    usesMult: { black: 1, white: 1 },   // Seeker / Zenith: more casts per map
    healBonus: 0,     // extra HP restored per heal
    dance: false,
    trains: new Uint8Array(SKILLS.length),
  };
  for (const w of raw.weapons) cls.trains[WEAPON_SKILL[w]] = 1;
  for (const t of raw.types) cls.trains[TYPE_SKILL[t]] = 1;
  if (cls.cavalry || cls.flying) {
    // Mounted classes also train what their page lists: an Ornius Rider's page
    // gives Riding and Flying. The Armored Ornius Rider page lists the wrong
    // skills, so every Ornius class is taken to train Flying.
    for (const k of Object.keys(raw.skillExp || {})) if (k in EXP_SKILL) cls.trains[EXP_SKILL[k]] = 1;
    if (/Ornius/.test(raw.name)) cls.trains[EXP_SKILL.flying] = 1;
  }
  for (const ab of raw.abilities || []) {
    if (ab.kind !== 'class') continue;
    const mod = (w, stat, v) => { (cls.weaponMods[w] ||= { hit: 0, crit: 0, avo: 0 })[stat] += v; };
    let m;
    if ((m = /When equipped with magic, grants (Hit|Crit|Avo) ?\+ ?(\d+)/i.exec(ab.text))) {
      mod('black', m[1].toLowerCase(), +m[2]);
      mod('white', m[1].toLowerCase(), +m[2]);
    } else if ((m = /Multiplies (black magic and white magic|black magic|white magic) uses by (\d+)/i.exec(ab.text))) {
      if (/black/i.test(m[1])) cls.usesMult.black = +m[2];
      if (/white/i.test(m[1])) cls.usesMult.white = +m[2];
    } else if ((m = /When healing an ally with magic, restores \+(\d+) HP/i.exec(ab.text))) {
      cls.healBonus += +m[1];
    } else if ((m = /^Grants Avo ?\+ ?(\d+)\.?$/i.exec(ab.text))) {
      cls.avoBonus += +m[1];
    } else if (/use of the Dance/i.test(ab.text)) {
      cls.dance = true;
    }
    if (!ab.effect) continue;
    const e = ab.effect;
    if (e.when === 'equipped') {
      if (e.stat in { hit: 0, crit: 0, avo: 0 }) mod(e.weapon, e.stat, e.value);
    } else if (e.when === 'foeInitiates') {
      if (e.stat === 'prt' || e.stat === 'shld') cls.guardPrt += e.value;
      if (e.stat === 'rsl' || e.stat === 'shld') cls.guardRsl += e.value;
    }
  }
  // Main weapon type (what a generic enemy of this class carries).
  const exp = {};
  for (const [k, v] of Object.entries(raw.skillExp || {})) exp[normSkill(k)] = v;
  const order = mech.enemies.weaponPriority.order;
  cls.primaryWeapon = [...raw.weapons].sort(
    (a, b) => (exp[b] || 0) - (exp[a] || 0) || order.indexOf(a) - order.indexOf(b),
  )[0] || null;
  return cls;
}

function buildArsenal(mech, weapons, side) {
  const list = [];
  for (const tier of mech.arsenal.tiers) {
    if (tier[side] == null) continue;
    for (const [type, label] of Object.entries(WEAPON_LABEL)) {
      const w = weapons.get(`${tier.prefix} ${label}`);
      if (w) list.push({ weapon: w, level: tier[side] });
    }
  }
  for (const [name, unlock] of [...Object.entries(mech.arsenal.spells), ...Object.entries(mech.arsenal.thrown || {})]) {
    if (name === 'note') continue;
    const w = weapons.get(name);
    if (w && unlock[side] != null) list.push({ weapon: w, level: unlock[side] });
  }
  return list;
}

/** Position of a rank letter on the ladder in mechanics.json (E = 0, E+ = 1, D = 2 ...). */
export function rankValue(mech, rank) {
  const i = mech.skills.ranks.findIndex((r) => r.rank === rank);
  return i < 0 ? 0 : i;
}

/**
 * Units listed under lateJoiners do not join in their published state: move
 * them to the checkpoint and class they really join at, with stats grown from
 * the published (or estimated) line at their own growth rates.
 */
function applyLateJoin(char, mech, classes) {
  const entry = (mech.lateJoiners?.units || {})[char.name];
  if (!entry) return;
  const cp = mech.checkpoints.list.find((c) => c.id === entry.from);
  const cls = classes.get(entry.class);
  if (!cp || !cls) return;
  const level = Math.max(char.base.level, cp.enemyLevel);
  const tierLevel = (mech.progression.tiers.find((t) => t.tier === cls.tier) || { level: 1 }).level;
  const stats = {};
  for (const s of STATS) {
    const inClass = Math.max(0, level - Math.max(char.base.level, tierLevel));
    stats[s] = char.base.stats[s] + ((level - char.base.level) * char.growths[s] + inClass * (cls.growths[s] || 0)) / 100;
  }
  char.base = {
    ...char.base, level, class: cls.name, stats, source: 'estimated', joinsAt: cp.id,
    bld: Math.round(char.base.bld + mech.formulas.playerBldPerLevel.value * (level - char.base.level)),
  };
}

/**
 * `raw` holds the parsed data files: { mechanics, weapons, classes, characters,
 * enemies } for mechanics.json, weapons.json, classes.json, characters.json and
 * enemies_observed.json. Its records are annotated in place, so build once per copy.
 */
export function buildData(raw) {
  const mechanics = raw.mechanics;
  const weapons = new Map(raw.weapons.weapons.map((w) => [w.name, w]));
  for (const w of weapons.values()) w.rankValue = rankValue(mechanics, w.rank || 'E');
  const classes = new Map(raw.classes.classes.map((c) => [c.name, normClass(c, mechanics)]));
  const charFile = raw.characters;
  const heals = new Map((raw.weapons.heals || []).map((h) => [h.name, h]));
  const characters = new Map();
  for (const raw of charFile.characters) {
    if (!classes.has(raw.base.class)) continue;
    const char = {
      ...raw,
      growthArr: statArray(raw.growths),
      nonIdeal: raw.nonIdeal || [],
      preferred: raw.preferred || [],
    };
    applyLateJoin(char, mechanics, classes);
    char.baseArr = statArray(char.base.stats);
    char.abilityList = prepareAbilities(char);
    char.locks = classLocks(char);
    char.skillRate = Float64Array.from(SKILLS, (sk) =>
      (char.preferred.includes(sk) ? mechanics.skills.preferred : char.nonIdeal.includes(sk) ? mechanics.skills.nonIdeal : 1));
    // The unit's own spell list, resolved to attack spells and heals we have numbers for.
    char.spellBook = raw.spells ? ['black', 'white'].flatMap((school) => (raw.spells[school] || []).map((sp) => ({
      school, rank: rankValue(mechanics, sp.rank), weapon: weapons.get(sp.name) || null, heal: heals.get(sp.name) || null,
    }))).filter((sp) => sp.weapon || sp.heal) : null;
    characters.set(raw.name, char);
  }
  const observed = raw.enemies.enemies;
  const f = mechanics.formulas;
  const formulas = {
    followUp: f.followUpThreshold.value,
    critMult: f.critMultiplier.value,
    swordFollowUp: f.swordFollowUpMultiplier.value,
    axeMin: f.axeMinDamage.value,
    hitDex: f.hit.dex, hitLck: f.hit.lck,
    critDex: f.crit.dex, critLck: f.crit.lck,
    dodgeLck: f.dodge.lck,
    gauntletAvo: f.gauntletAvoid.value,
  };
  return {
    mechanics, formulas, weapons, heals, classes, characters, observed,
    checkpoints: mechanics.checkpoints.list,
    playerArsenal: buildArsenal(mechanics, weapons, 'player'),
    enemyArsenal: buildArsenal(mechanics, weapons, 'enemy'),
    sources: charFile.sources,
  };
}

export function findByName(map, query) {
  if (map.has(query)) return map.get(query);
  const q = query.toLowerCase();
  const names = [...map.keys()];
  const exact = names.find((n) => n.toLowerCase() === q);
  if (exact) return map.get(exact);
  const partial = names.filter((n) => n.toLowerCase().startsWith(q));
  return partial.length === 1 ? map.get(partial[0]) : null;
}
