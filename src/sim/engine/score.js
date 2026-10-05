// The legacy duel score (--role duel): "this unit, with these stats, in this
// class" as one 0-100 number against a checkpoint's whole enemy roster.

import { resolveRound } from './combat.js';

const round = {};

/** Initiator-side strike numbers of the round just resolved, for reports. */
function strikeInfo(L, range, r) {
  return { weapon: L.weapon.name, range, dmg: r.dmgI, hit: r.hitI, crit: r.critI, follow: r.followI };
}

/**
 * Score a unit (its candidate loadouts) against a roster.
 *
 * Player phase: the unit attacks each enemy with its best weapon from its best
 * range. Enemy phase: the unit commits to a weapon, then the enemy attacks
 * from whichever of its ranges is worst for the unit.
 */
export function evalCheckpoint(data, loadouts, roster, detail = false) {
  const S = data.mechanics.scoring;
  const F = data.formulas;
  // Weapon choice uses the same weights as the final score.
  const span = S.bulkFloor - S.bulkCeil;
  const kPP = (S.bulk * (1 - S.takenEP)) / span;
  const kEP = (S.bulk * S.takenEP) / span;
  const agg = { dealPP: 0, koPP: 0, takenPP: 0, dealEP: 0, koEP: 0, takenEP: 0, deathEP: 0 };
  const rows = detail ? [] : null;

  for (const enemy of roster) {
    const E = enemy.loadout;
    // Best player-phase option and best enemy-phase option found so far.
    let ppValue = -Infinity, ppDeal = 0, ppKo = 0, ppTaken = 0, ppInfo = null;
    let epValue = -Infinity, epDeal = 0, epKo = 0, epTaken = 0, epDeath = 0, epInfo = null;

    for (const L of loadouts) {
      for (let d = L.lo; d <= L.hi; d++) {
        resolveRound(L, E, d >= E.lo && d <= E.hi, F, round, d);
        const deal = round.dealt / E.hp, taken = round.taken / L.hp;
        const value = S.offense * (S.dealPP * deal + S.koPP * round.kill) - kPP * taken;
        if (value > ppValue) {
          ppValue = value; ppDeal = deal; ppKo = round.kill; ppTaken = taken;
          if (detail) ppInfo = strikeInfo(L, d, round);
        }
      }
      // The enemy picks the range that is worst for this weapon.
      let wValue = Infinity, wDeal = 0, wKo = 0, wTaken = 0, wDeath = 0, wInfo = null;
      for (let d = E.lo; d <= E.hi; d++) {
        resolveRound(E, L, d >= L.lo && d <= L.hi, F, round, d);
        const deal = round.taken / E.hp, taken = round.dealt / L.hp;
        const value = S.offense * S.dealEP * deal - kEP * taken;
        if (value < wValue) {
          wValue = value; wDeal = deal; wKo = round.death; wTaken = taken; wDeath = round.kill;
          if (detail) wInfo = strikeInfo(L, d, round);
        }
      }
      if (wValue > epValue) {
        epValue = wValue; epDeal = wDeal; epKo = wKo; epTaken = wTaken; epDeath = wDeath; epInfo = wInfo;
      }
    }

    const w = enemy.share;
    agg.dealPP += w * ppDeal; agg.koPP += w * ppKo; agg.takenPP += w * ppTaken;
    agg.dealEP += w * epDeal; agg.koEP += w * epKo; agg.takenEP += w * epTaken; agg.deathEP += w * epDeath;
    if (rows) {
      rows.push({
        enemy,
        pp: { ...ppInfo, deal: ppDeal, ko: ppKo, taken: ppTaken },
        ep: { ...epInfo, deal: epDeal, ko: epKo, taken: epTaken, death: epDeath },
      });
    }
  }

  const offense = S.dealPP * agg.dealPP + S.koPP * agg.koPP + S.dealEP * agg.dealEP;
  const loss = S.takenEP * agg.takenEP + (1 - S.takenEP) * agg.takenPP;
  const bulk = Math.min(1, Math.max(0, (S.bulkFloor - loss) / span));
  return { score: 100 * (S.offense * offense + S.bulk * bulk), offense: 100 * offense, bulk: 100 * bulk, ...agg, rows };
}
