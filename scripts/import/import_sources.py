"""Builds data/*.json from the cached source pages in .cache/sources/.

Usage: python3 scripts/import/import_sources.py

The JSON in data/ is the source of truth once committed. Re-running this
overwrites it, so hand edits belong in data/overrides.json (applied last).
"""
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, '.cache', 'sources')
OUT = os.path.join(ROOT, 'data')
sys.path.insert(0, os.path.dirname(__file__))
from htmltables import parse_tables, page_text  # noqa: E402

STATS = ['hp', 'str', 'mag', 'spd', 'dex', 'def', 'res', 'lck', 'cha']
ROUTES = [
    {'id': 'cai', 'lord': 'cai', 'name': "Cai's Path", 'army': 'Ribeira Winds'},
    {'id': 'dietrich', 'lord': 'dietrich', 'name': "Dietrich's Path", 'army': 'House Lamine'},
    {'id': 'theodora', 'lord': 'theodora', 'name': "Theodora's Path", 'army': "Megaira's Beacon"},
    {'id': 'leda', 'lord': 'leda', 'name': "Leda's Path", 'army': 'Rose Tempest'},
]
# Game8 labels routes by (mis-spelled / shortened) army name.
ARMY_TO_ROUTE = {'Riberia Wind': 'cai', 'House Lamine': 'dietrich', 'Megaira': 'theodora', 'Rose Tempest': 'leda'}
LORDS = {'Cai', 'Dietrich', 'Theodora', 'Leda'}

APTITUDE_ALIASES = {
    'sword': 'sword', 'spear': 'spear', 'axe': 'axe', 'bow': 'bow',
    'gauntlet': 'gauntlet', 'brawling': 'gauntlet',
    'white magic': 'whiteMagic', 'black magic': 'blackMagic',
    'rider': 'riding', 'riding': 'riding', 'flier': 'flying', 'flying': 'flying',
    'heavy': 'heavyArmor', 'heavy armor': 'heavyArmor',
    'authority': 'authority', 'infantry': 'infantry',
}

report = []


def slug(name):
    name = name.lower().replace("'", '').replace('’', '').replace('+', ' plus ')
    return re.sub(r'[^a-z0-9]+', '-', name).strip('-')


def dedupe(cell):
    """Game8 cells repeat the name via an icon alt text: 'Brio Brio', 'Tactician Tactician's Wit'."""
    cell = cell.strip()
    for i in range(1, len(cell)):
        if cell[i] == ' ' and cell[i + 1:].startswith(cell[:i]):
            return cell[i + 1:]
    return cell


def load(name):
    with open(os.path.join(SRC, name), encoding='utf-8', errors='ignore') as f:
        return f.read()


def stats_row(values):
    return {k: int(v) for k, v in zip(STATS, values)}


# ---------------------------------------------------------------- classes
def import_classes():
    growth_tables = parse_tables(load('game8-growth-rates.html'))
    tier_order = ['base', 'beginner', 'specialty', 'advanced', 'master', 'divine']
    class_growths = []
    for t in growth_tables:
        if t and t[0][:2] == ['Class', 'HP']:
            class_growths.append(t[1:])
    assert len(class_growths) == 6, f'expected 6 class growth tables, got {len(class_growths)}'

    classes = {}
    for tier, rows in zip(tier_order, class_growths):
        for r in rows:
            name = r[0]
            classes[slug(name)] = {
                'id': slug(name), 'name': name, 'tier': tier,
                'growths': stats_row(r[1:10]),
                'requirements': None, 'skills': [], 'masterySkill': None,
                'tags': [],
            }
    # Noble is a base class (lords start in it) that Game8's growth table omits.
    # Game8 states base classes add no growth rates.
    classes['noble'] = {
        'id': 'noble', 'name': 'Noble', 'tier': 'base', 'growths': {k: 0 for k in STATS},
        'requirements': None, 'skills': [], 'masterySkill': 'combat-basics', 'tags': [],
    }
    classes['commoner']['masterySkill'] = 'combat-basics'
    classes['elephant-rider']['tier'] = 'advanced'

    req_tables = parse_tables(load('game8-classes.html'))
    for t in req_tables:
        if not t or t[0] != ['Name', 'Requirements', 'Abilities']:
            continue
        for name_cell, req, abil in t[1:]:
            cid = slug(dedupe(name_cell))
            c = classes.get(cid)
            if not c:
                report.append(f'class on requirements page but not in growth tables: {name_cell}')
                continue
            c['requirements'] = parse_class_requirements(req)
            m = re.search(r'Master:\s*/?\s*・\s*(.+?)(?:\s+Class:|$)', abil)
            if m:
                c['masterySkill'] = slug(m.group(1).strip())
            m = re.search(r'Class:\s*/?\s*(.+)$', abil)
            if m:
                c['skills'] = [slug(s.strip()) for s in m.group(1).split('・') if s.strip()]

    for c in classes.values():
        r = c['requirements'] or {}
        skills = [s['skill'] for s in r.get('primarySkills', []) + r.get('secondarySkills', [])]
        if 'riding' in skills or 'mount-dismount' in c['skills']:
            c['tags'].append('mounted')
        if 'flying' in skills:
            c['tags'].append('flying')
        if 'heavyArmor' in skills:
            c['tags'].append('armored')
        if not c['requirements'] and c['tier'] not in ('base',):
            report.append(f'class has no requirements data: {c["name"]}')
    return classes


def parse_skill_list(s):
    out = []
    for name, rank in re.findall(r'([A-Za-z ]+?) Skill \(([A-E][+]?|S)\)', s):
        key = APTITUDE_ALIASES.get(name.strip().lower())
        if not key:
            report.append(f'unknown weapon skill in class requirements: {name}')
            continue
        out.append({'skill': key, 'rank': rank})
    return out


def parse_class_requirements(s):
    r = {}
    m = re.search(r'License:\s*(\w+)', s)
    if m:
        r['license'] = m.group(1)
    if re.search(r'License: Elephant', s):
        r['license'] = 'Elephant'
    m = re.search(r'Ideal: Lv\. (\d+)', s)
    if m:
        r['level'] = int(m.group(1))
    m = re.search(r'Renown: Lv\. (\d+)', s)
    if m:
        r['renown'] = int(m.group(1))
    prim = re.search(r'Primary Skill:\s*/?\s*(.*?)(?:Secondary Skill:|$)', s)
    sec = re.search(r'Secondary Skill:\s*(.*)$', s)
    r['primarySkills'] = parse_skill_list(prim.group(1)) if prim else []
    r['secondarySkills'] = parse_skill_list(sec.group(1)) if sec else []
    unlock = re.split(r'License:|Primary Skill:|Secondary Skill:', s)[0].strip(' /')
    if unlock:
        unlock = re.sub(r'(\w+) Icon \1 - ', r'\1 – ', unlock)
        r['unlock'] = unlock
    return r


# ---------------------------------------------------------------- skills
SKILL_SECTIONS = ['personal', 'class', 'mastery', 'weaponRank', 'mount', 'level', 'bloodmark']
KEEP_SECTIONS = {'personal', 'class', 'mastery', 'level', 'bloodmark'}


def import_skills(classes):
    tables = [t for t in parse_tables(load('game8-abilities.html')) if t and t[0] == ['Skill', 'Details']]
    assert len(tables) == len(SKILL_SECTIONS), f'abilities page layout changed: {len(tables)} skill tables'
    skills = {}
    unit_skills = {}  # unit id -> {'personal': id, 'level': [{skill, level}], 'bloodmarks': [id]}

    def add(name, effect, kind, extra=None):
        sid = slug(name)
        if sid in skills:
            return sid
        skills[sid] = {'id': sid, 'name': name, 'type': kind, 'effect': effect, **(extra or {})}
        return sid

    for kind, t in zip(SKILL_SECTIONS, tables):
        if kind not in KEEP_SECTIONS:
            continue
        for name_cell, details in t[1:]:
            name = dedupe(name_cell)
            crest = re.match(r'Crest:\s*(.*?)\s*/\s*', details)
            if crest:
                details = details[crest.end():]
            m = re.match(r'Effect:\s*/?\s*(.*?)\s*(Used by:|Mastered by:|Skill Unlock:|$)(.*)', details)
            if not m:
                report.append(f'unparsed {kind} skill: {name_cell} | {details}')
                continue
            effect, rest = m.group(1).strip(), m.group(3)
            extra = {'crest': crest.group(1)} if crest else None
            sid = add(name, effect, kind, extra)
            if kind == 'personal':
                for owner in split_owners(rest):
                    unit_skills.setdefault(slug(owner), {})['personal'] = sid
            elif kind == 'level':
                parts = re.findall(r'(.*?)\(Lv\. (\d+)\)', rest) or [(rest, None)]
                for owner_text, lv in parts:
                    for o in split_owners(owner_text):
                        unit_skills.setdefault(slug(o), {}).setdefault('level', []).append(
                            {'skill': sid, 'level': int(lv) if lv else None})
            elif kind == 'bloodmark':
                for owner in split_owners(rest):
                    unit_skills.setdefault(slug(owner), {}).setdefault('bloodmarks', []).append(sid)
    names = {}
    for t in parse_tables(load('game8-classes.html')):
        for row in t:
            for cell in row:
                for n in re.findall(r'・\s*([^・]+?)(?=\s*・|\s+Class:|$)', cell):
                    names[slug(n.strip())] = n.strip()
    for c in classes.values():
        for s in c['skills']:
            if s not in skills:
                add(names.get(s, s), None, 'class')
                report.append(f'class skill without effect text (stub added): {names.get(s, s)}')
        s = c['masterySkill']
        if s and s not in skills:
            add(names.get(s, s), None, 'mastery')
            report.append(f'mastery skill without effect text (stub added): {names.get(s, s)}')
    return skills, unit_skills


KNOWN_NAMES = []  # unit + class names, filled in by main() before skills/paralogues are parsed


def split_owners(s):
    """'Halvin Halvin' / 'WarriorWarrior BlacksmithBlacksmith' / 'Sha LanSha Lan' -> names, in order."""
    found = []
    for name in sorted(KNOWN_NAMES, key=len, reverse=True):
        for m in re.finditer(re.escape(name), s):
            if not any(a <= m.start() < b for a, b, _ in found):
                found.append((m.start(), m.end(), name))
    names = []
    for _, _, n in sorted(found):
        if n not in names:
            names.append(n)
    return names or [dedupe(s)]


def dedupe_name(x):
    return slug(x)


# ---------------------------------------------------------------- recruitment
ITEM_RE = re.compile(
    r"Give (?:(?P<n1>\d+) (?P<i1>.+?) to \w[\w ]*|(?P<who>[A-Z][\w ]*?) (?:(?P<n2>\d+) |a copy of the )?(?P<i2>.+?)(?: x(?P<n3>\d+))?)\.?$")


def parse_condition(clause):
    c = clause.strip().rstrip('.')
    low = c.lower()
    m = re.search(r"(?:clear|complete) (.+?)'s (?:regret )?paralogue", low)
    if m:
        return {'type': 'paralogue', 'paralogue': slug(m.group(1)), 'text': c}
    m = re.search(r'(\d+) gold', low)
    if m and ('give' in low or 'pay' in low):
        return {'type': 'gold', 'amount': int(m.group(1)), 'text': c}
    m = re.search(r'reach chapter (\d+)', low)
    if m:
        return {'type': 'chapter', 'chapter': int(m.group(1)), 'text': c}
    if low.startswith('give'):
        m = re.match(r'give (\d+) (.+?) to ', c, re.I)
        if m:
            return {'type': 'item', 'item': m.group(2).strip(), 'qty': int(m.group(1)), 'text': c}
        m = re.match(r'give \w[\w ]*? (\d+) (.+)$', c, re.I)
        if m:
            return {'type': 'item', 'item': m.group(2).strip(), 'qty': int(m.group(1)), 'text': c}
        m = re.match(r'give \w+ (.+?) x(\d+)$', c, re.I)
        if m:
            return {'type': 'item', 'item': m.group(1).strip(), 'qty': int(m.group(2)), 'text': c}
        m = re.match(r'give \w+ (?:a copy of the )?(.+)$', c, re.I)
        if m:
            return {'type': 'item', 'item': m.group(1).strip(), 'qty': 1, 'text': c}
    if 'request' in low or 'quest' in low or 'gather information' in low:
        return {'type': 'request', 'text': c}
    if any(k in low for k in ('answer', 'select', 'pick', 'admit', 'refuse', 'questions')):
        return {'type': 'dialogue', 'text': c}
    return {'type': 'other', 'text': c}


def split_clauses(text):
    text = text.strip().rstrip('.')
    # "Pay 500 Gold and pick tails" / "Clear X then give 3000 gold" / "Refuse to pay thrice then pay Zarcone 10 Gold"
    parts = re.split(r'\s+(?:then|and)\s+(?=[a-z]*\s?(?:give|pay|select|answer|complete|reach|pick|clear)\b)', text, flags=re.I)
    return [p for p in parts if p.strip()]


def parse_route_cell(cell, route_id, unit_name):
    cell = cell.strip()
    if cell in ('-', ''):
        return None
    lines = [l.strip(' ・') for l in cell.split('/') if l.strip(' ・')]
    entry = {'route': route_id, 'part': 1, 'chapter': None, 'method': 'automatic', 'conditions': []}
    for l in lines:
        m = re.match(r'Part I Chapter (\d+)', l)
        if m:
            entry['chapter'] = int(m.group(1))
            continue
        m = re.match(r'Support Lv (\d+)', l)
        if m:
            entry['support'] = int(m.group(1))
            entry['method'] = 'recruit'
            continue
        m = re.match(r'(\d+) Renown', l)
        if m:
            entry['renown'] = int(m.group(1))
            entry['method'] = 'recruit'
            continue
        entry['method'] = 'recruit'
        for clause in split_clauses(l):
            cond = parse_condition(clause)
            if cond['type'] == 'other':
                report.append(f'unclassified condition for {unit_name} ({route_id}): {clause}')
            entry['conditions'].append(cond)
    if entry['chapter'] is None:
        report.append(f'no chapter for {unit_name} on {route_id}: {cell}')
    return entry


def import_recruitment():
    tables = parse_tables(load('game8-recruitment.html'))
    main = next(t for t in tables if t and t[0][:2] == ['Character', "Cai's Path"])
    story = next(t for t in tables if t and t[0] == ['Character', 'Availability', 'Conditions'])
    rec = {}
    for row in main[1:]:
        name = dedupe(row[0])
        uid = slug(name)
        if len(row) == 2:  # prologue units: one merged cell
            m = re.match(r'Prologue: Descent Chapter (\d+)', row[1])
            rec[uid] = [{'route': 'all', 'part': 0, 'chapter': int(m.group(1)), 'method': 'automatic',
                         'conditions': []}]
            continue
        entries = []
        for route, cell in zip(ROUTES, row[1:5]):
            e = parse_route_cell(cell, route['id'], name)
            if e:
                entries.append(e)
        rec[uid] = entries
    for lord in LORDS:
        rec[slug(lord)] = [{'route': slug(lord), 'part': 1, 'chapter': 1, 'method': 'automatic', 'conditions': []}]
    for name_cell, avail, cond in story[1:]:
        name = dedupe(name_cell.replace('Show spoiler', '').strip())
        uid = slug(name)
        m = re.match(r'Part (\d) (?:Chapter (\d+)|(\w+) Section)', avail)
        part = int(m.group(1))
        entry = {'route': 'all', 'part': part, 'method': 'story', 'conditions': [],
                 'chapter': int(m.group(2)) if m.group(2) else None}
        if m.group(3):
            entry['section'] = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'].index(m.group(3)) + 1
        for clause in [c for c in re.split(r'\s*/\s*', cond) if c.strip()]:
            c = parse_condition(clause)
            if c['type'] == 'other' and re.search(r'surviv', clause, re.I):
                c['type'] = 'survive'
            if c['type'] == 'other' and re.search(r'defeat', clause, re.I):
                c['type'] = 'battle'
            entry['conditions'].append(c)
        rec.setdefault(uid, []).append(entry)
    # Hong Hua and Troy rejoin in Part III per Game8's character notes.
    for uid in ('hong-hua', 'troy'):
        rec[uid].append({'route': 'all', 'part': 3, 'chapter': None, 'method': 'story', 'conditions': [
            {'type': 'other', 'text': 'Rejoins automatically in Part III: Salvation'}]})
    return rec


# ---------------------------------------------------------------- paralogues
def import_paralogues():
    tables = parse_tables(load('game8-paralogues.html'))
    overview = tables[0]
    detail = [t for t in tables if t and len(t[0]) == 2 and t[0][1] == 'Rewards']
    owners = [r[0] for r in overview[1:]]
    assert len(owners) == len(detail), (owners, len(detail))
    paralogues = []
    for owner, t in zip(owners, detail):
        title = t[0][0]
        loc = title.split(' - ', 1)[1] if ' - ' in title else None
        rewards = t[1][0].replace('Gold Icon', '').replace('Renown Icon', '')
        rewards = [r.strip(' ・') for r in re.split(r'\s*/\s*|(?<=Gold)\s+', rewards) if r.strip(' ・')]
        availability, recruits = [], []
        for r in t[2:]:
            if r[0].startswith('Recruitment Req. For:'):
                recruits = [slug(x) for x in split_owners(r[0].split(':', 1)[1])]
                continue
            m = re.match(r'(.+?) \w+\'s Path Ch\. (\d+)', r[0])
            if m:
                availability.append({'route': ARMY_TO_ROUTE[m.group(1).strip()], 'chapter': int(m.group(2)),
                                     'dates': r[1] if len(r) > 1 else None})
        paralogues.append({'id': slug(owner), 'name': f"{owner}'s Paralogue", 'location': loc,
                           'rewards': rewards, 'availability': availability, 'recruitmentFor': recruits})
    return paralogues


# ---------------------------------------------------------------- units
def import_fextralife():
    out = {}
    d = os.path.join(SRC, 'fextralife')
    for fn in sorted(os.listdir(d)):
        name = fn[:-5].replace('_', ' ')
        lines = [l.strip() for l in page_text(open(os.path.join(d, fn), encoding='utf-8', errors='ignore').read()).split('\n') if l.strip()]

        def after(label):
            for i, l in enumerate(lines):
                if l == label and i + 1 < len(lines):
                    return lines[i + 1]

        body = ' '.join(lines)
        info = {'faction': after('Faction'), 'startingClass': after('Starting Class')}
        m = re.search(r'Favorable Skills:\s*(.*?)\s*Unfavorable Skills:\s*(.*?)\s*(?:How To Recruit|Pale Raven|Recruits|Recommended Classes|Support Allies|##|$)', body)
        if m:
            info['favored'] = norm_aptitudes(m.group(1))
            info['unfavored'] = norm_aptitudes(m.group(2))
        m = re.search(r'White Magic (D tier:.*?)Black Magic (D tier:.*?)(?:\S+ Combat Arts|Growth Rate)', body)
        if m:
            info['magic'] = {'white': magic_tiers(m.group(1)), 'black': magic_tiers(m.group(2))}
        m = re.search(r"stats at Level (\d+), without any class\.\s*" + FX_STAT_BLOCK, body)
        if m:
            info['baseLevel'] = int(m.group(1))
            info['baseStats'] = fx_stats(m)
        m = re.search(r"Growth Rates for [\w' ]+ without any class\.\s*" + FX_STAT_BLOCK, body)
        if m:
            info['growths'] = fx_stats(m)
        out[slug(name)] = info
    return out


FX_LABELS = {'HP': 'hp', 'Strength': 'str', 'Magic': 'mag', 'Dexterity': 'dex', 'Speed': 'spd',
             'Luck': 'lck', 'Defense': 'def', 'Resistance': 'res', 'Charm': 'cha'}
# Fextralife labels its columns, in its own order; capture the labels and the numbers.
FX_STAT_BLOCK = r'((?:(?:HP|Strength|Magic|Dexterity|Speed|Luck|Defense|Resistance|Charm)\s+){9})((?:\d+\s*){9})'


def fx_stats(m):
    labels = m.group(m.lastindex - 1).split()
    values = [int(x) for x in m.group(m.lastindex).split()]
    stats = {FX_LABELS[l]: v for l, v in zip(labels, values)}
    return {k: stats[k] for k in STATS} if len(stats) == 9 else None


def norm_aptitudes(s):
    out = []
    for part in s.split(','):
        p = part.strip().rstrip('.').lower()
        if not p or p == 'none' or len(p) > 40:
            continue
        p = re.sub(r'\s*skills?$', '', p)
        if p in ('white and black magic', 'white magic, black magic'):
            out += ['whiteMagic', 'blackMagic']
            continue
        if p == 'white magic' or p == 'black magic':
            out.append(APTITUDE_ALIASES[p])
            continue
        key = APTITUDE_ALIASES.get(p)
        if key:
            out.append(key)
        else:
            report.append(f'unknown aptitude "{part.strip()}"')
    return sorted(set(out))


def magic_tiers(s):
    tiers = {}
    for rank, spell in re.findall(r'([DCBAS]) tier:\s*(.*?)(?=\s[DCBAS] tier:|$)', s.strip()):
        spell = spell.strip()
        tiers[rank] = None if spell in ('--', '-', '') else spell
    return tiers


def import_units(classes, unit_skills, recruitment, fx):
    tables = parse_tables(load('game8-growth-rates.html'))
    growth_table = next(t for t in tables if t and t[0][:2] == ['Unit', 'HP'])
    units = {}
    order = 0
    for row in growth_table[1:]:
        name = dedupe(row[0])
        uid = slug(name)
        units[uid] = {'id': uid, 'name': name, 'order': order, 'growths': stats_row(row[1:10])}
        order += 1
    for extra in ('long', 'anna', 'solel'):
        units[extra] = {'id': extra, 'name': extra.title(), 'order': order, 'growths': None}
        order += 1

    story_units = {uid for uid, es in recruitment.items() if all(e['method'] == 'story' for e in es)}
    for uid, u in units.items():
        f = fx.get(uid, {})
        u['lord'] = u['name'] in LORDS
        u['faction'] = f.get('faction') if f.get('faction') not in (None, 'None', '--', 'Neutral') else None
        sc = slug(f.get('startingClass') or '')
        u['startingClass'] = sc if sc in classes else None
        us = unit_skills.get(uid, {})
        u['personalSkill'] = us.get('personal')
        u['levelSkills'] = sorted(us.get('level', []), key=lambda x: x['level'] or 0)
        u['bloodmarks'] = us.get('bloodmarks', [])
        u['aptitudes'] = {'favored': f.get('favored', []), 'unfavored': f.get('unfavored', [])}
        u['magic'] = f.get('magic')
        u['baseStats'] = f.get('baseStats')
        u['baseLevel'] = f.get('baseLevel') if u['baseStats'] else None
        u['recruitment'] = recruitment.get(uid, [])
        u['spoiler'] = 2 if uid in ('long', 'anna', 'solel') else 1 if uid in story_units else 0
        u['notes'] = []
        if not u['recruitment']:
            u['notes'].append('Recruitment details have not been documented yet.')
        if uid == 'mu' and f.get('growths'):
            bonus = {u['growths'][k] - f['growths'][k] for k in STATS}
            if bonus == {20}:
                u['notes'] = ['Growths shown include Signs of Growth (+20% to every stat). Her growths without it are 20% lower across the board.']
                continue
        if u['growths'] and f.get('growths') and f['growths'] != u['growths']:
            diff = {k: (u['growths'][k], f['growths'][k]) for k in STATS if u['growths'][k] != f['growths'][k]}
            report.append(f'growth mismatch for {u["name"]} (game8, fextralife): {diff}')
            u['notes'].append('Sources disagree on some growth rates: ' + ', '.join(
                f'{k.upper()} {a}% (Game8) vs {b}% (Fextralife)' for k, (a, b) in diff.items())
                + '. Game8 values are shown.')
        if not u['personalSkill']:
            report.append(f'no personal skill for {u["name"]}')
    return units


def apply_overrides(collections):
    path = os.path.join(OUT, 'overrides.json')
    if not os.path.exists(path):
        return
    with open(path) as f:
        overrides = json.load(f)
    for coll, items in overrides.items():
        if coll.startswith('_'):
            continue
        for oid, patch in items.items():
            target = collections[coll].get(oid)
            if target is None:
                report.append(f'override for unknown {coll} id {oid}')
                continue
            target.update(patch)


def main():
    classes = import_classes()
    growth_rows = next(t for t in parse_tables(load('game8-growth-rates.html')) if t and t[0][:2] == ['Unit', 'HP'])
    KNOWN_NAMES.extend([dedupe(r[0]) for r in growth_rows[1:]] + ['Long', 'Anna', 'Solel']
                       + [c['name'] for c in classes.values()])
    skills, unit_skills = import_skills(classes)
    recruitment = import_recruitment()
    paralogues = import_paralogues()
    fx = import_fextralife()
    units = import_units(classes, unit_skills, recruitment, fx)
    collections = {'units': units, 'classes': classes, 'skills': skills,
                   'paralogues': {p['id']: p for p in paralogues}}
    apply_overrides(collections)

    os.makedirs(OUT, exist_ok=True)

    def dump(name, data):
        with open(os.path.join(OUT, name), 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')

    dump('routes.json', ROUTES)
    dump('units.json', sorted(units.values(), key=lambda u: u['order']))
    dump('classes.json', list(classes.values()))
    dump('skills.json', sorted(skills.values(), key=lambda s: (s['type'], s['name'])))
    dump('paralogues.json', list(collections['paralogues'].values()))
    with open(os.path.join(OUT, 'import-report.txt'), 'w') as f:
        f.write('\n'.join(report) + '\n')
    print(f'{len(units)} units, {len(classes)} classes, {len(skills)} skills, {len(paralogues)} paralogues')
    print(f'{len(report)} report lines -> data/import-report.txt')


if __name__ == '__main__':
    main()
