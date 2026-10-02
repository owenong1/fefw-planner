"""Downloads unit icons from Game8 into src/assets/portraits/<unit id>.webp.

Usage: python3 scripts/import/fetch_portraits.py [--force]

Image URLs come from the cached Game8 pages in .cache/sources/ (the icon's alt
text is the unit name). Icons are shrunk and saved as WebP with Pillow; without
Pillow the original PNG is kept.
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
OUT = os.path.join(ROOT, 'src', 'assets', 'portraits')
PAGES = ['game8-characters.html', 'game8-recruitment.html', 'game8-growth-rates.html']
WIDTH = 200  # source icons are 334x270; the avatar crops to the face, so this covers 64px at 2x

IMG = re.compile(r"<img[^>]*alt='([^']*)'[^>]*data-src='(https://img\.game8\.co/[^']+)'")


def main():
    force = '--force' in sys.argv
    with open(os.path.join(ROOT, 'data', 'units.json'), encoding='utf-8') as f:
        by_name = {u['name'].lower(): u['id'] for u in json.load(f)}

    urls = {}
    for page in PAGES:
        with open(os.path.join(SRC, page), encoding='utf-8', errors='ignore') as f:
            for alt, src in IMG.findall(f.read()):
                uid = by_name.get(alt.strip().lower())
                if uid:
                    urls.setdefault(uid, src)

    os.makedirs(OUT, exist_ok=True)
    ext = 'webp' if Image else 'png'
    for uid, url in sorted(urls.items()):
        path = os.path.join(OUT, f'{uid}.{ext}')
        if os.path.exists(path) and not force:
            continue
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
        if Image:
            img = Image.open(BytesIO(data)).convert('RGBA')
            img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
            img.save(path, 'WEBP', quality=82, method=6)
        else:
            with open(path, 'wb') as out:
                out.write(data)
        print('fetched', uid)

    missing = sorted(set(by_name.values()) - set(urls))
    print(f'{len(urls)} units have icons; missing: {", ".join(missing) or "none"}')


if __name__ == '__main__':
    main()
