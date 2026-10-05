# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Fan-made unit database, army builder and RNG checker for *Fire Emblem: Fortune's Weave*. A fully static Vite + React 19 + TypeScript + Tailwind v4 SPA with no backend.

## Commands

```sh
npm run dev                        # Vite dev server, http://localhost:5173
npm run build                      # tsc -b && vite build → dist/ (the only type-check; there is no separate typecheck script)
npm run lint                       # oxlint (not ESLint); config in .oxlintrc.json
npm test                           # vitest run
npx vitest run src/engine/growth.test.ts   # one file
npx vitest run -t "mid-rank"       # tests matching a name
npm run import                     # regenerate data/*.json (Python 3, see below)
python3 scripts/import/fetch_portraits.py [--force]   # download unit icons into src/assets/portraits/ and class icons into src/assets/classes/
npm run sim -- char Sofia          # the growth simulator from a terminal (`npm run sim help`; see below)
npx vitest run src/sim             # the simulator's tests only
npm run import:paths               # regenerate data/classPaths.json and data/pathCandidates.json from the simulator (about a minute)
npm run import:sim-data            # rebuild the simulator's own data from its source sites (Python 3; --refresh re-downloads)
```

## Data pipeline

Game data flows one way:

`.cache/sources/*.html` (gitignored, downloaded by hand) → `scripts/import/import_sources.py` → `data/*.json` (committed) → `src/data/index.ts` → pages.

- **Do not hand-edit the generated JSON** (`units`, `classes`, `skills`, `routes`, `paralogues`). A re-import overwrites it. Corrections go in `data/overrides.json`, shaped `{ collection: { id: { field: value } } }`, which the importer applies last.
- The importer writes anything it could not parse, plus disagreements between sources, to `data/import-report.txt`. Read it after every import.
- `src/data/index.ts` imports the JSON and **casts** it to the schema types without parsing. The Zod schemas in `src/data/schema.ts` are only run by `src/data/data.test.ts`, which also checks that every cross-collection id reference resolves. So `npm test` is the data validator: run it after any change to `data/`, the importer, or the schema.
- A schema change has to be made in three places: `schema.ts`, the importer's output, and the regenerated JSON.
- Ids are slugs of the display name (`slug()` in the importer). A route's id is its lord's unit id (`cai`, `dietrich`, `theodora`, `leda`), and that same id keys the `--route-<id>` CSS variables in `src/index.css`.
- `data/SOURCES.md` records where each field comes from. `data/MECHANICS.md` records which game rules are confirmed and which are assumptions; update it when a rule changes, because the engine and UI copy lean on it.

## The growth simulator

`src/sim/` is a class-path simulator: it searches the class paths a unit could take and recommends one per role. It was a separate project (fefw-growth-sim) and now lives here; `src/sim/README.md` explains the method, every command and option, and what not to trust. It powers the Simulator page (`/sim`), the Class Paths page and the paths card on each unit page.

- `src/sim/engine/` is the simulator, plain JavaScript with no Node imports (a test enforces it), because the site runs it in a web worker. tsc reads it through `allowJs` without type-checking it, and oxlint skips it.
- `src/sim/data/` is the simulator's **own** game data and rules, separate from `data/*.json`: it needs weapons, enemy stats, exams and a `mechanics.json` of tagged assumptions that the site's data does not carry. Its numbers are not derived from `data/*.json`; only unit and class names have to match (`src/sim/sim.test.ts` and the paths importer both check). `scripts/import/build_sim_data.py` regenerates all of it except the hand-maintained `mechanics.json`, from pages cached in `.cache/sim/`, and overwrites hand edits to the rest.
- Every command (`char`, `path`, `all`, `classes`, `refs`, `enemies`, `visuals`, `export`, `list`, `help`) is in `engine/commands.js` and returns a document of text, table and file blocks. Two front ends run them: `scripts/sim/cli.js` in a terminal (`npm run sim`), which prints the document, and `src/sim/worker.ts` on the site, whose document `components/SimDoc.tsx` renders. The two give identical output by construction, so add or change a command in `commands.js`, never in a front end. A new option also needs a field on the Simulator page (`Fields`, `USES` and `buildArgv` in `SimPage.tsx`).
- Whole-cast commands search all 63 units, a few seconds each. `scripts/sim/cast.js` shares them over worker threads; `worker.ts` shares them over a pool of `castWorker.ts` web workers and caches finished runs. Both use `engine/castjob.js`.
- Pages may import only `src/sim/client.ts` and `protocol.ts`. Importing anything under `engine/` or `data/` from a page pulls the whole simulator into the main bundle.
- `data/classPaths.json` is the simulator's `export` at default settings, precomputed by `scripts/import/import_class_paths.py` with names rewritten as ids, so the Class Paths page and unit cards are instant and spoiler-aware. Re-run `npm run import:paths` after changing the engine or its data (extra flags pass through: `npm run import:paths -- --hard`).
- The Class Paths page is the native port of the simulator's `visuals` page (`engine/visuals.template.html`): results, the explanation of how a number is made, charts, class value tables and role-weight sliders. Its arithmetic (standings over a chapter range, re-scoring a role with other weights) is `src/data/pathModel.ts`, which mirrors `rankCast` in `commands.js`; its sections are in `src/components/paths/`. The sliders re-score `data/pathCandidates.json` (each unit's candidate paths, about 5 MB, written by the same importer). That file is never imported as a module: the page fetches it by URL (`?url`) the first time a slider moves, and the test reads it as text.
- The Simulator page sits behind a level-1 `SpoilerGate`, because its output is the simulator's own text and names Master classes and late-joining units throughout.
- The engine's tests are in `src/sim/test/` (vitest, with `node:assert`). After a change to `commands.js` or a front end, also check a few commands from the terminal: the output there is what the site shows.

## Architecture

- `src/data/`: the dataset plus every derived lookup and game rule that depends on data (`combinedGrowths`, `canUseClass`, `recruitmentOn`, `skillOwners`, `classSpoiler`, `timingLabel`, `roleAxes`). Put new data-derived helpers here rather than in pages.
- `src/engine/growth.ts`: the RNG checker's maths as pure functions with no React or data imports beyond types. Each stat's total gain is a Poisson-binomial distribution built by convolving one level-up at a time; percentiles are mid-rank; the overall score is the percentile of the summed gain. Rank thresholds live in `RANKS`.
- `src/lib/`: `settings.tsx` (spoiler level context), `army.ts` (builder state hook), `rngInput.ts` (RNG checker state ↔ URL query string), `display.ts` (labels and colour helpers).
- `src/pages/`: one component per route in `src/App.tsx`, all nested under `components/Layout.tsx` (nav, global Fuse.js search, spoiler toggle).
- `src/components/ui.tsx`: shared primitives. `Avatar` resolves portraits through `import.meta.glob` on `src/assets/portraits/<unit id>.{webp,png}`, so a portrait is picked up by filename alone. `ClassIcon` does the same for `src/assets/classes/<class id>.{webp,png}`.

There is no state library. Persistent state is `localStorage` under `fefw:*` keys (`fefw:spoilerLevel`, `fefw:army`, `fefw:finalClasses`), read defensively because stored ids can be stale or storage unavailable. The RNG checker's state lives in the URL instead, so links are shareable and `?u=<unitId>` alone is a valid prefill.

### Game rules the code assumes

- Growths are additive: personal + the modifier of the class held at that level-up. Base classes (Commoner, Noble) add nothing.
- Levels never reset on class change, so a class history is a list of `{ class, fromLevel }` segments.
- Growths above 100% are treated as +1 guaranteed plus a (p − 100)% chance of +2. This is an unconfirmed assumption.
- Stat caps are unpublished and per-class flat stat bonuses aren't imported yet (Game8's per-class pages have them), so the engine models neither. The RNG page shows a "not reliable yet" note until the bonuses are in.
- Classes whose growths scale with level (Charioteer, Elephant Rider) are detected by skill text and flagged as approximate.
- Class restrictions are also derived from personal skill text (`classRestrictions`), not from a data field.
- Recruitment entries use `route: 'all'` for story recruits shared by every route; only Part I (`part === 1`) differs between routes, which is why the builder works from Part I entries only.
- Merge Causality (Part III) keeps each stat's best value across a unit's route copies. The merge planner applies that to growths.

### Spoilers

Every unit has `spoiler` 0–2 (0 = Part I, 1 = joins in Part II/III, 2 = secret character), and Master/Divine classes count as level 1 through `classSpoiler`. Any new list, dropdown or search result must filter on `useSettings().spoilerLevel`. Two conventions to keep:

- Detail pages reachable by direct link wrap their content in `SpoilerGate` instead of returning a 404.
- A recommended class path (`PathSteps` in `components/ClassPath.tsx`) names a class above the spoiler level by its tier only ("Master class"), so the path still reads as a path.
- A select keeps its currently selected option visible even when the spoiler level would hide it (`classSpoiler(c) <= spoilerLevel || c.id === value`), so shared links and earlier choices still render.

### Styling

Tailwind v4 through the Vite plugin, with no `tailwind.config`. Theme tokens are declared in `@theme` in `src/index.css` and backed by CSS variables that switch on `prefers-color-scheme`. Use the token classes (`bg-surface`, `text-muted`, `border-line`, `text-accent`) or `var(--…)`, never raw hex, so dark mode keeps working. Use the `tabular` class on numeric columns.

## PLAN.md is partly out of date

`PLAN.md` is the original roadmap. The implementation deliberately diverged from it: there is no Zustand, dnd-kit, lz-string, Recharts, `scripts/validate-data.ts`, `src/features/` or `src/store/`; data is JSON rather than YAML; and the schema in `src/data/schema.ts` differs from the one sketched there. Treat the code as the truth and PLAN.md as background on intent.

## Deploy

Any static host. `public/_redirects` provides the SPA fallback for Netlify and Cloudflare Pages; other hosts need unknown paths rewritten to `/index.html`.
