// One unit's share of a whole-cast run (`all`, `classes`, `visuals`), and how
// the shares are put back together. Free of Node: scripts/sim/cast.js shares the
// units out over worker threads, src/sim/worker.ts over web workers.

import { searchPaths, rankRolled, evaluatePath, roleWeights } from './search.js';
import { NA } from './profile.js';

/**
 * One unit's search result and, for each of `roles`, the recommended path and
 * that path's score chapter by chapter. Plain data only (it crosses a thread
 * boundary); null when the unit has no chapter in range.
 */
export function unitJob(ctx, char, opts, roles) {
  const result = searchPaths(ctx, char, opts);
  if (!result.paths.length) return null;
  const picks = {};
  for (const role of roles) {
    const { rec } = rankRolled(ctx, char, result, role, opts);
    const w = roleWeights(ctx.data, role);
    const chapters = evaluatePath(ctx, char, rec.steps, opts).rows.map((row) => {
      let score = 0;
      for (let i = 0; i < NA; i++) score += w[i] * row.axes[i];
      return { id: row.cp.id, score };
    });
    picks[role] = { path: result.paths.indexOf(rec.path), score: rec.score, final: rec.final, rolled: rec.rolled, chapters };
  }
  return {
    name: char.name, picks,
    result: {
      paths: result.paths.map((p) => ({ steps: p.steps, classes: p.classes, axes: p.axes, finalAxes: p.finalAxes, train: p.train })),
      decisions: result.decisions.map((d) => ({ level: d.level, tier: d.tier })),
      checkpoints: result.checkpoints, explored: result.explored, tierOf: result.tierOf,
    },
  };
}

/**
 * The finished jobs ({ name } alone for a unit with nothing in range) as
 * [{ char, result, roles: { role: { rec, chapters } } }] in the data's unit
 * order, units with nothing in range left out. `rec` has the same fields as a
 * rankRolled() pick.
 */
export function assembleCast(data, jobs) {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  return [...data.characters.keys()].map((name) => byName.get(name)).filter((j) => j && j.result).map((j) => ({
    char: data.characters.get(j.name),
    result: j.result,
    roles: Object.fromEntries(Object.entries(j.picks).map(([role, p]) => {
      const path = j.result.paths[p.path];
      return [role, { rec: { path, classes: path.classes, steps: path.steps, train: path.train, score: p.score, final: p.final, rolled: p.rolled, equal: true }, chapters: p.chapters }];
    })),
  }));
}
