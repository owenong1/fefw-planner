#!/usr/bin/env node
// Command-line front end of the growth simulator. Run `npm run sim help` for usage.
// The commands themselves are in src/sim/engine/commands.js, which the site also runs; this file loads the data, runs one, and
// prints the document it returns.

import { writeFileSync, readFileSync, mkdirSync, watch } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './load.js';
import { runCast } from './cast.js';
import { runCommand, tableText, CommandError } from '../../src/sim/engine/commands.js';

const TEMPLATE = fileURLToPath(new URL('../../src/sim/engine/visuals.template.html', import.meta.url));

function environment(data) {
  return {
    data, runCast,
    progress: (done, total) => { process.stderr.write(done < total ? `\r  searched ${done}/${total} units` : '\r' + ' '.repeat(40) + '\r'); },
    template: () => readFileSync(TEMPLATE, 'utf8'),
    visualsOut: fileURLToPath(new URL('../../out/visuals.html', import.meta.url)),
  };
}

async function run(argv) {
  const doc = await runCommand(argv, environment(loadData()));
  for (const block of doc) {
    if (block.t === 'file') { mkdirSync(dirname(block.name), { recursive: true }); writeFileSync(block.name, block.text); }
    else console.log(block.t === 'table' ? tableText(block) : block.text);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  try {
    await run(argv);
  } catch (err) {
    if (!(err instanceof CommandError)) throw err;
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (argv[0] !== 'visuals' || !argv.includes('--watch')) return;
  const dir = fileURLToPath(new URL('../../src/sim/data/', import.meta.url));
  console.log(`Watching ${dir} and the template; the page is rebuilt when a file changes. Ctrl+C to stop.`);
  let timer = null;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(argv).catch((err) => console.error(`Not rebuilt: ${err.message}`)), 300);
  };
  watch(dir, rebuild);
  watch(TEMPLATE, rebuild);
}

main();
