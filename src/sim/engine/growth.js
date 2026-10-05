// Level-up maths. A unit's personal stats grow by +1 per level with probability
// (character growth + class growth)%. The class it currently holds also adds a
// flat bonus that is lost again when it changes class.

import { STATS } from './data.js';

const N = STATS.length;

/** Growth chance per stat for a character in a class, as a fraction. */
export function growthRates(char, cls) {
  const p = new Float64Array(N);
  for (let i = 0; i < N; i++) p[i] = Math.max(0, (char.growthArr[i] + cls.growthArr[i]) / 100);
  return p;
}

/** Variance of one level-up for each stat. Above 100% the guaranteed point adds none. */
export function growthVariance(p) {
  const v = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const frac = p[i] - Math.floor(p[i]);
    v[i] = frac * (1 - frac);
  }
  return v;
}

/** Stats shown in game: personal stats plus the current class's flat bonus. */
export function withClassBonus(personal, cls, out = new Float64Array(N)) {
  for (let i = 0; i < N; i++) out[i] = Math.max(0, personal[i] + cls.bonusArr[i]);
  return out;
}

/**
 * Expected personal stats (and their variance) at `level` for a unit following
 * `segments` = [{level, cls}], sorted by level, the first being its join state.
 */
export function expectedPersonal(char, segments, level) {
  const mean = Float64Array.from(char.baseArr);
  const vari = new Float64Array(N);
  for (let s = 0; s < segments.length; s++) {
    const from = segments[s].level;
    const to = Math.min(level, s + 1 < segments.length ? segments[s + 1].level : Infinity);
    if (to <= from) continue;
    const p = growthRates(char, segments[s].cls);
    const v = growthVariance(p);
    for (let i = 0; i < N; i++) {
      mean[i] += (to - from) * p[i];
      vari[i] += (to - from) * v[i];
    }
  }
  return { mean, vari };
}

/** The class held at `level` on a path. */
export function classAt(segments, level) {
  let cls = segments[0].cls;
  for (const seg of segments) if (seg.level <= level) cls = seg.cls;
  return cls;
}

/** Deterministic PRNG so Monte Carlo output is reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Roll one playthrough's level-ups. Returns integer personal stats at each of
 * `levels` (ascending).
 */
export function sampleRun(char, segments, levels, rng) {
  const stats = Float64Array.from(char.baseArr);
  const out = [];
  let li = 0;
  let level = segments[0].level;
  const last = levels[levels.length - 1];
  let seg = 0;
  let p = growthRates(char, segments[0].cls);
  while (li < levels.length && levels[li] <= level) { out.push(Float64Array.from(stats)); li++; }
  while (level < last) {
    while (seg + 1 < segments.length && segments[seg + 1].level <= level) {
      seg++;
      p = growthRates(char, segments[seg].cls);
    }
    for (let i = 0; i < N; i++) {
      const whole = Math.floor(p[i]);
      stats[i] += whole + (rng() < p[i] - whole ? 1 : 0);
    }
    level++;
    while (li < levels.length && levels[li] <= level) { out.push(Float64Array.from(stats)); li++; }
  }
  return out;
}

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const tail = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

function normInv(q) {
  let lo = -8, hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Luck offsets for `count` representative playthroughs: per stat, how many
 * standard deviations above or below its expected value the stat sits. Each
 * stat is cut into `count` equally likely bands (unlucky to lucky) and every
 * line takes a different band per stat, shuffled by `seed`, so the lines
 * together cover the spread of every stat.
 */
export function luckLines(count, seed) {
  if (count <= 1) return [new Float64Array(N)];
  const pdf = (z) => 0.3989422804014327 * Math.exp(-z * z / 2);
  // The average offset inside each band, rescaled so the bands keep the full spread.
  const band = [];
  for (let j = 0; j < count; j++) {
    const a = j === 0 ? 0 : pdf(normInv(j / count));
    const b = j === count - 1 ? 0 : pdf(normInv((j + 1) / count));
    band.push((a - b) * count);
  }
  const spread = Math.sqrt(band.reduce((s, z) => s + z * z, 0) / count);
  const rng = mulberry32(seed);
  const lines = Array.from({ length: count }, () => new Float64Array(N));
  for (let i = 0; i < N; i++) {
    const order = band.map((z) => z / spread);
    for (let j = count - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [order[j], order[k]] = [order[k], order[j]];
    }
    for (let j = 0; j < count; j++) lines[j][i] = order[j];
  }
  return lines;
}

/** Whole-number personal stats for one luck line (HP at least 1). */
export function lineStats(mean, vari, z, out = new Float64Array(N)) {
  for (let i = 0; i < N; i++) {
    // The small nudge keeps a value sitting exactly on .5 from rounding either way on float noise.
    const v = Math.round(mean[i] + z[i] * Math.sqrt(vari[i]) + 1e-6);
    out[i] = v < (i === 0 ? 1 : 0) ? (i === 0 ? 1 : 0) : v;
  }
  return out;
}
