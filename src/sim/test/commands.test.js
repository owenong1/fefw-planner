import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadData } from '../../../scripts/sim/load.js';
import { runCommand, tableText, describe, CommandError } from '../engine/commands.js';

const data = loadData();
const env = { data, runCast: () => { throw new Error('not a whole-cast test'); }, template: () => '' };

test('a command returns a document of text and table blocks', async () => {
  const doc = await runCommand(['path', 'Cai', 'Gladiator>Brigand>Warrior>Battlemaster'], env);
  assert.ok(doc.every((b) => ['text', 'table', 'file'].includes(b.t)));
  const table = doc.find((b) => b.t === 'table');
  assert.ok(table.cols.some((c) => c.h === 'Checkpoint'));
  assert.ok(table.rows.every((r) => r.length === table.cols.length && r.every((v) => typeof v === 'string')));
  // The terminal form: a header, a rule and one line per row, columns lined up.
  const lines = tableText(table).split('\n');
  assert.equal(lines.length, table.rows.length + 2);
  assert.match(lines[1], /^-+( +-+)*$/);
});

test('a file a command writes is a block, not a write to disk', async () => {
  const doc = await runCommand(['char', 'Sofia', '--role', 'healer', '--runs', '0', '--csv', 'sofia.csv'], env);
  const file = doc.find((b) => b.t === 'file');
  assert.equal(file.name, 'sofia.csv');
  assert.match(file.text, /^path,score,endgame,train,/);
});

test('a mistake in the command line is a CommandError', async () => {
  await assert.rejects(runCommand(['char', 'Nobody'], env), CommandError);
  await assert.rejects(runCommand(['bogus'], env), CommandError);
  await assert.rejects(runCommand(['char', 'Sofia', '--top'], env), CommandError);
  // and the next command still runs
  assert.equal((await runCommand(['help'], env)).length, 1);
});

test('describe lists what a form needs to offer every option', () => {
  const meta = describe(data);
  assert.equal(meta.units.length, data.characters.size);
  assert.ok(meta.roles.some((r) => r.id === 'duel'));
  assert.equal(meta.checkpoints.length, data.checkpoints.length);
  assert.equal(meta.defaults.runs, data.mechanics.roles.rolled.runs);
});

test('the engine imports no Node modules', () => {
  // The site runs everything in engine/ in a web worker; cli.js, load.js and cast.js live in scripts/sim/.
  for (const name of readdirSync(new URL('../engine/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(readFileSync(new URL(`../engine/${name}`, import.meta.url), 'utf8'), /from 'node:/, name);
  }
});
