import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadData } from '../../../scripts/sim/load.js';
import { STATS } from '../engine/data.js';
import { parseAbilityText, activeAbilities, effectsAt, effectsFor } from '../engine/abilities.js';
import { makeLoadout, resolveRound } from '../engine/combat.js';

const data = loadData();
const unit = (n) => data.characters.get(n);
const F = data.formulas;
const plain = { name: 'Test', weaponMods: {}, guardPrt: 0, guardRsl: 0, flying: false, cavalry: false, armored: false, infantry: true };
const weapon = (over) => ({ name: 'w', type: 'spear', mt: 5, hit: 999, crit: 0, wt: 0, range: [1, 1], effective: {}, ...over });
// stats: hp str mag spd dex def res lck cha
const build = (stats, w, text, cls = plain) => {
  const effects = text ? effectsFor(parseAbilityText(text).effects, cls, weapon(w)) : null;
  return makeLoadout(Float64Array.from(stats), null, 0, cls, weapon(w), F, effects);
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('parser: plain modifiers become effects, everything else is left unscored with a reason', () => {
  const hit = parseAbilityText('When equipped with a bow, grants Hit+20.');
  assert.equal(hit.reason, null);
  assert.equal(hit.effects[0].weapon, 'bow');
  assert.equal(hit.effects[0].mods.hit, 20);
  const first = parseAbilityText('If unit attacks first, grants AS+3, Hit+10 during combat.').effects[0];
  assert.deepEqual([first.phase, first.mods.as, first.mods.hit], [1, 3, 10]);
  const shield = parseAbilityText('(Cavalry) If unit attacks first, grants Shld+3, Ddg+30 during combat.').effects[0];
  assert.deepEqual([shield.type, shield.mods.prt, shield.mods.rsl, shield.mods.ddg], ['cavalry', 3, 3, 30]);
  const oneOf = parseAbilityText('Grants one of Hit+10, Avo+10, or Crit+10 during combat.').effects[0];
  near(oneOf.mods.hit, 10 / 3);
  assert.equal(parseAbilityText('Grants Def+3 to adjacent allies.').reason, 'affects or depends on allies');
  assert.equal(parseAbilityText('After defeating a foe, grants Spd +1 until the end of the map. (Max +10)').reason, 'builds up over a map');
  assert.equal(parseAbilityText('Grants Atk +3 when attacking with a combat art,').reason, 'needs combat arts');
});

test('every unit\'s abilities parse, and upgrades replace their base version', () => {
  let scored = 0;
  for (const c of data.characters.values()) for (const a of c.abilityList) { assert.ok(Array.isArray(a.effects)); if (!a.reason) scored++; }
  assert.ok(scored >= 70);
  const names = (u, lv) => activeAbilities(unit(u), lv).map((a) => a.name);
  assert.deepEqual(names('Ursula', 10), ['Management Skills']);
  assert.ok(names('Ursula', 20).includes('Seize the Chance'));
  assert.ok(names('Ursula', 35).includes('Seize the Chance+') && !names('Ursula', 35).includes('Seize the Chance'));
  // "Changes the effect of Hot-Headed to grant +15" rewrites the personal ability.
  assert.deepEqual(names('Guzran', 20), ['Top Form']);
  near(effectsAt(unit('Guzran'), 20)[0].mods.crit, 5);
  assert.deepEqual([...unit('Orchel').locks].sort(), ['cavalry', 'flying']);
  assert.equal(unit('Cai').locks.size, 0);
});

test('a trigger chance scales the effect: Lck / 2 % to multiply damage by 1.5', () => {
  const foe = build([100, 0, 0, 5, 0, 0, 0, 0, 0], {});
  const base = build([30, 10, 0, 5, 0, 0, 0, 40, 0], { mt: 0 });
  const lucky = build([30, 10, 0, 5, 0, 0, 0, 40, 0], { mt: 0 }, 'Multiplies damage by 1.5 when attacking. Trigger % = Lck ÷ 2.');
  near(resolveRound(base, foe, false, F, {}).dealt, 10);
  near(resolveRound(lucky, foe, false, F, {}).dealt, 10 * (1 + 0.2 * 0.5));   // 20% of the time x1.5
  // It also applies when countering.
  near(resolveRound(foe, lucky, true, F, {}).taken, 11);
});

test('conditions: who attacks first, weapon, range and the foe\'s weapon', () => {
  const foe = build([100, 5, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  const quick = build([30, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 }, 'If unit attacks first, grants Atk+3 during combat. Trigger % = 50.');
  near(resolveRound(quick, foe, false, F, {}).dealt, 11.5);
  near(resolveRound(foe, quick, true, F, {}).taken, 10);          // foe started it: no bonus
  const counter = build([30, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 }, 'If foe attacks first, grants Atk+3 to unit during combat.');
  near(resolveRound(counter, foe, false, F, {}).dealt, 10);
  near(resolveRound(foe, counter, true, F, {}).taken, 13);
  // Weapon-bound stat bonus is part of the loadout itself.
  assert.equal(build([30, 10, 0, 5, 0, 0, 0, 0, 0], { type: 'axe' }, 'When equipped with an axe, grants Str+3.').atk, 13);
  assert.equal(build([30, 10, 0, 5, 0, 0, 0, 0, 0], { type: 'sword' }, 'When equipped with an axe, grants Str+3.').atk, 10);
  const thrower = build([30, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0, range: [1, 2] }, 'If throwing a spear, grants Hit+10, Atk+2 during combat.');
  near(resolveRound(thrower, foe, false, F, {}, 1).dealt, 10);
  near(resolveRound(thrower, foe, false, F, {}, 2).dealt, 12);
  const mageFoe = build([100, 0, 5, 5, 0, 0, 0, 0, 0], { mt: 0, hit: 100, type: 'black', magical: true });
  const spirit = build([30, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 }, 'If foes uses magic, grants Hit/Avo+10 to unit during combat.');
  near(resolveRound(mageFoe, spirit, false, F, {}).hitI, (100 - 5 - 10) / 100);
  near(resolveRound(foe, spirit, false, F, {}).hitI, 1);
});

test('damage reduction, forced follow-ups and Attack Speed conditions', () => {
  const foe = build([100, 20, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  const plainUnit = build([60, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 });
  const resolve = build([60, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 }, 'Unit takes half damage when attacked. Trigger % = 30.');
  near(resolveRound(foe, plainUnit, false, F, {}).dealt, 20);
  near(resolveRound(foe, resolve, false, F, {}).dealt, 20 * 0.85);
  const wall = build([60, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 }, "For the first combat in enemy's phase, unit takes half damage.");
  near(resolveRound(foe, wall, false, F, {}).dealt, 10);
  near(resolveRound(wall, foe, true, F, {}).taken, 20);           // only when the enemy starts the fight
  const requiem = build([60, 10, 0, 5, 0, 0, 0, 0, 0], { mt: 0 }, 'Unit makes a follow up regardless of AS during combat. Trigger % = 5.');
  near(resolveRound(requiem, foe, false, F, {}).followI, 0.05);
  const squall = (spd) => build([60, 10, 0, spd, 0, 0, 0, 0, 0], { mt: 0, hit: 50 }, "If AS ≥ foe's AS+3, grants Hit+20 during combat.");
  near(resolveRound(squall(8), foe, false, F, {}).hitI, 0.45 + 0.2);   // weapon Hit 50 - foe Avo 5, AS lead of 3
  near(resolveRound(squall(7), foe, false, F, {}).hitI, 0.45);
});

test('real units: abilities change what the simulator sees', () => {
  const stats = Float64Array.from(STATS, () => 20);
  const cls = data.classes.get('Sniper');
  const bow = data.weapons.get('Iron Bow');
  const load = (u, lv) => makeLoadout(stats, null, 5, cls, bow, F, effectsFor(effectsAt(unit(u), lv), cls, bow));
  assert.equal(load('Inyoni', 1).atk, 23);                         // Heavy-Bow User: Str+3 with a bow
  assert.equal(load('Peter', 1).atk, 20);
  const foe = makeLoadout(stats, null, 5, data.classes.get('Brigand'), data.weapons.get('Iron Axe'), F);
  const out = {};
  stats[4] = 0;   // no Dex, so neither hit chance is capped at 100%
  const aswan = resolveRound(load('Aswan', 60), foe, false, F, out, 2).hitI;   // Princess of Arrows: Hit+20
  const peter = resolveRound(load('Peter', 1), foe, false, F, out, 2).hitI;
  near(aswan - peter, 0.2);
  stats[4] = 20;
  // Esmeralda's Brawn: equipment weighs 80%.
  const heavy = data.weapons.get('Iron Axe');
  const war = data.classes.get('Warrior');
  const esme = makeLoadout(stats, null, 5, war, heavy, F, effectsFor(effectsAt(unit('Esmeralda'), 1), war, heavy));
  assert.equal(esme.as, 20 - (heavy.wt * 0.8 - 5));
});
