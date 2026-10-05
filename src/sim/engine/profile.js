// A unit's profile at one checkpoint: separate 0-100 axes for physical and
// magical damage, physical and magical bulk, avoid, support and reach, each
// measured against that checkpoint's reference enemies (see "profile" in
// mechanics.json). Axes are never added up here; roles weight them (search.js).

import { MAG, STATS } from './data.js';
import { makeLoadout, resolveRound, lethalIndex } from './combat.js';
import { modeledEnemy } from './enemies.js';
import { isStatic } from './abilities.js';

export const AXES = ['physDmg', 'magDmg', 'bestDmg', 'safety', 'physBulk', 'magBulk', 'avoid', 'physSurv', 'magSurv', 'support', 'reach', 'duel'];
export const AXIS_LABEL = {
  physDmg: 'Phys dmg', magDmg: 'Mag dmg', bestDmg: 'Best dmg', safety: 'Safe atk', physBulk: 'Phys bulk', magBulk: 'Mag bulk',
  avoid: 'Avoid', physSurv: 'Phys surv', magSurv: 'Mag surv', support: 'Support', reach: 'Reach', duel: 'Duel',
};
const [PHYS_DMG, MAG_DMG, BEST_DMG, SAFETY, PHYS_BULK, MAG_BULK, AVOID, PHYS_SURV, MAG_SURV, SUPPORT, REACH] = AXES.keys();
export const NA = AXES.length;

function tierForLevel(data, level) {
  let tier = 'beginner';
  for (const band of data.mechanics.enemies.tierByLevel.bands) if (level >= band.minLevel) tier = band.tier;
  return tier;
}
/**
 * Reference enemies for every checkpoint: the list for the checkpoint's enemy
 * tier ("references" in mechanics.json), each row at its own level around the
 * checkpoint's enemy level.
 */
export function buildReferences(data, model, { hard = false } = {}) {
  const e = data.mechanics.enemies;
  const hardArr = hard ? STATS.map((s) => e.hardDelta.stats[s] || 0) : null;
  const tiers = data.mechanics.profile.references.tiers;
  return data.checkpoints.map((cp) => {
    const refs = [], seen = new Set();
    for (const row of tiers[tierForLevel(data, cp.enemyLevel)] || []) {
      const cls = data.classes.get(row.class);
      if (!cls) throw new Error(`Reference enemy uses unknown class "${row.class}"`);
      const level = Math.max(1, cp.enemyLevel + (row.level || 0));
      const ref = modeledEnemy(data, model, cls, level, false, hardArr, row.weapon);
      if (!ref) throw new Error(`Reference enemy ${row.class} Lv${level} has no "${row.weapon}" to carry`);
      const key = `${cls.name}|${ref.weapon.name}|${level}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ref.archetype = row.archetype;
      ref.loadout = makeLoadout(ref.stats, null, ref.bld, ref.cls, ref.weapon, data.formulas);
      ref.magic = ref.loadout.magical;
      refs.push(ref);
    }
    return refs;
  });
}

const round = {};

// Scratch space for damage distributions (index = whole HP of damage, last used entry = "dies").
const SIZE = 1024;
let distA = new Float64Array(SIZE), distB = new Float64Array(SIZE);
let hpA = new Float64Array(SIZE), hpB = new Float64Array(SIZE);
const outDmg = new Int32Array(SIZE), outP = new Float64Array(SIZE);
const series = new Float64Array(16), hpLeft = new Float64Array(16);
const KILL_ROUNDS = 4;   // attacks played out exactly before the remaining HP is extrapolated

/**
 * Chance a unit with lethal index `n` is still alive after 1..K attacks that
 * each deal damage drawn from `dist`. Writes them to `series[0..K-1]` (with
 * `track`, also the share of its HP it has left on average, the dead counting as
 * none, to `hpLeft[0..K-1]`) and
 * returns the distribution of its remaining HP after the last one.
 */
function aliveSeries(dist, n, K, track = false) {
  const record = (hp, k) => { let sum = 0; for (let h = 1; h <= n; h++) sum += h * hp[h]; hpLeft[k] = sum / n; };
  let m = 0;
  for (let j = 1; j <= n; j++) if (dist[j] > 0) { outDmg[m] = j; outP[m++] = dist[j]; }
  const p0 = dist[0];
  let a = hpA, b = hpB;
  for (let h = 0; h <= n; h++) a[h] = dist[n - h];
  series[0] = 1 - a[0];
  if (track) record(a, 0);
  for (let k = 1; k < K; k++) {
    if (series[k - 1] < 1e-7) { series[k] = 0; hpLeft[k] = 0; continue; }
    b.fill(0, 0, n + 1);
    b[0] = a[0];
    for (let h = 1; h <= n; h++) {
      const p = a[h];
      if (p === 0) continue;
      b[h] += p * p0;
      for (let i = 0; i < m; i++) { const left = h - outDmg[i]; b[left > 0 ? left : 0] += p * outP[i]; }
    }
    const t = a; a = b; b = t;
    series[k] = 1 - a[0] > 0 ? 1 - a[0] : 0;
    if (track) record(a, k);
  }
  return a;
}

/**
 * Kill speed: 1 / (attacks the unit expects to need to kill), given the damage
 * distribution of one attack. 1 = a certain kill in one attack, 0.5 = two
 * attacks, 0 = it cannot hurt the enemy.
 */
export function killSpeed(dist, n) {
  if (dist[n] >= 1 - 1e-9) return 1;
  let mean = 0;
  for (let j = 1; j <= n; j++) mean += j * dist[j];
  if (mean < 1e-9) return 0;
  const left = aliveSeries(dist, n, KILL_ROUNDS);
  let attacks = 1;
  for (let k = 0; k < KILL_ROUNDS - 1; k++) attacks += series[k];
  // Whatever is still standing needs about (HP left / average damage) more attacks, at least one.
  for (let h = 1; h <= n; h++) if (left[h] > 0) attacks += left[h] * (h > mean ? h / mean : 1);
  return 1 / attacks;
}

/**
 * How a unit comes out of being attacked by one enemy, by two, ... by `K`, each
 * attack drawn from `dist`: the share of its HP it has left on average (dead = none),
 * averaged over those fights.
 */
export function phaseSurvival(dist, n, K) {
  aliveSeries(dist, n, K, true);
  let sum = 0;
  for (let k = 0; k < K; k++) sum += hpLeft[k];
  return sum / K;
}

/**
 * Best attack of loadout `L` against `E` in attacks it starts, over its ranges
 * (ties go to the range where it takes less in return), or -1 when it cannot
 * beat `floor`. An attack is worth its chance to kill outright and its kill
 * speed, `ko` and 1 - `ko` of the score ("oneAttackKill" in mechanics.json).
 * Writes the share of its own HP lost in that exchange to `strike.taken`.
 */
const strike = { taken: 0 };
function bestStrike(L, E, F, ko, info, floor = -1) {
  let best = -1;
  const n = lethalIndex(E.hp);
  for (let d = L.lo; d <= L.hi; d++) {
    resolveRound(L, E, d >= E.lo && d <= E.hi, F, round, d, distA);
    // Neither kill speed nor the chance to kill can exceed the share of the enemy's HP one attack removes on average.
    const share = round.dealt / E.hp;
    if (share < floor - 1e-9 || share < best - 1e-9) continue;
    // Nor can kill speed exceed 1 / (2 - the chance to kill): an attack that does not kill needs another.
    const cap = ko * round.kill + (1 - ko) * Math.min(share, 1 / (2 - round.kill));
    if (cap < floor - 1e-9 || cap < best - 1e-9) continue;
    const speed = killSpeed(distA, n), taken = round.taken / L.hp;
    const value = ko * round.kill + (1 - ko) * speed;
    if (value > best + 1e-9 || (value > best - 1e-9 && taken < strike.taken)) {
      best = value;
      strike.taken = taken;
      if (info) Object.assign(info, { weapon: L.weapon.name, range: d, dmg: round.dmgI, hit: round.hitI, crit: round.critI, follow: round.followI, share, kill: round.kill, speed, taken });
    }
  }
  return best;
}

/**
 * `E` starts the fight against loadout `L`, from the range that costs the unit
 * the most HP on average. Writes the share of the unit's HP lost if every
 * enemy strike lands, the enemy's hit chance and the expected share lost, and
 * leaves the damage distribution of that attack in `distB`.
 */
function worstHit(L, E, F, out) {
  out.lost = 0; out.hit = 0; out.expected = -1; out.dmg = 0; out.follow = 0;
  for (let d = E.lo; d <= E.hi; d++) {
    resolveRound(E, L, d >= L.lo && d <= L.hi, F, round, d, distA);
    const lost = Math.min(1, (round.dmgI * (1 + round.followI * (E.sword ? F.swordFollowUp : 1))) / L.hp);
    if (lost > out.lost) { out.lost = lost; out.dmg = round.dmgI; out.follow = round.followI; out.range = d; }
    if (round.hitI > out.hit) out.hit = round.hitI;
    // Expected loss with hit and crit chances (and the unit's own counter) played out.
    const expected = round.dealt / L.hp;
    if (expected > out.expected) { out.expected = expected; const t = distA; distA = distB; distB = t; }
  }
  return out;
}

const hitOut = {};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** HP the unit can heal in one map: the strongest casts first, up to the per-map cap. */
export function healCapacity(data, gear, detail = null) {
  const P = data.mechanics.profile;
  const { heals, stats, effects, cls } = gear;
  if (!heals.length) return 0;
  let bonus = cls.healBonus, free = 0;
  for (const e of effects) {
    if (!e.heal && !e.healFree) continue;
    const w = !e.trig ? 1 : e.trig.pct != null ? e.trig.pct / 100 : clamp01(stats[STAT_OF[e.trig.stat]] / e.trig.div / 100);
    if (e.heal) bonus += w * e.heal;
    if (e.healFree) free = Math.min(0.9, w);
  }
  const casts = heals.map(({ heal, uses }) => ({
    name: heal.name,
    amount: (heal.power + stats[MAG] / P.healFormula.magDiv + bonus) * (heal.area ? P.healAreaTargets.value : 1),
    uses: uses / (1 - free),
  })).sort((a, b) => b.amount - a.amount);
  let left = P.healCastsPerMap.value, total = 0;
  for (const c of casts) {
    const n = Math.min(left, c.uses);
    total += n * c.amount;
    left -= n;
    if (detail) detail.push({ name: c.name, amount: c.amount, casts: n });
    if (left <= 0) break;
  }
  return total;
}
const STAT_OF = Object.fromEntries(STATS.map((s, i) => [s, i]));

/** Movement including ability bonuses and the flier allowance. */
export function effectiveMov(data, cls, effects) {
  let mov = cls.mov;
  for (const e of effects) if (isStatic(e) && e.mods.mov && (!e.type || cls[e.type]) && !e.weapon) mov += e.mods.mov;
  return mov;
}

/**
 * Profile of a unit at one checkpoint.
 * `gear` is unitLoadouts() output plus `cls`; `refs` the checkpoint's reference enemies.
 * Returns the axes (Float64Array, AXES order; `duel` left 0) and, with `detail`, the per-enemy numbers.
 */
export function evalProfile(data, gear, refs, detail = false) {
  const F = data.formulas;
  const P = data.mechanics.profile;
  const axes = new Float64Array(NA);
  const rows = detail ? [] : null;
  const KC = P.combatsPerMap.value;
  const ko = P.oneAttackKill.value;
  const physical = gear.loadouts.filter((L) => !L.magical);
  const magical = gear.loadouts.filter((L) => L.magical);

  let phys = 0, mag = 0, safe = 0;
  const nMag = refs.filter((r) => r.magic).length, nPhys = refs.length - nMag;
  const shares = [];
  // The weapon the unit attacks with is the one it is left holding when the enemy answers
  // ("heldWeapon" in mechanics.json): weapon -> the share of the reference enemies it is used on.
  const held = new Map();
  const hold = (L, w) => held.set(L, (held.get(L) || 0) + w);
  for (const ref of refs) {
    const E = ref.loadout;
    const row = detail ? { ref, phys: null, mag: null, def: null } : null;

    let best = 0, physTaken = 0, bestL = null;
    for (const L of physical) {
      const info = detail ? {} : null;
      const s = bestStrike(L, E, F, ko, info, best);
      if (s > best) { best = s; bestL = L; physTaken = strike.taken; if (row) row.phys = info; }
    }
    phys += best;

    // Spells run out: fill the map's attacks with the best casts available.
    shares.length = 0;
    for (const L of magical) {
      const info = detail ? {} : null;
      const s = bestStrike(L, E, F, ko, info);
      shares.push({ s, taken: strike.taken, uses: L.uses, info, L });
    }
    shares.sort((a, b) => b.s - a.s);
    let left = KC, sum = 0, magTaken = 0;
    for (const c of shares) {
      const n = Math.min(left, c.uses);
      sum += n * c.s;
      magTaken += n * c.taken;
      left -= n;
      if (left <= 0) break;
    }
    mag += sum / KC;
    // Safety of the unit's own attack, for whichever kind of damage is its better one here.
    safe += 1 - (sum / KC > best ? magTaken / (KC - left || 1) : physTaken);
    if (sum / KC > best) {
      let casts = KC;
      for (const c of shares) {
        const n = Math.min(casts, c.uses);
        hold(c.L, n / (KC - left));
        casts -= n;
        if (casts <= 0) break;
      }
    } else if (bestL) hold(bestL, 1);
    if (row && shares.length) row.mag = { ...shares[0].info, average: sum / KC, casts: Math.min(KC, shares[0].uses) };

    if (row) rows.push(row);
  }

  // Defence, with the weapons the unit attacks with (one that cannot hurt anything
  // may be holding any of them). Bulk and avoid are read per enemy. Survival is the
  // small fight: one attacker, then two, up to `enemyPhaseAttacks`, drawn evenly from
  // the physical (or magical) reference enemies, and the HP the unit has left after each.
  const K = P.enemyPhaseAttacks.value;
  if (!held.size) for (const L of gear.loadouts) hold(L, 1);
  let total = 0;
  for (const w of held.values()) total += w;
  const lost = refs.map(() => 0), hit = refs.map(() => 0), expected = refs.map(() => 0);
  const dmg = refs.map(() => 0), follow = refs.map(() => 0);
  const blank = () => ({ alive: new Array(K).fill(0), left: new Array(K).fill(0) });
  const survive = detail ? { phys: nPhys ? blank() : null, mag: nMag ? blank() : null } : null;
  let pSurv = 0, mSurv = 0;
  for (const [L, share] of held) {
    const w = share / total;
    const n = lethalIndex(L.hp);
    const mixP = new Float64Array(n + 1), mixM = new Float64Array(n + 1);
    refs.forEach((ref, r) => {
      worstHit(L, ref.loadout, F, hitOut);
      lost[r] += w * hitOut.lost;
      hit[r] += w * hitOut.hit;
      expected[r] += w * hitOut.expected;
      dmg[r] += w * hitOut.dmg;
      follow[r] += w * hitOut.follow;
      const mix = ref.magic ? mixM : mixP, each = 1 / (ref.magic ? nMag : nPhys);
      for (let j = 0; j <= n; j++) mix[j] += each * distB[j];
    });
    if (nPhys) {
      pSurv += w * phaseSurvival(mixP, n, K);
      if (survive) for (let k = 0; k < K; k++) { survive.phys.alive[k] += w * series[k]; survive.phys.left[k] += w * hpLeft[k]; }
    }
    if (nMag) {
      mSurv += w * phaseSurvival(mixM, n, K);
      if (survive) for (let k = 0; k < K; k++) { survive.mag.alive[k] += w * series[k]; survive.mag.left[k] += w * hpLeft[k]; }
    }
  }
  const holding = detail ? [...held].map(([L, share]) => ({ weapon: L.weapon.name, share: share / total })).sort((x, y) => y.share - x.share) : null;
  let pBulk = 0, mBulk = 0, avoid = 0;
  refs.forEach((ref, r) => {
    if (ref.magic) mBulk += 1 - lost[r]; else pBulk += 1 - lost[r];
    avoid += 1 - hit[r];
    if (rows) {
      rows[r].def = { weapon: holding[0].weapon, dmg: dmg[r], follow: follow[r], lost: lost[r], hit: hit[r], expected: expected[r] };
      rows[r].avoid = 1 - hit[r];
    }
  });
  const n = refs.length || 1;
  axes[PHYS_DMG] = 100 * phys / n;
  axes[MAG_DMG] = 100 * mag / n;
  axes[BEST_DMG] = Math.max(axes[PHYS_DMG], axes[MAG_DMG]);
  axes[SAFETY] = 100 * safe / n;
  axes[PHYS_BULK] = 100 * pBulk / (nPhys || 1);
  axes[MAG_BULK] = 100 * mBulk / (nMag || 1);
  axes[AVOID] = 100 * avoid / n;
  axes[PHYS_SURV] = 100 * pSurv;
  axes[MAG_SURV] = 100 * mSurv;

  const ally = refs.find((r) => r.archetype === 'fighter') || refs[0];
  const healDetail = detail ? [] : null;
  const healed = healCapacity(data, gear, healDetail);
  let support = ally ? 100 * healed / (P.healBars.value * ally.stats[0]) : 0;
  if (gear.cls.dance) support += P.dance.value;
  axes[SUPPORT] = Math.min(100, support);

  const mov = effectiveMov(data, gear.cls, gear.effects) + (gear.cls.flying ? P.flyingMov : 0);
  axes[REACH] = 100 * clamp01((mov - P.movFloor) / (P.movCeil - P.movFloor));
  return { axes, rows, healed, heals: healDetail, mov, survive, held: holding };
}
