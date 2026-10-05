// Every command of the simulator, free of Node: a command reads its arguments,
// runs, and returns a document (a list of text, table and file blocks) that a
// front end prints. scripts/sim/cli.js is the terminal front end; the site runs
// the same commands in a web worker (src/sim/worker.ts) and renders the same blocks.

import { findByName, STATS, ROUTES, TIERS, SKILLS } from './data.js';
import { createContext, searchPaths, rankPaths, rankRolled, evaluatePath, roleScore, roleNames, monteCarlo, classMarginals, decisionPlan } from './search.js';
import { AXES, AXIS_LABEL } from './profile.js';
import { rankAt, rankName } from './gear.js';
import { activeAbilities, abilityCaveats, isScored } from './abilities.js';

/** A mistake in the command itself (unknown unit, bad option): reported, not a crash. */
export class CommandError extends Error {}

// The command being run: its document so far and its front end. Commands run one at a time (see runCommand).
let doc = [];
let io = {};

/** Add a line of text or a table() to the document. */
function print(x = '') {
  doc.push(x && x.t === 'table' ? x : { t: 'text', text: String(x) });
}

/** Text that only makes sense in a terminal (it names a follow-up command line). */
function hint(text) {
  doc.push({ t: 'text', text, cli: true });
}

/** Hand a file to the front end: the terminal writes it, the site offers it as a download. */
function file(name, text) {
  doc.push({ t: 'file', name, text });
}

const HELP = `Fire Emblem: Fortune's Weave growth simulator

Usage: node scripts/sim/cli.js <command> [options]

Commands
  char <unit>            Recommended class path for each role (add --role for the ranked list)
  path <unit> <A>B>C>D>  Profile one specific path chapter by chapter
                         (one class per decision, "stay" to keep the current class; or give
                         each change its level, e.g. "Gladiator@5>Brigand@20>Warrior@38")
  all                    Every unit: the role it fits best and the path for it
                         (add --role for one role's leaderboard)
  classes                Which classes help the most units, per tier and role
  export [file]          The \`all\` results as self-describing JSON (roles, axes, chapters, class
                         value, every unit's path per role and its candidate paths) for other
                         tools to read; stdout when no file is given
  refs                   The reference enemies every profile is measured against
  visuals                Write out/visuals.html: how every number is made, and the results,
                         colour-coded. Rebuilt from the data on every run (--out <file>,
                         --watch to rebuild whenever a data file changes)
  enemies                Full enemy roster (used by the duel role) and the enemy model
  list                   Units and classes in the data

A unit is described by a profile, not one score: physical and magic damage (how
fast it kills), safety when attacking, physical and magic bulk, avoid, survival
(how much of an enemy phase it lasts), support (healing) and reach, each 0-100.
A role weights those axes; paths are ranked per role, and a role's leading
paths are replayed with level-ups actually rolled to decide between them.

Options
  --route <name>     cai | dietrich | theodora | leda | any | common (default common).
                     Eight Advanced classes only unlock on certain Part I routes.
                     common = leave them out, a route name = add that route's,
                     any = add them all.
  --hard             Hard-difficulty enemies
  --divine           Also search Divine classes (one more decision late in Part III)
  --no-arts          Units never attack with combat arts: abilities that need one are not
                     counted (by default they count as if the unit always used an art)
  --role <name>      striker | mage | tank | magetank | mixedtank | healer (see "roles" in
                     src/sim/data/mechanics.json), or duel for the old single score (slow)
  --max-gap <n>      Largest exam shortfall, in skill ranks, a class change may have
                     (default 1: one rank can be made up by training)
  --free-reclass     Allow any class change regardless of skill ranks
  --detours <n>      Sideways class changes (within a tier) a path may make (default 1)
  --offense <0-1>    duel role only: share of the duel score given to offense
  --from <id> --to <id>   Only score checkpoints in this range (e.g. --from P2-01)
  --top <n>          Rows to show (default 10)
  --runs <n>         Level-up playthroughs rolled for each role's leading paths
                     (default: "roles.rolled.runs" in src/sim/data/mechanics.json; 0 = do not roll,
                     treat paths within the fixed tolerance as equal)
  --at <id>          path/refs/enemies: show one checkpoint in detail (e.g. P1-08)
  --csv <file>       all/char: also write the table as CSV
  --json             Print machine-readable output instead of tables
`;

// ------------------------------------------------------------------ helpers

function parseArgs(argv) {
  const opts = { _: [] };
  const flags = new Set(['hard', 'divine', 'no-arts', 'free-reclass', 'json', 'help', 'watch']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    if (flags.has(key)) opts[key] = true;
    else {
      if (i + 1 >= argv.length) fail(`Option ${a} needs a value`);
      opts[key] = argv[++i];
    }
  }
  return opts;
}

function fail(message) {
  throw new CommandError(message);
}

function searchOptions(data, args) {
  const route = (args.route || 'common').toLowerCase();
  if (!['any', 'common', ...ROUTES].includes(route)) fail(`Unknown route "${args.route}". Use ${ROUTES.join(', ')}, common or any.`);
  const role = args.role ? String(args.role).toLowerCase() : undefined;
  if (role && !roleNames(data, { duel: true }).includes(role)) fail(`Unknown role "${args.role}". Roles: ${roleNames(data, { duel: true }).join(', ')}.`);
  let maxGap;
  if (args['max-gap'] != null) {
    maxGap = Number(args['max-gap']);
    if (!(maxGap >= 0)) fail('--max-gap must be a number of skill ranks, 0 or more');
  }
  return {
    route, role, hard: !!args.hard, divine: !!args.divine, arts: !args['no-arts'], maxGap,
    freeReclass: !!args['free-reclass'], from: args.from, to: args.to,
    offense: offenseOption(args.offense),
    detours: intOption(args.detours, undefined, 'detours'),
    runs: intOption(args.runs, data.mechanics.roles.rolled.runs, 'runs'),
  };
}

function offenseOption(value) {
  if (value == null) return undefined;
  const n = Number(value);
  if (!(n >= 0 && n <= 1)) fail('--offense must be a number from 0 to 1 (share of the score given to offense)');
  return n;
}

function intOption(value, fallback, name) {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(`--${name} must be a non-negative whole number`);
  return n;
}

const f1 = (x) => (x == null ? '-' : x.toFixed(1));
const pct = (x) => `${Math.round(100 * x)}%`;

/** A table block. cols: [{h: header, v: row => value, right: bool}] */
function table(rows, cols) {
  return { t: 'table', cols: cols.map((c) => ({ h: c.h, right: !!c.right })), rows: rows.map((r) => cols.map((c) => String(c.v(r)))) };
}

/** A table block as plain text, the way the terminal shows it. */
export function tableText(block) {
  const { cols, rows: cells } = block;
  const widths = cols.map((c, i) => Math.max(c.h.length, ...cells.map((r) => r[i].length)));
  const line = (vals) => vals.map((v, i) => (cols[i].right ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join('  ').trimEnd();
  return [line(cols.map((c) => c.h)), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

function csv(rows, cols) {
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.map((c) => esc(c.h)).join(','), ...rows.map((r) => cols.map((c) => esc(c.v(r))).join(','))].join('\n') + '\n';
}

function getChar(data, name) {
  if (!name) fail('Give a unit name (see `list`).');
  const char = findByName(data.characters, name);
  if (!char) fail(`Unknown unit "${name}". Run \`node scripts/sim/cli.js list\` to see the names.`);
  return char;
}

/** "Gladiator > Brigand > Warrior (Lv38)": a change's level is shown when it is not the tier's own. */
function pathLabel(data, char, steps) {
  const prog = data.mechanics.progression;
  const usual = (name) => {
    const tier = data.classes.get(name).tier;
    return tier === 'divine' ? prog.divineLevel : (prog.tiers.find((t) => t.tier === tier) || {}).level;
  };
  return steps.map((s) => (s.level === usual(s.name) || s.level === char.base.level ? s.name : `${s.name} (Lv${s.level})`)).join(' > ') || '(stays in its class)';
}

function flagsFor(data, char, classes) {
  const notes = new Set();
  for (const name of classes) {
    const cls = data.classes.get(name);
    if (cls.routes) notes.add('r');
    if (cls.growthsGame8) notes.add('~');
  }
  return [...notes].join('');
}

function scopeLine(ctx, opts) {
  const classes = { common: 'classes every route unlocks', any: 'all classes incl. route exclusives' }[opts.route] || `classes on ${opts.route}'s route`;
  const parts = [classes, `difficulty: ${opts.hard ? 'hard' : 'normal'}`];
  if (opts.divine) parts.push('divine classes on');
  if (opts.arts === false) parts.push('no combat arts');
  if (opts.detours != null) parts.push(`${opts.detours} sideways change(s)`);
  if (opts.freeReclass) parts.push('free reclassing');
  else if (opts.maxGap != null) parts.push(`exam gap up to ${opts.maxGap} rank(s)`);
  if (opts.role === 'duel') {
    const sc = ctx.data.mechanics.scoring;
    parts.push(`duel score = ${Math.round(100 * sc.offense)}% offense / ${Math.round(100 * sc.bulk)}% bulk`);
  }
  if (opts.from || opts.to) parts.push(`checkpoints ${opts.from || 'start'}..${opts.to || 'end'}`);
  return parts.join(' | ');
}

const roleLabel = (data, role) => data.mechanics.roles.list[role].label;
const joinLabel = (char) => `Lv${char.base.level} ${char.base.class}${char.base.source === 'estimated' ? ' *' : ''}`;
const trainLabel = (t) => (t > 0 ? (Number.isInteger(t) ? String(t) : t.toFixed(1)) : '-');

/** Profile axes to show: everything measured (the duel axis only when it was computed). */
function shownAxes(ctx) {
  return AXES.map((name, i) => ({ name, i })).filter((a) => a.name !== 'duel' || ctx.duel);
}

function axisCols(ctx, get) {
  return shownAxes(ctx).map((a) => ({ h: AXIS_LABEL[a.name], v: (r) => Math.round(get(r)[a.i]), right: true }));
}

/** Axes a role weights, heaviest first. */
function roleAxes(data, role) {
  return Object.entries(data.mechanics.roles.list[role].weights).sort((a, b) => b[1] - a[1]).map(([name]) => ({ name, i: AXES.indexOf(name) }));
}

function abilityLines(char, arts = true) {
  const lines = [];
  const scored = char.abilityList.filter((a) => isScored(a, arts));
  const artOnly = char.abilityList.filter((a) => !a.reason && !isScored(a, arts));
  const skipped = char.abilityList.filter((a) => a.reason && !char.abilityList.some((b) => b.replaces.includes(a.name)));
  const when = (a) => (a.kind === 'personal' ? 'personal' : a.level == null ? 'level not published, assumed learned' : `Lv${a.level}`);
  if (scored.length) lines.push(`Abilities scored:     ${scored.map((a) => `${a.name} (${when(a)}): ${a.text}`).join('\n                      ')}`);
  if (skipped.length) lines.push(`Abilities not scored: ${skipped.map((a) => `${a.name} - ${a.reason}`).join('; ')}`);
  if (artOnly.length) lines.push(`Not counted (no combat arts): ${artOnly.map((a) => a.name).join(', ')}`);
  for (const c of abilityCaveats(char, arts)) lines.push(`Caveat:               ${c} The arts themselves are not modelled.`);
  return lines;
}

/** How "as good" was decided, for the footer. */
function equalNote(data, opts) {
  const cfg = data.mechanics.roles.rolled;
  if (!(opts.runs > 0)) return `As good = other paths within ${data.mechanics.roles.tolerance.value} point of the role's best; the one needing the least training is shown.`;
  return `Rolled = average score over ${opts.runs} playthroughs with level-ups actually rolled (the same dice for every path); Unlucky 10% = the score 9 in 10 playthroughs beat.\n`
    + `As good = other paths the leader beats in fewer than ${Math.round(100 * cfg.winShare)}% of those playthroughs, or by under ${cfg.minGap} points; of these the one needing the least training is shown.`;
}

const NOTES = "Train = skill ranks the path's exams ask for beyond what the unit would have from its classes alone (make them up at the Arena); - = none.";

const LEGEND = 'Flags: r route-exclusive class   ~ sources disagree on this class\'s growths';

// ----------------------------------------------------------------- commands

function unitHeader(ctx, char, opts) {
  const lines = [`${char.name} - joins ${joinLabel(char)}${char.base.joinsAt ? ` at ${ctx.data.checkpoints.find((c) => c.id === char.base.joinsAt).label}` : ''} (base stats: ${char.base.source})`];
  lines.push(`Growths  ${STATS.map((s) => `${s} ${char.growths[s]}`).join('  ')}`);
  lines.push(`Skills   good at: ${char.preferred.join(', ') || '-'}   bad at: ${char.nonIdeal.join(', ') || '-'}${char.locks.size ? `   cannot be: ${[...char.locks].join(', ')}` : ''}`);
  lines.push(...abilityLines(char, opts.arts));
  if (!char.spellBook) lines.push('Spell list not published yet: the standard spell lines are assumed.');
  if (char.notes) lines.push(char.notes);
  lines.push(scopeLine(ctx, opts));
  return lines.join('\n');
}

function examLine(data, evaluated) {
  if (!evaluated.exams.length) return 'Exams: none (no class change)';
  return `Exams: ${evaluated.exams.map((e) => `Lv${e.level} ${e.cls.name} ${e.gap > 0 ? `needs ${e.skills.join(' + ')} trained up (${trainLabel(e.gap)} rank${e.gap === 1 ? '' : 's'} short)` : 'ok'}`).join('; ')}`;
}

function cmdChar(data, args) {
  const opts = searchOptions(data, args);
  const char = getChar(data, args._[1]);
  const ctx = createContext(data, opts);
  const t0 = Date.now();
  const result = searchPaths(ctx, char, opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!result.paths.length) fail(`${char.name} joins at Lv${char.base.level}, after the last checkpoint in range.`);
  const cps = result.checkpoints;
  const searched = `Searched class paths over ${cps.length} checkpoints (${cps[0].cp.label} to ${cps[cps.length - 1].cp.label}): ${result.explored.toLocaleString()} unit-chapters profiled, the ${result.paths.length.toLocaleString()} best paths kept, in ${secs}s`;
  if (opts.role) return charRole(ctx, char, opts, args, result, searched);

  const rows = roleNames(data).map((role) => {
    const { ranked, rec } = rankRolled(ctx, char, result, role, opts);
    return { role, rec, best: ranked[0], equal: ranked.filter((r) => r.equal).length };
  });
  if (args.json) {
    print(JSON.stringify({
      unit: char.name, base: char.base, options: opts, pathsSearched: result.paths.length,
      roles: rows.map((r) => ({ role: r.role, path: r.rec.steps, score: r.rec.score, endgame: r.rec.final, train: r.rec.train,
        rolled: r.rec.rolled, equalPaths: r.equal, profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, r.rec.path.axes[a.i]])) })),
    }, null, 1));
    return;
  }
  print(unitHeader(ctx, char, opts));
  print(`${searched}\n`);
  print('RECOMMENDED PATH PER ROLE  (profile = campaign average, each axis 0-100)');
  print(table(rows, [
    { h: 'Role', v: (r) => roleLabel(data, r.role) },
    { h: 'Path', v: (r) => pathLabel(data, char, r.rec.steps) },
    { h: 'Score', v: (r) => f1(r.rec.score), right: true },
    ...(opts.runs > 0 ? [{ h: 'Rolled', v: (r) => f1(r.rec.rolled.mean), right: true }, { h: 'Unlucky 10%', v: (r) => f1(r.rec.rolled.p10), right: true }] : []),
    { h: 'Train', v: (r) => trainLabel(r.rec.train), right: true },
    { h: 'As good', v: (r) => r.equal - 1, right: true },
    ...axisCols(ctx, (r) => r.rec.path.axes),
    { h: 'Flags', v: (r) => flagsFor(data, char, r.rec.classes) },
  ]));
  print(`\nScore is the role's weighting of the profile; compare it within a role, not across roles (\`all\` shows how ${char.name} ranks in the cast for each role).`);
  print(equalNote(data, opts));
  print(NOTES);
  print(LEGEND);
  hint(`\nNext: node scripts/sim/cli.js char ${char.name} --role <${roleNames(data).join('|')}> for the ranked list and chapter-by-chapter numbers.`);
  if (char.base.source === 'estimated') print(`Note: ${char.name}'s base stats are not published yet; they are estimated from growth rates (see src/sim/README.md).`);
}

function charRole(ctx, char, opts, args, result, searched) {
  const { data } = ctx;
  const role = opts.role;
  const top = intOption(args.top, 10, 'top');
  const runs = opts.runs;
  const { ranked, rec } = rankRolled(ctx, char, result, role, opts);
  const shown = ranked.slice(0, top);
  if (!shown.includes(rec)) shown.push(rec);
  const best = evaluatePath(ctx, char, rec.steps, opts);
  const marginals = classMarginals(result, ranked);
  const axes = roleAxes(data, role);

  if (args.json) {
    print(JSON.stringify({
      unit: char.name, base: char.base, role, options: opts, pathsSearched: result.paths.length,
      decisions: result.decisions.map((d) => ({ level: d.level, tier: d.tier })),
      recommended: rec.steps,
      top: shown.map((r) => ({ path: r.steps, score: r.score, endgame: r.final, train: r.train, equal: !!r.equal, rolled: r.rolled,
        profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, r.path.axes[a.i]])) })),
      classMarginals: marginals,
      exams: best.exams.map((e) => ({ level: e.level, class: e.cls.name, shortBy: e.gap, skills: e.skills })),
      recommendedPath: best.rows.map((r) => ({ checkpoint: r.cp.id, level: r.cp.playerLevel, class: r.cls.name,
        stats: Object.fromEntries(STATS.map((s, i) => [s, +r.stats[i].toFixed(1)])),
        profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, +r.axes[a.i].toFixed(1)])) })),
    }, null, 1));
    return;
  }

  print(unitHeader(ctx, char, opts));
  print(`${searched}\n`);
  const w = data.mechanics.roles.list[role].weights;
  print(`TOP PATHS AS ${roleLabel(data, role).toUpperCase()}  (score = ${axes.map((a) => `${Math.round(100 * w[a.name])}% ${AXIS_LABEL[a.name]}`).join(' + ')})`);
  const cols = [
    { h: '#', v: (r) => ranked.indexOf(r) + 1, right: true },
    { h: '', v: (r) => (r === rec ? '>' : r.equal ? '=' : '') },
    { h: 'Path', v: (r) => pathLabel(data, char, r.steps) },
    { h: 'Score', v: (r) => f1(r.score), right: true },
    { h: 'Endgame', v: (r) => f1(r.final), right: true },
    { h: 'Train', v: (r) => trainLabel(r.train), right: true },
    ...axes.map((a) => ({ h: AXIS_LABEL[a.name], v: (r) => Math.round(r.path.axes[a.i]), right: true })),
    { h: 'Flags', v: (r) => flagsFor(data, char, r.classes) },
  ];
  if (runs > 0) {
    cols.push({ h: `Rolled x${runs}`, v: (r) => (r.rolled ? `${f1(r.rolled.mean)} +/-${f1(r.rolled.sd)}` : ''), right: true });
    cols.push({ h: 'Unlucky 10%', v: (r) => (r.rolled ? f1(r.rolled.p10) : ''), right: true });
    cols.push({ h: 'Leader wins', v: (r) => (r.rolled ? (r.rolled.gap === 0 && r.rolled.lead === 0.5 ? 'leader' : `${pct(r.rolled.lead)} by ${f1(r.rolled.gap)}`) : ''), right: true });
  }
  print(table(shown, cols));
  if (runs > 0) {
    const cfg = data.mechanics.roles.rolled;
    print(`Rolled x${runs}: the top ${cfg.top} paths replayed with level-ups actually rolled, the same dice for every path (mean +/- sd); Unlucky 10%: the score 9 in 10 playthroughs beat.`);
    print(`Leader wins: how often, and by how much on average, the path with the best rolled score beats this one in the same playthrough.`);
    print(`> recommended   = as good as the leader (it wins under ${Math.round(100 * cfg.winShare)}% of playthroughs, or by under ${cfg.minGap} points); the recommended path is the one of these that needs the least training.`);
  } else {
    print(`> recommended   = within ${data.mechanics.roles.tolerance.value} point of the best, i.e. as good; the recommended path is the one of these that needs the least training.`);
  }
  print(`Score = campaign average over the unit's luck lines, Endgame = last chapter. A level in brackets marks a class change not made at the tier's usual level. ${NOTES}`);
  print(LEGEND);

  print('\nBEST CLASS OF EACH TIER  (best score of any path through that class, and the gap to the best path)');
  for (const m of marginals) {
    const list = m.classes.slice(0, 8).map((c) => `${c.name} ${f1(c.score)}${c.delta < -0.05 ? ` (${f1(c.delta)})` : ''}`);
    print(`  Lv${String(m.level).padEnd(2)} ${m.tier.padEnd(9)} ${list.join(' | ')}`);
  }

  print(`\nRECOMMENDED PATH CHAPTER BY CHAPTER  (expected stats incl. class bonus; profile axes 0-100)`);
  print(examLine(data, best));
  const wArr = shownAxes(ctx);
  print(table(best.rows, [
    { h: 'Checkpoint', v: (r) => r.cp.label },
    { h: 'Lv', v: (r) => r.cp.playerLevel, right: true },
    { h: 'Class', v: (r) => r.cls.name },
    ...STATS.slice(0, 8).map((s, i) => ({ h: s[0].toUpperCase() + s.slice(1), v: (r) => Math.round(r.stats[i]), right: true })),
    ...wArr.map((a) => ({ h: AXIS_LABEL[a.name], v: (r) => Math.round(r.axes[a.i]), right: true })),
  ]));
  if (char.base.source === 'estimated') print(`\nNote: ${char.name}'s base stats are not published yet; they are estimated from growth rates (see src/sim/README.md).`);
  if (args.csv) {
    file(args.csv, csv(ranked, [
      { h: 'path', v: (r) => r.steps.map((st) => `${st.name}@${st.level}`).join('>') },
      { h: 'score', v: (r) => r.score.toFixed(2) }, { h: 'endgame', v: (r) => (r.final ?? 0).toFixed(2) }, { h: 'train', v: (r) => r.train },
      ...wArr.map((a) => ({ h: a.name, v: (r) => r.path.axes[a.i].toFixed(1) })),
    ]));
    print(`\nWrote the ${ranked.length} paths kept to ${args.csv}`);
  }
}

/** A path typed on the command line, as steps: "A>B>C" (one class per decision) or "A@5>B@20>C@38". */
function parsePath(data, char, decisions, text) {
  if (!text) fail('Give a path like "Gladiator>Brigand>Warrior>Battlemaster" or "Gladiator@5>Brigand@20>Warrior@38".');
  const parts = text.split('>').map((s) => s.trim()).filter(Boolean);
  const levelled = parts.some((n) => n.includes('@'));
  if (levelled && !parts.every((n) => n.includes('@'))) fail('Give every class change its level ("Class@Level"), or none of them.');
  if (!levelled && parts.length > decisions.length) fail(`${char.name} has ${decisions.length} class decisions (${decisions.map((d) => `Lv${d.level} ${d.tier}`).join(', ')}); got ${parts.length} classes. To change class more often, give each change its level: "Class@Level".`);
  let prev = char.base.class;
  const steps = [];
  parts.forEach((part, i) => {
    const [n, at] = part.split('@').map((x) => x.trim());
    const level = levelled ? Number(at) : decisions[i].level;
    if (levelled && !(Number.isInteger(level) && level >= char.base.level)) fail(`"${part}": the level must be a whole number, ${char.base.level} or higher.`);
    if (steps.length && level < steps[steps.length - 1].level) fail('Class changes must be given in level order.');
    if (/^(stay|-)$/i.test(n)) return;
    const cls = findByName(data.classes, n);
    if (!cls) fail(`Unknown class "${n}". Run \`node scripts/sim/cli.js list\` to see the names.`);
    if (cls.name !== prev) steps.push({ level, name: cls.name });
    prev = cls.name;
  });
  return steps;
}

const strikeText = (s) => (s ? `${s.weapon} @${s.range}: ${Math.round(s.dmg)}${s.follow > 0.5 ? ' x2' : ''}, hit ${pct(s.hit)}` : '-');

function cmdPath(data, args) {
  const opts = searchOptions(data, args);
  const char = getChar(data, args._[1]);
  const ctx = createContext(data, opts);
  const decisions = decisionPlan(data, char, opts);
  const steps = parsePath(data, char, decisions, args._[2]);
  const classes = steps.map((st) => st.name);
  const res = evaluatePath(ctx, char, steps, { ...opts, detail: !!args.at });
  if (!res.rows.length) fail('No checkpoints in range for this unit.');
  const runs = opts.runs;
  const roles = roleNames(data, { duel: ctx.duel });
  const scores = roles.map((role) => ({ role, ...roleScore(ctx, res, role) }));
  const locked = classes.map((n) => data.classes.get(n)).filter((c) => (c.cavalry && char.locks.has('cavalry')) || (c.flying && char.locks.has('flying')));

  if (args.at) {
    const row = res.rows.find((r) => r.cp.id.toLowerCase() === String(args.at).toLowerCase());
    if (!row) fail(`Checkpoint "${args.at}" is not one this unit is scored at. Options: ${res.rows.map((r) => r.cp.id).join(' ')}`);
    if (args.json) { print(JSON.stringify(matchupJson(ctx, row), null, 1)); return; }
    print(`${char.name} as Lv${row.cp.playerLevel} ${row.cls.name} at ${row.cp.label} (${row.cp.id})  |  ${scopeLine(ctx, opts)}`);
    print(`Stats   ${STATS.map((s, i) => `${s} ${row.stats[i].toFixed(1)}`).join('  ')}  bld ${row.bld}  mov ${row.mov}   (expected; the table below is read at these, rounded)`);
    print(`Ranks   ${SKILLS.map((s, i) => [s, rankAt(data, row.expo[i])]).filter(([, r]) => r > 0).map(([s, r]) => `${s} ${rankName(data, r)}`).join('  ') || '-'}   (estimated)`);
    const active = activeAbilities(char, row.cp.playerLevel).filter((a) => isScored(a, opts.arts));
    if (active.length) print(`Active  ${active.map((a) => a.name).join(', ')}`);
    print(`Profile ${shownAxes(ctx).map((a) => `${AXIS_LABEL[a.name]} ${Math.round(row.axes[a.i])}`).join('  ')}\n`);
    print('AGAINST THE REFERENCE ENEMIES');
    print(table(row.rows, [
      { h: 'Enemy', v: (m) => `${m.ref.cls.name} Lv${m.ref.level}` },
      { h: 'HP', v: (m) => m.ref.stats[0], right: true },
      { h: 'Def', v: (m) => m.ref.stats[5], right: true },
      { h: 'Res', v: (m) => m.ref.stats[6], right: true },
      { h: 'AS', v: (m) => Math.round(m.ref.loadout.as), right: true },
      { h: '| Physical attack', v: (m) => `| ${strikeText(m.phys)}` },
      { h: 'HP dealt', v: (m) => (m.phys ? pct(m.phys.share) : '-'), right: true },
      { h: 'Kills', v: (m) => (m.phys ? pct(m.phys.kill) : '-'), right: true },
      { h: 'Attacks', v: (m) => (m.phys && m.phys.speed > 0 ? (1 / m.phys.speed).toFixed(1) : '-'), right: true },
      { h: '| Magic attack', v: (m) => `| ${strikeText(m.mag)}` },
      { h: 'Kills', v: (m) => (m.mag ? pct(m.mag.kill) : '-'), right: true },
      { h: 'Attacks', v: (m) => (m.mag && m.mag.speed > 0 ? (1 / m.mag.speed).toFixed(1) : '-'), right: true },
      { h: 'Map avg', v: (m) => (m.mag ? pct(m.mag.average) : '-'), right: true },
      { h: `| ${'Their attack'}`, v: (m) => `| ${m.ref.weapon.name}: ${Math.round(m.def.dmg)}${m.def.follow > 0.5 ? ' x2' : ''}` },
      { h: 'HP lost', v: (m) => pct(m.def.lost), right: true },
      { h: 'Their hit', v: (m) => pct(1 - m.avoid), right: true },
      { h: 'Expected', v: (m) => pct(m.def.expected), right: true },
    ]));
    print(`\nHP dealt = share of the enemy's HP removed, on average, in one attack you start; Kills = chance that attack kills; Attacks = attacks you expect to need to kill it.`);
    print(`The damage axes are ${Math.round(data.mechanics.profile.oneAttackKill.value * 100)}% Kills + ${Math.round((1 - data.mechanics.profile.oneAttackKill.value) * 100)}% of 100 / Attacks, averaged over the enemies. Map avg = the same for magic over ${data.mechanics.profile.combatsPerMap.value} attacks with limited spell uses.`);
    print('HP lost = share of your HP gone after one attack the enemy starts, if every strike lands; Their hit = their chance to hit; Expected = HP lost on average with hit and crit chances played out.');
    print(`It defends holding the weapon it attacked with, so the "Their attack" columns and the survival below are averaged over: ${row.held.map((h) => `${h.weapon} ${pct(h.share)}`).join(', ')}.`);
    const phase = (label, sv) => (sv ? `${label} ${sv.left.map((p, k) => `${k + 1}: ${pct(p)} (alive ${pct(sv.alive[k])})`).join('  ')}` : null);
    const lines = [phase('physical attackers', row.survive.phys), phase('magical attackers ', row.survive.mag)].filter(Boolean);
    if (lines.length) print(`HP left on average after being attacked by that many enemies in a row (the survival axes are the average):\n  ${lines.join('\n  ')}`);
    if (row.heals && row.heals.length) print(`Healing per map: ${row.heals.map((h) => `${h.name} x${Math.round(h.casts)} (${Math.round(h.amount)} HP each)`).join(', ')} = ${Math.round(row.healed)} HP`);
    if (ctx.duel) duelTable(row);
    return;
  }

  const mcRole = opts.role || null;
  const mc = runs > 0 && mcRole ? monteCarlo(ctx, char, steps, { ...opts, runs }) : null;
  if (args.json) {
    print(JSON.stringify({ unit: char.name, path: steps, train: res.train,
      exams: res.exams.map((e) => ({ level: e.level, class: e.cls.name, shortBy: e.gap, skills: e.skills })),
      roles: Object.fromEntries(scores.map((s) => [s.role, { score: s.score, endgame: s.final }])), monteCarlo: mc,
      rows: res.rows.map((r) => ({ checkpoint: r.cp.id, level: r.cp.playerLevel, class: r.cls.name,
        profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, +r.axes[a.i].toFixed(1)])) })) }, null, 1));
    return;
  }
  print(`${char.name}: ${pathLabel(data, char, steps)}  |  ${scopeLine(ctx, opts)}`);
  if (locked.length) print(`Warning: ${char.name} cannot change to ${locked.map((c) => c.name).join(', ')} (personal ability). This path is not possible in game.`);
  print(examLine(data, res));
  print(`Role scores (campaign / endgame): ${scores.map((s) => `${s.role} ${f1(s.score)} / ${f1(s.final)}`).join('   ')}`);
  if (mc) print(`As ${mcRole}, rolled x${runs}: ${f1(mc.campaign.mean)} +/-${f1(mc.campaign.sd)}, unlucky 10% ${f1(mc.campaign.p10)}, lucky 10% ${f1(mc.campaign.p90)}`);
  print('');
  print(table(res.rows, [
    { h: 'Id', v: (r) => r.cp.id },
    { h: 'Checkpoint', v: (r) => r.cp.label },
    { h: 'Lv', v: (r) => r.cp.playerLevel, right: true },
    { h: 'Class', v: (r) => r.cls.name },
    ...STATS.slice(0, 8).map((s, i) => ({ h: s[0].toUpperCase() + s.slice(1), v: (r) => Math.round(r.stats[i]), right: true })),
    ...axisCols(ctx, (r) => r.axes),
  ]));
  hint('\nAdd --at <Id> to see the numbers behind one checkpoint.');
}

function duelTable(row) {
  print(`\nDUEL SCORE ${f1(row.duel.score)}  (offense ${f1(row.duel.offense)}, bulk ${f1(row.duel.bulk)})`);
  print(table(row.duel.rows, [
    { h: 'Enemy', v: (m) => `${m.enemy.name} Lv${m.enemy.level}` },
    { h: 'Src', v: (m) => ({ model: 'model', observed: 'real', 'observed+model': 'real*' })[m.enemy.source] },
    { h: 'Enemy weapon', v: (m) => m.enemy.weapon.name },
    { h: 'Wt', v: (m) => pct(m.enemy.share), right: true },
    { h: 'Attack with', v: (m) => `${m.pp.weapon} @${m.pp.range}` },
    { h: 'Dmg', v: (m) => `${Math.round(m.pp.dmg)}${m.pp.follow > 0.5 ? ' x2' : ''}`, right: true },
    { h: 'Hit', v: (m) => pct(m.pp.hit), right: true },
    { h: 'Crit', v: (m) => pct(m.pp.crit), right: true },
    { h: 'HP dealt', v: (m) => pct(m.pp.deal), right: true },
    { h: '1RKO', v: (m) => pct(m.pp.ko), right: true },
    { h: '| Defend with', v: (m) => `| ${m.ep.weapon}` },
    { h: 'Foe dmg', v: (m) => `${Math.round(m.ep.dmg)}${m.ep.follow > 0.5 ? ' x2' : ''}`, right: true },
    { h: 'Foe hit', v: (m) => pct(m.ep.hit), right: true },
    { h: 'HP lost', v: (m) => pct(m.ep.taken), right: true },
    { h: 'Counter', v: (m) => pct(m.ep.deal), right: true },
    { h: 'Die', v: (m) => pct(m.ep.death), right: true },
  ]));
  print('\nSrc: real = published stats, real* = published stats with gaps filled by the model, model = generated from the enemy model. Wt = share of the score.');
}

function matchupJson(ctx, row) {
  return {
    checkpoint: row.cp.id, class: row.cls.name,
    profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, row.axes[a.i]])),
    references: row.rows.map((m) => ({ enemy: m.ref.cls.name, archetype: m.ref.archetype, level: m.ref.level, weapon: m.ref.weapon.name,
      physical: m.phys, magic: m.mag, defence: m.def, avoid: m.avoid })),
    held: row.held,
    healing: { perMap: row.healed, casts: row.heals },
    duel: row.duel ? { score: row.duel.score, matchups: row.duel.rows.map((m) => ({ enemy: m.enemy.name, level: m.enemy.level,
      source: m.enemy.source, weapon: m.enemy.weapon.name, share: m.enemy.share, playerPhase: m.pp, enemyPhase: m.ep })) } : undefined,
  };
}

/** Search every unit (on worker threads); `roles` are the roles to pick a recommended path for. */
async function runAll(data, args, roles = []) {
  const opts = searchOptions(data, args);
  const ctx = createContext(data, opts);
  const rows = await io.runCast(data, opts, roles, (done, total) => {
    if (!args.json && io.progress) io.progress(done, total);
  });
  return { ctx, opts, rows };
}

/** Every unit's recommended path, score and place in the cast for each role, and the role it fits best. */
async function rankCast(data, args) {
  const picked = args.role ? [String(args.role).toLowerCase()] : roleNames(data);
  const { ctx, opts, rows } = await runAll(data, args, picked);
  const roles = opts.role ? [opts.role] : roleNames(data);
  const castAvg = {};
  // Each unit comes with its recommended path per role (r.roles); here it gets its place in the cast.
  // Units are present for different chapters, and chapters differ in how high anyone scores
  // (everyone is weak as a Lv1 Commoner). So units are ranked on how far they sit above the
  // cast's average in each chapter they are present for, not on their raw campaign average.
  for (const role of roles) {
    const byChapter = new Map();
    for (const r of rows) {
      for (const c of r.roles[role].chapters) {
        const e = byChapter.get(c.id) || byChapter.set(c.id, { sum: 0, n: 0 }).get(c.id);
        e.sum += c.score; e.n++;
      }
    }
    castAvg[role] = new Map([...byChapter].map(([id, e]) => [id, e.sum / e.n]));
    for (const r of rows) {
      const e = r.roles[role];
      e.vsCast = e.chapters.reduce((sum, c) => sum + c.score - byChapter.get(c.id).sum / byChapter.get(c.id).n, 0) / e.chapters.length;
    }
    const order = [...rows].sort((a, b) => b.roles[role].vsCast - a.roles[role].vsCast);
    order.forEach((r, i) => { r.roles[role].rank = i + 1; r.roles[role].share = r.roles[role].vsCast; });
  }
  // Best role: the one where the unit ranks highest in the cast (ties: closest to that role's best unit).
  for (const r of rows) {
    r.role = roles.reduce((best, role) => (!best || r.roles[role].rank < r.roles[best].rank
      || (r.roles[role].rank === r.roles[best].rank && r.roles[role].share > r.roles[best].share) ? role : best), null);
    r.fit = r.roles[r.role];
  }
  rows.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role) || a.fit.rank - b.fit.rank);

  return { ctx, opts, rows, roles, castAvg };
}

async function cmdAll(data, args) {
  const t0 = Date.now();
  const { ctx, opts, rows, roles } = await rankCast(data, args);

  if (args.json) {
    print(JSON.stringify(rows.map((r) => ({ unit: r.char.name, joinLevel: r.char.base.level, joinClass: r.char.base.class,
      baseSource: r.char.base.source, checkpoints: r.result.checkpoints.length, bestRole: r.role,
      roles: Object.fromEntries(roles.map((role) => [role, { rank: r.roles[role].rank, vsCast: r.roles[role].vsCast, path: r.roles[role].rec.steps,
        score: r.roles[role].rec.score, rolled: r.roles[role].rec.rolled, endgame: r.roles[role].rec.final, train: r.roles[role].rec.train,
        profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, r.roles[role].rec.path.axes[a.i]])) }])),
      profile: Object.fromEntries(shownAxes(ctx).map((a) => [a.name, r.fit.rec.path.axes[a.i]])) })), null, 1));
    return;
  }
  const single = !!opts.role;
  const cols = [
    ...(single ? [{ h: '#', v: (r) => r.fit.rank, right: true }] : []),
    { h: 'Unit', v: (r) => r.char.name },
    { h: 'Joins', v: (r) => joinLabel(r.char) },
    ...(single ? [] : [
      ...roles.map((role) => ({ h: role, v: (r) => `${f1(r.roles[role].rec.score)} (${r.roles[role].rank})`, right: true })),
      { h: 'Best role', v: (r) => roleLabel(data, r.role) }]),
    { h: 'Path', v: (r) => pathLabel(data, r.char, r.fit.rec.steps) },
    ...(single ? [{ h: 'Score', v: (r) => f1(r.fit.rec.score), right: true },
      { h: 'vs cast', v: (r) => `${r.fit.vsCast >= 0 ? '+' : ''}${f1(r.fit.vsCast)}`, right: true }] : []),
    { h: 'Endgame', v: (r) => f1(r.fit.rec.final), right: true },
    { h: 'Train', v: (r) => trainLabel(r.fit.rec.train), right: true },
    { h: 'Chapters', v: (r) => r.result.checkpoints.length, right: true },
    ...axisCols(ctx, (r) => r.fit.rec.path.axes),
    { h: 'Flags', v: (r) => flagsFor(data, r.char, r.fit.rec.classes) },
  ];
  const title = single ? `Every unit as ${roleLabel(data, opts.role)}` : 'Best-fit role and class path per unit';
  print(`${title}  |  ${scopeLine(ctx, opts)}  |  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  print(table(rows.slice(0, intOption(args.top, rows.length, 'top')), cols));
  if (!single) {
    print(`\nThe ${roles.join(' / ')} columns are the unit's score on its recommended path for that role and, in brackets, its place among all ${rows.length} units (1 = best).`);
    print('Places compare each unit with the cast average in the chapters it is present for, so joining early (weak Commoner chapters) or late does not move a unit up or down.');
    print('Best role = the role where it places highest; Path, Train and the profile are for that role. The CSV and --json output carry the path for every role.');
    print('\nTOP UNITS PER ROLE  (points above the cast average, chapter by chapter)');
    for (const role of roles) {
      const order = [...rows].sort((a, b) => a.roles[role].rank - b.roles[role].rank).slice(0, 8);
      print(`  ${roleLabel(data, role).padEnd(17)} ${order.map((r) => `${r.char.name} +${f1(r.roles[role].vsCast)}`).join(', ')}`);
    }
  }
  print(`\n* base stats estimated (not published yet).  ${LEGEND}`);
  const caveats = rows.flatMap((r) => abilityCaveats(r.char, opts.arts));
  if (caveats.length) print(`Caveats: ${caveats.join(' ')}`);
  print(`Score and profile are campaign averages over the chapters a unit is present for${single ? '; vs cast is the score against the cast average in those same chapters, and sets the order' : ''}. ${NOTES}`);
  if (args.csv) {
    const extra = single ? [] : roles.flatMap((role) => [
      { h: `${role} path`, v: (r) => pathLabel(data, r.char, r.roles[role].rec.steps) },
      { h: `${role} train`, v: (r) => r.roles[role].rec.train },
      ...shownAxes(ctx).map((a) => ({ h: `${role} ${a.name}`, v: (r) => r.roles[role].rec.path.axes[a.i].toFixed(1) })),
    ]);
    file(args.csv, csv(rows, [...cols, ...extra]));
    print(`Wrote ${args.csv}`);
  }
}

/** How much data went in and how firm it is, for the pages that explain the results. */
function castCounts(data, rows, arts = true) {
  return {
    units: rows.length, classes: data.classes.size, weapons: data.weapons.size, heals: data.heals.size,
    observedEnemies: data.observed.length, paths: rows.reduce((n, r) => n + r.result.paths.length, 0),
    estimatedBases: rows.filter((r) => r.char.base.source === 'estimated').length,
    abilities: rows.reduce((n, r) => n + r.char.abilityList.length, 0),
    abilitiesScored: rows.reduce((n, r) => n + r.char.abilityList.filter((a) => isScored(a, arts)).length, 0),
    basis: basisCounts(data.mechanics),
  };
}

/** The constants of the profile axes that their explanations quote. */
function profileConstants(mech) {
  return {
    healBars: mech.profile.healBars.value, dance: mech.profile.dance.value, healDiv: mech.profile.healFormula.magDiv,
    combatsPerMap: mech.profile.combatsPerMap.value, movFloor: mech.profile.movFloor, movCeil: mech.profile.movCeil, flyingMov: mech.profile.flyingMov,
  };
}

/** classValue() per tier in tier order: each class's average gap to the best option per role, rounded by `round`. */
function classTierList(data, ctx, rows, roles, round) {
  return [...classValue(data, ctx, rows, roles)].sort((a, b) => TIERS.indexOf(a[0]) - TIERS.indexOf(b[0])).map(([tier, map]) => ({
    tier, classes: [...map.values()].map((e) => ({
      name: e.name, types: data.classes.get(e.name).types, mov: data.classes.get(e.name).mov,
      roles: Object.fromEntries(roles.map((role) => [role, e.roles[role] ? { gap: round(e.roles[role].gap / e.roles[role].n), best: e.roles[role].best, n: e.roles[role].n } : null])),
    })),
  }));
}

/**
 * The `all` results with everything needed to explain and re-weight them alongside, for other tools (the planner
 * site) to read: role and axis definitions, the chapters, class value per tier, and each unit's candidate paths.
 */
async function cmdExport(data, args) {
  const { ctx, opts, rows, roles } = await rankCast(data, { ...args, json: !args._[1] });
  const mech = data.mechanics;
  const prog = data.mechanics.progression;
  const usual = (name) => {
    const tier = data.classes.get(name).tier;
    return tier === 'divine' ? prog.divineLevel : (prog.tiers.find((t) => t.tier === tier) || {}).level;
  };
  const r1 = (x) => Math.round(10 * x) / 10;
  const axes = shownAxes(ctx);
  const cpIndex = new Map(data.checkpoints.map((cp, i) => [cp.id, i]));
  // late: the change is not made at its tier's usual level (shown as "Warrior (Lv38)" elsewhere).
  const stepsOut = (char, steps) => steps.map((s) => ({ name: s.name, level: s.level, late: s.level !== usual(s.name) && s.level !== char.base.level }));
  const out = {
    scope: { route: opts.route, hard: opts.hard, divine: opts.divine, arts: opts.arts, runs: opts.runs },
    counts: castCounts(data, rows, opts.arts),
    tiers: [...prog.tiers, ...(opts.divine ? [{ tier: 'divine', level: prog.divineLevel }] : [])],
    maxExamGap: opts.freeReclass ? null : opts.maxGap ?? mech.skills.maxExamGap.value,
    profile: profileConstants(mech),
    checkpoints: data.checkpoints.map((cp, i) => ({
      id: cp.id, label: cp.label, playerLevel: cp.playerLevel, enemyLevel: cp.enemyLevel, bossLevel: cp.bossLevel ?? null,
      refs: ctx.refs[i].map((e) => ({ archetype: e.archetype, class: e.cls.name })),
    })),
    classTiers: classTierList(data, ctx, rows, roles, r1),
    roles: roles.map((id) => ({ id, label: roleLabel(data, id), weights: data.mechanics.roles.list[id].weights })),
    axes: axes.map((a) => ({ id: a.name, label: AXIS_LABEL[a.name] })),
    units: rows.map((r) => ({
      unit: r.char.name, joinLevel: r.char.base.level, joinClass: r.char.base.class,
      estimated: r.char.base.source === 'estimated', chapters: r.result.checkpoints.length, paths: r.result.paths.length,
      // The paths that could lead under some weighting of the axes, so a reader can re-score a role with other weights.
      // `ch` is the profile at every chapter the unit is present for, flattened (chapter * axes + axis), in tenths.
      cands: weightCandidates(r.result.paths, axes, roles.map((role) => r.result.paths.indexOf(r.roles[role].rec.path))).map((pi) => {
        const p = r.result.paths[pi];
        return { path: stepsOut(r.char, p.steps), train: p.train, ch: evaluatePath(ctx, r.char, p.steps, opts).rows.flatMap((row) => axes.map((a) => Math.round(row.axes[a.i] * 10))) };
      }),
      // The unit is present from this checkpoint (an index into `checkpoints`) to the last one scored.
      firstChapter: cpIndex.get(r.result.checkpoints[0].cp.id), bestRole: r.role,
      // What the scores take for granted about how the unit is played.
      caveats: abilityCaveats(r.char, opts.arts),
      roles: Object.fromEntries(roles.map((role) => {
        const e = r.roles[role];
        return [role, {
          rank: e.rank, vsCast: r1(e.vsCast), score: r1(e.rec.score), endgame: r1(e.rec.final), train: e.rec.train,
          // The role score at each chapter from firstChapter on, so a reader can compare part of the campaign.
          chapters: e.chapters.map((c) => r1(c.score)),
          path: stepsOut(r.char, e.rec.steps),
          axes: axes.map((a) => r1(e.rec.path.axes[a.i])),
        }];
      })),
    })),
  };
  const text = JSON.stringify(out);
  if (!args._[1]) { print(text); return; }
  file(args._[1], text + '\n');
  print(`Wrote ${args._[1]} (${out.units.length} units, ${scopeLine(ctx, opts)})`);
}

/**
 * For each role, tier and class: how far the best path through that class
 * falls short of the unit's best path, summed over the units that can take it.
 */
function classValue(data, ctx, rows, roles) {
  const tiers = new Map();
  for (const role of roles) {
    for (const { result } of rows) {
      for (const m of classMarginals(result, rankPaths(ctx, result, role))) {
        const tier = (tiers.has(m.tier) ? tiers : tiers.set(m.tier, new Map())).get(m.tier);
        for (const c of m.classes) {
          const cls = data.classes.get(c.name);
          if (cls.tier !== m.tier) continue; // a held lower-tier class is not this tier's option
          const e = tier.get(c.name) || tier.set(c.name, { name: c.name, roles: {} }).get(c.name);
          const r = (e.roles[role] ||= { n: 0, gap: 0, best: 0 });
          r.n++; r.gap += c.delta;
          if (c.delta > -0.05) r.best++;
        }
      }
    }
  }
  return tiers;
}

async function cmdClasses(data, args) {
  const { ctx, opts, rows } = await runAll(data, args);
  const roles = opts.role ? [opts.role] : roleNames(data);
  const tiers = classValue(data, ctx, rows, roles);
  const avg = (e, role) => (e.roles[role] ? e.roles[role].gap / e.roles[role].n : null);
  if (args.json) {
    print(JSON.stringify(Object.fromEntries([...tiers].map(([t, m]) => [t, [...m.values()].map((e) => ({ name: e.name,
      roles: Object.fromEntries(roles.map((role) => [role, e.roles[role] ? { avgGap: avg(e, role), bestFor: e.roles[role].best, units: e.roles[role].n } : null])) }))])), null, 1));
    return;
  }
  print(`Class value across ${rows.length} units  |  ${scopeLine(ctx, opts)}\n`);
  const ordered = [...tiers].sort((a, b) => TIERS.indexOf(a[0]) - TIERS.indexOf(b[0]));
  for (const [tier, map] of ordered) {
    const list = [...map.values()].sort((a, b) => Math.max(...roles.map((r) => avg(b, r) ?? -99)) - Math.max(...roles.map((r) => avg(a, r) ?? -99)));
    print(`${tier.toUpperCase()}`);
    print(table(list, [
      { h: 'Class', v: (e) => e.name },
      { h: 'Type', v: (e) => data.classes.get(e.name).types.join('/') },
      { h: 'Mov', v: (e) => data.classes.get(e.name).mov, right: true },
      ...roles.flatMap((role) => [
        { h: roleLabel(data, role), v: (e) => (e.roles[role] ? f1(avg(e, role)) : '-'), right: true },
        { h: 'best for', v: (e) => (e.roles[role] ? `${e.roles[role].best}/${e.roles[role].n}` : '-'), right: true },
      ]),
    ]));
    print('');
  }
  print('Per role: points lost, on average, by routing a unit through this class instead of its best option for that role (0 = always best), and for how many units it is the best option.');
}

/** How many rules in mechanics.json carry each `basis` tag. */
function basisCounts(node, out = {}) {
  if (Array.isArray(node)) node.forEach((v) => basisCounts(v, out));
  else if (node && typeof node === 'object') {
    if (typeof node.basis === 'string') out[node.basis] = (out[node.basis] || 0) + 1;
    Object.values(node).forEach((v) => basisCounts(v, out));
  }
  return out;
}

/**
 * The paths of one unit that could win under some weighting of the axes: the best
 * path for each of a few thousand weightings (single axes, pairs, random mixes).
 * The visuals page re-scores these when a role's weights are changed in the browser.
 */
function weightCandidates(paths, axes, keep) {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = axes.length, trials = [];
  for (let i = 0; i < n; i++) {
    trials.push(axes.map((_, k) => (k === i ? 1 : 0)));
    for (let j = i + 1; j < n; j++) for (const t of [0.25, 0.5, 0.75]) trials.push(axes.map((_, k) => (k === i ? t : k === j ? 1 - t : 0)));
  }
  for (let t = 0; t < 2500; t++) {
    const w = new Array(n).fill(0);
    for (let k = 1 + Math.floor(rand() * 4); k > 0; k--) w[Math.floor(rand() * n)] = rand();
    trials.push(w);
  }
  const picked = new Set(keep);
  for (const w of trials) {
    let best = -1, bestScore = -Infinity;
    paths.forEach((p, pi) => {
      let score = 0;
      for (let k = 0; k < n; k++) score += w[k] * p.axes[axes[k].i];
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && p.train < paths[best].train)) { best = pi; bestScore = score; }
    });
    picked.add(best);
  }
  return [...picked];
}

/** Everything the visuals page shows, as plain JSON. */
async function visualsPayload(data, args) {
  const t0 = Date.now();
  const { ctx, opts, rows, roles, castAvg } = await rankCast(data, { ...args, role: undefined });
  const mech = data.mechanics;
  const axes = shownAxes(ctx);
  const cpIndex = new Map(data.checkpoints.map((cp, i) => [cp.id, i]));
  const round = (x) => Math.round(x * 100) / 100;
  return {
    generated: new Date().toISOString(),
    seconds: 0,
    scope: scopeLine(ctx, opts),
    counts: castCounts(data, rows, opts.arts),
    roles: roles.map((id) => ({ id, label: roleLabel(data, id), weights: mech.roles.list[id].weights })),
    axes: axes.map((a) => ({ id: a.name, label: AXIS_LABEL[a.name] })),
    tolerance: mech.roles.tolerance.value,
    tiers: [...mech.progression.tiers, ...(opts.divine ? [{ tier: 'divine', level: mech.progression.divineLevel }] : [])],
    maxExamGap: opts.freeReclass ? null : opts.maxGap ?? mech.skills.maxExamGap.value,
    formulas: data.formulas,
    profile: profileConstants(mech),
    checkpoints: data.checkpoints.map((cp, i) => ({
      ...cp, castAvg: Object.fromEntries(roles.map((role) => [role, castAvg[role].has(cp.id) ? round(castAvg[role].get(cp.id)) : null])),
      refs: ctx.refs[i].map((e) => ({ archetype: e.archetype, class: e.cls.name, magic: !!e.magic })),
    })),
    classGrowths: Object.fromEntries([...data.classes.values()].map((c) => [c.name, c.growths])),
    units: rows.map((r) => ({
      cps: r.roles[roles[0]].chapters.map((c) => cpIndex.get(c.id)),
      // Each candidate carries its axes at every chapter the unit is present for, flattened (chapter * axes + axis), in tenths.
      cands: weightCandidates(r.result.paths, axes, roles.map((role) => r.result.paths.indexOf(r.roles[role].rec.path))).map((pi) => {
        const p = r.result.paths[pi];
        const first = data.classes.get(p.classes[0]) || data.classes.get(r.char.base.class);
        return {
          path: pathLabel(data, r.char, p.steps), flags: flagsFor(data, r.char, p.classes), train: p.train, first: first.name,
          ch: evaluatePath(ctx, r.char, p.steps, opts).rows.flatMap((row) => axes.map((a) => Math.round(row.axes[a.i] * 10))),
        };
      }),
      name: r.char.name, join: joinLabel(r.char), estimated: r.char.base.source === 'estimated', growths: r.char.growths,
      bestRole: r.role, chapters: r.result.checkpoints.length, paths: r.result.paths.length,
      roles: Object.fromEntries(roles.map((role) => {
        const e = r.roles[role];
        const first = data.classes.get(e.rec.classes[0]) || data.classes.get(r.char.base.class);
        return [role, {
          rank: e.rank, vsCast: round(e.vsCast), score: round(e.rec.score), endgame: e.rec.final == null ? null : round(e.rec.final), train: e.rec.train,
          path: pathLabel(data, r.char, e.rec.steps), flags: flagsFor(data, r.char, e.rec.classes),
          firstClass: { name: first.name, growths: first.growths },
          axes: axes.map((a) => round(e.rec.path.axes[a.i])),
          chapters: e.chapters.map((c) => [cpIndex.get(c.id), round(c.score)]),
        }];
      })),
    })),
    classTiers: classTierList(data, ctx, rows, roles, round),
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

async function cmdVisuals(data, args) {
  const out = args.out || io.visualsOut || 'visuals.html';
  const payload = await visualsPayload(data, args);
  // "<" is escaped so no data value can close the script tag.
  file(out, io.template().replace('"__DATA__"', () => JSON.stringify(payload).replace(/</g, '\\u003c')));
  print(`Wrote ${out}  (${payload.counts.units} units, ${payload.counts.paths} paths, ${payload.seconds}s)`);
}

function cmdRefs(data, args) {
  const opts = searchOptions(data, args);
  const ctx = createContext(data, opts);
  const pick = args.at ? data.checkpoints.findIndex((cp) => cp.id.toLowerCase() === String(args.at).toLowerCase()) : -1;
  if (args.at && pick < 0) fail(`Unknown checkpoint "${args.at}". Options: ${data.checkpoints.map((c) => c.id).join(' ')}`);
  const list = data.checkpoints.map((cp, i) => ({ cp, refs: ctx.refs[i] })).filter((_, i) => pick < 0 || i === pick);
  if (args.json) {
    print(JSON.stringify(list.map(({ cp, refs }) => ({ checkpoint: cp, references: refs.map((e) => ({ archetype: e.archetype, class: e.cls.name,
      level: e.level, weapon: e.weapon.name, magic: e.magic, stats: Object.fromEntries(STATS.map((s, k) => [s, e.stats[k]])) })) })), null, 1));
    return;
  }
  print(`Reference enemies: made-up generic enemies around each checkpoint's enemy level, varied by class, weapon and level, with stats from the enemy model (${opts.hard ? 'hard' : 'normal'}).`);
  print('Every profile axis is measured against these, each counting equally; edit "profile.references" in src/sim/data/mechanics.json to change the mix.\n');
  print(table(list.flatMap(({ cp, refs }) => refs.map((e, k) => ({ cp, e, first: k === 0 }))), [
    { h: 'Id', v: (r) => (r.first ? r.cp.id : '') },
    { h: 'Checkpoint', v: (r) => (r.first ? r.cp.label : '') },
    { h: 'Archetype', v: (r) => r.e.archetype },
    { h: 'Class', v: (r) => r.e.cls.name },
    { h: 'Lv', v: (r) => r.e.level, right: true },
    ...STATS.slice(0, 8).map((s, k) => ({ h: s[0].toUpperCase() + s.slice(1), v: (r) => r.e.stats[k], right: true })),
    { h: 'Weapon', v: (r) => r.e.weapon.name },
    { h: 'AS', v: (r) => r.e.loadout.as, right: true },
    { h: 'Used for', v: (r) => (r.e.magic ? 'damage, avoid, magic bulk' : 'damage, avoid, physical bulk') },
  ]));
}

function cmdEnemies(data, args) {
  const opts = searchOptions(data, args);
  const ctx = createContext(data, opts);
  const { model } = ctx;
  if (args.json) {
    print(JSON.stringify({ model, rosters: data.checkpoints.map((cp, i) => ({ checkpoint: cp, enemies: ctx.rosters[i].map((e) => ({
      name: e.name, class: e.cls.name, level: e.level, boss: e.boss, source: e.source, share: e.share, weapon: e.weapon.name,
      stats: Object.fromEntries(STATS.map((s, k) => [s, e.stats[k]])) })) })) }, null, 1));
    return;
  }
  if (args.at) {
    const i = data.checkpoints.findIndex((cp) => cp.id.toLowerCase() === String(args.at).toLowerCase());
    if (i < 0) fail(`Unknown checkpoint "${args.at}". Options: ${data.checkpoints.map((c) => c.id).join(' ')}`);
    const cp = data.checkpoints[i];
    print(`${cp.label} (${cp.id}): expected unit Lv${cp.playerLevel}, enemies Lv${cp.enemyLevel}, bosses Lv${cp.bossLevel}  |  ${opts.hard ? 'hard' : 'normal'}\n`);
    print(table(ctx.rosters[i], [
      { h: 'Enemy', v: (e) => e.name },
      { h: 'Class', v: (e) => e.cls.name },
      { h: 'Lv', v: (e) => e.level, right: true },
      { h: 'Src', v: (e) => ({ model: 'model', observed: 'real', 'observed+model': 'real*' })[e.source] },
      ...STATS.slice(0, 8).map((s, k) => ({ h: s[0].toUpperCase() + s.slice(1), v: (e) => e.stats[k], right: true })),
      { h: 'Bld', v: (e) => e.bld, right: true },
      { h: 'Weapon', v: (e) => e.weapon.name },
      { h: 'AS', v: (e) => e.loadout.as, right: true },
      { h: 'Wt', v: (e) => pct(e.share), right: true },
    ]));
    return;
  }
  print(`Enemy model fitted to ${model.units} published enemy stat lines (${model.points} stat values); class-growth factor kappa = ${model.kappa}`);
  print('stat = base + (level-1)*(growth + kappa*classGrowth)/100 + classBonus   [bosses: + bossBase + (level-1)*bossGrowth/100]\n');
  print(table(model.params, [
    { h: 'Stat', v: (p) => p.stat },
    { h: 'Base', v: (p) => f1(p.base), right: true },
    { h: 'Growth %', v: (p) => f1(p.growth), right: true },
    { h: 'Boss base', v: (p) => f1(p.bossBase), right: true },
    { h: 'Boss growth %', v: (p) => f1(p.bossGrowth), right: true },
    { h: 'Fit error (rmse)', v: (p) => f1(p.rmse), right: true },
    { h: 'Values', v: (p) => p.n, right: true },
  ]));
  print('\nRoster per checkpoint (add --at <Id> for the full list):\n');
  print(table(data.checkpoints.map((cp, i) => ({ cp, roster: ctx.rosters[i] })), [
    { h: 'Id', v: (r) => r.cp.id },
    { h: 'Checkpoint', v: (r) => r.cp.label },
    { h: 'Unit Lv', v: (r) => r.cp.playerLevel, right: true },
    { h: 'Enemy Lv', v: (r) => r.cp.enemyLevel, right: true },
    { h: 'Boss Lv', v: (r) => r.cp.bossLevel, right: true },
    { h: 'Enemies', v: (r) => r.roster.length, right: true },
    { h: 'Real', v: (r) => r.roster.filter((e) => e.source !== 'model').length, right: true },
    { h: 'Real share of score', v: (r) => pct(r.roster.filter((e) => e.source !== 'model').reduce((s, e) => s + e.share, 0)), right: true },
    { h: 'Real enemies', v: (r) => r.roster.filter((e) => e.source !== 'model').map((e) => e.name).join(', ') },
  ]));
}

function cmdList(data, args) {
  if (args.json) {
    print(JSON.stringify({ units: [...data.characters.keys()], classes: [...data.classes.values()].map((c) => ({ name: c.name, tier: c.tier })) }, null, 1));
    return;
  }
  print('UNITS');
  print(table([...data.characters.values()], [
    { h: 'Unit', v: (c) => c.name },
    { h: 'Joins', v: (c) => `Lv${c.base.level} ${c.base.class}${c.base.joinsAt ? ` (${c.base.joinsAt})` : ''}` },
    { h: 'Bases', v: (c) => c.base.source },
    ...STATS.map((s) => ({ h: s, v: (c) => c.growths[s], right: true })),
    { h: 'Good at', v: (c) => c.preferred.join(', ') },
    { h: 'Bad at', v: (c) => c.nonIdeal.join(', ') },
  ]));
  print('\nCLASSES');
  print(table([...data.classes.values()], [
    { h: 'Class', v: (c) => c.name },
    { h: 'Tier', v: (c) => c.tier },
    { h: 'Type', v: (c) => c.types.join('/') },
    { h: 'Mov', v: (c) => c.mov, right: true },
    { h: 'Weapons', v: (c) => c.weapons.join(',') || '-' },
    ...STATS.map((s) => ({ h: s, v: (c) => c.growths[s], right: true })),
    { h: 'Notes', v: (c) => [c.gender && `${c.gender} only`, c.routes && `routes: ${c.routes.join('/')}`, c.unsupported && 'not simulated', c.growthsGame8 && 'growths differ on Game8'].filter(Boolean).join('; ') },
  ]));
}

// --------------------------------------------------------------------- main

const COMMANDS = { char: cmdChar, path: cmdPath, all: cmdAll, export: cmdExport, classes: cmdClasses, refs: cmdRefs, visuals: cmdVisuals, enemies: cmdEnemies, list: cmdList };

let queue = Promise.resolve();

/**
 * Run one command line (argv without the program name) and return its document:
 * [{ t: 'text', text, cli? } | { t: 'table', cols, rows } | { t: 'file', name, text }].
 * `env` is the front end:
 *   data        the loaded data (buildData)
 *   runCast     (data, opts, roles, progress) => rows, may be async: searches every unit
 *   progress    (done, total), optional: called as a whole-cast run advances
 *   template    () => the visuals page template, for `visuals`
 *   visualsOut  where `visuals` writes when no --out is given, optional
 * A CommandError is thrown for a mistake in the command line. Commands run one at a time.
 */
export function runCommand(argv, env) {
  const run = queue.then(async () => {
    doc = []; io = env;
    const args = parseArgs(argv);
    const command = args._[0];
    if (!command || command === 'help' || args.help) { print(HELP); return doc; }
    if (!COMMANDS[command]) fail(`Unknown command "${command}". Run \`node scripts/sim/cli.js help\`.`);
    await COMMANDS[command](env.data, args);
    return doc;
  });
  queue = run.catch(() => {});
  return run;
}

/** What a form needs to offer every option: units, classes, roles, checkpoints and defaults. */
export function describe(data) {
  const mech = data.mechanics;
  return {
    units: [...data.characters.values()].map((c) => ({ name: c.name, level: c.base.level, class: c.base.class, joinsAt: c.base.joinsAt || null })),
    classes: [...data.classes.values()].map((c) => ({ name: c.name, tier: c.tier })),
    roles: roleNames(data, { duel: true }).map((id) => ({ id, label: mech.roles.list[id].label || id })),
    routes: ROUTES,
    checkpoints: data.checkpoints.map((cp) => ({ id: cp.id, label: cp.label })),
    defaults: { runs: mech.roles.rolled.runs, maxGap: mech.skills.maxExamGap.value, detours: mech.search.detours.value, top: 10 },
  };
}
