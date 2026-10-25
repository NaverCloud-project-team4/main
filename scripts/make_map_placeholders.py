"""Generate placeholder watercolor map assets in frontend/public/map-assets/.

Replace any output with a final asset of the same file name and format; the
frontend only refers to these names (see frontend/public/map-assets/README.md).

    .venv/Scripts/python scripts/make_map_placeholders.py [--only paper-texture.webp ...]
"""

import argparse
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend/public/map-assets"


def seamless_noise(size, cells, seed, blur=0):
    """Value noise that tiles: noise is wrapped 3x3, resized, then the centre is cropped."""
    rng = random.Random(seed)
    small = Image.new("L", (cells, cells))
    small.putdata([rng.randrange(256) for _ in range(cells * cells)])
    tiled = Image.new("L", (cells * 3, cells * 3))
    for x in range(3):
        for y in range(3):
            tiled.paste(small, (x * cells, y * cells))
    big = tiled.resize((size * 3, size * 3), Image.BICUBIC)
    if blur:
        big = big.filter(ImageFilter.GaussianBlur(blur))
    return big.crop((size, size, size * 2, size * 2))


def octaves(size, seed, layers):
    """Blend several noise frequencies; layers are (cells, weight, blur)."""
    result, seen = None, 0
    for index, (cells, weight, blur) in enumerate(layers):
        layer = seamless_noise(size, cells, seed + index, blur)
        seen += weight
        # Running weighted average: each new layer gets weight / cumulative weight.
        result = layer if result is None else Image.blend(result, layer, weight / seen)
    return result


def paper_texture():
    size = 1024
    fibre = octaves(size, 11, [(8, 4, 6), (32, 3, 2), (128, 2, 0), (512, 1, 0)])
    fibre = fibre.point(lambda v: 128 + (v - 128) * 0.22)
    base = Image.new("RGB", (size, size), (243, 236, 220))
    shade = Image.merge("RGB", [fibre, fibre, fibre.point(lambda v: v - 6)])
    # Soft-light style mix: keeps the off-white tone, adds faint fibre and mottling.
    paper = ImageChops.multiply(base, shade.point(lambda v: min(255, v + 120)))
    paper = Image.blend(base, paper, 0.55)
    paper.save(OUT / "paper-texture.webp", "WEBP", quality=82, method=6)


def pigment_grain():
    size = 512
    grain = octaves(size, 23, [(16, 3, 4), (64, 2, 1), (256, 2, 0)])
    # Uniform dark tone; alpha marks where pigment pools (multiplied over the wash).
    # 16 levels keep the PNG small enough to inline as a data URI in the SVG filter.
    alpha = grain.point(lambda v: max(0, min(255, int((v - 110) * 1.4))) // 16 * 16)
    gray = Image.new("L", (size, size), 60)
    Image.merge("LA", [gray, alpha]).save(OUT / "pigment-grain.png", optimize=True)


ASSETS = {"paper-texture.webp": paper_texture, "pigment-grain.png": pigment_grain}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", choices=sorted(ASSETS), help="Regenerate just these files")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in args.only or ASSETS:
        ASSETS[name]()
        print(f"{name}: {(OUT / name).stat().st_size / 1024:.1f} KB")
