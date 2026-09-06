"""
Builds the Persian user guide into one self-contained HTML file.

`docs/guide-fa.template.html` is the authored document; every screenshot in it is a
`{{img:name}}` placeholder. This inlines each one as a data URI, so the finished guide is
a single file that can be emailed, opened from a USB stick, or published as-is — nobody
receiving it has to also receive an images folder.

Screenshots are UI, not photographs: a small palette of flat colours and a lot of text.
Quantising to a 200-colour PNG keeps the text crisp while cutting the payload by about
four fifths, which JPEG cannot do without smearing the type.

    python scripts/build-guide.py
"""

import base64
import io
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, 'docs', 'guide-fa.template.html')
IMAGES = os.path.join(ROOT, 'docs', 'images')
OUTPUT = os.path.join(ROOT, 'docs', 'guide-fa.html')

MAX_WIDTH = 720
COLORS = 200


def encode(name: str) -> str:
    path = os.path.join(IMAGES, f'{name}.png')
    if not os.path.exists(path):
        raise SystemExit(f'missing screenshot: {path}\nRun `npm run docs:shots` first.')

    image = Image.open(path).convert('RGB')
    if image.width > MAX_WIDTH:
        image = image.resize((MAX_WIDTH, round(image.height * MAX_WIDTH / image.width)),
                             Image.LANCZOS)

    buffer = io.BytesIO()
    image.quantize(colors=COLORS, method=Image.MEDIANCUT).save(buffer, 'PNG', optimize=True)
    data = base64.b64encode(buffer.getvalue()).decode('ascii')
    return f'data:image/png;base64,{data}', buffer.tell(), os.path.getsize(path)


def main() -> None:
    html = io.open(TEMPLATE, encoding='utf-8').read()

    used, before, after = [], 0, 0

    def replace(match: 're.Match[str]') -> str:
        nonlocal before, after
        name = match.group(1)
        uri, packed, original = encode(name)
        used.append(name)
        before += original
        after += packed
        return uri

    html = re.sub(r'\{\{img:([a-z0-9-]+)\}\}', replace, html)

    leftover = re.findall(r'\{\{[^}]+\}\}', html)
    if leftover:
        raise SystemExit(f'unresolved placeholders: {sorted(set(leftover))}')

    io.open(OUTPUT, 'w', encoding='utf-8', newline='\n').write(html)

    size = os.path.getsize(OUTPUT)
    print(f'{len(used)} screenshots inlined')
    print(f'  images {before / 1024 / 1024:.2f} MB -> {after / 1024 / 1024:.2f} MB')
    print(f'  {os.path.relpath(OUTPUT, ROOT)}  {size / 1024 / 1024:.2f} MB')

    # The Artifact ceiling is 16 MB for the rendered page.
    if size > 15 * 1024 * 1024:
        print('  ! close to the 16 MB publish limit', file=sys.stderr)


main()
