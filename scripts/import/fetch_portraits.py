"""Downloads unit and class icons from Game8.

Usage: python3 scripts/import/fetch_portraits.py [--force]

Unit icons go to src/assets/portraits/<unit id>.webp and class icons to
src/assets/classes/<class id>.webp. Image URLs come from the cached Game8 pages
in .cache/sources/ (the icon's alt text is the unit or class name). Icons are
shrunk and saved as WebP with Pillow; without Pillow the original PNG is kept.
Existing files are skipped unless --force is passed.
"""
import json
import os
import re
import sys
import urllib.request
from io import BytesIO

try:
    from PIL import Image
except ImportError:
    Image = None

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, '.cache', 'sources')
ASSETS = os.path.join(ROOT, 'src', 'assets')

# (label, data file, output folder, source pages, max width)
SETS = [
    # Source unit icons are 334x270; the avatar crops to the face, so 200 covers 64px at 2x.
    ('units', 'units.json', 'portraits', ['game8-characters.html', 'game8-recruitment.html', 'game8-growth-rates.html'], 200),
    # Source class icons are about 104px square and shown at up to 40px.
    ('classes', 'classes.json', 'classes', ['game8-classes.html', 'game8-abilities.html'], 96),
]

IMG = re.compile(r"<img[^>]*alt='([^']*)'[^>]*data-src='(https://img\.game8\.co/[^']+)'")


def fetch_set(label, data_file, folder, pages, width, force):
    with open(os.path.join(ROOT, 'data', data_file), encoding='utf-8') as f:
        by_name = {x['name'].lower(): x['id'] for x in json.load(f)}

    urls = {}
    for page in pages:
        with open(os.path.join(SRC, page), encoding='utf-8', errors='ignore') as f:
            for alt, src in IMG.findall(f.read()):
                xid = by_name.get(alt.strip().lower())
                if xid:
                    urls.setdefault(xid, src)

    out_dir = os.path.join(ASSETS, folder)
    os.makedirs(out_dir, exist_ok=True)
    ext = 'webp' if Image else 'png'
    for xid, url in sorted(urls.items()):
        path = os.path.join(out_dir, f'{xid}.{ext}')
        if os.path.exists(path) and not force:
            continue
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        if Image:
            img = Image.open(BytesIO(data)).convert('RGBA')
            if img.width > width:
                img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
            img.save(path, 'WEBP', quality=82, method=6)
        else:
            with open(path, 'wb') as out:
                out.write(data)
        print('fetched', folder, xid)

    missing = sorted(set(by_name.values()) - set(urls))
    print(f'{len(urls)} {label} have icons; missing: {", ".join(missing) or "none"}')


def main():
    force = '--force' in sys.argv
    for label, data_file, folder, pages, width in SETS:
        fetch_set(label, data_file, folder, pages, width, force)


if __name__ == '__main__':
    main()
