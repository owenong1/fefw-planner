import { test } from 'vitest';
import assert from 'node:assert/strict';
import { makeLoadout, resolveRound, strikeDamage, followUpChance, lethalIndex } from '../engine/combat.js';

const F = {
  followUp: 4, critMult: 3, swordFollowUp: 1.2, axeMin: 5,
  hitDex: 1, hitLck: 0, critDex: 0.5, critLck: 0, dodgeLck: 1, gauntletAvo: 10,
};
const plain = { weaponMods: {}, guardPrt: 0, guardRsl: 0, flying: false, cavalry: false, armored: false };
const weapon = (over) => ({ name: 'w', type: 'spear', mt: 5, hit: 999, crit: 0, wt: 0, range: [1, 1], effective: {}, ...over });
// stats: hp str mag spd dex def res lck cha
const unit = (stats, w, cls = plain, bld = 0) => makeLoadout(Float64Array.from(stats), null, bld, cls, weapon(w), F);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('attack speed: Spd - (Wt - Bld), never a bonus for spare Bld', () => {
  // Game8's worked example: Spd 12, Wt 4, Bld 2 -> AS 10.
  assert.equal(unit([20, 5, 0, 12, 0, 0, 0, 0, 0], { wt: 4 }, plain, 2).as, 10);
  assert.equal(unit([20, 5, 0, 12, 0, 0, 0, 0, 0], { wt: 4 }, plain, 9).as, 12);
});

test('damage is Atk + Mt - Prt, zero when outclassed', () => {
  const a = unit([20, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 5 });
  assert.equal(strikeDamage(a, unit([20, 0, 0, 5, 0, 7, 0, 0, 0], {}), false, F), 8);
  assert.equal(strikeDamage(a, unit([20, 0, 0, 5, 0, 30, 0, 0, 0], {}), false, F), 0);
});

test('magic uses Mag and targets Res', () => {
  const mage = unit([20, 1, 12, 5, 0, 0, 0, 0, 0], { type: 'black', magical: true, mt: 3 });
  assert.equal(strikeDamage(mage, unit([20, 0, 0, 5, 0, 99, 4, 0, 0], {}), false, F), 11);
});

test('axes always deal at least 5', () => {
  const axe = unit([20, 3, 0, 5, 0, 0, 0, 0, 0], { type: 'axe', mt: 2 });
  assert.equal(strikeDamage(axe, unit([20, 0, 0, 5, 0, 50, 0, 0, 0], {}), false, F), 5);
});

test('effective weapons multiply Might, not total attack', () => {
  const rider = { ...plain, cavalry: true };
  const flier = { ...plain, flying: true };
  const spear = unit([20, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 5, effective: { cavalry: 2 } });
  const bow = unit([20, 10, 0, 5, 0, 0, 0, 0, 0], { type: 'bow', mt: 5, effective: { flying: 3 } });
  assert.equal(strikeDamage(spear, unit([20, 0, 0, 5, 0, 0, 0, 0, 0], {}, rider), false, F), 20);
  assert.equal(strikeDamage(bow, unit([20, 0, 0, 5, 0, 0, 0, 0, 0], {}, flier), false, F), 25);
  assert.equal(strikeDamage(bow, unit([20, 0, 0, 5, 0, 0, 0, 0, 0], {}), false, F), 15);
});

test('follow-up needs exactly +4 attack speed', () => {
  assert.equal(followUpChance(3, 0, 4), 0);
  assert.equal(followUpChance(4, 0, 4), 1);
  // With uncertain Speed the cliff becomes a slope.
  const p = followUpChance(3.5, 4, 4);
  assert.ok(p > 0.3 && p < 0.7);
});

test('a certain hit with no counter deals exactly its damage', () => {
  const a = unit([20, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 5 });
  const d = unit([30, 0, 0, 5, 0, 3, 0, 0, 0], {});
  const r = resolveRound(a, d, false, F, {});
  near(r.dealt, 12);
  near(r.kill, 0);
  near(r.taken, 0);
});

test('hit and crit chances weight the outcome; crits triple damage', () => {
  // Hit = 60 + Dex 20 - Avo 10 = 70%. Crit = 10 + Dex/2 = 20% minus Dodge 5 = 15%.
  const a = unit([20, 10, 0, 10, 20, 0, 0, 0, 0], { mt: 0, hit: 60, crit: 10 });
  const d = unit([100, 0, 0, 10, 0, 4, 0, 5, 0], {});
  const r = resolveRound(a, d, false, F, {});
  near(r.hitI, 0.7);
  near(r.critI, 0.15);
  near(r.dealt, 0.7 * (0.85 * 6 + 0.15 * 18));
});

test('follow-up attack: two strikes, and damage cannot exceed remaining HP', () => {
  const a = unit([20, 10, 0, 14, 0, 0, 0, 0, 0], { mt: 0 });
  const d = unit([15, 0, 0, 10, 0, 0, 0, 99, 0], {});
  const r = resolveRound(a, d, false, F, {});
  near(r.dealt, 15);   // 10 + 10, capped at 15 HP
  near(r.kill, 1);
});

test('swords hit 1.2x on the follow-up strike only', () => {
  const a = unit([20, 10, 0, 14, 0, 0, 0, 0, 0], { type: 'sword', mt: 0 });
  const d = unit([99, 0, 0, 10, 0, 0, 0, 99, 0], {});
  near(resolveRound(a, d, false, F, {}).dealt, 10 + 12);
});

test('the defender counters only when in range, and a dead unit never strikes', () => {
  const a = unit([20, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  const d = unit([30, 7, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  near(resolveRound(a, d, true, F, {}).taken, 7);
  near(resolveRound(a, d, false, F, {}).taken, 0);
  const killer = unit([20, 40, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  near(resolveRound(killer, d, true, F, {}).taken, 0);
});

test('the faster defender gets the follow-up', () => {
  const a = unit([50, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  const d = unit([50, 7, 0, 9, 0, 0, 0, 0, 0], { mt: 0 });
  const r = resolveRound(a, d, true, F, {});
  near(r.dealt, 10);
  near(r.taken, 14);
});

test('gauntlets and class abilities feed avoid, hit and guard', () => {
  const brawler = { ...plain, weaponMods: { gauntlet: { hit: 5, crit: 0, avo: 3 } } };
  const g = unit([20, 5, 0, 10, 8, 0, 0, 0, 0], { type: 'gauntlet', hit: 90 }, brawler);
  assert.equal(g.avo, 10 + 3 + 10);
  assert.equal(g.hit, 90 + 8 + 5);
  const wall = { ...plain, guardPrt: 5 };
  const a = unit([20, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  const tank = unit([20, 0, 0, 5, 0, 2, 0, 0, 0], {}, wall);
  assert.equal(strikeDamage(a, tank, false, F), 3);  // foe attacked first: +5 Prt
  assert.equal(strikeDamage(a, tank, true, F), 8);   // tank attacked first: no bonus
});

test('damage distribution: every outcome of the round, summing to 1 and matching the averages', () => {
  // 70% to hit, 15% to crit (x3), a follow-up: damage is 0, 6, 12, 18, 24 or 36.
  const a = unit([20, 10, 0, 14, 20, 0, 0, 0, 0], { mt: 0, hit: 60, crit: 10 });
  const d = unit([30, 0, 0, 10, 0, 4, 0, 5, 0], {});
  const dist = new Float64Array(64);
  const r = resolveRound(a, d, false, F, {}, 1, dist);
  const n = lethalIndex(d.hp);
  assert.equal(n, 30);
  let total = 0, mean = 0;
  for (let j = 0; j <= n; j++) { total += dist[j]; mean += j * dist[j]; }
  near(total, 1);
  near(mean, r.dealt);
  near(dist[n], r.kill);            // the last entry is "dies": 18 + 18, or a crit and a hit
  near(dist[0], 0.3 * 0.3);
  near(dist[6], 2 * 0.3 * 0.7 * 0.85);
  assert.equal(dist[5], 0);
});
