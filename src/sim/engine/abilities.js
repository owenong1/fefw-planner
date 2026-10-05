// Personal and level-up abilities. The data files keep each ability as the
// game's own text; this module turns the ones that are plain combat, stat or
// healing modifiers into numbers and leaves the rest marked as not scored.
//
// A parsed ability is a list of effects. An effect has conditions (when it
// applies), an optional trigger chance, and a payload (what it changes).

const STAT_KEYS = {
  hit: 'hit', avo: 'avo', crit: 'crit', atk: 'atk', as: 'as', prt: 'prt', rsl: 'rsl', ddg: 'ddg',
  str: 'str', mag: 'mag', spd: 'spd', dex: 'dex', def: 'def', res: 'res', lck: 'lck', cha: 'cha',
  mov: 'mov', bld: 'bld',
};
const BASE_STATS = ['str', 'mag', 'spd', 'dex', 'def', 'res', 'lck', 'cha'];
const PAIR = /((?:Hit|Avo|Crit|Atk|AS|Prt|Rsl|Shld|Ddg|Str|Mag|Spd|Dex|Def|Res|Lck|Cha|Mov|Bld)(?:\/(?:Hit|Avo|Crit|Atk|AS|Prt|Rsl|Shld|Ddg|Str|Mag|Spd|Dex|Def|Res|Lck|Cha))*) ?([+\-−]) ?(\d+)/g;

// Text that makes an effect depend on things the simulator does not track.
const NOT_SCORED = [
  [/Blaze Art|Overblaze|staggering/i, 'needs Blaze arts or staggering blows'],
  [/adjacent all|allies within|to allies|target allies|all allies|for each adjacent ally|an adjacent ally/i, 'affects or depends on allies'],
  [/After (?:combat|defeating|using)|until (?:the end|unit|a unit)|When .* triggers|after .* triggers/i, 'builds up over a map'],
  [/status effect|is damaged|foe.s HP|avoids? an attack|Underworld|undead|obstacles|artillery|terrain|Diadem/i, 'situational'],
  [/attacks first during combat|unit attacks first\.? Trigger/i, 'changes strike order'],
  [/storage|move through|movement cost|Mov ?[-−]|Extends range|Rng ?\+|stat increase|levels up|leaves unit with 1 HP|cannot be countered|cannot suffer/i, 'utility'],
];

// A bonus for attacking with a combat art is scored as if the unit always attacks
// with one: it applies whenever the unit starts the fight. The art's own might,
// hit and cost are not modelled. The ability carries the assumption (`assumes`)
// so every front end can say that the unit has to use its arts to earn the score.
const COMBAT_ART = /when attacking with (?:an? )?(?:(sword|axe|bow|spear|gauntlet|magic) )?combat arts?/i;

const lower = (s) => s.toLowerCase();

function parseTrigger(text) {
  let m = /trigger ?% ?= ?(\d+)/i.exec(text);
  if (m) return { pct: +m[1] };
  m = /trigger ?% ?= ?(Lck|Str|Def|Dex|Cha|Mag|Spd) ?(?:[÷/] ?(\d+))?/i.exec(text);
  if (m) return { stat: lower(m[1]), div: +(m[2] || 1) };
  if (/trigger ?% ?= ?unit.s remaining HP/i.test(text)) return { pct: 100 }; // full HP assumed
  return null;
}

function blankEffect() {
  return {
    phase: 0, weapon: null, weaponName: null, type: null, cls: null, range: 0,
    foeMagic: false, effective: false, asLead: null, canFollow: false, noFollow: false,
    minHit: null, foeCantCounter: false, trig: null,
    mods: {}, foeMods: {}, followMods: {}, dmgMult: 1, takenMult: 1, followAlways: false,
    wtMult: 1, heal: 0, healFree: false, armored: false, locks: null,
  };
}

function addPairs(target, clause, scale = 1) {
  let found = false;
  for (const m of clause.matchAll(PAIR)) {
    const value = (m[2] === '+' ? 1 : -1) * +m[3] * scale;
    for (const raw of m[1].split('/')) {
      const k = lower(raw);
      if (k === 'shld') { target.prt = (target.prt || 0) + value; target.rsl = (target.rsl || 0) + value; }
      else target[STAT_KEYS[k]] = (target[STAT_KEYS[k]] || 0) + value;
      found = true;
    }
  }
  return found;
}

function parseClause(clause, inherited) {
  const e = { ...blankEffect(), ...inherited, mods: {}, foeMods: {}, followMods: {} };
  let m;
  if ((m = /^\((Cavalry|Infantry|Flying|Armored)\)/i.exec(clause))) e.type = lower(m[1]);
  if (/unit is (?:a )?charioteer/i.test(clause)) e.cls = 'Charioteer';
  if (/If unit attacks first/i.test(clause)) e.phase = 1;
  if (/If foes? attacks first|first combat in enemy.s phase/i.test(clause)) e.phase = 2;
  if ((m = /When equipped with (?:an? )?(sword|axe|bow|spear|gauntlet|magic)s?/i.exec(clause))) e.weapon = lower(m[1]);
  if ((m = /When using (Nosferatu)/i.exec(clause))) e.weaponName = m[1];
  if (/to magic during combat/i.test(clause)) e.weapon = 'magic';
  if (/adjacent foe\b/i.test(clause)) e.range = 1;
  if (/throwing a spear/i.test(clause)) { e.weapon = 'spear'; e.range = 2; }
  if ((m = COMBAT_ART.exec(clause))) { e.phase = 1; if (m[1]) e.weapon = lower(m[1]); }
  if (/If foes? uses magic/i.test(clause)) e.foeMagic = true;
  if (/unit is effective against foe/i.test(clause)) e.effective = true;
  if ((m = /AS (?:≥|is greater than or equal to) foe.s AS ?\+ ?(\d+)/i.exec(clause))) e.asLead = +m[1];
  if (/unit can make a follow-up/i.test(clause)) e.canFollow = true;
  if (/unit and foe cannot make a follow-up/i.test(clause)) e.noFollow = true;
  if ((m = /hit (?:percent|%) ?(?:is )?(?:≥|=)(?: to)? ?(\d+)/i.exec(clause))) e.minHit = +m[1];
  if (/If foe cannot counter/i.test(clause)) e.foeCantCounter = true;
  const inline = /\(trigger/i.test(clause) ? parseTrigger(clause) : null;
  if (inline) e.trig = inline;

  let payload = false;
  if ((m = /multiplies (?:unit.s )?damage by ([\d.]+) when attacking/i.exec(clause))) { e.dmgMult = +m[1]; payload = true; }
  if (/takes half damage/i.test(clause)) { e.takenMult = 0.5; payload = true; }
  if ((m = /Reduces damage to (\d+)% when attacked/i.exec(clause))) { e.takenMult = +m[1] / 100; payload = true; }
  if (/follow.?up regardless of AS/i.test(clause)) { e.followAlways = true; payload = true; }
  if ((m = /Reduces Wt of unit.s equipment to (\d+)%/i.exec(clause))) { e.wtMult = +m[1] / 100; payload = true; }
  if ((m = /When healing an ally with magic, restores \+(\d+) HP/i.exec(clause))) { e.heal = +m[1]; return e; }
  if (/When healing an ally with magic, reduces magic cost to 0/i.test(clause)) { e.healFree = true; return e; }
  if (/Unit is armored/i.test(clause)) { e.armored = true; payload = true; }
  if (/cannot change to cavalry or flying/i.test(clause)) { e.locks = ['cavalry', 'flying']; payload = true; }

  const body = clause.replace(/AS (?:≥|is greater than or equal to) foe.s AS ?\+ ?\d+/gi, '').replace(/^\([A-Za-z]+\)/, '');
  if (/^\s*Inflicts .* on adjacent foes/i.test(body)) {
    e.range = 1;
    if (addPairs(e.foeMods, body)) payload = true;
  } else if (/when making a follow-up/i.test(body)) {
    if (addPairs(e.followMods, body)) payload = true;
  } else {
    const options = /grants one of/i.test(body) ? [...body.matchAll(PAIR)].length : 1;
    if (addPairs(e.mods, body, 1 / options)) payload = true;
  }
  return payload ? e : null;
}

/**
 * Parse one ability's text. Returns { effects, reason, assumes }: `reason` is set
 * when nothing could be scored, `assumes` when the score takes a choice of the
 * player's for granted (e.g. "attacks with bow combat arts").
 */
export function parseAbilityText(text) {
  const clean = text.replace(/[’]/g, "'").trim();
  // Healing bonuses mention allies but are scored (support axis).
  const healing = /When healing an ally with magic, (?:restores \+\d+ HP|reduces magic cost)/i.test(clean);
  if (!healing) {
    for (const [re, reason] of NOT_SCORED) if (re.test(clean)) return { effects: [], reason, assumes: null };
  }
  // A standalone "Trigger % = ..." sentence applies to the whole ability.
  const global = /(?:^|\. ?)Trigger ?% ?=/.test(clean) ? parseTrigger(clean) : null;
  const clauses = clean.split(/\. (?=[A-Z(])|, and if /).map((c) => c.trim()).filter((c) => c && !/^Trigger ?%/i.test(c));
  const effects = [];
  let inherited = {};
  for (const clause of clauses) {
    const e = parseClause(clause, inherited);
    if (!e) continue;
    if (!e.trig && global) e.trig = global;
    // "Also grants ..." and ", and if ..." clauses keep the earlier clause's phase / weapon scope.
    inherited = { phase: e.phase, weapon: e.weapon, type: e.type, cls: e.cls };
    effects.push(e);
  }
  if (!effects.length) return { effects, reason: 'not a plain modifier', assumes: null };
  const art = COMBAT_ART.exec(clean);
  return { effects, reason: null, assumes: art ? `attacks with ${art[1] ? `${lower(art[1])} ` : ''}combat arts` : null };
}

/**
 * Attach parsed effects to a character's abilities.
 * "X+" replaces "X" once learned; "Changes the effect of X to grant +N" rewrites X.
 */
export function prepareAbilities(char) {
  const list = (char.abilities || []).map((a) => ({ assumes: null, ...a, replaces: [] }));
  for (const a of list) {
    // An upgrade supersedes its base version: same name plus "+", or an explicit rewrite.
    if (a.name.endsWith('+') && list.some((b) => b.name === a.name.slice(0, -1))) a.replaces.push(a.name.slice(0, -1));
    const m = /Changes the effect of (.+?) to grant \+(\d+)/i.exec(a.text);
    const target = m && list.find((b) => b.name.toLowerCase() === m[1].trim().toLowerCase());
    if (target) {
      a.replaces.push(target.name);
      Object.assign(a, parseAbilityText(target.text.replace(/\+ ?\d+/g, `+${m[2]}`)));
    } else if (a.effects) {
      a.reason = null;   // hand-written effects in the data file win
    } else {
      Object.assign(a, parseAbilityText(a.text));
    }
  }
  return list;
}

/** Abilities a unit has at `level`, upgrades applied. */
export function activeAbilities(char, level) {
  const have = char.abilityList.filter((a) => a.kind === 'personal' || a.level == null || a.level <= level);
  const replaced = new Set(have.flatMap((a) => a.replaces));
  return have.filter((a) => !replaced.has(a.name));
}

/**
 * What a unit's score takes for granted about how it is played, one sentence
 * per assumption: "Pierce and Pierce+ are counted as if Inyoni always attacks with bow combat arts."
 */
export function abilityCaveats(char) {
  const by = new Map();
  for (const a of char.abilityList) if (a.assumes && !a.reason) by.set(a.assumes, [...(by.get(a.assumes) || []), a.name]);
  return [...by].map(([assumes, names]) => {
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are` : `${names[0]} is`;
    return `${list} counted as if ${char.name} always ${assumes}.`;
  });
}

/** Class and movement restrictions that hold for the whole game. */
export function classLocks(char) {
  const locks = new Set();
  for (const a of char.abilityList) if (a.kind === 'personal') for (const e of a.effects) for (const l of e.locks || []) locks.add(l);
  return locks;
}

const cache = new WeakMap();

/** Flat list of scored effects active at `level` (cached per character). */
export function effectsAt(char, level) {
  let byLevel = cache.get(char);
  if (!byLevel) cache.set(char, (byLevel = new Map()));
  let list = byLevel.get(level);
  if (!list) {
    list = activeAbilities(char, level).flatMap((a) => a.effects);
    byLevel.set(level, list);
  }
  return list;
}

const weaponMatches = (e, weapon) =>
  (!e.weapon || (e.weapon === 'magic' ? weapon.type === 'black' || weapon.type === 'white' : weapon.type === e.weapon)) &&
  (!e.weaponName || weapon.name === e.weaponName);
const classMatches = (e, cls) => (!e.type || cls[e.type] === true || (e.type === 'infantry' && cls.infantry)) && (!e.cls || cls.name === e.cls);

/** Effects that can apply to this class holding this weapon. */
export function effectsFor(effects, cls, weapon) {
  return effects.filter((e) => weaponMatches(e, weapon) && classMatches(e, cls));
}

/** Is the effect a pure stat change with no combat condition (applied when the loadout is built)? */
export function isStatic(e) {
  return e.phase === 0 && e.range === 0 && !e.foeMagic && !e.effective && e.asLead == null && !e.canFollow &&
    !e.noFollow && e.minHit == null && !e.foeCantCounter && !e.trig;
}

export { BASE_STATS };
