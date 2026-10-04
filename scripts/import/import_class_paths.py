"""Builds data/classPaths.json from the growth simulator's results.

Usage: python3 scripts/import/import_class_paths.py [--sim <dir>] [--from <export.json>] [sim options]

The simulator (https://github.com/owenong1/fefw-growth-sim) searches every
unit's class paths and recommends one per role. This runs its `export` command
(about a minute; needs Node 18+) and rewrites unit and class names as this
site's ids. `--sim` is the simulator checkout (default: ../fefw_growth_sim, or
$FEFW_SIM); `--from` reads an export made earlier instead of running it.
Anything else is passed to the simulator, e.g. `--hard` or `--route cai`.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'classPaths.json')
sys.path.insert(0, os.path.dirname(__file__))
from import_sources import slug  # noqa: E402


def take(args, flag):
    if flag not in args:
        return None
    i = args.index(flag)
    value = args[i + 1]
    del args[i:i + 2]
    return value


def run_sim(sim, extra):
    cli = os.path.join(sim, 'src', 'cli.js')
    if not os.path.exists(cli):
        sys.exit(f'No simulator at {sim}. Clone fefw-growth-sim there, or pass --sim <dir> or --from <export.json>.')
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'export.json')
        subprocess.run(['node', cli, 'export', path, *extra], check=True, stderr=subprocess.DEVNULL)
        with open(path, encoding='utf-8') as f:
            return json.load(f)


def main():
    args = sys.argv[1:]
    source = take(args, '--from')
    sim = take(args, '--sim') or os.environ.get('FEFW_SIM') or os.path.join(ROOT, '..', 'fefw_growth_sim')
    if source:
        with open(source, encoding='utf-8') as f:
            export = json.load(f)
    else:
        export = run_sim(os.path.abspath(sim), args)

    with open(os.path.join(ROOT, 'data', 'units.json'), encoding='utf-8') as f:
        unit_ids = {u['id'] for u in json.load(f)}
    with open(os.path.join(ROOT, 'data', 'classes.json'), encoding='utf-8') as f:
        class_ids = {c['id'] for c in json.load(f)}

    unknown = set()

    def ref(name, ids, kind):
        if slug(name) not in ids:
            unknown.add(f'{kind} {name}')
        return slug(name)

    units = []
    for u in export['units']:
        roles = {}
        for role, r in u['roles'].items():
            path = [{'class': ref(s['name'], class_ids, 'class'), 'level': s['level'], 'late': s['late']} for s in r['path']]
            roles[role] = {**r, 'path': path}
        units.append({**u, 'unit': ref(u['unit'], unit_ids, 'unit'), 'joinClass': ref(u['joinClass'], class_ids, 'class'), 'roles': roles})
    if unknown:
        sys.exit('The simulator names records this site does not have: ' + ', '.join(sorted(unknown)))
    units.sort(key=lambda u: u['unit'])

    # One unit per line, so a re-run shows up in a diff as the units that changed.
    head = {k: export[k] for k in ('scope', 'roles', 'axes')}
    lines = ',\n'.join('  ' + json.dumps(u, separators=(',', ':')) for u in units)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(json.dumps(head, indent=1)[:-2] + ',\n "units": [\n' + lines + '\n ]\n}\n')
    print(f'Wrote {os.path.relpath(OUT, ROOT)}: {len(units)} units, {len(head["roles"])} roles')


if __name__ == '__main__':
    main()
