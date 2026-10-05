import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadData } from '../../../scripts/sim/load.js';
import { SKILLS } from '../engine/data.js';
import { createContext, evaluatePath, roleScore } from '../engine/search.js';
import { AXES, evalProfile, healCapacity, killSpeed, phaseSurvival } from '../engine/profile.js';
import { unitLoadouts } from '../engine/gear.js';

const data = loadData();
const ctx = createContext(data);
const unit = (n) => data.characters.get(n);
const cls = (n) => data.classes.get(n);
const ax = (name) => AXES.indexOf(name);
const flat = (x) => Float64Array.from(SKILLS, () => x);

// A unit's profile in `c` at checkpoint index `cp`, with every skill at the given exposure.
function profile(u, c, cp, stats, expo = 60) {
  const level = data.checkpoints[cp].playerLevel;
  const gear = unitLoadouts(data, unit(u), cls(c), level, Float64Array.from(stats), null, flat(expo));
  gear.cls = cls(c);
  return { ...evalProfile(data, gear, ctx.refs[cp], true), gear };
}
// stats: hp str mag spd dex def res lck cha
const fighter = [60, 40, 5, 30, 30, 30, 10, 20, 10];
const caster = [45, 5, 40, 30, 30, 12, 35, 20, 10];

test('physical and magical damage are separate axes', () => {
  const war = profile('Cai', 'Warrior', 15, fighter);
  assert.ok(war.axes[ax('physDmg')] > 40);
  assert.equal(war.axes[ax('magDmg')], 0);
  assert.equal(war.axes[ax('bestDmg')], war.axes[ax('physDmg')]);
  const ovate = profile('Cai', 'Ovate', 15, caster);
  assert.ok(ovate.axes[ax('magDmg')] > 30);
  assert.equal(ovate.axes[ax('bestDmg')], Math.max(ovate.axes[ax('magDmg')], ovate.axes[ax('physDmg')]));
  for (const p of [war, ovate]) for (const v of p.axes) assert.ok(v >= 0 && v <= 100);
});

test('physical and magical bulk are separate axes', () => {
  const armored = profile('Cai', 'Dreadnought', 15, [60, 30, 5, 20, 20, 45, 5, 20, 10]);
  const warded = profile('Cai', 'Dreadnought', 15, [60, 30, 5, 20, 20, 5, 45, 20, 10]);
  assert.ok(armored.axes[ax('physBulk')] > warded.axes[ax('physBulk')] + 20);
  assert.ok(warded.axes[ax('magBulk')] > armored.axes[ax('magBulk')] + 20);
  // Bulk ignores hit chances; avoid carries them.
  const fast = profile('Cai', 'Dreadnought', 15, [60, 30, 5, 60, 20, 45, 5, 20, 10]);
  assert.ok(fast.axes[ax('avoid')] > armored.axes[ax('avoid')] + 20);
});

test('magic damage is limited by spell uses', () => {
  // Tialla as a Bishop (no Black-Magic Seeker) and as an Ovate (casts doubled), same stats.
  const bishop = profile('Tialla', 'Bishop', 15, caster);
  const ovate = profile('Tialla', 'Ovate', 15, caster);
  assert.ok(ovate.axes[ax('magDmg')] > bishop.axes[ax('magDmg')]);
  const row = bishop.rows[0].mag;
  assert.ok(row.average <= row.share + 1e-9);    // the map-long average cannot beat the best single cast
});

test('safety: an attack the enemy cannot answer keeps all HP', () => {
  const sniper = profile('Cai', 'Sniper', 15, fighter);
  const warrior = profile('Cai', 'Warrior', 15, fighter);
  assert.ok(sniper.axes[ax('safety')] > warrior.axes[ax('safety')]);
  const melee = sniper.rows.find((r) => r.ref.archetype === 'fighter');
  assert.equal(melee.phys.range, 2);
  assert.ok(Math.abs(melee.phys.taken) < 1e-9);
});

test('support: healing scales with Mag, spells known and heal bonuses; dancing counts', () => {
  const weak = profile('Tialla', 'Bishop', 15, [45, 5, 10, 30, 30, 12, 35, 20, 10]);
  const strong = profile('Tialla', 'Bishop', 15, caster);
  assert.ok(strong.healed > weak.healed);
  assert.ok(strong.axes[ax('support')] > 0);
  assert.equal(profile('Tialla', 'Warrior', 15, caster).axes[ax('support')], 0);
  // Sofia's Healing Knowledge: +10 HP per heal.
  // (rank D only, so each casts nothing but Heal)
  const cast = (u) => { const g = unitLoadouts(data, unit(u), cls('Priest'), 30, Float64Array.from(caster), null, flat(5)); g.cls = cls('Priest'); const d = []; healCapacity(data, g, d); return d; };
  const sofia = cast('Sofia'), tialla = cast('Tialla');
  assert.deepEqual([sofia.length, sofia[0].name, tialla[0].name], [1, 'Heal', 'Heal']);
  assert.ok(Math.abs(sofia[0].amount - tialla[0].amount - 10) < 1e-9);
  assert.equal(profile('Leda', 'Dancer', 15, fighter).axes[ax('support')], data.mechanics.profile.dance.value);
});

test('reach follows movement, personal movement bonuses and flying', () => {
  const armor = profile('Mu', 'Dreadnought', 15, fighter).axes[ax('reach')];
  const cav = profile('Mu', 'Bardinger', 15, fighter).axes[ax('reach')];
  assert.equal(armor, 0);
  assert.ok(cav > armor);
  assert.ok(profile('Cai', 'Bardinger', 15, fighter).axes[ax('reach')] > cav);     // Brio: Mov+1
  assert.ok(profile('Mu', 'Dragoon', 15, fighter).axes[ax('reach')] > profile('Mu', 'Forest Knight', 15, fighter).axes[ax('reach')]);
});

test('roles read different axes from the same path', () => {
  const tank = evaluatePath(ctx, unit('Cai'), ['Soldier', 'Armored Knight', 'Dreadnought', 'Castle Knight']);
  const heal = evaluatePath(ctx, unit('Cai'), ['Diviner', 'Priest', 'Bishop', 'Wiseman']);
  assert.ok(roleScore(ctx, tank, 'tank').score > roleScore(ctx, heal, 'tank').score);
  assert.ok(roleScore(ctx, heal, 'healer').score > roleScore(ctx, tank, 'healer').score);
  assert.equal(tank.axes[ax('support')], 0);
});

test('kill speed counts attacks needed, not damage dealt', () => {
  const dist = (pairs, n) => { const d = new Float64Array(n + 1); for (const [k, p] of pairs) d[k] = p; return d; };
  assert.equal(killSpeed(dist([[20, 1]], 20), 20), 1);                       // always kills
  assert.ok(Math.abs(killSpeed(dist([[10, 1]], 20), 20) - 1 / 2) < 1e-9);    // two hits of 10
  assert.ok(Math.abs(killSpeed(dist([[19, 1]], 20), 20) - 1 / 2) < 1e-9);    // 95% of its HP is still two attacks
  assert.ok(Math.abs(killSpeed(dist([[7, 1]], 20), 20) - 1 / 3) < 1e-9);
  assert.ok(Math.abs(killSpeed(dist([[0, 0.5], [20, 0.5]], 20), 20) - 1 / 2) < 0.02);   // a coin flip each attack
  assert.equal(killSpeed(dist([[0, 1]], 20), 20), 0);
  assert.ok(Math.abs(killSpeed(dist([[2, 1]], 20), 20) - 1 / 10) < 1e-9);    // long fights are extrapolated
});

test('one point of Str that turns two attacks into one moves the damage axis', () => {
  // Same unit either side of a kill threshold against the armoured reference enemy.
  const armor = ctx.refs[15].find((r) => r.archetype === 'armor');
  const dmg = (str) => profile('Cai', 'Warrior', 15, [60, str, 5, 30, 60, 30, 10, 20, 10]).rows.find((r) => r.ref === armor).phys;
  let str = 20;
  while (dmg(str).kill < 0.99 && str < 99) str++;
  assert.ok(str < 99);
  const below = dmg(str - 1), at = dmg(str);
  assert.ok(at.share - below.share < 0.1);        // barely more damage ...
  assert.ok(at.speed - below.speed > 0.2);        // ... but the kill is now certain
});

test('survival plays out a whole enemy phase', () => {
  const dist = (pairs, n) => { const d = new Float64Array(n + 1); for (const [k, p] of pairs) d[k] = p; return d; };
  assert.equal(phaseSurvival(dist([[0, 1]], 30), 30, 6), 1);
  assert.ok(Math.abs(phaseSurvival(dist([[10, 1]], 30), 30, 6) - 2 / 6) < 1e-9);   // dies to the third attack
  assert.ok(Math.abs(phaseSurvival(dist([[9, 1]], 30), 30, 6) - 3 / 6) < 1e-9);    // one HP less per hit: one attack more
  // Bulk decides it: the same unit with more Def lasts longer against physical attackers.
  const soft = profile('Cai', 'Dreadnought', 15, [50, 30, 5, 20, 20, 15, 5, 20, 10]);
  const hard = profile('Cai', 'Dreadnought', 15, [50, 30, 5, 20, 20, 40, 5, 20, 10]);
  assert.ok(hard.axes[ax('physSurv')] > soft.axes[ax('physSurv')] + 20);
  assert.equal(soft.survive.phys.alive.length, data.mechanics.profile.enemyPhaseAttacks.value);
  for (let k = 1; k < soft.survive.phys.alive.length; k++) assert.ok(soft.survive.phys.alive[k] <= soft.survive.phys.alive[k - 1] + 1e-12);
});
