"""Minimal stdlib HTML helpers: table extraction and visible-text extraction."""
import re
from html.parser import HTMLParser


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.stack, self.cell, self.row = [], [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.stack.append([])
        elif tag == 'tr' and self.stack:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []
        elif tag == 'img' and self.cell is not None:
            alt = dict(attrs).get('alt')
            if alt:
                self.cell.append(alt)
        elif tag == 'br' and self.cell is not None:
            self.cell.append(' / ')

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None and self.row is not None:
            self.row.append(re.sub(r'\s+', ' ', ''.join(self.cell)).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None and self.stack:
            self.stack[-1].append(self.row)
            self.row = None
        elif tag == 'table' and self.stack:
            self.tables.append(self.stack.pop())

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def parse_tables(html):
    p = _TableParser()
    p.feed(html)
    return p.tables


class _TextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'nav'):
            self.skip += 1
        if tag in ('p', 'h2', 'h3', 'h4', 'li', 'br', 'div', 'td', 'th', 'tr'):
            self.out.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'nav'):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def page_text(html):
    p = _TextParser()
    p.feed(html)
    return re.sub(r'\n\s*\n+', '\n', ''.join(p.out))


if __name__ == '__main__':
    import sys
    for i, t in enumerate(parse_tables(open(sys.argv[1], encoding='utf-8', errors='ignore').read())):
        print(f'=== TABLE {i} ({len(t)} rows)')
        for r in t:
            print(' | '.join(r))
