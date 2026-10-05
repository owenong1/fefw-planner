import characters from './data/characters.json'
import classes from './data/classes.json'
import enemies from './data/enemies_observed.json'
import mechanics from './data/mechanics.json'
import weapons from './data/weapons.json'
import { buildData } from './engine/data.js'

/** The simulator's own data set, built once per worker (buildData annotates the records in place). */
export function loadSimData() {
  return buildData({ mechanics, weapons, classes, characters, enemies })
}
