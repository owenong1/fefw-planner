// Combat resolution. One "round" is a single engagement: the initiator
// strikes, the defender counters if its weapon reaches, then whoever has at
// least +4 Attack Speed strikes again. Outcomes are computed exactly by walking
// the hit / crit / miss tree - no dice are rolled here.

import { HP, STR, MAG, SPD, DEX, DEF, RES, LCK, STATS } from './data.js';
import { isStatic } from './abilities.js';

const STAT_INDEX = Object.fromEntries(STATS.map((s, i) => [s, i]));

/**
 * Everything combat needs to know about one unit holding one weapon.
 * `stats` are in-game stats (class bonus included); `vars` is the per-stat
 * variance when `stats` are expected values (null for an exact unit).
 * `effects` are the unit's ability effects that fit this class and weapon
 * (see abilities.js): plain stat changes are applied here, the rest are kept
 * on the loadout and resolved in each combat.
 */
export function makeLoadout(stats, vars, bld, cls, weapon, F, effects = null) {
  let wt = weapon.wt, armored = cls.armored, fx = null;
  if (effects && effects.length) {
    stats = Float64Array.from(stats);
    for (const e of effects) {
      wt *= e.wtMult;
      if (e.armored) armored = true;
      let dynamic = e.dmgMult !== 1 || e.takenMult !== 1 || e.followAlways || !isStatic(e);
      for (const k in e.mods) {
        if (!isStatic(e)) break;
        if (k === 'bld') bld += e.mods[k];
        else if (k in STAT_INDEX) stats[STAT_INDEX[k]] += e.mods[k];
        else dynamic = true;
      }
      for (const k in e.foeMods) { dynamic = true; break; }
      for (const k in e.followMods) { dynamic = true; break; }
      if (dynamic) (fx ||= []).push(e);
    }
  }
  const mods = cls.weaponMods[weapon.type];
  const burden = Math.max(0, wt - bld);
  const as = stats[SPD] - burden;
  const magical = weapon.magical === true;
  const eff = weapon.effective || {};
  return {
    weapon,
    cls,
    stats,
    fx,
    magical,
    hp: stats[HP],
    atk: magical ? stats[MAG] : stats[STR],
    mt: weapon.mt,
    hit: weapon.hit + F.hitDex * stats[DEX] + F.hitLck * stats[LCK] + (mods ? mods.hit : 0),
    crit: weapon.crit + F.critDex * stats[DEX] + F.critLck * stats[LCK] + (mods ? mods.crit : 0),
    as,
    asVar: vars ? vars[SPD] : 0,
    avo: as + (mods ? mods.avo : 0) + (weapon.type === 'gauntlet' ? F.gauntletAvo : 0) + (weapon.avo || 0) + (cls.avoBonus || 0),
    ddg: F.dodgeLck * stats[LCK],
    prt: stats[DEF],
    rsl: stats[RES],
    guardPrt: cls.guardPrt,
    guardRsl: cls.guardRsl,
    lo: weapon.range[0],
    hi: weapon.range[1],
    hitsRsl: magical && weapon.targets !== 'prt',
    sword: weapon.type === 'sword',
    axe: weapon.type === 'axe',
    effFlying: eff.flying || 1,
    effCavalry: eff.cavalry || 1,
    effArmored: eff.armored || 1,
    flying: cls.flying,
    cavalry: cls.cavalry,
    armored,
  };
}

/** Might multiplier of `att`'s weapon against `def`'s class type. */
export function effectiveness(att, def) {
  let mult = 1;
  if (def.flying && att.effFlying > mult) mult = att.effFlying;
  if (def.cavalry && att.effCavalry > mult) mult = att.effCavalry;
  if (def.armored && att.effArmored > mult) mult = att.effArmored;
  return mult;
}

/**
 * Damage of one non-critical strike. `defInitiated`: the defender started the
 * fight. `atkAdd` / `defAdd` are ability bonuses to Atk and to Prt or Rsl.
 */
export function strikeDamage(att, def, defInitiated, F, atkAdd = 0, defAdd = 0) {
  const guard = defInitiated ? 0 : (att.hitsRsl ? def.guardRsl : def.guardPrt);
  const raw = att.atk + atkAdd + att.mt * effectiveness(att, def) - (att.hitsRsl ? def.rsl : def.prt) - defAdd - guard;
  let dmg = raw > 0 ? raw : 0;
  if (att.axe && dmg < F.axeMin) dmg = F.axeMin;
  return dmg;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Abramowitz-Stegun approximation of the standard normal CDF.
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const tail = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

/**
 * Chance that `diff + noise >= threshold`. With exact stats this is 0 or 1;
 * with expected stats the Speed variance turns the follow-up cliff into a slope.
 */
export function followUpChance(diff, variance, threshold) {
  if (variance < 1e-9) return diff >= threshold - 1e-9 ? 1 : 0;
  const p = 1 - normCdf((threshold - 0.5 - diff) / Math.sqrt(variance));
  return p < 0.02 ? 0 : p > 0.98 ? 1 : p;
}

// Scratch state for the outcome tree (at most three strikes per round).
const who = new Int8Array(3);
const sHit = new Float64Array(3);
const sCrit = new Float64Array(3);
const sDmg = new Float64Array(3);
const sCdmg = new Float64Array(3);
let nStrikes = 0;
let accHpI = 0, accHpD = 0, accKillD = 0, accKillI = 0;
// When a caller asks for it: the distribution of damage the defender takes.
let accDist = null, distHp = 0, distN = 0;

/** Index of the "defender is dead" entry in a damage distribution for a unit with `hp`. */
export function lethalIndex(hp) {
  return Math.ceil(hp - 1e-9);
}

function walk(k, hpI, hpD, p) {
  if (k === nStrikes || hpI <= 0 || hpD <= 0) {
    accHpI += p * (hpI > 0 ? hpI : 0);
    accHpD += p * (hpD > 0 ? hpD : 0);
    if (hpD <= 0) accKillD += p;
    if (hpI <= 0) accKillI += p;
    if (accDist) {
      if (hpD <= 1e-9) accDist[distN] += p;
      else {
        // Fractional damage (averaged triggers) is split between the whole numbers either side.
        const d = distHp - hpD, lo = Math.floor(d + 1e-9), f = d - lo;
        if (f < 1e-9 || lo + 1 >= distN) accDist[lo < distN ? lo : distN - 1] += p;
        else { accDist[lo] += p * (1 - f); accDist[lo + 1] += p * f; }
      }
    }
    return;
  }
  const h = sHit[k], c = sCrit[k];
  if (h < 1) walk(k + 1, hpI, hpD, p * (1 - h));
  if (h > 0) {
    if (who[k] === 0) {
      if (c < 1) walk(k + 1, hpI, hpD - sDmg[k], p * h * (1 - c));
      if (c > 0) walk(k + 1, hpI, hpD - sCdmg[k], p * h * c);
    } else {
      if (c < 1) walk(k + 1, hpI - sDmg[k], hpD, p * h * (1 - c));
      if (c > 0) walk(k + 1, hpI - sCdmg[k], hpD, p * h * c);
    }
  }
}

function setStrike(k, side, hit, crit, dmg, F) {
  who[k] = side;
  sHit[k] = hit;
  sCrit[k] = dmg > 0 ? crit : 0;
  sDmg[k] = dmg;
  sCdmg[k] = dmg * F.critMult;
}

function followDamage(att, dmg, F) {
  if (!att.sword) return dmg;
  const boosted = dmg * F.swordFollowUp;
  return Number.isInteger(dmg) ? Math.floor(boosted + 1e-9) : boosted;
}

// Ability bonuses for one side of one combat.
function blankAdj() {
  return { hit: 0, avo: 0, crit: 0, atk: 0, as: 0, prt: 0, rsl: 0, ddg: 0, dmgMult: 1, takenMult: 1,
    followAlways: 0, fHit: 0, fCrit: 0, foeHit: 0, foeAvo: 0, foeCrit: 0, foeDdg: 0 };
}
const adjI = blankAdj(), adjD = blankAdj();
const ZERO = Object.freeze(blankAdj());

/**
 * Add the effects of `L` that apply in this combat to `adj`. Effects are
 * resolved in three stages because some conditions depend on earlier results:
 * 0 = plain conditions, 1 = Attack Speed / follow-up conditions (`pLead(k)`,
 * `pFollow`, `pNone` are then known), 2 = conditions on the unit's hit chance.
 */
function gather(adj, L, foe, initiating, range, foeCanCounter, stage, info) {
  for (const e of L.fx) {
    const eStage = e.minHit != null ? 2 : (e.asLead != null || e.canFollow || e.noFollow) ? 1 : 0;
    if (eStage !== stage) continue;
    if (e.phase === 1 && !initiating) continue;
    if (e.phase === 2 && initiating) continue;
    if (e.range === 1 && range !== 1) continue;
    if (e.range === 2 && range < 2) continue;
    if (e.foeMagic && !foe.magical) continue;
    if (e.effective && effectiveness(L, foe) <= 1) continue;
    if (e.foeCantCounter && !(initiating && !foeCanCounter)) continue;
    let w = 1;
    if (e.trig) w = e.trig.pct != null ? e.trig.pct / 100 : L.stats[STAT_INDEX[e.trig.stat]] / e.trig.div / 100;
    if (stage === 1) {
      if (e.asLead != null) w *= info.pLead(e.asLead);
      if (e.canFollow) w *= info.pFollow;
      if (e.noFollow) w *= info.pNone;
    } else if (stage === 2 && info.hit * 100 < e.minHit - 1e-9) continue;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    if (w === 0) continue;
    const m = e.mods;
    // A conditional Str / Mag bonus acts as Atk; other base stats only count when unconditional (see makeLoadout).
    for (const k in m) {
      if (k in adj && k !== 'dmgMult') adj[k] += w * m[k];
      else if ((k === 'str' && !L.magical) || (k === 'mag' && L.magical)) { if (!isStatic(e)) adj.atk += w * m[k]; }
    }
    if (e.dmgMult !== 1) adj.dmgMult *= 1 + w * (e.dmgMult - 1);
    if (e.takenMult !== 1) adj.takenMult *= 1 - w * (1 - e.takenMult);
    if (e.followAlways) adj.followAlways = 1 - (1 - adj.followAlways) * (1 - w);
    if (e.followMods.hit) adj.fHit += w * e.followMods.hit;
    if (e.followMods.crit) adj.fCrit += w * e.followMods.crit;
    const f = e.foeMods;
    if (f.hit) adj.foeHit += w * f.hit;
    if (f.avo) adj.foeAvo += w * f.avo;
    if (f.crit) adj.foeCrit += w * f.crit;
    if (f.ddg) adj.foeDdg += w * f.ddg;
  }
}

// Hit and crit chance of `a` against `d`, with each side's ability bonuses (`x` for a, `y` for d).
const hitOf = (a, d, x, y) => clamp01((a.hit + x.hit + y.foeHit - d.avo - y.avo - x.foeAvo) / 100);
const critOf = (a, d, x, y) => clamp01((a.crit + x.crit + y.foeCrit - d.ddg - y.ddg - x.foeDdg) / 100);

/**
 * Resolve one round with `I` initiating against `D` at `range`, both at full HP.
 * Writes into `out`:
 *   dealt / kill  - expected damage to D (capped at its HP) and chance D dies
 *   taken / death - the same for I
 * plus the per-strike numbers for reporting.
 * With `dist` (length > lethalIndex(D.hp)) it is also filled with the chance of
 * each whole amount of damage to D; the entry at lethalIndex(D.hp) is "D dies".
 */
export function resolveRound(I, D, canCounter, F, out, range = 1, dist = null) {
  let aI = ZERO, aD = ZERO;
  if (I.fx) { aI = Object.assign(adjI, ZERO); gather(aI, I, D, true, range, canCounter, 0, null); }
  if (D.fx) { aD = Object.assign(adjD, ZERO); gather(aD, D, I, false, range, true, 0, null); }

  const variance = I.asVar + D.asVar;
  const diff = I.as + aI.as - D.as - aD.as;
  let pI = followUpChance(diff, variance, F.followUp);
  if (aI.followAlways) pI = aI.followAlways + (1 - aI.followAlways) * pI;
  let pD = canCounter ? followUpChance(-diff, variance, F.followUp) : 0;
  if (canCounter && aD.followAlways) pD = aD.followAlways + (1 - aD.followAlways) * pD;
  pD = Math.min(1 - pI, pD);
  const pNone = 1 - pI - pD;

  if (I.fx) gather(aI, I, D, true, range, canCounter, 1, { pLead: (k) => followUpChance(diff, variance, k), pFollow: pI, pNone });
  if (D.fx) gather(aD, D, I, false, range, true, 1, { pLead: (k) => followUpChance(-diff, variance, k), pFollow: pD, pNone });

  if (I.fx) gather(aI, I, D, true, range, canCounter, 2, { hit: hitOf(I, D, aI, aD) });
  if (D.fx && canCounter) gather(aD, D, I, false, range, true, 2, { hit: hitOf(D, I, aD, aI) });

  const dmgI = strikeDamage(I, D, false, F, aI.atk, I.hitsRsl ? aD.rsl : aD.prt) * aI.dmgMult * aD.takenMult;
  const hitI = hitOf(I, D, aI, aD);
  const critI = critOf(I, D, aI, aD);
  let dmgD = 0, hitD = 0, critD = 0;
  if (canCounter) {
    dmgD = strikeDamage(D, I, true, F, aD.atk, D.hitsRsl ? aI.rsl : aI.prt) * aD.dmgMult * aI.takenMult;
    hitD = hitOf(D, I, aD, aI);
    critD = critOf(D, I, aD, aI);
  }

  accHpI = 0; accHpD = 0; accKillD = 0; accKillI = 0;
  accDist = dist;
  if (dist) { distHp = D.hp; distN = lethalIndex(D.hp); dist.fill(0, 0, distN + 1); }
  setStrike(0, 0, hitI, critI, dmgI, F);
  let base = 1;
  if (canCounter) { setStrike(1, 1, hitD, critD, dmgD, F); base = 2; }
  if (pNone > 0) { nStrikes = base; walk(0, I.hp, D.hp, pNone); }
  if (pI > 0) {
    setStrike(base, 0, clamp01(hitI + aI.fHit / 100), clamp01(critI + aI.fCrit / 100), followDamage(I, dmgI, F), F);
    nStrikes = base + 1;
    walk(0, I.hp, D.hp, pI);
  }
  if (pD > 0) {
    setStrike(base, 1, clamp01(hitD + aD.fHit / 100), clamp01(critD + aD.fCrit / 100), followDamage(D, dmgD, F), F);
    nStrikes = base + 1;
    walk(0, I.hp, D.hp, pD);
  }
  accDist = null;
  out.dealt = D.hp - accHpD;
  out.kill = accKillD;
  out.taken = I.hp - accHpI;
  out.death = accKillI;
  out.dmgI = dmgI; out.hitI = hitI; out.critI = critI; out.followI = pI;
  out.dmgD = dmgD; out.hitD = hitD; out.critD = critD; out.followD = pD;
  return out;
}
