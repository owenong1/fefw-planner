import { test } from 'vitest';
import assert from 'node:assert/strict';
import { loadData } from '../../../scripts/sim/load.js';
import { STATS, HP, STR, SPD } from '../engine/data.js';
import { expectedPersonal, sampleRun, mulberry32, withClassBonus, classAt, growthRates, luckLines, lineStats } from '../engine/growth.js';

const data = loadData();
const cai = data.characters.get('Cai');
const cls = (n) => data.classes.get(n);

test('growth chance is character growth plus class growth', () => {
  const p = growthRates(cai, cls('Gladiator'));
  assert.equal(p[HP], (45 + 10) / 100);
  assert.equal(p[STR], (45 + 10) / 100);
  assert.equal(p[SPD], 0.45);
});

test('expected stats add growth per level, switching rates at each class change', () => {
  const segments = [{ level: 1, cls: cls('Commoner') }, { level: 5, cls: cls('Gladiator') }];
  const at5 = expectedPersonal(cai, segments, 5).mean;
  assert.ok(Math.abs(at5[STR] - (10 + 4 * 0.45)) < 1e-9);
  const at10 = expectedPersonal(cai, segments, 10).mean;
  assert.ok(Math.abs(at10[STR] - (10 + 4 * 0.45 + 5 * 0.55)) < 1e-9);
  const { vari } = expectedPersonal(cai, segments, 5);
  assert.ok(Math.abs(vari[STR] - 4 * 0.45 * 0.55) < 1e-9);
});

test('class bonus applies only while in the class', () => {
  const segments = [{ level: 1, cls: cls('Commoner') }, { level: 5, cls: cls('Gladiator') }, { level: 20, cls: cls('Myrmidon') }];
  assert.equal(classAt(segments, 4).name, 'Commoner');
  assert.equal(classAt(segments, 5).name, 'Gladiator');
  assert.equal(classAt(segments, 30).name, 'Myrmidon');
  const personal = Float64Array.from(STATS, () => 10);
  assert.equal(withClassBonus(personal, cls('Gladiator'))[STR], 11);
  assert.equal(withClassBonus(personal, cls('Myrmidon'))[STR], 10);
});

test('rolled playthroughs average out to the expected stats', () => {
  const segments = [{ level: 1, cls: cls('Commoner') }, { level: 5, cls: cls('Gladiator') }, { level: 20, cls: cls('Brigand') }];
  const rng = mulberry32(7);
  const runs = 4000;
  const sum = new Float64Array(STATS.length);
  for (let r = 0; r < runs; r++) {
    const [at30] = sampleRun(cai, segments, [30], rng);
    at30.forEach((v, i) => { sum[i] += v; assert.ok(Number.isInteger(v)); });
  }
  const { mean, vari } = expectedPersonal(cai, segments, 30);
  STATS.forEach((s, i) => {
    const stderr = Math.sqrt(vari[i] / runs);
    assert.ok(Math.abs(sum[i] / runs - mean[i]) < 5 * stderr + 1e-9, `${s}: ${sum[i] / runs} vs ${mean[i]}`);
  });
});

test('sampleRun reports the join stats untouched at the join level', () => {
  const segments = [{ level: 1, cls: cls('Commoner') }];
  const [at1, at2] = sampleRun(cai, segments, [1, 2], mulberry32(1));
  assert.deepEqual([...at1], [...cai.baseArr]);
  at2.forEach((v, i) => assert.ok(v === cai.baseArr[i] || v === cai.baseArr[i] + 1));
});

test('luck lines spread every stat from unlucky to lucky, keeping its mean and variance', () => {
  for (const count of [2, 4, 7]) {
    const lines = luckLines(count, 99);
    assert.equal(lines.length, count);
    STATS.forEach((s, i) => {
      const z = lines.map((l) => l[i]);
      assert.ok(Math.abs(z.reduce((a, b) => a + b, 0)) < 1e-6, `${s} mean`);
      assert.ok(Math.abs(z.reduce((a, b) => a + b * b, 0) / count - 1) < 1e-6, `${s} variance`);
      assert.equal(new Set(z.map((v) => v.toFixed(6))).size, count);   // each line takes a different band
    });
  }
  assert.deepEqual(luckLines(4, 5), luckLines(4, 5));
  assert.deepEqual([...luckLines(1, 5)[0]], [...new Float64Array(STATS.length)]);
  // A line's stats are whole numbers around the expected ones.
  const mean = Float64Array.from(STATS, () => 20.4), vari = Float64Array.from(STATS, () => 4);
  const z = Float64Array.from(STATS, (_, i) => (i % 2 ? 1 : -1));
  assert.deepEqual([...lineStats(mean, vari, z)], STATS.map((_, i) => (i % 2 ? 22 : 18)));
});
