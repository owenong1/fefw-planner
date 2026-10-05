// Class-path search. A path is a list of class changes, each at a level:
//   join class -> Gladiator (Lv5) -> Brigand (Lv20) -> Warrior (Lv35) -> Battlemaster (Lv45)
// A unit may change class between any two chapters, to any class whose license
// tier it has reached and whose exam it could plausibly pass: so a promotion
// can be taken late (when the exam is not passable yet) and a path can hold
// more than one class of a tier. That space is far too large to list, so it is
// searched chapter by chapter with a beam (see searchPaths). Every state is
// profiled at each story checkpoint over several luck lines (growth.js); a
// path's result is its average profile (one value per axis), and a role turns
// that into a score. The leading paths are then replayed with level-ups
// actually rolled, the same rolls for every path, to decide which are really
// better (rankRolled).

import { STATS, TIERS } from './data.js';
import { growthRates, growthVariance, expectedPersonal, classAt, sampleRun, mulberry32, withClassBonus, luckLines, lineStats } from './growth.js';
import { evalCheckpoint } from './score.js';
import { fitEnemyModel, buildRosters } from './enemies.js';
import { AXES, NA, buildReferences, evalProfile } from './profile.js';
import { initialExposure, trainExposure, examNeed, unitGear, unitLoadouts } from './gear.js';

const N = STATS.length;
const DUEL = AXES.indexOf('duel');
const NO_LUCK = new Float64Array(N);

/**
 * Shared, precomputed state for a run: enemy model, reference enemies and the
 * full roster per checkpoint. `opts.role === 'duel'` also switches on the
 * (slow) legacy duel score.
 */
export function createContext(data, opts = {}) {
  if (opts.offense != null) {
    // Re-split the duel score between offense and bulk for this run only.
    data = { ...data, mechanics: { ...data.mechanics, scoring: { ...data.mechanics.scoring, offense: opts.offense, bulk: 1 - opts.offense } } };
  }
  const model = fitEnemyModel(data);
  const hard = !!opts.hard;
  return {
    data, model, opts,
    rosters: buildRosters(data, model, { hard }),
    refs: buildReferences(data, model, { hard }),
    duel: opts.role === 'duel',
    lines: new Map(),
  };
}

/** The luck lines a unit is measured at: the same for every path, so paths are compared like for like. */
function linesFor(ctx, char) {
  let lines = ctx.lines.get(char.name);
  if (!lines) {
    let seed = 2166136261;
    for (const ch of char.name) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
    lines = luckLines(ctx.data.mechanics.profile.statLines.value, seed >>> 0);
    ctx.lines.set(char.name, lines);
  }
  return lines;
}

/** Role names in mechanics.json order (the legacy duel role last, only on request). */
export function roleNames(data, { duel = false } = {}) {
  return Object.keys(data.mechanics.roles.list).filter((r) => duel || r !== 'duel');
}

/** A role's axis weights as an array in AXES order. */
export function roleWeights(data, role) {
  const def = data.mechanics.roles.list[role];
  if (!def) throw new Error(`Unknown role "${role}". Roles: ${Object.keys(data.mechanics.roles.list).join(', ')}`);
  const w = new Float64Array(NA);
  for (const [axis, value] of Object.entries(def.weights)) {
    const i = AXES.indexOf(axis);
    if (i < 0) throw new Error(`Role "${role}" uses unknown axis "${axis}"`);
    w[i] = value;
  }
  return w;
}

const dot = (w, axes) => { let s = 0; for (let i = 0; i < NA; i++) s += w[i] * axes[i]; return s; };

function classAllowed(char, cls, opts) {
  if (cls.unsupported) return false;
  if (cls.gender && char.gender && cls.gender !== char.gender) return false;
  // Route-exclusive classes need --route <that route> or --route any.
  if (cls.routes && opts.route !== 'any' && !cls.routes.includes(opts.route)) return false;
  // Personal abilities such as "Cannot change to cavalry or flying".
  if ((cls.cavalry && char.locks.has('cavalry')) || (cls.flying && char.locks.has('flying'))) return false;
  return true;
}

/**
 * The decisions a unit faces: [{level, tier, options}] in level order. A unit
 * that joins above a tier's level, or already in a promoted class, gets one
 * catch-up decision at its join level for the highest tier it has reached.
 */
export function decisionPlan(data, char, opts = {}) {
  const prog = data.mechanics.progression;
  const tiers = [...prog.tiers];
  if (opts.divine) tiers.push({ tier: 'divine', level: prog.divineLevel });
  const join = char.base.level;
  const options = (tier) => [...data.classes.values()].filter((c) => c.tier === tier && classAllowed(char, c, opts));
  const decisions = [];
  // Catch-up: the highest tier the unit's level, or the class it joins in, already reaches.
  const joinTier = tiers.findIndex((t) => t.tier === data.classes.get(char.base.class).tier);
  const reached = Math.max(joinTier, tiers.filter((t) => t.level <= join).length - 1);
  if (reached >= 0) decisions.push({ level: join, tier: tiers[reached].tier, options: options(tiers[reached].tier) });
  tiers.forEach((t, i) => {
    if (t.level > join && i > reached) decisions.push({ level: t.level, tier: t.tier, options: options(t.tier) });
  });
  return decisions;
}

/** Checkpoints the unit is present for, in order. */
function activeCheckpoints(data, char, opts) {
  const out = [];
  data.checkpoints.forEach((cp, index) => {
    if (cp.playerLevel < char.base.level) return;
    if (char.base.joinsAt && cp.id < char.base.joinsAt) return;
    if (opts.from && cp.id < opts.from) return;
    if (opts.to && cp.id > opts.to) return;
    out.push({ cp, index });
  });
  return out;
}

/** Largest exam shortfall (in ranks) a class change may have and still be offered. */
function gapLimit(data, opts) {
  if (opts.freeReclass) return Infinity;
  return opts.maxGap ?? data.mechanics.skills.maxExamGap.value;
}

const lineBuf = new Float64Array(N);

/**
 * Profile of the unit in `cls` at one checkpoint.
 * `vari` null: `mean` are exact (rolled) personal stats. Otherwise the axes are
 * the average over the unit's luck lines, or, with `median`, read at the
 * expected stats alone (a quick look, used to screen candidates). `detail`
 * adds the per-enemy numbers, taken at the expected stats.
 */
function profileAt(ctx, char, cls, mean, vari, level, expo, cpIndex, detail = false, median = false) {
  const { data } = ctx;
  const gear = unitGear(data, char, cls, level, expo, ctx.opts);
  if (!vari) return profileExact(ctx, char, cls, level, expo, cpIndex, gear, mean, detail);
  if (median && !detail) return profileExact(ctx, char, cls, level, expo, cpIndex, gear, lineStats(mean, vari, NO_LUCK, lineBuf), false);
  const lines = linesFor(ctx, char);
  const axes = new Float64Array(NA);
  for (const z of lines) {
    const one = profileExact(ctx, char, cls, level, expo, cpIndex, gear, lineStats(mean, vari, z, lineBuf), false).axes;
    for (let i = 0; i < NA; i++) axes[i] += one[i] / lines.length;
  }
  const res = detail ? { ...profileExact(ctx, char, cls, level, expo, cpIndex, gear, lineStats(mean, vari, NO_LUCK, lineBuf), true) } : { bld: gear.bld };
  res.axes = axes;
  res.stats = withClassBonus(mean, cls);
  return res;
}

/**
 * Profile at whole-number personal stats. Different histories often reach the
 * same stats in the same class and gear, so results are remembered per unit;
 * the returned object is shared and must not be changed.
 */
function profileExact(ctx, char, cls, level, expo, cpIndex, gear, personal, detail) {
  const { data } = ctx;
  if (ctx.cacheFor !== char) { ctx.cacheFor = char; ctx.cache = new Map(); }
  gear.sig ??= `${cpIndex}|${cls.name}|${gear.weapons.map((w) => w.weapon.name).join()}|${gear.heals.map((h) => h.heal.name).join()}|`;
  const key = detail ? null : gear.sig + personal.join();
  if (key) {
    const hit = ctx.cache.get(key);
    if (hit) return hit;
  }
  const g = unitLoadouts(data, char, cls, level, personal, null, expo, gear, ctx.opts.arts !== false);
  g.cls = cls;
  const res = evalProfile(data, g, ctx.refs[cpIndex], detail);
  if (ctx.duel) {
    res.duel = evalCheckpoint(data, g.loadouts, ctx.rosters[cpIndex], detail);
    res.axes[DUEL] = res.duel.score;
  }
  res.stats = g.stats;
  res.bld = g.bld;
  if (key) ctx.cache.set(key, res);
  return res;
}

/** Adds `levels` level-ups in `cls` to expected stats and their variance, in place. */
function grow(char, cls, mean, vari, levels) {
  if (levels <= 0) return;
  const p = growthRates(char, cls), v = growthVariance(p);
  for (let i = 0; i < N; i++) { mean[i] += levels * p[i]; vari[i] += levels * v[i]; }
}

/**
 * Of `list`, the states worth keeping: per current class (and sidesteps used)
 * the `width` best for each role, plus, for each class anywhere in a state's
 * history, the best state for each role that went through it (so every class
 * keeps its best path). `prio[k][r]` is state k's priority for role r;
 * `margin` is how far behind the leader, in at least one role, a state may be
 * and still be kept for its class.
 */
function selectStates(list, prio, nRoles, width, margin) {
  const keep = new Set();
  const byClass = new Map();
  list.forEach((s, k) => {
    // A state that has spent its sidestep cannot become one that has not: they are kept apart.
    const key = `${s.cls.name}|${s.sidesteps}`;
    (byClass.get(key) || byClass.set(key, []).get(key)).push(k);
  });
  // A state far behind the leader in every role is not kept for its class's sake.
  const lead = Array.from({ length: nRoles }, (_, r) => prio.reduce((m, p) => Math.max(m, p[r]), -Infinity));
  const close = prio.map((p) => p.some((v, r) => v >= lead[r] - margin));
  for (let r = 0; r < nRoles; r++) {
    for (const idx of byClass.values()) {
      idx.sort((a, b) => prio[b][r] - prio[a][r]);
      for (let j = 0; j < width && j < idx.length; j++) if (close[idx[j]]) keep.add(idx[j]);
    }
    const through = new Map();
    list.forEach((s, k) => {
      for (const name of s.visited) {
        const best = through.get(name);
        if (best === undefined || prio[k][r] > prio[best][r]) through.set(name, k);
      }
    });
    for (const k of through.values()) keep.add(k);
  }
  return [...keep].sort((a, b) => a - b).map((k) => list[k]);
}

/**
 * Search a character's class paths.
 *
 * The search walks the story chapter by chapter. Between two chapters a unit
 * may stay in its class or change to a class of a tier it has reached, if the
 * exam is within reach: up a tier, or sideways to another class of its tier
 * (at most `detours` times along a path). A class that unlocks between the two
 * chapters is entered at its unlock level, any other at the level after the
 * earlier chapter. A class is held for at least `minLevels` levels.
 *
 * Only the promising states are carried forward (a beam): for every class a
 * unit could hold at that chapter, the best few histories per role, judged by
 * the score so far plus the current chapter's score projected over the
 * chapters left. Candidates for a change are first screened at their expected
 * stats; the survivors are then profiled over all luck lines.
 *
 * Returns { paths, decisions, checkpoints, explored }; each path is
 *   { steps: [{level, name}], classes: [name], axes, finalAxes, train }
 * `steps` are its class changes, `axes` the campaign-average profile,
 * `finalAxes` the profile at the last checkpoint, and `train` the total rank
 * shortfall its exams would need covered by training. Use rankPaths() or
 * rankRolled() to order them for a role.
 */
export function searchPaths(ctx, char, opts = {}) {
  const { data } = ctx;
  const S = data.mechanics.search;
  const decisions = decisionPlan(data, char, opts);
  const cps = activeCheckpoints(data, char, opts);
  const tierOf = new Map([...data.classes.values()].map((c) => [c.name, c.tier]));
  const result = { paths: [], decisions, checkpoints: cps, explored: 0, tierOf };
  if (!cps.length) return result;
  const lastIndex = cps[cps.length - 1].index;
  const scoredAt = new Set(cps.map((c) => c.index));
  // Chapters before --from are still played (they shape the stats), just not scored.
  const chapters = activeCheckpoints(data, char, { to: opts.to }).filter((c) => c.index <= lastIndex);
  const limit = gapLimit(data, opts) + 1e-9;
  const width = opts.beam ?? S.beam.value;
  const parents = S.parents.value;
  const roles = roleNames(data, { duel: ctx.duel });
  const W = roles.map((r) => roleWeights(data, r));
  const R = roles.length;

  // Classes the unit may change to, and the level each becomes available.
  const prog = data.mechanics.progression;
  const tiers = [...prog.tiers];
  if (opts.divine) tiers.push({ tier: 'divine', level: prog.divineLevel });
  const join = char.base.level;
  const baseCls = data.classes.get(char.base.class);
  const reached = Math.max(tiers.findIndex((t) => t.tier === baseCls.tier), tiers.filter((t) => t.level <= join).length - 1);
  const options = [];
  tiers.forEach((t, i) => {
    for (const cls of data.classes.values()) {
      if (cls.tier === t.tier && classAllowed(char, cls, opts)) options.push({ cls, unlock: i <= reached ? join : t.level });
    }
  });
  const detours = opts.detours ?? S.detours.value;
  const margin = S.margin.value * cps.length;
  const minLevels = S.minLevels.value;

  let states = [{
    cls: baseCls, since: -Infinity, mean: Float64Array.from(char.baseArr), vari: new Float64Array(N), expo: initialExposure(data, char),
    cum: new Float64Array(NA), last: null, final: null, train: 0, sidesteps: 0, steps: [], visited: [baseCls.name],
  }];
  let prev = join;         // the level every state is at
  let floor = join;        // the earliest level a class change may happen in this interval
  let left = cps.length;   // scored chapters not yet played
  for (const { cp, index } of chapters) {
    const L = cp.playerLevel;
    const scored = scoredAt.has(index);
    const horizon = left;                 // scored chapters from this one on
    if (scored) left--;

    // 1. Candidate class changes. For each class and role the parents are the
    //    states with the best score so far (stats differ little between
    //    histories, so the realized score decides); a class that has just
    //    unlocked also takes the best state through each class already visited.
    const cumScore = states.map((s) => W.map((w) => dot(w, s.cum)));
    const order = W.map((_, r) => states.map((_, k) => k).sort((a, b) => cumScore[b][r] - cumScore[a][r]));
    const reach = S.parentMargin.value * horizon;
    const moves = new Map();
    const move = (k, opt, d) => {
      const key = k * 1000 + options.indexOf(opt);
      if (moves.has(key)) return moves.get(key);
      const s = states[k], c = opt.cls;
      let m = null;
      const up = c.tierRank > s.cls.tierRank;
      if (s.cls !== c && d - s.since >= minLevels && (up || (c.tierRank === s.cls.tierRank && s.sidesteps < detours))) {
        const expo = d > prev ? trainExposure(char, s.cls, s.expo, d - prev) : s.expo;
        const need = examNeed(data, char, c, expo);
        if (need.worst <= limit) m = { s, c, d, need };
      }
      moves.set(key, m);
      return m;
    };
    for (const opt of options) {
      const d = Math.max(floor, opt.unlock);
      if (d > L) continue;
      const fresh = opt.unlock >= floor;
      for (let r = 0; r < R; r++) {
        let taken = 0, best = null;
        for (const k of order[r]) {
          if (best != null && cumScore[k][r] < best - reach) break;
          if (!move(k, opt, d)) continue;
          if (best == null) best = cumScore[k][r];
          if (++taken >= parents) break;
        }
        if (!fresh) continue;
        const covered = new Set();
        for (const k of order[r]) {
          if (states[k].visited.every((name) => covered.has(name))) continue;
          if (!move(k, opt, d)) continue;
          for (const name of states[k].visited) covered.add(name);
        }
      }
    }
    let children = [];
    for (const m of moves.values()) {
      if (!m) continue;
      const { s, c, d, need } = m;
      const mean = Float64Array.from(s.mean), vari = Float64Array.from(s.vari);
      grow(char, s.cls, mean, vari, d - prev);
      grow(char, c, mean, vari, L - d);
      children.push({
        cls: c, since: d, mean, vari, expo: trainExposure(char, c, need.expo, L - d), cum: s.cum, last: null, final: s.final,
        train: s.train + need.gap, sidesteps: s.sidesteps + (c.tierRank === s.cls.tierRank ? 1 : 0), steps: [...s.steps, { level: d, name: c.name }], visited: [...s.visited, c.name],
      });
    }

    // 2. Screen the candidates at their expected stats; keep the best per class and role.
    if (children.length) {
      const seen = children.map((s) => profileAt(ctx, char, s.cls, s.mean, s.vari, L, s.expo, index, false, true).axes);
      const prio = children.map((s, k) => W.map((w) => dot(w, s.cum) + horizon * dot(w, seen[k])));
      result.explored += children.length;
      children = selectStates(children, prio, R, width * S.screen.value, margin);
      for (const s of children) s.cum = Float64Array.from(s.cum);
    }

    // 3. Everyone still in the race plays the chapter, over all luck lines.
    for (const s of states) {
      grow(char, s.cls, s.mean, s.vari, L - prev);
      s.expo = trainExposure(char, s.cls, s.expo, L - prev);
    }
    states = states.concat(children);
    for (const s of states) {
      s.last = profileAt(ctx, char, s.cls, s.mean, s.vari, L, s.expo, index).axes;
      if (scored) for (let i = 0; i < NA; i++) s.cum[i] += s.last[i];
      if (index === lastIndex) s.final = s.last;
    }
    result.explored += states.length;

    // 4. Keep the best per class and role: score so far, plus this chapter's score for each chapter left.
    const stayed = states.find((s) => !s.steps.length);
    states = selectStates(states, states.map((s) => W.map((w) => dot(w, s.cum) + left * dot(w, s.last))), R, width, margin);
    if (!states.includes(stayed)) states.push(stayed);   // never changing class is always kept, as the baseline
    prev = L;
    floor = L + 1;
  }

  result.paths = states.map((s) => ({
    steps: s.steps, classes: s.steps.map((st) => st.name),
    axes: Float64Array.from(s.cum, (x) => x / cps.length), finalAxes: s.final, train: s.train,
  }));

  // 5. Tidy the leaders. The beam can keep a path with a needless sidestep or
  //    a promotion taken late over its plainer version. For each role's best
  //    paths, try dropping each class change and taking each as early as the
  //    rules allow, and keep whatever is legal; repeat while it helps.
  const byName = new Map(options.map((o) => [o.cls.name, o]));
  const legal = (steps) => {
    let cls = baseCls, since = -Infinity, level = join, expo = initialExposure(data, char), side = 0;
    for (const st of steps) {
      const opt = byName.get(st.name);
      if (!opt || opt.cls === cls || st.level < Math.max(level, opt.unlock) || st.level - since < minLevels) return false;
      const c = opt.cls;
      if (c.tierRank < cls.tierRank || (c.tierRank === cls.tierRank && ++side > detours)) return false;
      expo = trainExposure(char, cls, expo, st.level - level);
      const need = examNeed(data, char, c, expo);
      if (need.worst > limit) return false;
      expo = need.expo; cls = c; since = level = st.level;
    }
    return true;
  };
  // The earliest a change can follow the one before it: at its unlock level, or else right after a chapter.
  const earliest = (name, after) => {
    const unlock = byName.get(name).unlock, from = after == null ? join : after + minLevels;
    if (from <= unlock) return unlock;
    const ch = chapters.find(({ cp }) => cp.playerLevel + 1 >= from);
    return ch ? ch.cp.playerLevel + 1 : Infinity;
  };
  const variants = (steps) => {
    const out = [];
    steps.forEach((st, i) => {
      out.push(steps.filter((_, k) => k !== i));
      const e = earliest(st.name, i > 0 ? steps[i - 1].level : null);
      if (e < st.level) out.push(steps.map((x, k) => (k === i ? { ...x, level: e } : x)));
    });
    const prompt = [];
    for (let i = 0; i < steps.length; i++) prompt.push({ ...steps[i], level: Math.min(steps[i].level, earliest(steps[i].name, i > 0 ? prompt[i - 1].level : null)) });
    out.push(prompt);
    return out;
  };
  const key = (steps) => steps.map((st) => `${st.name}@${st.level}`).join('>');
  const known = new Set(result.paths.map((p) => key(p.steps)));
  const score = (p) => W.map((w) => dot(w, p.axes));
  let front = new Set(W.flatMap((w) => [...result.paths].sort((a, b) => dot(w, b.axes) - dot(w, a.axes)).slice(0, S.tidy.value)));
  for (let round = 0; round < 3 && front.size; round++) {
    const next = new Set();
    for (const p of front) {
      const base = score(p);
      for (const steps of variants(p.steps)) {
        const k = key(steps);
        if (known.has(k) || !legal(steps)) continue;
        known.add(k);
        const ev = evaluatePath(ctx, char, steps, opts);
        result.explored += ev.rows.length;
        const q = { steps, classes: steps.map((st) => st.name), axes: ev.axes, finalAxes: ev.finalAxes, train: ev.train };
        result.paths.push(q);
        if (score(q).some((v, r) => v > base[r] + 1e-9)) next.add(q);
      }
    }
    front = next;
  }
  return result;
}

/**
 * Order a search result for one role. Returns [{ path, classes, steps, score, final, train, equal }]
 * best first; `equal` marks paths within the role tolerance of the best.
 */
export function rankPaths(ctx, result, role) {
  const w = roleWeights(ctx.data, role);
  const ranked = result.paths.map((path) => ({
    path, classes: path.classes, steps: path.steps, train: path.train,
    score: dot(w, path.axes), final: path.finalAxes ? dot(w, path.finalAxes) : null,
  })).sort((a, b) => b.score - a.score || a.train - b.train);
  if (ranked.length) {
    const tol = ctx.data.mechanics.roles.tolerance.value;
    for (const r of ranked) {
      if (ranked[0].score - r.score > tol) break;
      r.equal = true;
    }
  }
  return ranked;
}

/**
 * The path to recommend for a role: of the paths marked as good as the best,
 * the one that needs the least training (then the fewest class changes, then
 * the highest score).
 */
export function recommend(ranked) {
  let pick = null;
  const value = (r) => (r.rolled ? r.rolled.mean : r.score);
  for (const r of ranked) {
    if (!r.equal) continue;
    const tie = pick && r.train < pick.train + 1e-9;
    if (!pick || r.train < pick.train - 1e-9 || (tie && r.steps.length < pick.steps.length)
      || (tie && r.steps.length === pick.steps.length && value(r) > value(pick))) pick = r;
  }
  return pick;
}

/**
 * [{level, cls}] for a path. `spec` is either the path's steps ([{level, name}])
 * or a list of class names, one per decision of decisionPlan() (the older,
 * one-class-per-tier way to write a path).
 */
export function segmentsFor(data, char, decisions, spec) {
  const segments = [{ level: char.base.level, cls: data.classes.get(char.base.class) }];
  spec.forEach((item, i) => {
    const named = typeof item === 'string';
    const cls = data.classes.get(named ? item : item.name);
    if (!cls) throw new Error(`Unknown class "${named ? item : item.name}"`);
    if (named && i >= decisions.length) throw new Error(`Too many classes: ${char.name} only has ${decisions.length} class decisions`);
    const level = named ? decisions[i].level : item.level;
    const last = segments[segments.length - 1];
    if (!(level >= last.level)) throw new Error(`Class changes must be in level order (${cls.name} at Lv${level} after Lv${last.level})`);
    if (cls !== last.cls) segments.push({ level, cls });
  });
  return segments;
}

/**
 * Skill exposure along a path. Returns the exams it takes
 * ([{ level, cls, gap, worst, skills }]) and a function giving the exposure at any level.
 */
export function skillPlan(data, char, segments) {
  const exams = [];
  const starts = [];
  let expo = initialExposure(data, char);
  segments.forEach((seg, i) => {
    if (i > 0) {
      const prev = segments[i - 1];
      expo = trainExposure(char, prev.cls, expo, seg.level - prev.level);
      const need = examNeed(data, char, seg.cls, expo);
      exams.push({ level: seg.level, cls: seg.cls, gap: need.gap, worst: need.worst, skills: need.skills });
      expo = need.expo;
    }
    starts.push(expo);
  });
  const exposureAt = (level) => {
    let i = 0;
    while (i + 1 < segments.length && segments[i + 1].level <= level) i++;
    return trainExposure(char, segments[i].cls, starts[i], level - segments[i].level);
  };
  return { exams, exposureAt, train: exams.reduce((t, e) => t + e.gap, 0) };
}

/** Full per-checkpoint breakdown of one path (steps or class names, see segmentsFor). */
export function evaluatePath(ctx, char, spec, opts = {}) {
  const { data } = ctx;
  const decisions = decisionPlan(data, char, opts);
  const segments = segmentsFor(data, char, decisions, spec);
  const plan = skillPlan(data, char, segments);
  const rows = activeCheckpoints(data, char, opts).map(({ cp, index }) => {
    const cls = classAt(segments, cp.playerLevel);
    const { mean, vari } = expectedPersonal(char, segments, cp.playerLevel);
    const expo = plan.exposureAt(cp.playerLevel);
    const result = profileAt(ctx, char, cls, mean, vari, cp.playerLevel, expo, index, !!opts.detail);
    return { cp, index, cls, expo, ...result };
  });
  const axes = new Float64Array(NA);
  for (const r of rows) for (let i = 0; i < NA; i++) axes[i] += r.axes[i] / rows.length;
  return { segments, rows, axes, finalAxes: rows.length ? rows[rows.length - 1].axes : null, exams: plan.exams, train: plan.train };
}

/** A path's score for a role, from evaluatePath() output. */
export function roleScore(ctx, evaluated, role) {
  const w = roleWeights(ctx.data, role);
  return { score: dot(w, evaluated.axes), final: evaluated.finalAxes ? dot(w, evaluated.finalAxes) : null };
}

/**
 * Roll `runs` playthroughs of level-ups for one path and profile each with
 * the stats it actually got. Every path is rolled with the same dice (the
 * same seed, one draw per stat per level), so two paths' playthroughs can be
 * compared one against one. Returns the campaign-average and last-checkpoint
 * axes of every run, flattened (run * NA + axis).
 */
export function rollPath(ctx, char, spec, opts = {}) {
  const { data } = ctx;
  const runs = opts.runs ?? data.mechanics.roles.rolled.runs;
  const segments = segmentsFor(data, char, decisionPlan(data, char, opts), spec);
  const plan = skillPlan(data, char, segments);
  const cps = activeCheckpoints(data, char, opts);
  const levels = cps.map(({ cp }) => cp.playerLevel);
  const at = cps.map(({ cp, index }) => {
    const cls = classAt(segments, cp.playerLevel), expo = plan.exposureAt(cp.playerLevel);
    return { cls, expo, index, level: cp.playerLevel, gear: unitGear(data, char, cls, cp.playerLevel, expo, ctx.opts) };
  });
  const rng = mulberry32(opts.seed ?? 12345);
  const campaign = new Float64Array(runs * NA), final = new Float64Array(runs * NA);
  for (let r = 0; r < runs; r++) {
    const stats = sampleRun(char, segments, levels, rng);
    at.forEach((c, k) => {
      const { axes } = profileExact(ctx, char, c.cls, c.level, c.expo, c.index, c.gear, stats[k], false);
      for (let i = 0; i < NA; i++) campaign[r * NA + i] += axes[i] / at.length;
      if (k === at.length - 1) final.set(axes, r * NA);
    });
  }
  return { runs, campaign, final };
}

/** One role's score in every run of rollPath() output. */
function rolledScores(w, flat, runs) {
  const out = new Float64Array(runs);
  for (let r = 0; r < runs; r++) for (let i = 0; i < NA; i++) out[r] += w[i] * flat[r * NA + i];
  return out;
}

/**
 * Roll `runs` playthroughs of level-ups for one path and score each for
 * `opts.role`. Shows how much a path depends on level-up luck.
 */
export function monteCarlo(ctx, char, spec, opts = {}) {
  const w = roleWeights(ctx.data, opts.role || roleNames(ctx.data)[0]);
  const rolled = rollPath(ctx, char, spec, { ...opts, runs: opts.runs || 300 });
  return {
    runs: rolled.runs,
    campaign: summarize(rolledScores(w, rolled.campaign, rolled.runs)),
    final: summarize(rolledScores(w, rolled.final, rolled.runs)),
  };
}

function summarize(values) {
  const sorted = Float64Array.from(values).sort();
  const n = sorted.length;
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const q = (f) => sorted[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
  return { mean, sd, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

/**
 * Order a search result for one role and settle the leaders on rolled
 * playthroughs. The role's top paths (roles.rolled.top) are each replayed
 * with the same dice; the leader is the one with the best rolled average, and
 * another path counts as just as good (`equal`) when the leader beats it in
 * fewer than roles.rolled.winShare of those playthroughs, or by less than
 * roles.rolled.minGap points on average. Each replayed path gets
 *   rolled: { mean, sd, p10, p50, p90, final, lead, gap }
 * (`lead` = share of playthroughs the leader scores higher, `gap` = the
 * leader's average margin). Returns { ranked, leader, rec }; `rec` is the
 * path of the equal ones that needs the least training.
 * With `opts.runs` 0 nothing is rolled and the fixed tolerance of rankPaths() decides.
 */
export function rankRolled(ctx, char, result, role, opts = {}) {
  const ranked = rankPaths(ctx, result, role);
  const cfg = ctx.data.mechanics.roles.rolled;
  const runs = opts.runs ?? cfg.runs;
  if (!ranked.length || runs <= 0) return { ranked, leader: ranked[0] || null, rec: recommend(ranked) };
  const w = roleWeights(ctx.data, role);
  const top = ranked.slice(0, cfg.top);
  const key = `${runs}|${opts.seed ?? ''}`;
  for (const r of top) {
    // Rolls are kept on the path, so the roles share them.
    if (!r.path.rolls || r.path.rolls.key !== key) r.path.rolls = { key, ...rollPath(ctx, char, r.steps, { ...opts, runs }) };
    r.runScores = rolledScores(w, r.path.rolls.campaign, runs);
    r.rolled = { ...summarize(r.runScores), final: summarize(rolledScores(w, r.path.rolls.final, runs)).mean };
  }
  const leader = top.reduce((a, b) => (b.rolled.mean > a.rolled.mean ? b : a));
  for (const r of ranked) r.equal = false;
  for (const r of top) {
    let wins = 0, gap = 0;
    for (let k = 0; k < runs; k++) {
      const d = leader.runScores[k] - r.runScores[k];
      wins += d > 1e-9 ? 1 : d < -1e-9 ? 0 : 0.5;
      gap += d / runs;
    }
    r.rolled.lead = wins / runs;
    r.rolled.gap = gap;
    r.equal = r === leader || r.rolled.lead < cfg.winShare || gap < cfg.minGap;
  }
  for (const r of top) delete r.runScores;
  return { ranked, leader, rec: recommend(ranked) };
}

/** Best score achievable through each class of each license tier, relative to the role's best path. */
export function classMarginals(result, ranked) {
  const best = ranked.length ? ranked[0].score : 0;
  return result.decisions.map((d) => {
    const top = new Map();
    for (const r of ranked) {
      // ranked best first, so the first path through a class is its best
      for (const name of r.classes) if (result.tierOf.get(name) === d.tier && !top.has(name)) top.set(name, r);
    }
    return {
      level: d.level, tier: d.tier,
      classes: [...top.entries()].map(([name, r]) => ({ name, score: r.score, delta: r.score - best, path: r.classes }))
        .sort((a, b) => b.score - a.score),
    };
  });
}

export function tierRank(name) {
  return TIERS.indexOf(name);
}

export { withClassBonus };
