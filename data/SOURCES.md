# Data sources

All game data is © Nintendo / Intelligent Systems. This is a non-commercial fan project.

| Data | Primary source | Notes |
|---|---|---|
| Unit growth rates | [Game8 – Growth Rates Explained](https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/618974) | Cross-checked against Fextralife; disagreements are noted on the unit |
| Class growth modifiers and tiers | Game8 – Growth Rates Explained | |
| Class requirements and skills | [Game8 – List of All Classes](https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/620256) | |
| Recruitment by route | [Game8 – How to Recruit Characters](https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/620957) | Other guides (e.g. RPG Site) disagree on a few support/renown values |
| Paralogues | [Game8 – List of All Paralogues](https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/624240) | |
| Personal, class and mastery skills | [Game8 – List of All Abilities](https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/623691) | |
| Base stats, starting class, faction, aptitudes, magic lists | [Fextralife wiki](https://fortunesweave.wiki.fextralife.com/Characters) | Base stats only exist for some units so far |
| Recommended class paths (`classPaths.json`) | [fefw-growth-sim](https://github.com/owenong1/fefw-growth-sim) | Simulated, not sourced: the simulator has its own data (Serenes Forest, Game8, Fire Emblem Wiki) and models enemy stats. Regenerate with `npm run import:paths` |

## Updating

1. Download the pages into `.cache/sources/` (filenames are listed in `scripts/import/import_sources.py`).
2. Run `python3 scripts/import/import_sources.py`.
3. Read `data/import-report.txt` for anything the importer could not parse.
4. Put hand corrections in `data/overrides.json` rather than editing the generated JSON, so a re-import keeps them.
5. Run `npm test` to validate references between collections.
