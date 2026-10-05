# Growth simulator

The simulator behind the Class Paths and Simulator pages. It began as a separate project (fefw-growth-sim) and now lives here.

Finds class paths for each unit. A unit's growth rates are its own plus its
current class's, so the classes it passes through decide the stats it ends up
with. This tool searches the class paths a unit could plausibly certify for
(which classes, in what order, and at what level each change is made) and at
each story chapter measures what the unit can do: how fast it kills with
weapons and with magic, how safely it attacks, physical and magic bulk, avoid,
what it has left after being attacked by one or two enemies, healing and reach. Paths are then
ranked **per role** (striker, mage, physical tank, magic tank, mixed tank,
healer), never as one overall score, and each role's leading paths are
replayed with level-ups actually rolled to decide between them.

Needs Node 18+. From the repository root:

```
npm run sim -- char Sofia                 # recommended path for each role, with the profile behind it
npm run sim -- char Sofia --role healer   # ranked paths for one role, chapter by chapter
npm run sim -- all                        # every unit: score and rank in each role, and its best-fit path (about four minutes on 8 cores)
npm run sim -- all --role tank            # one role's leaderboard
npm run sim -- classes                    # which classes suit which role
npm run sim -- export paths.json          # the `all` results and candidate paths as JSON (about 5 MB; the planner site reads this)
npm run sim -- path Cai "Ornius Rider>Light Cavalry>Bardinger>Orichaldia"             # one path, chapter by chapter
npm run sim -- path Cai "Ornius Rider>Light Cavalry>Bardinger>Orichaldia" --at P2-04  # the numbers behind one chapter
npm run sim -- path Cai "Gladiator@5>Brigand@20>Warrior@38>Battlemaster@45"           # a path with its own change levels
npm run sim -- refs                       # the reference enemies everything is measured against
npm run sim -- visuals                    # out/visuals.html: how the numbers are made and the results, colour-coded
npm run sim -- list                       # units and classes
npm run sim -- help                       # all options
npx vitest run src/sim
```

Useful options: `--role <name>`, `--route cai|dietrich|theodora|leda|any` (adds
route-exclusive classes), `--hard`, `--divine`, `--max-gap 2` or
`--free-reclass` (loosen the exam check), `--detours 0` (no sideways class
changes), `--from P2-01 --to P3-06` (only part of the game), `--runs 300`
(more rolled playthroughs; `--runs 0` skips them), `--csv file`, `--json`.

## Reading the output

**Profile.** Axes from 0 to 100, measured at every chapter against that
chapter's reference enemies and averaged over the chapters the unit is present
for. Each chapter is measured at four whole-number stat lines, spread from an
unlucky to a lucky playthrough, so a kill that only a lucky unit gets counts
for the share of playthroughs that get it:

| Axis | What it is |
|---|---|
| Phys dmg | With its best physical weapon, half the chance to kill an enemy in one attack and half kill speed: 100 / the attacks it expects to need (100 = always kills in one attack; a sure two-attack kill is 25). Removing 95% of an enemy's HP is still two attacks |
| Mag dmg | The same with magic, averaged over a map's worth of attacks because spells run out |
| Best dmg | The larger of the two |
| Safe atk | Share of its own HP the unit keeps during that attack (100 = the enemy cannot answer) |
| Phys bulk | Share of its HP left after a physical enemy attacks it, if every strike lands. This, avoid and survival are measured holding the weapons the unit attacks with |
| Mag bulk | The same against a magic enemy |
| Avoid | Chance an enemy's strike misses |
| Phys surv / Mag surv | Attacked by one physical (or magical) enemy, then by two, then by three, with hit and crit chances played out: the share of its HP it has left on average after each. Bulk and avoid combined, and dying counts as nothing left |
| Support | HP it can heal per map (12 ally HP bars = 100); being able to Dance counts 60 |
| Reach | Movement, from Mov 4 (0) to Mov 9 (100); fliers count one extra |

**Role.** A role is a weighting of those axes (`roles` in
`src/sim/data/mechanics.json`; edit the weights or add your own). Scores compare paths
and units *within* a role. A unit's scores in different roles are not
comparable with each other; `all` shows every unit's score and place in the
cast for each role. No role weights reach: as a flat bonus it outweighed the
small combat differences between classes and put nearly every unit on a mount.
Roles are judged on combat alone, with reach shown beside them.

**Path.** Class changes in order. A level in brackets, as in `Warrior (Lv38)`,
marks a change not made at the tier's usual level (5 / 20 / 35 / 45).

**Recommended path.** Level-up luck alone moves a path's score by several
points, but it moves similar paths together. So each role's top six paths are
replayed 100 times with level-ups actually rolled, every path with the same
dice, and compared playthrough by playthrough. The leader is the path with the
best rolled average; another path is as good (`=` in the list) when the leader
beats it in fewer than 75% of playthroughs, or by less than 0.25 points. Of
those, the one whose exams need the least extra training is recommended (`>`),
then the one with the fewest class changes. `Rolled` is the rolled average,
`Unlucky 10%` the score nine playthroughs in ten beat, and `Leader wins` how
often and by how much the leader beats that path.

**Train.** The number of skill ranks a path's exams ask for beyond what the
unit would have from its classes alone, to be made up at the Arena or with
manuals. `-` means the path's own classes cover every exam.

## What decides which paths are offered

- **Class changes.** A unit may change class between any two chapters: up to a
  class of a higher tier once it has the tier's level, or sideways to another
  class of its own tier, once along a path (`--detours`). A class is held for at
  least 5 levels. So a promotion can be taken late, when its exam is not yet
  within reach at the tier's level, and a path can pass through two classes of
  one tier.
- **Exams.** Each class change must pass the new class's exam requirements.
  Skill ranks are estimated from the levels spent in classes that train each
  skill, faster for skills the unit is good at and slower for ones it is bad
  at. A class is offered only if every requirement is within one rank of the
  estimate (`--max-gap` changes that, `--free-reclass` removes the check).
- **Class locks.** Personal abilities that forbid classes are enforced (Goliath
  and Orchel cannot become cavalry or fliers), as are gender- and route-locked
  classes.
- **Join state.** Ten units join late, already promoted (Creek, Nathan,
  Bertrand, Talimun, Anatolia, Orchel, Centurio, Aswan, Tahonia, Gaitz). They
  enter at their real chapter and class and only face the decisions they still
  have.

## What feeds the numbers

**Growth.** On each level-up every stat rises by 1 with probability
(character growth + class growth)%. A class also gives a flat stat bonus while
the unit is in it. License tiers open at the recommended levels:

| Tier | Level | Options |
|---|---|---|
| Beginner | 5 | 5 classes |
| Specialty | 20 | 12 classes |
| Advanced | 35 | 8 classes, plus 8 route exclusives |
| Master | 45 | 16 classes |
| Divine (`--divine`) | 55 | 8 classes |

Staying in the current class is always an option, and so is taking a tier
late.

**Abilities.** Each unit's personal ability and the abilities it learns by
level (Lv20 and Lv35 for most) are read from their in-game text. Plain combat,
stat and healing modifiers are applied: for example Ursula's *Seize the Chance*
(Lck/2 % chance to multiply damage by 1.3, then 1.5), Aswan's bow Hit+20,
Theodora's 30% chance to halve damage, Sofia's +10 HP per heal. A "Trigger %"
effect is applied at its average value. 86 of 170 abilities are scored this
way; the rest depend on allies, positioning, Blaze arts or earlier fights in
the map, and `char` lists them per unit as not scored.

A bonus for attacking with a combat art (Inyoni's *Pierce*, Tobias's *Power
Arts* and *All-Out Attack*) is counted in every fight the unit starts with a
fitting weapon, as if it always attacked with an art. The art itself is not
modelled, so the unit only earns that score if it does use its arts: `char` and
`all` print the caveat, and the site shows it on the unit.

**Spells.** A unit casts only the spells on its own spell list, at the skill
rank the list gives, with the published number of uses per map (doubled or
tripled by Seeker and Zenith class abilities). Eleven units have no published
list yet and fall back to the standard spell lines.

**Combat.** Each exchange is resolved exactly (the full hit / crit / miss tree,
no dice). Rules used: Atk = Str or Mag + Might, tripled or doubled Might for
effective weapons; Attack Speed = Spd − max(0, Weight − Build); a follow-up at
+4 Attack Speed; crits deal triple; swords deal 1.2x on the follow-up; axes
deal at least 5; bows only reach range 2; magic hits Res.

**Reference enemies.** Thirty-odd generic enemies per chapter (31 to 35), made
up but plausible, because too few real ones are published to fill a chapter.
There is one list per enemy tier in `src/sim/data/mechanics.json`
(`profile.references`), and a chapter uses the list for its enemy level. Each
enemy is a class, a weapon and a level: every class of the tier that fights
appears, the common ones with each weapon type they wield (an axe hits harder
and slower than a sword, a bow cannot answer at range 1, a thrown axe answers
at both), and levels run from two below the chapter's enemy level to two above
(upwards only before Lv20, because Lv1 is the floor). Their stats come from the
enemy model. Every enemy counts equally, so the mix is the weighting: about a
sixth each of armour, fighters, riders and magic, an eighth each of swordsmen,
archers and fliers (no flier before enemies reach Specialty classes). `refs`
lists them.

**Search.** With changes allowed between any two chapters there are far too
many paths to list, so the search walks the story chapter by chapter and keeps,
for every class the unit could hold at that chapter, the two best histories per
role (score so far, plus the current chapter's score for each chapter left),
and for every class the best path that passed through it. Each role's best
three paths are then retried with every class change dropped and with every
change taken as early as allowed, which removes sidesteps and delays that do
not pay. This is a heuristic: checked against every one-class-per-tier path for
twelve units, it found a better path in 19 of the 72 unit-role pairs and fell
short in 3, by at most 0.3 points. `src/sim/data/mechanics.json` (`search`)
holds the widths.

## Read this before trusting a number

- **Enemy stats are mostly modeled.** Only 29 enemy stat lines have been
  published (Fire Emblem Wiki), none above Lv45. The reference enemies come
  from a stat model fitted to those lines; out of sample it is off by 3 to 7
  points per stat. Everything in Part III is extrapolation.
- **The reference enemies are invented.** Which classes, weapons and levels a
  chapter's enemies have is a guess at a typical army, not a record of any
  map. No walkthrough or database publishes enemy stats yet beyond the wiki's
  29 lines.
- **40 of 63 units have estimated base stats** (marked `*`), from a regression
  on their growth rates. Late joiners' join-time stats are estimates too.
- **Skill ranks are estimated, not simulated.** The Arena, manuals and exam
  pass rates are not modeled; "Train" is a guide to how much of that a path
  needs, not a guarantee. A unit is assumed to keep every weapon type its class
  wields in practice.
- **Within a role, one or two classes often lead for most of the cast**
  (Swordmaster or Battlemaster for strikers, Castle Knight for tanks, Druid for mages). The tool is better at telling you which
  role a unit suits and which of its paths are as good as each other than at
  separating near-identical paths.
- **Role weights, the dance value, the reference-enemy mix and the length of an
  enemy phase are judgment calls.** They are all in `src/sim/data/mechanics.json`.
- **Class changes are assumed free.** Nothing is charged for a change beyond
  its exam, and sidesteps are capped at one per path instead. Without mastery
  abilities a sidestep only buys growth rates and exam ranks, so it rarely
  changes a path's score by more than a few tenths.

`src/sim/data/mechanics.json` holds every rule and schedule, each tagged `documented`,
`observed` or `assumed`. The assumptions that matter most:

- **Hit = weapon Hit + Dex, Crit = weapon Crit + Dex/2, Dodge = Lck.** The game
  only says which stat each depends on.
- **Heal = spell power + Mag/3.** The game only says healing scales with Mag.
- **Expected levels per chapter** are interpolated between a handful of known
  join levels and boss levels.
- **Gauntlets give +10 Avoid** (the game says "high Avoid", no number).
- **Combat-art abilities are all or nothing.** An ability that needs a combat
  art (Tobias's Power Arts, Inyoni's Pierce) counts on every attack the unit
  starts, at no cost; `--no-arts` leaves those abilities out instead. The arts
  themselves are not modelled, so a real unit sits between the two runs.
- **A unit defends with the weapon it attacked with.** It cannot swap between
  its attack and the enemy phase, so each weapon is held for the share of the
  reference enemies it is the unit's best attack against, and bulk, avoid and
  survival average over those. A unit that ends its turn without attacking
  could hold anything; that is not modelled. The legacy `duel` role still
  picks its enemy-phase weapon freely.
- **Standard gear only**: wooden to silver weapons plus the thrown spears and
  axes (Javelin to Pilum, Hand Axe to Sagaris), unlocked by level and skill
  rank. No relics, special shop weapons, forging or combat arts.
- **All learned abilities are active at once.** The game may limit how many can
  be equipped.

## What is not modeled

Combat arts themselves (their might, hit and cost; only an ability's bonus for
using one is counted), Blaze arts, gambits, bloodmarks, mastery abilities, abilities
learned by skill rank, mounts (their growth bonuses and abilities such as
Canto), shields, terrain, supports, stat caps, merging a unit's stats between
routes, and Elephant Rider (its attack has no published stats). Ally buffs and
enemy debuffs from abilities are not scored.

## The old duel score

`--role duel` ranks paths by the previous single score: one-on-one duels
against every enemy in the chapter's full roster (published enemies plus one
modeled enemy per class), 60% offense and 40% bulk (`--offense` changes the
split). It is kept for comparison. It is slower, favours armored infantry, and
ignores healing and movement.

## In the browser

The site's Simulator page (`/sim`) runs these same commands in a web worker and
renders the same output, so everything above works there too, with a form in
place of the command line. Only the terminal front end in `scripts/sim/` needs
Node; keep Node imports out of `engine/` (a test checks).

## Data and sources

| Data | Source | State |
|---|---|---|
| Character growths | Serenes Forest, cross-checked with Game8 | 63 units |
| Skill preferences, abilities, spell lists | Game8 character pages | 63 units; 52 spell lists |
| Class growths, bonuses, type, weapons, exams | Serenes Forest and Game8 class pages | 59 classes; 13 have growths the two sites disagree on (flag `~`, Serenes Forest used) |
| Weapons, magic and heals | Serenes Forest, Game8 | 122 weapons and spells, 5 heals |
| Character base stats | Fire Emblem Wiki | 23 units; the other 40 are **estimated** from their growth rates (marked `*`) |
| Join chapter and class of late joiners | Game8 recruit pages and class guide | 10 units, in `src/sim/data/mechanics.json` |
| Enemy stats | Fire Emblem Wiki | 29 lines |

## Improving the data

- **Add real enemies** to `src/sim/data/enemies_observed.json` (name, class, level,
  stats, `boss`, `difficulty`, optional `inventory`). The enemy model refits
  itself on the next run, which sharpens the reference enemies. Partial stat
  lines are fine. `npm run import:sim-data` picks up every wiki page that
  carries a boss or chapter stat table, so re-run it as the wiki fills in.
- **Change the reference enemies** in `profile.references` of
  `src/sim/data/mechanics.json`: add, drop or re-weight (by repeating at
  another level) rows of class, weapon and level. Cost grows with the number
  of rows: every candidate path fights every one of them.
- **Add a unit's real base stats** by editing its `base` block in
  `src/sim/data/characters.json` and setting `"source": "wiki"`.
- **Score an ability the parser skips** by giving it an `effects` list in
  `src/sim/data/characters.json` (see `engine/abilities.js` for the fields).
- **Correct a rule, a role, a late joiner or the level schedule** in
  `src/sim/data/mechanics.json`.
- **Refresh from the sites**: `npm run import:sim-data -- --refresh`
  re-downloads everything and regenerates the four generated JSON files
  (it never touches `mechanics.json`, but it does overwrite hand edits to the
  others).

## Layout

```
src/sim/data/        characters, classes, weapons, observed enemies, mechanics (rules)
src/sim/engine/      the simulator, free of Node:
  data.js            normalise the JSON
  growth.js          level-up maths, expected stats, luck lines, rolled playthroughs
  abilities.js       ability text -> effects
  combat.js          one round of combat, resolved exactly, abilities applied
  gear.js            skill ranks, exams, usable weapons and spells
  enemies.js         enemy stat model and per-chapter rosters
  profile.js         reference enemies and the profile axes (kill speed, phase survival)
  score.js           the legacy duel score
  search.js          path search, roles, rolled comparison, recommendations
  castjob.js         one unit's share of a whole-cast run (all, classes, visuals)
  commands.js        every command: arguments in, a document of text, tables and files out
  visuals.template.html   the page `visuals` fills with data
src/sim/test/        the engine's tests (vitest)
src/sim/*.ts         the site's front end: web workers, and the client the Simulator page calls
scripts/sim/         the terminal front end (Node): cli.js, load.js (reads the data), cast.js (worker threads)
scripts/import/build_sim_data.py   scraper that rebuilds src/sim/data/ (Python 3, standard library)
out/                 reports the CLI writes (ignored by git)
```
