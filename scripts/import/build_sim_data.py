#!/usr/bin/env python3
"""Rebuild the growth simulator's data (src/sim/data/*.json) from public Fortune's Weave data sources.

Only needed to refresh the data (the wikis are still being filled in); the
simulator itself reads the generated JSON and needs nothing but Node.

Sources
  Serenes Forest   character + class growth rates, weapon tables
  Game8            growth rates (cross-check), class pages, weapon/magic lists,
                   character skill preferences, abilities and spell lists
  Fire Emblem Wiki character base stats, boss stats, chapter enemy stats

Usage
  python3 scripts/import/build_sim_data.py            # use cached pages where present
  python3 scripts/import/build_sim_data.py --refresh  # re-download everything

src/sim/data/mechanics.json is hand-maintained and is never touched by this script.
"""
import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, '.cache', 'sim')
DATA = os.path.join(ROOT, 'src', 'sim', 'data')
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')
REFRESH = '--refresh' in sys.argv

G8 = 'https://game8.co/games/Fire-Emblem-Fortunes-Weave/archives/'
SF = 'https://serenesforest.net/fortunes-weave/'
WIKI_API = 'https://fireemblemwiki.org/w/api.php'

STATS = ['hp', 'str', 'mag', 'spd', 'dex', 'def', 'res', 'lck', 'cha']
G8_GROWTH_PAGE = '618974'
G8_WEAPON_PAGES = {
    'sword': '621071', 'spear': '621072', 'axe': '621073', 'bow': '621074',
    'gauntlet': '621076', 'black': '621078', 'white': '621077',
}
SF_WEAPON_PAGES = {
    'sword': 'swords', 'spear': 'spears', 'axe': 'axes', 'bow': 'bows',
    'gauntlet': 'gauntlets',
}

# Advanced classes that only one or two Part I paths can unlock (Game8 class
# change guide). Classes not listed are available on every path.
ROUTE_LOCKS = {
    'Caladrius': ['cai'], 'Blacksmith': ['dietrich'], 'Cataphract': ['theodora'],
    'Dancer': ['leda'], 'Dragoon': ['cai', 'theodora'],
    'Guardian': ['dietrich', 'theodora'], 'Ranger': ['dietrich', 'leda'],
    'Troubadour': ['cai', 'leda'],
}

# Magic has no listed skill rank on Game8. These ranks follow the spell lists
# on character pages (Fire D, Thunder C, Bolganone B, Thoron A; Heal D,
# Nosferatu C, Seraphim B) and are otherwise an assumption.
MAGIC_RANKS = {
    'Fire': 'E', 'Wind': 'E', 'Blizzard': 'D', 'Miasma Δ': 'D', 'Thunder': 'C',
    'Cutting Gale': 'C', 'Bolganone': 'B', 'Ice Blade': 'B', 'Thoron': 'A',
    'Excalibur': 'A', 'Sagittae': 'A', 'Nosferatu': 'C', 'Seraphim': 'B',
    'Aura': 'A',
}


# ---------------------------------------------------------------- fetching

def cache_path(key):
    return os.path.join(CACHE, re.sub(r'[^A-Za-z0-9._-]+', '_', key))


def fetch(url, key):
    path = cache_path(key)
    if os.path.exists(path) and os.path.getsize(path) > 0 and not REFRESH:
        with open(path, encoding='utf-8', errors='ignore') as f:
            return f.read()
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode('utf-8', errors='ignore')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)
    return text


def fetch_many(jobs):
    """jobs: list of (url, key). Returns {key: text}; failures are reported."""
    out = {}

    def one(job):
        try:
            return job[1], fetch(*job)
        except Exception as e:  # noqa: BLE001 - report and keep going
            print(f'  ! failed {job[0]}: {e}', file=sys.stderr)
            return job[1], None

    with ThreadPoolExecutor(max_workers=6) as ex:
        for key, text in ex.map(one, jobs):
            out[key] = text
    return out


def wiki_api(**params):
    params['format'] = 'json'
    url = WIKI_API + '?' + urllib.parse.urlencode(params)
    # The readable part is cut short, so the hash is what keeps two long title lists apart.
    query = urllib.parse.urlencode(sorted(params.items()))
    return json.loads(fetch(url, 'wiki_api_%s_%s.json' % (query[:120], hashlib.sha1(query.encode()).hexdigest()[:10])))


def wiki_category(cat):
    titles, cont = [], {}
    while True:
        d = wiki_api(action='query', list='categorymembers', cmtitle=cat, cmlimit=500, **cont)
        titles += [m['title'] for m in d['query']['categorymembers']]
        if 'continue' not in d:
            return titles
        cont = {'cmcontinue': d['continue']['cmcontinue']}


def wiki_embeds(template):
    """Every page that uses a template, whatever category it is filed under."""
    titles, cont = [], {}
    while True:
        d = wiki_api(action='query', list='embeddedin', eititle='Template:' + template, eilimit=500, einamespace=0, **cont)
        titles += [m['title'] for m in d['query']['embeddedin']]
        if 'continue' not in d:
            return titles
        cont = {'eicontinue': d['continue']['eicontinue']}


def wiki_text(titles):
    out = {}
    for i in range(0, len(titles), 40):
        d = wiki_api(action='query', prop='revisions', rvprop='content', rvslots='main',
                     titles='|'.join(titles[i:i + 40]), redirects=1)
        for page in d['query']['pages'].values():
            if 'revisions' in page:
                out[page['title']] = page['revisions'][0]['slots']['main']['*']
    return out


# ------------------------------------------------------------ html parsing

class Blocks(HTMLParser):
    """Flatten a page into ('h', text) / ('table', rows) / ('p', text) blocks."""

    def __init__(self):
        super().__init__()
        self.blocks, self.skip = [], 0
        self.rows = self.row = self.cell = self.head = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.skip += 1
        elif tag == 'table':
            self.depth += 1
            if self.depth == 1:
                self.rows = []
        elif tag == 'tr' and self.depth == 1:
            self.row = []
        elif tag in ('td', 'th') and self.depth == 1:
            self.cell = []
        elif tag in ('h1', 'h2', 'h3', 'h4'):
            self.head = []

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.skip = max(0, self.skip - 1)
        elif tag == 'table':
            if self.depth == 1 and self.rows is not None:
                self.blocks.append(('table', self.rows))
                self.rows = None
            self.depth = max(0, self.depth - 1)
        elif tag in ('td', 'th') and self.depth == 1 and self.cell is not None and self.row is not None:
            self.row.append(' '.join(' '.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.depth == 1 and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        elif tag in ('h1', 'h2', 'h3', 'h4') and self.head is not None:
            self.blocks.append(('h', ' '.join(' '.join(self.head).split())))
            self.head = None

    def handle_data(self, data):
        if self.skip:
            return
        if self.cell is not None:
            self.cell.append(data)
        elif self.head is not None:
            self.head.append(data)
        elif self.depth == 0 and data.strip():
            self.blocks.append(('p', data.strip()))


def blocks(html_text):
    p = Blocks()
    p.feed(html_text)
    return p.blocks


def tables(html_text):
    return [b[1] for b in blocks(html_text) if b[0] == 'table']


def num(x, default=None):
    x = (x or '').strip().replace('−', '-')
    m = re.fullmatch(r'[+-]?\d+', x)
    return int(x) if m else default


def norm(name):
    name = name.lower().replace('’', "'").replace('gautnlets', 'gauntlets')
    return re.sub(r'[^a-z0-9+]+', '', name)


def growth_table_rows(tbls, label=None):
    """Rows of every 'Name|HP|Str|...' style table as {name: {stat: value}}.

    `label` restricts to tables whose first header cell matches (Game8 heads
    its tables 'Unit' or 'Class').
    """
    out = {}
    for t in tbls:
        if not t or len(t[0]) < 10 or t[0][1].strip().lower() != 'hp':
            continue
        if label and t[0][0].strip().lower() != label:
            continue
        for row in t:
            if len(row) < 10 or row[1].strip().lower() == 'hp':
                continue
            # Game8 repeats the name (icon alt + text); cells are text only here.
            out[row[0].strip()] = {s: num(v, 0) for s, v in zip(STATS, row[1:10])}
    return out


# ------------------------------------------------------- growths (SF + G8)

def g8_index(html_text):
    """Map link text -> archive id for every Game8 link on the growth page."""
    idx = {}
    for m in re.finditer(r'<a[^>]*href=["\']?[^"\' >]*archives/(\d+)["\']?[^>]*>(.*?)</a>', html_text, re.S):
        text = ' '.join(re.sub(r'<[^>]+>', ' ', m.group(2)).replace('&#39;', "'").replace('&amp;', '&').split())
        if text:
            idx.setdefault(text, m.group(1))
    return idx


def load_growths():
    g8_html = fetch(G8 + G8_GROWTH_PAGE, 'g8_' + G8_GROWTH_PAGE + '.html')
    g8_tables = tables(g8_html)
    g8_chars = growth_table_rows(g8_tables, 'unit')
    g8_class = growth_table_rows(g8_tables, 'class')
    index = g8_index(g8_html)

    sf_char_tables = tables(fetch(SF + 'characters/growth-rates/', 'sf_char_growths.html'))
    sf_class = growth_table_rows(tables(fetch(SF + 'classes/growth-rates/', 'sf_class_growths.html')))
    # The first Serenes table holds playable units; the second holds guests/NPCs.
    sf_chars = growth_table_rows(sf_char_tables[:1])

    sf_class.pop('Noble', None)  # NPC-only class with no published data
    return sf_chars, g8_chars, sf_class, g8_class, index


# ------------------------------------------------------------------ classes

TYPE_FLAGS = (('flier', 'flying'), ('flying', 'flying'), ('cavalry', 'cavalry'),
              ('armor', 'armored'), ('infantry', 'infantry'))
WEAPON_WORDS = (('black magic', 'black'), ('white magic', 'white'), ('sword', 'sword'),
                ('spear', 'spear'), ('axe', 'axe'), ('bow', 'bow'), ('gauntlet', 'gauntlet'))
ABILITY_RE = re.compile(
    r'When equipped with (?:an? )?(sword|spear|axe|bow|gauntlets?|black magic|white magic)s?, grants '
    r'(Hit|Crit|Avo) ?\+ ?(\d+)', re.I)
STRIKE_LAST_RE = re.compile(r'If foe attacks first, grants (Prt|Rsl|Shld) ?\+ ?(\d+)', re.I)
STRIKE_FIRST_RE = re.compile(r'If unit attacks first, grants (Atk|Prt|Rsl|Shld|AS|Hit|Crit|Avo) ?\+ ?(\d+)', re.I)


def parse_skills(text):
    return [{'skill': s.strip(), 'rank': r}
            for s, r in re.findall(r'([A-Z][a-z]+(?: [A-Z][a-z]+)?) Skill \(([A-ES]\+?)\)', text or '')]


def parse_ability(name, text):
    """Turn simple, always-on class abilities into numeric combat modifiers."""
    m = ABILITY_RE.search(text)
    if m:
        weapon = m.group(1).lower().rstrip('s')
        weapon = {'black magic': 'black', 'white magic': 'white'}.get(weapon, weapon)
        return {'when': 'equipped', 'weapon': weapon, 'stat': m.group(2).lower(), 'value': int(m.group(3))}
    m = STRIKE_LAST_RE.search(text)
    if m:
        return {'when': 'foeInitiates', 'stat': m.group(1).lower(), 'value': int(m.group(2))}
    m = STRIKE_FIRST_RE.search(text)
    if m:
        return {'when': 'unitInitiates', 'stat': m.group(1).lower(), 'value': int(m.group(2))}
    return None


def parse_class_page(name, html_text):
    bl = blocks(html_text)
    info = {'name': name, 'abilities': []}
    stats_done = False
    heading = ''
    for kind, val in bl:
        if kind == 'h':
            heading = val
            m = re.search(r'Exclusive to (Female|Male) Units', val)
            if m:
                info['gender'] = m.group(1).lower()
            continue
        if kind != 'table':
            continue
        rows = {r[0].strip(): r[1].strip() for r in val if len(r) >= 2}
        if 'License' in rows and 'exam' not in info:
            info['exam'] = {
                'license': rows['License'],
                'level': num(rows.get('Ideal Lv.')),
                'renown': num(rows.get('Renown Lv.')),
                'primary': parse_skills(rows.get('Primary Skill')),
                'secondary': parse_skills(rows.get('Secondary Skill')),
            }
        elif 'Tier' in rows and 'tier' not in info:
            info['tier'] = rows['Tier'].lower()
            type_text = rows.get('Type', '').lower()
            info['typeText'] = rows.get('Type', '')
            info['types'] = sorted({flag for word, flag in TYPE_FLAGS if word in type_text})
            info['mov'] = num(rows.get('Movement'))
            wtext = rows.get('Weapons', '').lower()
            info['weapons'] = [w for word, w in WEAPON_WORDS if word in wtext]
        elif val and val[0][:3] == ['Stat', 'Bonus', 'Growth'] and not stats_done:
            key = {'HP': 'hp'}
            info['bonus'] = {key.get(r[0], r[0].lower()): num(r[1], 0) for r in val[1:] if len(r) >= 3}
            info['growthsG8Page'] = {key.get(r[0], r[0].lower()): num(r[2], 0) for r in val[1:] if len(r) >= 3}
            stats_done = True
        elif val and val[0] and val[0][0] == 'Skill EXP Bonus' and len(val) > 1 and 'skillExp' not in info:
            # "Sword +2, Axe +3, ..." - the largest weapon bonus marks the class's main weapon.
            info['skillExp'] = {k.strip().lower(): int(v) for k, v in re.findall(r'([A-Za-z ]+?) \+(\d+)', val[1][0])}
        elif heading in ('Class Ability', 'Master Ability') and len(info['abilities']) < 12:
            for r in val:
                if len(r) >= 2 and r[1] and r[1] != 'TBD':
                    ab = {'name': r[0], 'text': r[1], 'kind': 'class' if heading == 'Class Ability' else 'master'}
                    if any(a['name'] == ab['name'] for a in info['abilities']):
                        continue
                    effect = parse_ability(r[0], r[1])
                    if effect:
                        ab['effect'] = effect
                    info['abilities'].append(ab)
    return info


def build_classes(sf_class, g8_class, index):
    # Serenes Forest order first, then anything only Game8 lists.
    names = list(sf_class) + [n for n in g8_class if n not in sf_class]
    jobs = [(G8 + index[n], f'g8_{index[n]}.html') for n in names if n in index]
    pages = fetch_many(jobs)
    out = []
    for n in names:
        zero = {s: 0 for s in STATS}
        c = {'name': n, 'tier': None, 'types': ['infantry'], 'mov': 4, 'weapons': [],
             'bonus': dict(zero), 'abilities': []}
        page = pages.get(f'g8_{index[n]}.html') if n in index else None
        if page:
            c.update(parse_class_page(n, page))
        growths_page = c.pop('growthsG8Page', None)
        alt = g8_class.get(n) or growths_page
        c['growths'] = sf_class.get(n) or alt
        if alt and alt != c['growths']:
            c['growthsGame8'] = alt
        if n not in sf_class:
            c['growthsSource'] = 'game8'
        if n == 'Commoner':
            # No Game8 page: base class, every starting unit wields its own weapon type.
            c.update(tier='base', weapons=[w for _, w in WEAPON_WORDS], types=['infantry'], mov=4)
        if n in ROUTE_LOCKS:
            c['routes'] = ROUTE_LOCKS[n]
        if not c['weapons']:
            c['unsupported'] = 'no usable weapon list published (innate attack only)'
        if not c.get('types'):
            c['types'] = ['infantry']
        out.append(c)
    return out


# ------------------------------------------------------------------ weapons

def parse_range(text):
    m = re.fullmatch(r'\s*(\d+)(?:\s*-\s*(\d+))?\s*', text or '')
    if not m:
        return None
    lo = int(m.group(1))
    return [lo, int(m.group(2) or lo)]


def parse_effective(desc):
    eff = {}
    for m in re.finditer(r'Effective ?(\+)? ?vs\.? ([A-Za-z]+)', desc or '', re.I):
        target = m.group(2).lower()
        target = {'armor': 'armored', 'armour': 'armored', 'mounted': 'cavalry', 'mount': 'cavalry',
                  'fliers': 'flying', 'flier': 'flying'}.get(target, target)
        eff[target] = 3 if m.group(1) else 2
    return eff


HEAL_RE = re.compile(r'Restores (a little |a lot of )?HP|Heals allies', re.I)
# Published without a Might value; "restores a little HP" (less than Heal's 10).
HEAL_POWER_GUESS = {'Laia': 5}


def build_weapons():
    weapons = {}
    heals = {}
    for wtype, pid in G8_WEAPON_PAGES.items():
        for t in tables(fetch(G8 + pid, f'g8_{pid}.html')):
            if not t or t[0][:2] != ['Weapon', 'Might']:
                continue
            cur = None
            for row in t[1:]:
                if len(row) >= 8:
                    rank = re.search(r'%s ([A-ES]\+?)' % {'black': 'Black Magic', 'white': 'White Magic'}.get(wtype, wtype.title()), row[7])
                    cur = {'name': row[0].strip(), 'type': wtype, 'mt': num(row[1]), 'hit': num(row[4]),
                           'crit': num(row[5]), 'wt': num(row[6]), 'range': parse_range(row[3]),
                           'uses': num(row[2]), 'rank': rank.group(1) if rank else None}
                    weapons[norm(cur['name'])] = cur
                elif cur is not None and row and row[0].startswith('Description'):
                    cur['desc'] = row[0].split(':', 1)[-1].strip()
                    if wtype == 'white' and HEAL_RE.search(cur['desc']):
                        power = cur['mt'] if cur['mt'] is not None else HEAL_POWER_GUESS.get(cur['name'])
                        if power is not None and cur['uses']:
                            heal = {'name': cur['name'], 'power': power, 'uses': cur['uses'], 'range': cur['range'],
                                    'desc': cur['desc']}
                            if cur['mt'] is None:
                                heal['powerSource'] = 'assumed'
                            if 'allies within range' in cur['desc']:
                                heal['area'] = True
                            heals[cur['name']] = heal
    # Serenes Forest: physical weapon tables (no Crit column, no magic).
    for wtype, slug in SF_WEAPON_PAGES.items():
        for t in tables(fetch(SF + f'weapons-items/{slug}/', f'sf_{slug}.html')):
            if not t or t[0][:2] != ['Name', 'Mt']:
                continue
            for row in t[1:]:
                if len(row) < 8 or num(row[1]) is None:
                    continue
                key = norm(row[0])
                w = weapons.setdefault(key, {'name': row[0].replace('Gautnlets', 'Gauntlets').replace('’', "'"),
                                             'type': wtype, 'crit': None, 'uses': num(row[6])})
                # Serenes Forest's standard lines are internally consistent where
                # Game8 has typos (e.g. Bronze Spear Mt 9), so it wins on conflict.
                sf_vals = {'mt': num(row[1]), 'hit': num(row[2]), 'wt': num(row[3]), 'range': parse_range(row[4])}
                for k, v in sf_vals.items():
                    if v is None:
                        continue
                    if w.get(k) is not None and w[k] != v:
                        w.setdefault('game8', {})[k] = w[k]
                    w[k] = v
                if not w.get('rank'):
                    m = re.search(r'([A-ES]\+?)\s*$', row[5].strip())
                    w['rank'] = m.group(1) if m else None
                w.setdefault('desc', row[7])
                m = re.search(r'Crit\+(\d+)', row[7])
                if m and not w.get('crit'):
                    w['crit'] = int(m.group(1))
    out = []
    for w in weapons.values():
        if w.get('mt') is None or w.get('hit') is None or w.get('range') is None:
            continue  # staves, utility magic, or stats still unpublished
        desc = w.get('desc', '') or ''
        w['crit'] = w.get('crit') or 0
        w['wt'] = w.get('wt') or 0
        eff = parse_effective(desc)
        if w['type'] == 'spear':
            eff.setdefault('cavalry', 2)   # every spear: 2x Might vs cavalry
        if w['type'] == 'bow':
            eff.setdefault('flying', 3)    # every bow: 3x Might vs fliers
        w['effective'] = eff
        w['magical'] = w['type'] in ('black', 'white') or 'Treated as a magical attack' in desc
        if w['type'] in ('black', 'white'):
            w['rank'] = MAGIC_RANKS.get(w['name'], w.get('rank'))
            if 'based on foe\'s Prt' in desc:
                w['targets'] = 'prt'
        m = re.search(r'Avo\+(\d+)', desc)
        if m:
            w['avo'] = int(m.group(1))
        if 'Strikes 2 times' in desc:
            w['strikes'] = 2
        out.append(w)
    out.sort(key=lambda w: (w['type'], w['mt'], w['name']))
    return out, sorted(heals.values(), key=lambda h: (h['power'], h['name']))


# --------------------------------------------------------------- wiki stats

def find_templates(text, name):
    out, i = [], 0
    while True:
        j = text.find('{{' + name, i)
        if j < 0:
            return out
        depth, k = 0, j
        while k < len(text):
            if text.startswith('{{', k):
                depth += 1
                k += 2
            elif text.startswith('}}', k):
                depth -= 1
                k += 2
                if depth == 0:
                    break
            else:
                k += 1
        out.append((j, text[j + 2:k - 2]))
        i = k


def split_params(body):
    parts, depth, cur, i = [], 0, '', 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ('{{', '[['):
            depth += 1
            cur += two
            i += 2
        elif two in ('}}', ']]'):
            depth -= 1
            cur += two
            i += 2
        elif body[i] == '|' and depth == 0:
            parts.append(cur)
            cur = ''
            i += 1
        else:
            cur += body[i]
            i += 1
    parts.append(cur)
    params = {}
    for p in parts[1:]:
        if '=' in p:
            k, v = p.split('=', 1)
            params[k.strip()] = v.strip()
    return params


def stat_value(raw, extras=True):
    """'{{Personal|29|5}}{{h|+6|...}}' -> (total shown in game, class bonus part).

    `extras` adds item/ability bonuses the wiki shows as tooltips: wanted for
    enemies (that is what you fight), not for a recruit's personal base.
    """
    if not raw:
        return None, 0
    bonus = 0
    m = re.search(r'\{\{Personal\|(\d+)\|(-?\d+)\}\}', raw)
    if m:
        total, bonus = int(m.group(1)), int(m.group(2))
    else:
        m = re.match(r'\s*(\d+)', raw)
        if not m:
            return None, 0
        total = int(m.group(1))
    if extras:
        for extra in re.findall(r'\{\{h\|\+(\d+)\|', raw):
            total += int(extra)
    return total, bonus


def items(raw):
    return [i.strip() for i in re.findall(r'\{\{[Ii]tem\|18\|([^|}]+)', raw or '')]


def parse_unit(params, extras=True):
    stats, bonus = {}, {}
    for s in STATS:
        raw = params.get(s) or params.get(s.upper()) or (params.get('HP') if s == 'hp' else None)
        total, b = stat_value(raw, extras)
        if total is not None:
            stats[s] = total
            bonus[s] = b
    cls = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', params.get('class', '')).strip()
    bld, _ = stat_value(params.get('bld'), extras)
    lv = num(re.sub(r'\D.*', '', params.get('lv', '')))
    return {'class': cls, 'level': lv, 'bld': bld, 'stats': stats, 'classBonus': bonus,
            'inventory': items(params.get('inventory')) + items(params.get('spells'))}


def tab_label(text, pos):
    """Difficulty/scenario tab a template sits in (best effort)."""
    start = text.rfind('{{Tab', 0, pos)
    if start < 0:
        return None
    seg = text[start:pos]
    idx = [int(n) for n in re.findall(r'\|content(\d+)=', seg)]
    if not idx:
        return None
    m = re.search(r'\|tab%d=([^\n|]+)' % idx[-1], seg)
    return m.group(1).strip() if m else None


def build_from_wiki(char_names):
    playable = wiki_category("Category:Playable characters in Fire Emblem: Fortune's Weave")
    stat_pages = wiki_category("Category:Fortune's Weave stat pages")
    enemies = wiki_category("Category:Enemies in Fire Emblem: Fortune's Weave")
    chapters = wiki_category("Category:Chapters of Fire Emblem: Fortune's Weave")
    by_name = sorted(char_names) + [n + " (Fortune's Weave)" for n in sorted(char_names)]
    # Boss and chapter pages are not all categorised yet, so also take every page that carries a stat table.
    stat_tables = [t for name in ('BossStats FE18', 'ChapUnitCellFE18', 'CharStats FE18') for t in wiki_embeds(name)]
    enemies = sorted(set(enemies + [t for t in stat_tables if t not in playable + stat_pages + chapters]))
    texts = wiki_text(sorted(set(playable + stat_pages + enemies + chapters + stat_tables + by_name)))

    def char_key(title):
        return re.sub(r'\s*\(.*\)$', '', title.split('/')[0])

    bases, genders = {}, {}
    for title, text in texts.items():
        name = char_key(title)
        if name not in char_names:
            continue
        m = re.search(r'\|gender=\s*(Male|Female)', text)
        if m and '/' not in title:
            genders[name] = m.group(1).lower()
        for _, body in find_templates(text, 'CharStats FE18'):
            params = split_params(body)
            unit = parse_unit(params, extras=False)
            if len(unit['stats']) == len(STATS) and unit['level'] and name not in bases:
                recruit = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', params.get('recruit', ''))
                unit['recruit'] = re.sub(r'<[^>]+>|\{\{[^}]*\}\}', '', recruit).strip()
                bases[name] = unit

    observed = []
    for title, text in texts.items():
        for pos, body in find_templates(text, 'ChapUnitCellFE18'):
            params = split_params(body)
            unit = parse_unit(params)
            if not unit['stats'] or not unit['class'] or not unit['level']:
                continue
            unit.update(name=re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', params.get('name', '?')),
                        boss=False, chapter=title, tab=tab_label(text, pos), source=f'fireemblemwiki.org/wiki/{title}')
            observed.append(unit)
        for pos, body in find_templates(text, 'BossStats FE18'):
            params = split_params(body)
            unit = parse_unit(params)
            if not unit['stats'] or not unit['class'] or not unit['level']:
                continue
            name = char_key(title) if title in playable + stat_pages + enemies else 'Boss'
            unit.update(name=name, boss=True, chapter=title, tab=tab_label(text, pos),
                        source=f'fireemblemwiki.org/wiki/{title}')
            observed.append(unit)
    # Anyone the wiki's chapter list links to as a chapter boss is a boss, even
    # when their stats were only recorded in a chapter's enemy table.
    chapter_list = texts.get("List of chapters in Fire Emblem: Fortune's Weave", '')
    boss_names = {re.sub(r'\s*\(.*\)$', '', m) for m in re.findall(r'\[\[([^\]|#]+)', chapter_list)}
    for unit in observed:
        if unit['name'] in boss_names:
            unit['boss'] = True
    return bases, genders, observed


def clean_observed(observed, class_names, char_names):
    out, seen = [], {}
    for u in observed:
        if u['class'] not in class_names:
            continue  # unique boss classes we have no class data for
        u['difficulty'] = 'hard' if (u.get('tab') or '').lower() == 'hard' else 'normal'
        # Recruitable lords fought as bosses carry personal skills/relics the
        # generic model should not be calibrated on.
        u['unique'] = u['name'] in char_names
        u.pop('classBonus', None)
        key = (u['name'], u['class'], u['level'], u['difficulty'])
        prev = seen.get(key)
        if prev is None:
            seen[key] = u
            out.append(u)
        elif u['boss'] and not prev['boss']:
            out[out.index(prev)] = u   # the boss page beats the chapter table
            seen[key] = u
        elif not (prev['boss'] and not u['boss']) and len(u['stats']) > len(prev['stats']):
            out[out.index(prev)] = u
            seen[key] = u
    out.sort(key=lambda u: (u['level'] or 0, u['class'], u['name']))
    return out


# --------------------------------------------------------------- characters

def parse_char_page(html_text):
    """Skill preferences, personal and level-up abilities, and the spell list.

    Ability effects stay as the game's own text; src/abilities.js turns the
    ones it understands into numbers.
    """
    info = {'preferred': [], 'nonIdeal': [], 'abilities': []}
    spells = {}
    heading = ''
    for kind, val in blocks(html_text):
        if kind == 'h':
            heading = val
            continue
        if kind != 'table':
            continue
        for row in val:
            if len(row) >= 2 and row[0] in ('Preferred Skills', 'Non-Ideal Skills'):
                skills = [s.strip() for s in re.findall(r'([A-Z][a-z]+(?: [A-Z][a-z]+)?) Skill', row[1])]
                info['preferred' if row[0].startswith('Pref') else 'nonIdeal'] = sorted(set(skills))
        if heading == 'Personal Ability' and not any(a['kind'] == 'personal' for a in info['abilities']):
            for row in val:
                if len(row) >= 2 and row[0] and row[1] and row[1] != 'TBD':
                    info['abilities'].append({'name': row[0], 'text': row[1], 'kind': 'personal'})
                    break
        elif heading == 'Abilities Learned By Leveling Up':
            for row in val[1:]:
                if len(row) >= 3 and row[1] and row[1] != 'TBD' and not any(a['name'] == row[0] for a in info['abilities']):
                    # level None = not published yet (late joiners; treated as already learned)
                    info['abilities'].append({'name': row[0], 'text': row[1], 'kind': 'level', 'level': num(row[2])})
        elif heading == 'Magic Spell List' and val and val[0][:1] == ['Skill Level']:
            for row in val[1:]:
                if len(row) < 3 or not re.fullmatch(r'[A-ES]\+?', row[0].strip()):
                    continue
                for school, cell in (('black', row[1]), ('white', row[2])):
                    for name in cell.split('・'):
                        name = name.strip()
                        if name and name != 'TBD':
                            spells.setdefault(school, []).append({'name': name, 'rank': row[0].strip()})
    if spells:
        info['spells'] = spells
    return info


def ols(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else 0.0
    return my - slope * mx, slope


def build_characters(sf_chars, g8_chars, index, classes, bases, genders):
    class_by_name = {c['name']: c for c in classes}
    names = [n for n in g8_chars if n in sf_chars or n in g8_chars]
    pages = fetch_many([(G8 + index[n], f'g8_{index[n]}.html') for n in names if n in index])

    growths = {}
    for n in names:
        g = dict(sf_chars.get(n) or g8_chars[n])
        if n == 'Mu' and 'Mu*' in sf_chars:
            g = dict(sf_chars['Mu*'])  # personal ability Signs of Growth: +20 to every growth
        growths[n] = g

    # Personal stats = in-game stats minus the class's flat bonus (the wiki
    # records both parts).
    personal = {}
    for n, b in bases.items():
        bonus = b['classBonus']
        if not any(bonus.values()):
            bonus = class_by_name.get(b['class'], {}).get('bonus', {})
        personal[n] = {s: b['stats'][s] - bonus.get(s, 0) for s in STATS}

    # Units without published base stats get an estimate: regress Lv1-equivalent
    # personal bases on growth rates over units that join at low level.
    fit = {}
    low = [n for n, b in bases.items() if b['level'] <= 8 and n in growths]
    for s in STATS:
        xs, ys = [], []
        for n in low:
            b = bases[n]
            cg = class_by_name.get(b['class'], {}).get('growths', {}).get(s, 0)
            lv1 = personal[n][s] - (b['level'] - 1) * (growths[n][s] + cg) / 100.0
            xs.append(growths[n][s])
            ys.append(lv1)
        fit[s] = ols(xs, ys)
    blds = sorted(bases[n]['bld'] for n in low if bases[n].get('bld'))
    median_bld = blds[len(blds) // 2] if blds else 2

    out = []
    for n in names:
        c = {'name': n, 'gender': genders.get(n), 'growths': growths[n]}
        alt = g8_chars.get(n)
        if alt and alt != growths[n] and n != 'Mu':
            c['growthsGame8'] = alt
        if n in bases:
            b = bases[n]
            c['base'] = {'level': b['level'], 'class': b['class'], 'bld': b.get('bld') or median_bld,
                         'stats': personal[n], 'source': 'wiki', 'recruit': b.get('recruit', ''),
                         'inventory': b.get('inventory', [])}
        else:
            est = {s: max(0, round(fit[s][0] + fit[s][1] * growths[n][s])) for s in STATS}
            c['base'] = {'level': 1, 'class': 'Commoner', 'bld': median_bld, 'stats': est, 'source': 'estimated'}
        page = pages.get(f'g8_{index[n]}.html') if n in index else None
        if page:
            c.update(parse_char_page(page))
        if n == 'Mu':
            c['notes'] = 'Growths include Signs of Growth (+20 to all growth rates).'
        out.append(c)
    return out, {s: {'intercept': round(a, 3), 'slope': round(b, 4)} for s, (a, b) in fit.items()}, len(low)


# --------------------------------------------------------------------- main

def dump(name, payload):
    path = os.path.join(DATA, name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'  wrote src/sim/data/{name}')


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(DATA, exist_ok=True)
    print('growth rates...')
    sf_chars, g8_chars, sf_class, g8_class, index = load_growths()
    print('classes...')
    classes = build_classes(sf_class, g8_class, index)
    print('weapons...')
    weapons, heals = build_weapons()
    print('wiki base stats and enemies...')
    bases, genders, observed = build_from_wiki(set(g8_chars))
    observed = clean_observed(observed, {c['name'] for c in classes}, set(g8_chars))
    print('characters...')
    characters, base_fit, n_fit = build_characters(sf_chars, g8_chars, index, classes, bases, genders)

    meta = {
        'growths': 'serenesforest.net/fortunes-weave (primary), game8.co growth guide (growthsGame8 where they disagree)',
        'classes': 'game8.co class pages (tier, type, movement, weapons, bonuses, abilities)',
        'weapons': 'game8.co weapon lists, gaps filled from serenesforest.net',
        'abilities': 'game8.co character pages (personal ability, abilities learned by level, spell list)',
        'bases': 'fireemblemwiki.org CharStats; "estimated" bases come from a growth regression over %d low-level units' % n_fit,
        'enemies': 'fireemblemwiki.org chapter and boss pages',
    }
    dump('characters.json', {'sources': meta, 'baseEstimateFit': base_fit, 'characters': characters})
    dump('classes.json', {'sources': meta, 'classes': classes})
    dump('weapons.json', {'sources': meta, 'weapons': weapons, 'heals': heals})
    dump('enemies_observed.json', {'sources': meta, 'enemies': observed})

    wiki_n = sum(1 for c in characters if c['base']['source'] == 'wiki')
    print(f'{len(characters)} characters ({wiki_n} with wiki base stats), {len(classes)} classes, '
          f'{len(weapons)} weapons, {len(observed)} observed enemy stat lines')


if __name__ == '__main__':
    main()
