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
const TIER_SLOT = { beginner: 0, specialty: 1, advanced: 2, master: 3 };

/** Reference enemies for every checkpoint: one per archetype, at the checkpoint's enemy level. */
export function buildReferences(data, model, { hard = false } = {}) {
  const e = data.mechanics.enemies;
  const hardArr = hard ? STATS.map((s) => e.hardDelta.stats[s] || 0) : null;
  return data.checkpoints.map((cp) => {
    const slot = TIER_SLOT[tierForLevel(data, cp.enemyLevel)];
    const refs = [];
    for (const arch of data.mechanics.profile.references.archetypes) {
      const cls = arch.classes[slot] && data.classes.get(arch.classes[slot]);
      const ref = cls && modeledEnemy(data, model, cls, cp.enemyLevel, false, hardArr);
      if (!ref) continue;
      ref.archetype = arch.name;
      ref.magic = !!arch.magic;
      ref.loadout = makeLoadout(ref.stats, null, ref.bld, ref.cls, ref.weapon, data.formulas);
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
const series = new Float64Array(16);
const KILL_ROUNDS = 4;   // attacks played out exactly before the remaining HP is extrapolated

/**
 * Chance a unit with lethal index `n` is still alive after 1..K attacks that
 * each deal damage drawn from `dist`. Writes them to `series[0..K-1]` and
 * returns the distribution of its remaining HP after the last one.
 */
function aliveSeries(dist, n, K) {
  let m = 0;
  for (let j = 1; j <= n; j++) if (dist[j] > 0) { outDmg[m] = j; outP[m++] = dist[j]; }
  const p0 = dist[0];
  let a = hpA, b = hpB;
  for (let h = 0; h <= n; h++) a[h] = dist[n - h];
  series[0] = 1 - a[0];
  for (let k = 1; k < K; k++) {
    if (series[k - 1] < 1e-7) { series[k] = 0; continue; }
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

/** Share of an enemy phase of `K` attacks, each drawn from `dist`, the unit is alive for. */
export function phaseSurvival(dist, n, K) {
  aliveSeries(dist, n, K);
  let sum = 0;
  for (let k = 0; k < K; k++) sum += series[k];
  return sum / K;
}

/**
 * Best kill speed of loadout `L` against `E` in attacks it starts, over its
 * ranges (ties go to the range where it takes less in return), or -1 when it
 * cannot beat `floor`. Writes the share of its own HP lost in that exchange to
 * `strike.taken`.
 */
const strike = { taken: 0 };
function bestStrike(L, E, F, info, floor = -1) {
  let best = -1;
  const n = lethalIndex(E.hp);
  for (let d = L.lo; d <= L.hi; d++) {
    resolveRound(L, E, d >= E.lo && d <= E.hi, F, round, d, distA);
    // Kill speed can never exceed the share of the enemy's HP one attack removes on average.
    const share = round.dealt / E.hp;
    if (share < floor - 1e-9 || share < best - 1e-9) continue;
    const speed = killSpeed(distA, n), taken = round.taken / L.hp;
    if (speed > best + 1e-9 || (speed > best - 1e-9 && taken < strike.taken)) {
      best = speed;
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
  const physical = gear.loadouts.filter((L) => !L.magical);
  const magical = gear.loadouts.filter((L) => L.magical);

  let phys = 0, mag = 0, safe = 0;
  const nMag = refs.filter((r) => r.magic).length, nPhys = refs.length - nMag;
  const shares = [];
  for (const ref of refs) {
    const E = ref.loadout;
    const row = detail ? { ref, phys: null, mag: null, def: null } : null;

    let best = 0, physTaken = 0;
    for (const L of physical) {
      const info = detail ? {} : null;
      const s = bestStrike(L, E, F, info, best);
      if (s > best) { best = s; physTaken = strike.taken; if (row) row.phys = info; }
    }
    phys += best;

    // Spells run out: fill the map's attacks with the best casts available.
    shares.length = 0;
    for (const L of magical) {
      const info = detail ? {} : null;
      const s = bestStrike(L, E, F, info);
      shares.push({ s, taken: strike.taken, uses: L.uses, info });
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
    if (row && shares.length) row.mag = { ...shares[0].info, average: sum / KC, casts: Math.min(KC, shares[0].uses) };

    if (row) rows.push(row);
  }

  // Defence. Bulk and avoid are read per enemy with the weapon that suits it best.
  // Survival plays out a whole enemy phase: the unit holds one weapon while
  // `enemyPhaseAttacks` attackers, drawn evenly from the physical (or magical)
  // reference enemies, come at it one after another.
  const K = P.enemyPhaseAttacks.value;
  const lost = refs.map(() => 1), hit = refs.map(() => 1), expected = refs.map(() => 1);
  const phase = gear.loadouts.map((L) => {
    const n = lethalIndex(L.hp);
    const mixP = new Float64Array(n + 1), mixM = new Float64Array(n + 1);
    let meanP = 0, meanM = 0;
    refs.forEach((ref, r) => {
      worstHit(L, ref.loadout, F, hitOut);
      if (hitOut.expected < expected[r]) expected[r] = hitOut.expected;
      if (hitOut.hit < hit[r]) hit[r] = hitOut.hit;
      if (hitOut.lost < lost[r] || (rows && !rows[r].def)) {
        lost[r] = Math.min(lost[r], hitOut.lost);
        if (rows) rows[r].def = { weapon: L.weapon.name, dmg: hitOut.dmg, follow: hitOut.follow, lost: lost[r], hit: hitOut.hit };
      }
      const mix = ref.magic ? mixM : mixP, share = 1 / (ref.magic ? nMag : nPhys);
      for (let j = 0; j <= n; j++) mix[j] += share * distB[j];
      if (ref.magic) meanM += share * hitOut.expected; else meanP += share * hitOut.expected;
    });
    return { L, n, mixP, mixM, meanP, meanM };
  });
  // The weapon to hold is the one that survives the phase best. Only weapons that lose
  // close to the least HP per attack on average can be that one; the rest are not played out.
  const survive = detail ? { phys: null, mag: null } : null;
  const best = (mix, mean, key) => {
    const least = Math.min(...phase.map((p) => p[mean]));
    let top = 0;
    for (const p of phase) {
      if (p[mean] > least * 1.1 + 1e-9) continue;
      const s = phaseSurvival(p[mix], p.n, K);
      if (s > top || (survive && !survive[key])) { top = Math.max(top, s); if (survive) survive[key] = { weapon: p.L.weapon.name, alive: Array.from(series.subarray(0, K)) }; }
    }
    return top;
  };
  const pSurv = nPhys ? best('mixP', 'meanP', 'phys') : 0;
  const mSurv = nMag ? best('mixM', 'meanM', 'mag') : 0;
  let pBulk = 0, mBulk = 0, avoid = 0;
  refs.forEach((ref, r) => {
    if (ref.magic) mBulk += 1 - lost[r]; else pBulk += 1 - lost[r];
    avoid += 1 - hit[r];
    if (rows) { rows[r].def.expected = expected[r]; rows[r].avoid = 1 - hit[r]; }
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
  return { axes, rows, healed, heals: healDetail, mov, survive };
}
