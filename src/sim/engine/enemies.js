// Enemy rosters. Published enemy stats are sparse, so every checkpoint's roster
// is real (observed) enemies of the right level plus modeled ones. The model
// is refitted from src/sim/data/enemies_observed.json on every run, so adding real
// stat lines there improves it automatically.
//
//   stat = base + (level-1) * (growth + kappa*classGrowth)/100 + classBonus
//          [+ bossBase + (level-1) * bossGrowth/100   for bosses]
//
// base / growth / bossBase / bossGrowth are fitted per stat by least squares;
// kappa (how strongly class growth rates show up in enemy stats) is shared and
// grid-searched.

import { STATS } from './data.js';
import { makeLoadout } from './combat.js';

const N = STATS.length;

function solve(A, y) {
  // Least squares through the normal equations (4 unknowns), lightly ridged.
  const n = A[0].length;
  const M = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 1e-6 : 0)));
  const v = Array.from({ length: n }, (_, i) => A.reduce((s, r, k) => s + r[i] * y[k], 0));
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    [v[i], v[piv]] = [v[piv], v[i]];
    for (let r = i + 1; r < n; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < n; c++) M[r][c] -= f * M[i][c];
      v[r] -= f * v[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = v[i];
    for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

/** Fit the enemy stat model to the observed, non-unique enemies. */
export function fitEnemyModel(data) {
  const hard = data.mechanics.enemies.hardDelta.stats;
  const rows = data.observed.filter((u) => !u.unique && data.classes.has(u.class) && u.level);
  const fitWith = (kappa) => {
    const params = [];
    let sse = 0, count = 0;
    for (let i = 0; i < N; i++) {
      const s = STATS[i];
      const A = [], y = [];
      for (const u of rows) {
        if (u.stats[s] == null) continue;
        const cls = data.classes.get(u.class);
        const t = (u.level - 1) / 100;
        A.push([1, t, u.boss ? 1 : 0, u.boss ? t : 0]);
        y.push(u.stats[s] - (u.difficulty === 'hard' ? hard[s] : 0) - cls.bonusArr[i] - kappa * t * cls.growthArr[i]);
      }
      const [base, growth, bossBase, bossGrowth] = solve(A, y);
      const err = A.reduce((acc, r, k) => acc + (y[k] - (base + growth * r[1] + bossBase * r[2] + bossGrowth * r[3])) ** 2, 0);
      params.push({ stat: s, base, growth, bossBase, bossGrowth, rmse: Math.sqrt(err / y.length), n: y.length });
      sse += err;
      count += y.length;
    }
    return { kappa, params, sse, points: count };
  };
  let best = null;
  for (let k = 0; k <= 3.0001; k += 0.25) {
    const fit = fitWith(k);
    if (!best || fit.sse < best.sse) best = fit;
  }
  best.units = rows.length;
  return best;
}

/** Modeled Normal-difficulty stats for a class at a level. */
export function modelStats(model, cls, level, boss) {
  const out = new Float64Array(N);
  const t = (level - 1) / 100;
  for (let i = 0; i < N; i++) {
    const p = model.params[i];
    const v = p.base + t * (p.growth + model.kappa * cls.growthArr[i]) + cls.bonusArr[i]
      + (boss ? p.bossBase + t * p.bossGrowth : 0);
    out[i] = Math.max(i === 0 ? 1 : 0, Math.round(v));
  }
  return out;
}

function tierForLevel(data, level) {
  let tier = 'beginner';
  for (const band of data.mechanics.enemies.tierByLevel.bands) if (level >= band.minLevel) tier = band.tier;
  return tier;
}

function standardWeapon(data, type, level) {
  let best = null;
  for (const entry of data.enemyArsenal) {
    if (entry.weapon.type !== type || entry.level > level) continue;
    if (!best || entry.weapon.mt > best.mt) best = entry.weapon;
  }
  return best;
}

function enemyWeapon(data, cls, level, inventory) {
  for (const item of inventory || []) {
    const w = data.weapons.get(item);
    if (w) return w;
  }
  const order = [cls.primaryWeapon, ...cls.weapons].filter(Boolean);
  for (const type of order) {
    const w = standardWeapon(data, type, level);
    if (w) return w;
  }
  return null;
}

/**
 * A generic enemy of a class at a level. `want` names what it carries: a weapon
 * type (the standard enemy weapon of that type for its level) or one weapon;
 * without it the enemy carries its class's main weapon type.
 */
export function modeledEnemy(data, model, cls, level, boss, hardArr, want = null) {
  const stats = modelStats(model, cls, level, boss);
  if (hardArr) for (let i = 0; i < N; i++) stats[i] += hardArr[i];
  const e = data.mechanics.enemies;
  const bld = Math.round(e.defaultBld.value + e.bldPerLevel.value * (level - 1)) + (boss ? 1 : 0);
  const weapon = want ? data.weapons.get(want) || standardWeapon(data, want, level) : enemyWeapon(data, cls, level, null);
  if (!weapon) return null;
  return {
    name: boss ? `${cls.name} boss` : cls.name, cls, level, boss, source: 'model',
    weight: boss ? e.bossWeight.value : 1, stats, bld, weapon,
  };
}

function observedEnemy(data, model, row, wantHard, hardArr) {
  const cls = data.classes.get(row.class);
  const stats = modelStats(model, cls, row.level, row.boss);
  if (wantHard) for (let i = 0; i < N; i++) stats[i] += hardArr[i];
  let partial = false;
  const shift = wantHard === (row.difficulty === 'hard') ? 0 : wantHard ? 1 : -1;
  for (let i = 0; i < N; i++) {
    const v = row.stats[STATS[i]];
    if (v == null) { partial = true; continue; }
    stats[i] = Math.max(i === 0 ? 1 : 0, v + shift * hardArr[i]);
  }
  const e = data.mechanics.enemies;
  const bld = row.bld ?? Math.round(e.defaultBld.value + e.bldPerLevel.value * (row.level - 1));
  const weapon = enemyWeapon(data, cls, row.level, row.inventory);
  if (!weapon) return null;
  return {
    name: row.name === 'Boss' ? `${row.class} boss` : row.name, cls, level: row.level, boss: row.boss,
    source: partial ? 'observed+model' : 'observed',
    weight: e.observedWeight.value * (row.boss ? e.bossWeight.value : 1), stats, bld, weapon,
    chapter: row.chapter,
  };
}

/** All enemies a unit is measured against at one checkpoint. */
export function buildRoster(data, model, checkpoint, { hard = false } = {}) {
  const e = data.mechanics.enemies;
  const hardArr = STATS.map((s) => e.hardDelta.stats[s] || 0);
  const roster = [];

  // Real enemies near this checkpoint's levels. Prefer the row recorded on the
  // difficulty being simulated when a unit is published on both.
  const window = e.observedLevelWindow.value;
  const picked = new Map();
  for (const row of data.observed) {
    if (!data.classes.has(row.class) || !row.level) continue;
    const target = row.boss ? checkpoint.bossLevel : checkpoint.enemyLevel;
    if (Math.abs(row.level - target) > window) continue;
    const key = `${row.name}|${row.class}`;
    const prev = picked.get(key);
    const matches = (row.difficulty === 'hard') === hard;
    if (!prev || (matches && (prev.difficulty === 'hard') !== hard)) picked.set(key, row);
  }
  for (const row of picked.values()) {
    const enemy = observedEnemy(data, model, row, hard, hardArr);
    if (enemy) roster.push(enemy);
  }

  const pool = (level) => [...data.classes.values()].filter(
    (c) => c.tier === tierForLevel(data, level) && !c.unsupported);
  for (const cls of pool(checkpoint.enemyLevel)) {
    const enemy = modeledEnemy(data, model, cls, checkpoint.enemyLevel, false, hard ? hardArr : null);
    if (enemy) roster.push(enemy);
  }
  for (const cls of pool(checkpoint.bossLevel)) {
    const enemy = modeledEnemy(data, model, cls, checkpoint.bossLevel, true, hard ? hardArr : null);
    if (enemy) roster.push(enemy);
  }

  let total = 0;
  for (const enemy of roster) {
    enemy.loadout = makeLoadout(enemy.stats, null, enemy.bld, enemy.cls, enemy.weapon, data.formulas);
    total += enemy.weight;
  }
  for (const enemy of roster) enemy.share = enemy.weight / total;
  return roster;
}

export function buildRosters(data, model, opts) {
  return data.checkpoints.map((cp) => buildRoster(data, model, cp, opts));
}
