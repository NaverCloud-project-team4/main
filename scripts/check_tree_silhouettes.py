"""Check that growth stages differ in shape, not only in size.

Each stage's silhouette (back + trunk + front alpha) is cropped and scaled to the same height,
then compared with the other stages of the same species by IoU. Exits non-zero when two
stages overlap more than MAX_IOU, e.g. after replacing art with a scaled copy.

    .venv/Scripts/python scripts/check_tree_silhouettes.py
"""

import sys
from itertools import combinations
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
TREES = ROOT / "frontend/public/tree-assets/trees"
SPECIES = ("maple", "ginkgo", "cherry", "xmas")
STAGES = ("sprout", "sapling", "young", "grown")
SIZE = 256
MAX_IOU = 0.75  # adjacent stages scaled to the same height must not match more than this


def silhouette(species, stage):
    alpha = None
    for part in ("back", "trunk", "front"):
        layer = Image.open(TREES / f"{species}-{stage}-{part}.webp").getchannel("A").point(lambda v: 255 if v > 40 else 0)
        alpha = layer if alpha is None else ImageChops.lighter(alpha, layer)
    alpha = alpha.crop(alpha.getbbox())
    width = max(1, round(alpha.width * SIZE / alpha.height))
    scaled = alpha.resize((width, SIZE))
    canvas = Image.new("L", (max(SIZE, width), SIZE), 0)
    canvas.paste(scaled, ((canvas.width - width) // 2, 0))
    return canvas.crop(((canvas.width - SIZE) // 2, 0, (canvas.width + SIZE) // 2, SIZE)) if canvas.width > SIZE else canvas


def iou(a, b):
    inter = ImageChops.multiply(a, b).histogram()[255]
    union = ImageChops.lighter(a, b).histogram()[255]
    return inter / union if union else 1.0


if __name__ == "__main__":
    failures = []
    for species in SPECIES:
        shapes = {stage: silhouette(species, stage) for stage in STAGES}
        row = []
        for a, b in combinations(STAGES, 2):
            value = iou(shapes[a], shapes[b])
            row.append(f"{a[:2]}-{b[:2]} {value:.2f}")
            if STAGES.index(b) - STAGES.index(a) == 1 and value > MAX_IOU:
                failures.append(f"{species} {a}→{b} IoU {value:.2f} > {MAX_IOU}")
        print(f"{species:7s} " + "  ".join(row))
    if failures:
        print("Stages too similar:\n  " + "\n  ".join(failures))
        sys.exit(1)
    print(f"OK: adjacent stages differ (IoU ≤ {MAX_IOU} at equal height)")
