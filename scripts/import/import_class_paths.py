"""Builds data/classPaths*.json and data/pathCandidates*.json from the growth simulator's results.

Usage: python3 scripts/import/import_class_paths.py [--exports <dir>] [simulator options]

The simulator (src/sim/, run from the terminal by scripts/sim/cli.js) searches
every unit's class paths and recommends one per role. This runs its `export`
command once per plan in PLANS (about two minutes in all; needs Node 18+) and
rewrites unit and class names as this site's ids. A plan is the stretch of the
campaign the paths are picked for: the whole of it, or Part II or Part III
onwards (the simulator's `--from`), which is a search of its own because the
best path for the late game is not the best one overall. The whole campaign
goes in classPaths.json and pathCandidates.json, the others in
classPaths.<plan>.json and pathCandidates.<plan>.json. The plans are also
listed in src/data/pathModel.ts.

`--exports` reads exports made earlier instead of running the simulator:
export.json, export.p2.json and export.p3.json in that directory. Anything
else is passed to the simulator, e.g. `--hard` or `--route cai`.

The export's candidate paths (what the Class Paths page re-scores when a role's
weights are edited) are several megabytes, so they go in a file of their own
that the page only fetches when the weights are first changed.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
# Plan id (the file suffix) -> the checkpoint the simulator scores from; None is the whole campaign.
PLANS = {'': None, 'p2': 'P2-01', 'p3': 'P3-01'}
sys.path.insert(0, os.path.dirname(__file__))
from import_sources import slug  # noqa: E402


def take(args, flag):
    if flag not in args:
        return None
    i = args.index(flag)
    value = args[i + 1]
    del args[i:i + 2]
    return value


def run_sim(extra):
    cli = os.path.join(ROOT, 'scripts', 'sim', 'cli.js')
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'export.json')
        subprocess.run(['node', cli, 'export', path, *extra], check=True, stderr=subprocess.DEVNULL)
        with open(path, encoding='utf-8') as f:
            return json.load(f)


def main():
    args = sys.argv[1:]
    source = take(args, '--exports')
    if '--from' in args:
        sys.exit('--from is set per plan by this importer; see PLANS.')
    for plan, start in PLANS.items():
        suffix = f'.{plan}' if plan else ''
        if source:
            with open(os.path.join(source, f'export{suffix}.json'), encoding='utf-8') as f:
                export = json.load(f)
        else:
            export = run_sim([*args, *(['--from', start] if start else [])])
        write(export, suffix)


def write(export, suffix):
    out = os.path.join(ROOT, 'data', f'classPaths{suffix}.json')
    out_candidates = os.path.join(ROOT, 'data', f'pathCandidates{suffix}.json')
    with open(os.path.join(ROOT, 'data', 'units.json'), encoding='utf-8') as f:
        unit_ids = {u['id'] for u in json.load(f)}
    with open(os.path.join(ROOT, 'data', 'classes.json'), encoding='utf-8') as f:
        class_ids = {c['id'] for c in json.load(f)}

    unknown = set()

    def ref(name, ids, kind):
        if slug(name) not in ids:
            unknown.add(f'{kind} {name}')
        return slug(name)

    def steps(path):
        return [{'class': ref(s['name'], class_ids, 'class'), 'level': s['level'], 'late': s['late']} for s in path]

    units, candidates = [], {}
    for u in export['units']:
        roles = {role: {**r, 'path': steps(r['path'])} for role, r in u['roles'].items()}
        unit = ref(u['unit'], unit_ids, 'unit')
        candidates[unit] = [{**c, 'path': steps(c['path'])} for c in u['cands']]
        units.append({**{k: v for k, v in u.items() if k != 'cands'}, 'unit': unit, 'joinClass': ref(u['joinClass'], class_ids, 'class'), 'roles': roles})
    checkpoints = [{**c, 'refs': [{'archetype': e['archetype'], 'class': ref(e['class'], class_ids, 'class')} for e in c['refs']]} for c in export['checkpoints']]
    class_tiers = [{**t, 'classes': [{**{k: v for k, v in c.items() if k != 'name'}, 'class': ref(c['name'], class_ids, 'class')} for c in t['classes']]} for t in export['classTiers']]
    if unknown:
        sys.exit('The simulator names records this site does not have: ' + ', '.join(sorted(unknown)))
    units.sort(key=lambda u: u['unit'])

    # One unit per line, so a re-run shows up in a diff as the units that changed.
    def line(x):
        return json.dumps(x, separators=(',', ':'))

    head = {**{k: export[k] for k in ('scope', 'counts', 'tiers', 'maxExamGap', 'profile', 'roles', 'axes')}, 'checkpoints': checkpoints, 'classTiers': class_tiers}
    compact = {k: line(head[k]) for k in ('checkpoints', 'classTiers')}
    text = json.dumps({k: (f'@@{k}@@' if k in compact else v) for k, v in head.items()}, indent=1)[:-2]
    for k, rows in compact.items():
        text = text.replace(f'"@@{k}@@"', '[\n' + ',\n'.join('  ' + line(x) for x in head[k]) + '\n ]')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text + ',\n "units": [\n' + ',\n'.join('  ' + line(u) for u in units) + '\n ]\n}\n')
    with open(out_candidates, 'w', encoding='utf-8') as f:
        f.write('{\n "units": {\n' + ',\n'.join(f'  {json.dumps(k)}: {line(candidates[k])}' for k in sorted(candidates)) + '\n }\n}\n')
    print(f'Wrote {os.path.relpath(out, ROOT)}: {len(units)} units, {len(head["roles"])} roles')
    print(f'Wrote {os.path.relpath(out_candidates, ROOT)}: {sum(len(c) for c in candidates.values())} candidate paths')


if __name__ == '__main__':
    main()
