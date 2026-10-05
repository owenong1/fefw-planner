// Reads src/sim/data/*.json from disk (Node only). The site imports the same
// files as modules and calls buildData() itself (src/sim/rawData.ts).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildData } from '../../src/sim/engine/data.js';

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'sim', 'data');

export function loadData(dir = DEFAULT_DIR) {
  const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  return buildData({
    mechanics: read('mechanics.json'), weapons: read('weapons.json'), classes: read('classes.json'),
    characters: read('characters.json'), enemies: read('enemies_observed.json'),
  });
}
