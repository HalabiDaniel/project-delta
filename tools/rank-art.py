"""v0.0.17: small copies of the developer's rank insignia for the game (assets/ranks/web/).

The originals in assets/ranks/ are kept as they were given; the game draws insignia at most
160 px tall, so it loads copies no larger than 256 px. Run after adding or changing art:

    python3 tools/rank-art.py
"""
import pathlib
from PIL import Image

SRC = pathlib.Path(__file__).resolve().parent.parent / 'assets' / 'ranks'
OUT = SRC / 'web'
OUT.mkdir(exist_ok=True)
for f in sorted(SRC.glob('*.png')):
    im = Image.open(f).convert('RGBA')
    box = im.getbbox()
    if box:
        # Keep a little margin for the drop shadow.
        pad = 6
        im = im.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(im.width, box[2] + pad), min(im.height, box[3] + pad)))
    im.thumbnail((256, 256), Image.LANCZOS)
    im.save(OUT / f.name, optimize=True)
    print(f.name, im.size)
