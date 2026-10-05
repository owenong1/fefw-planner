import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadData } from '../../../scripts/sim/load.js';
import { STATS, SKILLS } from '../engine/data.js';
import { createContext, searchPaths, rankPaths, rankRolled, recommend, evaluatePath, roleScore, roleNames, monteCarlo, rollPath, decisionPlan, classMarginals } from '../engine/search.js';
import { fitEnemyModel, buildRoster } from '../engine/enemies.js';
import { unitGear, examNeed, initialExposure, trainExposure, rankAt, rankName } from '../engine/gear.js';
import { AXES } from '../engine/profile.js';

const data = loadData();
const ctx = createContext(data);
const cls = (n) => data.classes.get(n);
const unit = (n) => data.characters.get(n);
const skill = (n) => SKILLS.indexOf(n);
const flat = (x) => Float64Array.from(SKILLS, () => x);

test('data: every unit and class is usable', () => {
  assert.ok(data.characters.size >= 60);
  for (const c of data.characters.values()) {
    assert.ok(data.classes.has(c.base.class), `${c.name} base class`);
    assert.equal(c.growthArr.length, STATS.length);
    assert.ok(c.baseArr[0] > 0, `${c.name} HP`);
  }
  for (const tier of ['beginner', 'specialty', 'advanced', 'master', 'divine']) {
    assert.ok([...data.classes.values()].some((c) => c.tier === tier), tier);
  }
  // 5 weapon tiers x 5 physical types, plus the spell lines.
  assert.ok(data.playerArsenal.length >= 25 + 8);
  assert.ok(data.heals.has('Heal') && data.heals.has('Recover'));
});

test('gear: only what the class wields, unlocked by level and skill rank, at most two melee and two thrown per type', () => {
  const names = (c, level, expo) => unitGear(data, unit('Cai'), cls(c), level, expo).weapons.map((g) => g.weapon.name);
  const list = unitGear(data, unit('Cai'), cls('Warrior'), 40, flat(50)).weapons;
  assert.ok(list.length > 0);
  for (const g of list) assert.ok(['sword', 'axe', 'gauntlet'].includes(g.weapon.type));
  assert.ok(names('Warrior', 40, flat(50)).includes('Silver Axe'));
  assert.ok(!names('Warrior', 10, flat(50)).some((n) => n.startsWith('Silver')));   // not sold yet
  assert.ok(!names('Warrior', 40, flat(10)).some((n) => n.startsWith('Silver')));   // rank too low (needs B)
  assert.ok(names('Warrior', 40, flat(10)).includes('Iron Axe'));
  const counts = {};
  for (const g of unitGear(data, unit('Cai'), cls('Commoner'), 60, flat(50)).weapons) {
    const key = `${g.weapon.type}${g.weapon.range[1] > g.weapon.range[0] ? ' thrown' : ''}`;
    if (!g.weapon.magical) counts[key] = (counts[key] || 0) + 1;
  }
  assert.ok(Object.values(counts).every((n) => n <= 2));
  // Thrown weapons sit beside the melee ones, gated the same way.
  assert.ok(names('Warrior', 40, flat(50)).includes('Sagaris'));
  assert.ok(!names('Warrior', 40, flat(10)).includes('Sagaris'));
  assert.ok(names('Dreadnought', 10, flat(10)).includes('Javelin'));
});

test('gear: spells come from the unit\'s own list, with limited casts doubled by Seeker', () => {
  const druid = unitGear(data, unit('Tialla'), cls('Druid'), 60, flat(60));
  const spells = druid.weapons.filter((g) => g.weapon.type === 'black').map((g) => g.weapon.name);
  assert.ok(spells.includes('Excalibur') && spells.includes('Fire'));
  assert.ok(!spells.includes('Thoron'));                    // not on Tialla's list
  const fire = druid.weapons.find((g) => g.weapon.name === 'Fire');
  assert.equal(fire.uses, 2 * fire.weapon.uses);            // Black-Magic Seeker
  assert.equal(druid.heals.length, 0);                      // a Druid has no white magic
  const bishop = unitGear(data, unit('Tialla'), cls('Bishop'), 60, flat(60));
  assert.ok(bishop.heals.some((h) => h.heal.name === 'Recover'));
  assert.ok(!unitGear(data, unit('Tialla'), cls('Bishop'), 60, flat(5)).heals.some((h) => h.heal.name === 'Recover'));
});

test('skill ranks follow exposure, faster in preferred skills and slower in non-ideal ones', () => {
  assert.equal(rankName(data, rankAt(data, 0)), 'E');
  assert.equal(rankName(data, rankAt(data, 15)), 'C');
  assert.equal(rankName(data, rankAt(data, 49.9)), 'A');
  const cai = unit('Cai');   // good at Sword, bad at Bow
  const after = trainExposure(cai, cls('Hunter'), new Float64Array(SKILLS.length), 10);
  assert.ok(after[skill('Sword')] > 10 && after[skill('Bow')] < 10);
  assert.equal(after[skill('Axe')], 0);
});

test('exams: shortfall is counted in ranks and decides which classes are offered', () => {
  const cai = unit('Cai');
  const hunter15 = trainExposure(cai, cls('Hunter'), initialExposure(data, cai), 15);
  assert.equal(examNeed(data, cai, cls('Myrmidon'), hunter15).gap, 0);          // Sword C from 15 levels of swords
  const druid = examNeed(data, cai, cls('Druid'), hunter15);
  assert.ok(druid.worst >= 3);                                                   // Black Magic A from nothing
  assert.deepEqual(druid.skills, ['Black Magic A']);
  // Passing means the rank was trained: exposure is lifted to the requirement.
  assert.ok(druid.expo[skill('Black Magic')] > hunter15[skill('Black Magic')]);
  // Every path the search offers passes its exams within one rank; the shortfall is its training need.
  const limit = data.mechanics.skills.maxExamGap.value;
  const paths = searchPaths(ctx, cai).paths;
  let trained = 0;
  for (const p of paths) {
    const { exams } = evaluatePath(ctx, cai, p.steps, { to: 'P1-01' });
    assert.equal(exams.length, p.steps.length);
    for (const e of exams) assert.ok(e.worst <= limit + 1e-9, `${e.cls.name}: ${e.worst}`);
    assert.equal(exams.reduce((t, e) => t + e.gap, 0), p.train);
    if (p.train > 0) trained++;
  }
  assert.ok(trained > 0);
  // --max-gap 0: only exams the unit already meets.
  for (const p of searchPaths(ctx, cai, { maxGap: 0 }).paths) assert.equal(p.train, 0);
  // Free reclassing opens what the exams rule out: an axe fighter turned Ovate with no black magic.
  const axeToMage = [{ level: 5, name: 'Gladiator' }, { level: 20, name: 'Brigand' }, { level: 35, name: 'Ovate' }];
  assert.ok(evaluatePath(ctx, cai, axeToMage, { to: 'P1-01' }).exams[2].worst > limit);
  assert.ok(!paths.some((p) => p.classes.join('>').startsWith('Gladiator>Brigand>Ovate')));
});

test('enemy roster: real enemies keep their published stats', () => {
  const model = fitEnemyModel(data);
  const roster = buildRoster(data, model, data.checkpoints[0]);
  const bandit = roster.find((e) => e.name === 'Bandit');
  assert.equal(bandit.source, 'observed');
  assert.deepEqual([...bandit.stats.slice(0, 4)], [22, 7, 2, 4]);
  assert.ok(roster.some((e) => e.source === 'model'));
  const share = roster.reduce((s, e) => s + e.share, 0);
  assert.ok(Math.abs(share - 1) < 1e-9);
});

test('enemy roster: hard mode raises stats by the published delta', () => {
  const model = fitEnemyModel(data);
  const cp = data.checkpoints[10];
  const normal = buildRoster(data, model, cp).find((e) => e.source === 'model');
  const hard = buildRoster(data, model, cp, { hard: true }).find((e) => e.name === normal.name);
  assert.equal(hard.stats[0], normal.stats[0] + data.mechanics.enemies.hardDelta.stats.hp);
});

test('reference enemies: one per archetype, physical and magical', () => {
  for (const refs of ctx.refs) {
    assert.ok(refs.length >= 5);
    assert.equal(refs.filter((r) => r.magic).length, 1);
    assert.ok(refs.find((r) => r.magic).loadout.magical);
  }
  assert.ok(!ctx.refs[0].some((r) => r.archetype === 'flier'));   // no flying class at the Beginner tier
  assert.ok(ctx.refs[10].some((r) => r.archetype === 'flier'));
  const hard = createContext(data, { hard: true });
  assert.ok(hard.refs[10][0].stats[0] > ctx.refs[10][0].stats[0]);
});

test('plan: Lv1 units face four decisions; late joiners get a catch-up decision', () => {
  assert.deepEqual(decisionPlan(data, unit('Cai')).map((d) => d.level), [5, 20, 35, 45]);
  assert.equal(decisionPlan(data, unit('Cai'), { divine: true }).length, 5);
  const plan = (u) => decisionPlan(data, unit(u)).map((d) => [d.level, d.tier]);
  assert.deepEqual(plan('Eshmel'), [[40, 'advanced'], [45, 'master']]);   // joins Lv40 in an Advanced class
  assert.deepEqual(plan('Troy'), [[40, 'master']]);                       // joins Lv40 already in a Master class
  assert.deepEqual(plan('Gaitz'), [[34, 'advanced'], [45, 'master']]);    // joins below Lv35 but already Advanced
});

test('plan: gender-, route- and ability-locked classes are filtered', () => {
  const names = (u, o) => decisionPlan(data, unit(u), o).flatMap((d) => d.options.map((c) => c.name));
  assert.ok(!names('Cai').includes('Wing Soldier'));
  assert.ok(names('Tialla').includes('Wing Soldier'));
  assert.ok(names('Cai', { route: 'cai' }).includes('Caladrius'));
  assert.ok(names('Cai', { route: 'any' }).includes('Caladrius'));
  assert.ok(!names('Cai', { route: 'leda' }).includes('Caladrius'));
  assert.ok(!names('Cai').includes('Caladrius'));
  assert.ok(!names('Cai').includes('Elephant Rider'));
  // Goliath: "Unit cannot change to cavalry or flying."
  for (const n of names('Goliath', { route: 'any' })) assert.ok(!cls(n).cavalry && !cls(n).flying, n);
  assert.ok(names('Goliath').includes('Armored Knight'));
});

test('late joiners enter at their real chapter and class', () => {
  const creek = unit('Creek');
  assert.equal(creek.base.class, 'Bardinger');
  assert.equal(creek.base.joinsAt, 'P2-03');
  assert.equal(creek.base.source, 'estimated');
  const res = searchPaths(ctx, creek);
  assert.equal(res.checkpoints[0].cp.id, 'P2-03');
  assert.equal(res.checkpoints.length, 10);
  assert.ok(res.paths.length > 0);
  // Already certified for its join class: staying in it is a path, and costs no training.
  assert.ok(res.paths.some((p) => p.steps.length === 0 && p.train === 0));
  // Its first change is a catch-up at the level it joins with.
  assert.ok(res.paths.some((p) => p.steps.length && p.steps[0].level === creek.base.level));
});

test('search: a path\'s profile equals its chapter-by-chapter evaluation', () => {
  const result = searchPaths(ctx, unit('Tialla'));
  assert.ok(result.paths.length > 20);
  for (const p of [result.paths[0], result.paths[17], result.paths[result.paths.length - 1]]) {
    const full = evaluatePath(ctx, unit('Tialla'), p.steps);
    AXES.forEach((a, i) => {
      assert.ok(Math.abs(full.axes[i] - p.axes[i]) < 1e-9, a);
      assert.ok(Math.abs(full.finalAxes[i] - p.finalAxes[i]) < 1e-9, a);
      assert.ok(p.axes[i] >= 0 && p.axes[i] <= 100, a);
    });
    assert.equal(full.train, p.train);
  }
});

test('search: paths obey the class-change rules', () => {
  const S = data.mechanics.search;
  const tierLevel = (name) => data.mechanics.progression.tiers.find((t) => t.tier === cls(name).tier).level;
  const sidesteps = (p) => p.steps.filter((st, i) => i > 0 && cls(st.name).tier === cls(p.steps[i - 1].name).tier).length;
  const result = searchPaths(ctx, unit('Cai'));
  for (const p of result.paths) {
    let prev = null;
    for (const st of p.steps) {
      assert.ok(st.level >= tierLevel(st.name), `${st.name} before its license level`);
      if (prev) {
        assert.ok(st.level - prev.level >= S.minLevels.value, `${prev.name} held too briefly`);
        assert.ok(cls(st.name).tierRank >= cls(prev.name).tierRank, 'never down a tier');
        assert.notEqual(st.name, prev.name);
      }
      prev = st;
    }
    assert.ok(sidesteps(p) <= S.detours.value);
  }
  // The search is not limited to one class per tier at the tier's level ...
  assert.ok(result.paths.some((p) => sidesteps(p) === 1));
  assert.ok(result.paths.some((p) => p.steps.some((st) => st.level !== tierLevel(st.name))));
  // ... unless told so.
  for (const p of searchPaths(ctx, unit('Cai'), { detours: 0 }).paths) assert.equal(sidesteps(p), 0);
});

test('search: finds the best one-class-per-tier path (checked against every such path)', () => {
  const creek = unit('Creek');   // joins late: few enough paths to try them all
  const decisions = decisionPlan(data, creek);
  const limit = data.mechanics.skills.maxExamGap.value + 1e-9;
  const all = [];
  const walk = (i, names) => {
    if (i === decisions.length) { all.push(names); return; }
    for (const c of [...decisions[i].options, null]) walk(i + 1, [...names, c ? c.name : names[i - 1] || creek.base.class]);
  };
  walk(0, []);
  const result = searchPaths(ctx, creek);
  for (const role of roleNames(data)) {
    let best = -Infinity;
    for (const names of all) {
      const ev = evaluatePath(ctx, creek, names);
      if (ev.exams.every((e) => e.worst <= limit)) best = Math.max(best, roleScore(ctx, ev, role).score);
    }
    assert.ok(rankPaths(ctx, result, role)[0].score >= best - 1e-9, role);
  }
});

test('roles: each ranks the same paths differently; the leaders are settled on rolled playthroughs', () => {
  const tialla = unit('Tialla');
  const result = searchPaths(ctx, tialla);
  const cfg = data.mechanics.roles.rolled;
  const picks = {};
  for (const role of roleNames(data)) {
    const { ranked, leader, rec } = rankRolled(ctx, tialla, result, role, { runs: 40 });
    assert.equal(ranked.length, result.paths.length);
    assert.ok(ranked[0].score >= ranked[1].score);
    const rolled = ranked.filter((r) => r.rolled);
    assert.equal(rolled.length, Math.min(cfg.top, ranked.length));
    assert.ok(rolled.includes(leader) && leader.equal && rec.equal);
    for (const r of ranked) {
      if (!r.rolled) { assert.ok(!r.equal); continue; }
      assert.ok(leader.rolled.mean >= r.rolled.mean - 1e-9);
      assert.ok(r.rolled.lead >= 0 && r.rolled.lead <= 1);
      assert.ok(Math.abs(r.rolled.gap - (leader.rolled.mean - r.rolled.mean)) < 1e-9);
      assert.equal(!!r.equal, r === leader || r.rolled.lead < cfg.winShare || r.rolled.gap < cfg.minGap);
      // Of the paths that are as good, the recommended one needs the least training.
      if (r.equal) assert.ok(rec.train <= r.train + 1e-9);
    }
    const again = roleScore(ctx, evaluatePath(ctx, tialla, rec.steps), role);
    assert.ok(Math.abs(again.score - rec.score) < 1e-9);
    picks[role] = rec.classes.join('>');
  }
  assert.notEqual(picks.healer, picks.tank);
  // A white-magic unit's healer path ends in a healing class.
  const healer = rankRolled(ctx, tialla, result, 'healer', { runs: 40 }).rec;
  assert.ok(cls(healer.classes[healer.classes.length - 1]).weapons.includes('white'));
  assert.throws(() => rankPaths(ctx, result, 'nonsense'), /Unknown role/);
});

test('roles: without rolls, paths within the fixed tolerance are equal', () => {
  const result = searchPaths(ctx, unit('Tialla'));
  const tol = data.mechanics.roles.tolerance.value;
  const { ranked, rec } = rankRolled(ctx, unit('Tialla'), result, 'striker', { runs: 0 });
  assert.ok(!ranked[0].rolled);
  assert.equal(rec, recommend(ranked));
  for (const r of ranked) assert.equal(!!r.equal, ranked[0].score - r.score <= tol);
  for (const r of ranked) if (r.equal) assert.ok(rec.train <= r.train + 1e-9);
});

test('rolled playthroughs use the same dice for every path', () => {
  const peter = unit('Peter');
  const a = rollPath(ctx, peter, ['Hunter', 'Archer', 'Sniper', 'Bow Adept'], { runs: 20 });
  const b = rollPath(ctx, peter, ['Hunter', 'Archer', 'Sniper', 'Sniper'], { runs: 20 });
  // A path replayed is identical; two paths that part ways at Lv45 differ at the end ...
  assert.deepEqual(rollPath(ctx, peter, ['Hunter', 'Archer', 'Sniper', 'Bow Adept'], { runs: 20 }), a);
  assert.notDeepEqual(a.final, b.final);
  // ... and are the same playthroughs up to there: the dice do not depend on the path.
  const early = rollPath(ctx, peter, ['Hunter', 'Archer', 'Sniper', 'Bow Adept'], { runs: 20, to: 'P2-06' });
  const earlyB = rollPath(ctx, peter, ['Hunter', 'Archer', 'Sniper', 'Sniper'], { runs: 20, to: 'P2-06' });
  assert.deepEqual(early, earlyB);
});

test('search: class marginals lead with the best path', () => {
  const result = searchPaths(ctx, unit('Peter'));
  const ranked = rankPaths(ctx, result, 'striker');
  const m = classMarginals(result, ranked);
  for (const name of ranked[0].classes) {
    const tier = m.find((t) => t.tier === cls(name).tier);
    const entry = tier.classes.find((c) => c.name === name);
    assert.ok(Math.abs(entry.delta) < 1e-9);
    assert.ok(tier.classes[0].score <= ranked[0].score + 1e-9);
  }
  // Every class of a tier the unit could take keeps its best path.
  assert.ok(m.find((t) => t.tier === 'beginner').classes.length === 5);
});

test('monte carlo: reproducible, and close to the expected-stat score', () => {
  const path = ['Hunter', 'Archer', 'Sniper', 'Bow Adept'];
  const a = monteCarlo(ctx, unit('Peter'), path, { runs: 60, role: 'striker' });
  const b = monteCarlo(ctx, unit('Peter'), path, { runs: 60, role: 'striker' });
  assert.deepEqual(a, b);
  const expected = roleScore(ctx, evaluatePath(ctx, unit('Peter'), path), 'striker').score;
  assert.ok(Math.abs(a.campaign.mean - expected) < 5);
  assert.ok(a.campaign.p10 <= a.campaign.p50 && a.campaign.p50 <= a.campaign.p90);
});

test('duel role: the legacy score is computed only on request and stays within 0-100', () => {
  const i = AXES.indexOf('duel');
  assert.equal(searchPaths(ctx, unit('Troy')).paths[0].axes[i], 0);
  const duel = createContext(data, { role: 'duel' });
  const res = evaluatePath(duel, unit('Goliath'), ['Soldier', 'Armored Knight', 'Dreadnought', 'Castle Knight']);
  for (const r of res.rows) assert.ok(r.axes[i] > 0 && r.axes[i] <= 100);
  assert.ok(rankPaths(duel, searchPaths(duel, unit('Troy')), 'duel')[0].score > 0);
});
