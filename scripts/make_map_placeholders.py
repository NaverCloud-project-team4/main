"""Generate placeholder watercolor map assets in frontend/public/map-assets/.

Replace any output with a final asset of the same file name and format; the
frontend only refers to these names (see frontend/public/map-assets/README.md).

    .venv/Scripts/python scripts/make_map_placeholders.py [--only paper-texture.webp ...]
"""

import argparse
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

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


TREE_SIZE = (512, 640)
TREE_BASE = 0.94  # trunk foot sits at 94% of the height, horizontally centred


def maple_source():
    """The existing rendered maple, cropped and placed on the shared 512x640 canvas."""
    source = Image.open(ROOT / "frontend/public/images/autumn-maple-tree.png").convert("RGBA")
    source = source.crop(source.getbbox())
    width = TREE_SIZE[0] - 16
    height = round(source.height * width / source.width)
    source = source.resize((width, height), Image.LANCZOS)
    canvas = Image.new("RGBA", TREE_SIZE, (0, 0, 0, 0))
    canvas.paste(source, ((TREE_SIZE[0] - width) // 2, round(TREE_SIZE[1] * TREE_BASE) - height), source)
    return canvas


def tree_maple():
    maple_source().save(OUT / "tree-maple.png", optimize=True)


def tree_ginkgo():
    """Placeholder ginkgo: the maple with its red/orange foliage shifted to ginkgo yellow."""
    tree = maple_source()
    alpha = tree.getchannel("A")
    h, s, v = tree.convert("RGB").convert("HSV").split()
    # Saturated, bright pixels are foliage; the darker trunk keeps its brown.
    mask = Image.eval(s, lambda x: 255 if x > 110 else 0)
    mask = ImageChops.multiply(mask, Image.eval(v, lambda x: 255 if x > 90 else 0))
    shifted = Image.eval(h, lambda x: 34 if (x < 30 or x > 230) else x)
    h = Image.composite(shifted, h, mask)
    s = Image.composite(Image.eval(s, lambda x: int(x * 0.9)), s, mask)
    v = Image.composite(Image.eval(v, lambda x: min(255, int(x * 1.12))), v, mask)
    rgb = Image.merge("HSV", [h, s, v]).convert("RGB")
    rgb.putalpha(alpha)
    rgb.save(OUT / "tree-ginkgo.png", optimize=True)


def tree_shadow():
    shadow = Image.new("L", (256, 64), 0)
    ImageDraw.Draw(shadow).ellipse((28, 18, 228, 46), fill=120)
    shadow = shadow.filter(ImageFilter.GaussianBlur(7))
    image = Image.new("RGBA", (256, 64), (92, 66, 44, 0))
    image.putalpha(shadow)
    image.save(OUT / "tree-shadow.png", optimize=True)


def leaf(name, color, kind, seed):
    rng = random.Random(seed)
    size = 64
    image = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cx, cy = size * 2, size * 2
    if kind == "maple":
        points = []
        for i in range(10):
            angle = -math.pi / 2 + i * math.pi / 5
            radius = (size * 1.5 if i % 2 == 0 else size * 0.62) * (1 + rng.uniform(-0.08, 0.08))
            points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
        draw.polygon(points, fill=color)
        draw.line((cx, cy, cx, cy + size * 1.6), fill=(110, 60, 30, 255), width=6)
    else:
        draw.pieslice((cx - size * 1.5, cy - size * 1.2, cx + size * 1.5, cy + size * 1.8), 200, 340, fill=color)
        draw.line((cx, cy + size * 0.3, cx, cy + size * 1.5), fill=(150, 120, 40, 255), width=6)
    image = image.rotate(rng.uniform(-40, 40), resample=Image.BICUBIC).resize((size, size), Image.LANCZOS)
    image.save(OUT / name, optimize=True)


LEAVES = {
    "leaf-maple-1.png": ((196, 52, 32, 235), "maple"),
    "leaf-maple-2.png": ((222, 104, 40, 235), "maple"),
    "leaf-maple-3.png": ((168, 40, 30, 235), "maple"),
    "leaf-ginkgo-1.png": ((236, 188, 52, 235), "ginkgo"),
    "leaf-ginkgo-2.png": ((214, 160, 40, 235), "ginkgo"),
}

ASSETS = {
    "paper-texture.webp": paper_texture,
    "pigment-grain.png": pigment_grain,
    "tree-maple.png": tree_maple,
    "tree-ginkgo.png": tree_ginkgo,
    "tree-shadow.png": tree_shadow,
    **{name: (lambda name=name, spec=spec, i=i: leaf(name, spec[0], spec[1], i)) for i, (name, spec) in enumerate(LEAVES.items())},
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", choices=sorted(ASSETS), help="Regenerate just these files")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for name in args.only or ASSETS:
        ASSETS[name]()
        print(f"{name}: {(OUT / name).stat().st_size / 1024:.1f} KB")
