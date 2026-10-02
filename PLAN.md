# Fire Emblem: Fortune's Weave Planner — Build Plan

Three tools sharing one dataset:

1. **Database**: units, recruitment conditions per route, stats, growths, personal skills.
2. **Army Builder**: drag-and-drop roster planning per route, with class assignment.
3. **RNG Checker**: enter a unit's stats, level and class history, and see how well they rolled as a percentile.

---

## 0. Things to confirm before writing code

> **Status:** mostly answered. Findings and remaining unknowns are in [data/MECHANICS.md](data/MECHANICS.md).

The game's mechanics decide the data model and the RNG math. Verify each of these against the game or a datamine before building on it:

| Question | Why it matters |
|---|---|
| How growths work: personal only, personal + class (Engage/3H style), or fixed | Core of the RNG checker |
| Whether growths over 100% give +1 guaranteed plus a chance of +2 | RNG checker distribution |
| Any "minimum stat-ups per level" rule, or rerolls of empty level-ups | RNG checker distribution |
| Stat caps: per class, per unit modifiers, or both | Truncating the distributions |
| Class changes: do base stats get swapped (class bases) or added as flat bonuses? Does the level reset on promotion? Is there an internal level? | Converting entered stats to "growth-only" gains |
| How Renown works: a single global value, per route, or per faction? Is it a threshold at a specific chapter? | Recruitment condition schema |
| Route structure: when the split happens and whether routes share early chapters | Route and chapter schema |
| Recruitment condition types: talk, support rank, renown, chapter choice, survival, NG+ | Condition schema |
| Which classes each unit can access (restricted, or any via items) | Builder class dropdowns |
| Deploy limits per chapter or route | Builder slot counts |

**Data source:** pick one primary source (your own playthrough notes, a datamine, or a community wiki), record it in `data/SOURCES.md`, and credit it on the site. Don't scrape and republish wiki content wholesale without checking its license.

**Spoilers:** recruitment conditions and routes give away the plot. Plan for a global "hide spoilers" toggle from day one; adding it later is painful.

---

## 1. Tech stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | **Vite + React + TypeScript**, or **Next.js (static export)** if SEO for unit pages matters | Fully static site; no backend needed |
| Styling | Tailwind CSS | Fast iteration |
| Data | JSON/YAML files in `data/`, validated with **Zod** at build time | Versioned in git and easy for contributors to PR |
| Drag and drop | **dnd-kit** | Accessible (keyboard DnD), works on touch |
| State | **Zustand** (+ `persist` middleware for localStorage) | Light, simple |
| Sharing | Build state (one roster per route) → compact JSON → `lz-string` → URL hash | Shareable links with no server |
| Charts | Recharts or plain SVG | Percentile bars and stat distributions |
| Tests | **Vitest** | The RNG math needs to be well tested |
| Hosting | Cloudflare Pages / Vercel / GitHub Pages | Free static hosting |

No backend in v1. Add accounts or cloud saves only if users ask for them.

---

## 2. Data model (`src/data/schema.ts`)

```ts
type StatKey = 'hp'|'str'|'mag'|'dex'|'spd'|'def'|'res'|'lck'|'bld'; // adjust to the game
type Stats = Record<StatKey, number>;

interface Route { id: string; name: string; splitsAtChapter?: string; }

interface Chapter { id: string; name: string; order: number; routes: string[]; }

interface Skill { id: string; name: string; description: string; }

interface ClassDef {
  id: string; name: string;
  tier: 'base'|'advanced'|'special';
  promotesTo?: string[];
  baseStats: Stats;          // or flat bonuses, depending on game rules
  growths: Stats;            // class growth modifiers (if applicable)
  caps: Stats;
  weapons: string[];
  skills: string[];
}

interface Unit {
  id: string; name: string; portrait: string;
  joinLevel: number; joinClass: string;
  baseStats: Stats;          // as they join
  growths: Stats;            // personal growths
  capMods?: Partial<Stats>;
  personalSkill: string;     // Skill id
  classOptions: string[];    // legal classes
  recruitment: Recruitment[]; // one entry per route the unit can join on
  spoilerLevel: 0 | 1 | 2;
}

interface Recruitment {
  route: string;             // route id or 'all'
  chapter: string;
  conditions: Condition[];   // all must hold (AND); use 'anyOf' for OR
  notes?: string;
}

type Condition =
  | { type: 'renown'; min: number; scope?: string }
  | { type: 'support'; with: string; rank: 'C'|'B'|'A'|'S' }
  | { type: 'talk'; by: string }
  | { type: 'alive'; unit: string }
  | { type: 'choice'; chapter: string; option: string }
  | { type: 'notRecruited'; unit: string }      // mutually exclusive recruits
  | { type: 'anyOf'; conditions: Condition[] }
  | { type: 'custom'; text: string };            // escape hatch
```

`scripts/validate-data.ts` runs in CI and checks every id reference (classes, skills, routes, units in conditions), so a typo fails the build.

---

## 3. Feature specs

### 3.1 Database

- **Unit list** (`/units`): sortable, filterable table (route, join chapter, class, growth columns). Toggle between base stats and growths.
- **Unit page** (`/units/:id`):
  - Portrait, base stats, growths, caps, personal skill
  - **Recruitment table by route**: chapter, conditions rendered as readable chips ("Renown ≥ 3", "Support B with X", "Talk with Y"), notes
  - Class options, with effective growths (personal + class) per class if growths combine
  - Link: "Check this unit's RNG", which opens the RNG checker prefilled
- **Class list and class pages**: bases, growths, caps, skills, which units can use the class.
- **Skills list**.
- **Route view** (`/routes/:id`): chapter-by-chapter list of who can join and what each needs.
- Global search (unit, class, skill names) with Fuse.js.
- Spoiler toggle hides or blurs late-game units and conditions.

### 3.2 Army Builder

Two views, toggled at the top:
- **All-routes overview**: one column (or swimlane) per route, so you can compare your plans across routes side by side. Each column shows that route's roster (portrait, class, join chapter) and highlights units that appear on several routes. Clicking a column opens it in the single-route view.
- **Single-route view**: the detailed editor below.

A build holds one roster per route, so the overview is just every route's roster shown together.

**Single-route layout:**
```
┌─ Route: [Route A ▾]   Build name: [______]  [Share] [Save] ─┐
├──────────────┬──────────────────────────────────────────────┤
│ Unit pool    │  Roster (deploy slots)                       │
│ [search]     │  ┌────┐ ┌────┐ ┌────┐ ┌────┐                 │
│ ▢ Unit A     │  │ A  │ │ B  │ │ +  │ │ +  │  …              │
│ ▢ Unit B     │  │Cls▾│ │Cls▾│ │    │ │    │                 │
│ ▢ Unit C (⚠) │  └────┘ └────┘ └────┘ └────┘                 │
│              │  Bench / Not recruiting                      │
├──────────────┴──────────────────────────────────────────────┤
│ Recruitment timeline (chapters →) · Team summary            │
└─────────────────────────────────────────────────────────────┘
```

- **Route selector** filters the pool to units recruitable on that route.
- **Drag** units from the pool into Roster or Bench. Each roster card has a **class dropdown** limited to `classOptions`, and optionally a planned promotion path (e.g. Base → Advanced at Lv X).
- **Recruitment checklist**: an aggregated list of what you must do to get the chosen roster, ordered by chapter (e.g. "Ch 7: Reach Renown 3", "Ch 9: Talk to Z with Unit A").
- **Conflict warnings** (⚠):
  - Unit not available on the selected route
  - Mutually exclusive recruits both selected
  - Requirement depends on a unit you didn't recruit (talk partner, support partner)
  - Renown thresholds that conflict with other choices (if that's how renown works)
- **Visualizations:**
  - Chapter timeline: when each roster unit joins
  - Team composition: class/weapon type coverage, physical/magic split
  - Optional: projected average stats at a chosen level in the chosen class (reuses the RNG engine's expected-value math)
- **Persistence:** autosave to localStorage, several named builds, share via URL hash. Encode compactly as `{v, route, roster:[[unitId, classId, ...]]}`, with a schema version for migrations.
- Keyboard DnD and a mobile fallback ("tap a unit, then tap a slot").

### 3.3 RNG Checker

**Inputs:**
- Unit (prefills join level, join class, base stats)
- Current level and current stats
- **Class history**: an ordered list of segments `{class, fromLevel, toLevel}`. The UI offers "Add class change at level ___ → [class]". Default is one segment from the join class.
- Flags for non-level-up stat sources, which are subtracted before analysis: stat boosters used, equipped items, bond or other passive buffs (as the game requires).

**Engine** (`src/engine/growth.ts`, pure functions, fully unit-tested):
1. Expand the class history into one growth rate **per level-up per stat**: `p = personal + class growth` for the class held at that level-up (or whatever rule step 0 confirms).
2. Compute the stat gained from level-ups: `gained = current − base − class-change adjustments − boosters`.
3. Build the exact distribution of total gains per stat with a **Poisson-binomial DP**: start with `dist = [1]`, and for each level-up convolve with `{0: 1−p, 1: p}`. Handle growths over 100% (+1 guaranteed, `p−1` chance of +2) if the game works that way. This is O(levels²) per stat, which is trivial.
4. Apply **caps** by folding probability mass above the cap onto the cap. Do this per class segment if caps change on class change (DP with clamping at each step).
5. If the game has a "guaranteed minimum stat-ups" rule, stats are no longer independent. Switch to **Monte Carlo** (~100k simulated runs in a Web Worker), or run a joint DP if the rule is simple. Ship Monte Carlo as the fallback either way; it also cross-checks the exact DP in tests.
6. **Percentile** per stat (mid-rank, so ties count fairly): `P(X < x) + 0.5·P(X = x)`.
7. **Overall score**: percentile of the *sum of gained stats* (convolution of all stat distributions; optionally weighted, e.g. excluding HP or Luck). Also show the mean of the per-stat percentiles.
8. **Tier rank** (per stat and overall), mapped from the percentile. Keep the thresholds in one config so they're easy to tune:

   | Rank | Percentile |
   |---|---|
   | S | ≥ 95 |
   | A | 80–95 |
   | B | 60–80 |
   | C | 40–60 |
   | D | 20–40 |
   | E | 5–20 |
   | E- | < 5 |

**Output:**
- Per-stat row: actual vs expected (mean ± SD), percentile bar (red to green), **tier rank badge (E- to S)**
- Overall headline: tier rank + percentile ("Rank A: better than 82% of possible runs")
- Expandable chart per stat showing the full distribution with the actual value marked
- Validation errors in plain language: "Strength 31 is unreachable: max possible is 28 at Lv 15", or "below base stat, did you include a debuff?"
- Shareable URL of the inputs

---

## 4. Project structure

```
fefw_planner/
├─ data/                 # source-of-truth game data (YAML/JSON) + SOURCES.md
│  ├─ units/*.yaml  classes.yaml  skills.yaml  routes.yaml  chapters.yaml
├─ scripts/validate-data.ts
├─ src/
│  ├─ data/              # schema.ts (Zod), loader.ts, derived indexes
│  ├─ engine/            # growth.ts, distribution.ts, montecarlo.worker.ts, recruitment.ts
│  ├─ features/
│  │  ├─ database/       # UnitList, UnitPage, ClassPage, RouteView, ConditionChip
│  │  ├─ builder/        # BuilderPage, UnitPool, RosterSlot, ClassPicker, Timeline, Warnings
│  │  └─ rng/            # RngPage, ClassHistoryEditor, StatResultRow, DistributionChart
│  ├─ store/             # zustand stores (builds, settings incl. spoilers)
│  ├─ lib/share.ts       # URL encode/decode with versioning
│  └─ components/        # shared UI (StatTable, UnitPortrait, SpoilerGuard)
└─ tests/                # engine tests, data validation, share round-trip
```

---

## 5. Milestones

| # | Milestone | Deliverable | Rough size |
|---|---|---|---|
| M0 | Mechanics research | Answers to section 0 written into `data/MECHANICS.md` | 1–3 days, depends on available info |
| M1 | Scaffold + schema | Vite/TS/Tailwind app, Zod schema, validator, CI, deploy pipeline | 1 day |
| M2 | Seed data | 5–10 units, all classes, routes. Enough to build features against | 1–2 days |
| M3 | Database UI | Unit list, unit page, route view, spoiler toggle | 3–4 days |
| M4 | RNG engine | `growth.ts` + DP + caps + Monte Carlo fallback, with thorough tests | 2–3 days |
| M5 | RNG UI | Inputs, class history editor, results, charts, share link | 3 days |
| M6 | Builder core | Route select, pool, DnD roster, class picker, localStorage | 3–4 days |
| M7 | Builder intelligence | Recruitment checklist, conflict warnings, timeline, composition | 3 days |
| M8 | Full data entry | All units and conditions on every route | Ongoing; parallel with M3–M7 |
| M9 | Polish | Mobile, a11y, SEO meta, about/credits page, error states | 2–3 days |

Build order reasoning: the RNG engine (M4) has no UI dependencies and holds the most risk, so it can be built and tested early, alongside the database UI. The builder comes last because its warnings depend on the recruitment condition schema having been tested on real data.

---

## 6. Testing strategy

- **Engine:** hand-computed cases (one level-up, p = 0.5 → 50/50), sums of probabilities = 1, cap folding, growths over 100%, the DP matching Monte Carlo within tolerance, class-change segments.
- **Data:** the validator runs in CI, and a snapshot test confirms every unit has recruitment info for at least one route.
- **Share links:** encode/decode round-trip, and decoding old versions still works.
- **E2E (optional, Playwright):** drag a unit, set its class, reload, and confirm the build persists.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Mechanics unknown or misreported | Isolate rules in `engine/` behind a small config (`growthModel`, `overflowRule`, `minStatUps`) so they're easy to change |
| Data entry is a big, error-prone job | YAML per unit, a strict validator, and a "report an error" link on each unit page (GitHub issue template) |
| Recruitment logic too irregular for the schema | `custom` condition type as an escape hatch; warnings skip custom conditions |
| Spoiler complaints | Spoilers hidden by default, per-unit `spoilerLevel` |
| Nintendo IP | Non-commercial fan site with a disclaimer. Avoid ripping official art at scale; use small portraits or initials placeholders |

---

## 8. Stretch ideas

- Stat projection ("what will this unit average at Lv 20 as Class X?") using the same engine
- Compare two units' growth-adjusted stats
- Import/export builds as JSON
- Community-shared builds gallery (would need a backend)
