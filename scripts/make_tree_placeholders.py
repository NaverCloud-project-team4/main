"""Placeholder art for "나만의 나무" (2.5D layered tree) in frontend/public/tree-assets/.

Every image is a stand-in: overwrite a file with final art of the same name, size and
anchor and the page picks it up (paths live only in frontend/src/lib/treeAssets.js).
Slot anchors live in frontend/src/lib/treeAnchors.json; this script writes that file only
when it is missing or with --write-anchors, so hand-tuned anchors are never overwritten.

    .venv/Scripts/python scripts/make_tree_placeholders.py [--write-anchors] [--only trees items bg fx]
"""

import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend/public/tree-assets"
ANCHORS = ROOT / "frontend/src/lib/treeAnchors.json"
PAPER = ROOT / "frontend/public/map-assets/paper-texture.webp"

CANVAS = 1024
BASE = (512, 940)  # trunk foot on every tree layer
INK = (91, 74, 58)
SPECIES = ("maple", "ginkgo", "cherry", "xmas")
STAGES = ("sprout", "sapling", "young", "grown")
STAGES_FILE = ROOT / "frontend/src/lib/treeStages.json"
STAGE_DATA = json.loads(STAGES_FILE.read_text(encoding="utf-8"))
STAGE_SCALE = {"sprout": 0.55, "sapling": 0.72, "young": 0.88, "grown": 1.0}  # item size factor
TRUNK = (110, 78, 52)
BARK = (78, 54, 36)
SOIL = (122, 92, 62)
BAMBOO = (186, 158, 98)
ITEM_BOX = {"topper": (256, 256), "branch": (192, 192), "ground": (384, 256)}


# ---------- stage geometry and anchors (from treeStages.json) ----------

def stage_of(stage):
    return STAGE_DATA["stages"][stage]


def tree_height(stage):
    return CANVAS * stage_of(stage)["height"]


def to_px(stage, fx, fy):
    """Fractions of the tree height (from the trunk foot) → canvas pixels."""
    h = tree_height(stage)
    return BASE[0] + fx * h, BASE[1] - fy * h


def xmas_tiers(stage):
    """Christmas-tree needle tiers from the tip down: [(top_y, bottom_y, half_width)]. 2 → 5 tiers by stage."""
    index = STAGES.index(stage)
    count = STAGE_DATA["species"]["xmas"]["tiers"][index]
    cone, h = STAGE_DATA["xmasCone"], tree_height(stage)
    base, half_width, overlap = cone["base"][index], cone["halfWidth"][index], cone["overlap"][index]
    span = 1 - base
    tiers = []
    for i in range(count):
        top = 1 - i * span / count
        bottom = max(base, 1 - (i + overlap) * span / count)
        # Each tier flares out past the one above, so the tiers read as steps (2 → 5 by stage).
        tiers.append((BASE[1] - top * h, BASE[1] - bottom * h, half_width * h * ((i + 1) / count) ** 0.75))
    return tiers


def xmas_slots(stage):
    """Ornament spots on the tips of the needle tiers (never in mid-air)."""
    tiers = xmas_tiers(stage)
    n, inset = len(tiers), STAGE_DATA["xmasCone"]["tipInset"]
    pick = lambda i: min(max(i, 0), n - 1)  # noqa: E731

    def tip(i, side):
        top, bottom, half = tiers[pick(i)]
        return BASE[0] + side * half * inset, bottom - 8

    low = n - 1 if n <= 3 else n - 2  # ornaments hang down, so skip the lowest tier on tall trees
    return {
        "branch-1": (*tip(low - 1, -1), "mid"), "branch-2": (*tip(low, 1), "front"),
        "branch-3": (*tip(low, -1), "front"), "branch-4": (*tip(low - 2, 1), "mid"),
        "topper": (BASE[0], tiers[0][0] + 30, "front"),  # the star overlaps the tip a little and stays on the canvas
    }


def anchors_for(species, stage):
    s = STAGE_SCALE[stage]
    h = tree_height(stage)
    if species == "xmas":
        spots = xmas_slots(stage)
    else:
        spots = {slot: (*to_px(stage, fx, fy), layer) for slot, (fx, fy, layer) in stage_of(stage)["slots"].items()}
    slot = lambda x, y, scale, layer: {"x": round(x), "y": round(y), "scale": round(scale, 3), "layer": layer}  # noqa: E731
    slots = {name: slot(x, y, s * (0.8 if name == "topper" else 1), layer) for name, (x, y, layer) in spots.items()}
    slots["ground"] = slot(BASE[0] + max(150, 0.4 * h), BASE[1] + 6, 0.4 + s * 0.5, "ground")
    slots["background"] = slot(0, 0, 1, "background")
    return {"crown": [BASE[0], round(BASE[1] - h), round(h * 0.8), round(h)], "slots": slots}


def build_anchors():
    return {
        "canvas": CANVAS,
        "base": list(BASE),
        "itemBox": {k: list(v) for k, v in ITEM_BOX.items()},
        "itemAnchor": {"topper": "bottom", "branch": "top", "ground": "bottom", "background": "fill"},
        "trees": {sp: {st: anchors_for(sp, st) for st in STAGES} for sp in SPECIES},
    }


# ---------- drawing helpers ----------

def ink_outline(layer, strength=150, width=3):
    """Thin warm-ink outline from the layer's own alpha (watercolor + ink look)."""
    alpha = layer.getchannel("A")
    edge = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(width)), alpha)
    edge = edge.point(lambda v: min(255, v * strength // 100))
    outline = Image.new("RGBA", layer.size, INK + (0,))
    outline.putalpha(edge)
    return Image.alpha_composite(outline, layer)


def soften(layer, blur=1.4):
    """Watercolor bleed: blur colour and alpha a little, then add pigment speckle."""
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    speckle = Image.effect_noise(layer.size, 28).point(lambda v: 255 - abs(v - 128) // 3)
    r, g, b, a = layer.split()
    r, g, b = (ImageChops.multiply(c, speckle) for c in (r, g, b))
    return Image.merge("RGBA", (r, g, b, a))


def new_layer():
    return Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))


def save(layer, name):
    """Transparent art is saved as WebP with alpha (≈10× smaller than PNG for watercolor texture)."""
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    layer.save(path, "WEBP", quality=82, method=6, alpha_quality=90)


# ---------- trees: a different silhouette per stage ----------

def hex_rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def colours(species, stage):
    """Back, front, highlight colours: green → autumn colour by the stage's ripeness (maple, ginkgo)."""
    data = STAGE_DATA["species"][species]
    green, ripe = [hex_rgb(c) for c in data["green"]], [hex_rgb(c) for c in data["ripe"]]
    t = data.get("ripeness", [0, 0, 0, 0])[STAGES.index(stage)]
    return [mix(g, r, t) for g, r in zip(green, ripe)]


def leaf(draw, kind, x, y, r, angle, colour):
    """One leaf in the species' own shape (maple star, ginkgo fan, cherry oval)."""
    if kind == "maple":
        pts = [(x + math.cos(angle + i * math.pi / 5) * (r if i % 2 == 0 else r * 0.45),
                y + math.sin(angle + i * math.pi / 5) * (r if i % 2 == 0 else r * 0.45)) for i in range(10)]
        draw.polygon(pts, fill=colour + (245,))
    elif kind == "ginkgo":
        start = math.degrees(angle) - 60
        draw.pieslice((x - r, y - r, x + r, y + r), start, start + 120, fill=colour + (245,))
    else:
        pts = [(x + math.cos(angle) * r * math.cos(a) - math.sin(angle) * r * 0.55 * math.sin(a),
                y + math.sin(angle) * r * math.cos(a) + math.cos(angle) * r * 0.55 * math.sin(a)) for a in [i * math.tau / 24 for i in range(24)]]
        draw.polygon(pts, fill=colour + (245,))


def blossom(draw, x, y, r, rng):
    for i in range(5):
        a = i * math.tau / 5 + rng.random()
        px, py = x + math.cos(a) * r * 0.55, y + math.sin(a) * r * 0.55
        draw.ellipse((px - r * 0.5, py - r * 0.5, px + r * 0.5, py + r * 0.5), fill=(250, 206, 220, 250))
    draw.ellipse((x - r * 0.22, y - r * 0.22, x + r * 0.22, y + r * 0.22), fill=(236, 140, 160, 255))


def tapered(draw, x1, y1, x2, y2, w1, w2, colour):
    """A trunk or limb as a tapered quad from (x1, y1) width w1 to (x2, y2) width w2."""
    dx, dy = x2 - x1, y2 - y1
    length = math.hypot(dx, dy) or 1
    nx, ny = -dy / length, dx / length
    draw.polygon([(x1 + nx * w1 / 2, y1 + ny * w1 / 2), (x2 + nx * w2 / 2, y2 + ny * w2 / 2),
                  (x2 - nx * w2 / 2, y2 - ny * w2 / 2), (x1 - nx * w1 / 2, y1 - ny * w1 / 2)], fill=colour + (255,))


def mound(draw, width, height):
    bx, by = BASE
    draw.pieslice((bx - width, by - height, bx + width, by + height), 180, 360, fill=SOIL + (255,))


def draw_deciduous(species, stage, layers, rng):
    back, trunk, front = layers
    db, dt, df = (ImageDraw.Draw(layer) for layer in layers)
    st, kind = stage_of(stage), STAGE_DATA["species"][species]["leaf"]
    back_c, front_c, light_c = colours(species, stage)
    bloom = STAGE_DATA["species"][species].get("bloom", [0, 0, 0, 0])[STAGES.index(stage)]
    h = tree_height(stage)
    bx, by = BASE

    if stage == "sprout":  # no stem: two seed leaves out of a little soil mound
        mound(dt, 70, 26)
        dt.line([(bx, by - 18), (bx, by - h * 0.45)], fill=(98, 138, 62, 255), width=6)
        for i, (fx, fy, size, tilt) in enumerate(st["cotyledons"]):
            x, y = to_px(stage, fx, fy)
            leaf(db if i == 0 else df, "cherry", x, y, size * h, math.radians(tilt), back_c if i == 0 else front_c)
        return

    trunk_w = st["trunkWidth"]
    top = to_px(stage, 0, st["trunkTop"])
    if "roots" in st["props"]:  # roots showing at the foot
        for side in (-1, 1):
            for spread in (0.9, 1.6):
                tapered(dt, bx, by - 14, bx + side * trunk_w * spread, by + 8, trunk_w * 0.5, 4, TRUNK)
    tapered(dt, bx, by, top[0], top[1], trunk_w, trunk_w * (0.35 if stage == "sapling" else 0.5), TRUNK)
    if "bark" in st["props"]:  # bark grain
        for i in range(-2, 3):
            x = bx + i * trunk_w * 0.18
            dt.line([(x, by - 10), (x + rng.uniform(-4, 4), top[1] + 30)], fill=BARK + (150,), width=3)
    for x1, y1, x2, y2 in st["limbs"]:
        (ax, ay), (cx, cy) = to_px(stage, x1, y1), to_px(stage, x2, y2)
        tapered(dt, ax, ay, cx, cy, max(4, trunk_w * 0.45), max(2, trunk_w * 0.14), TRUNK)

    if stage == "sapling":  # 5-8 single leaves, sparse; support stake tied with string
        size = st["leafSize"] * h
        for i, (fx, fy) in enumerate(st["leaves"]):
            x, y = to_px(stage, fx, fy)
            draw = db if i % 3 == 2 else df
            colour = mix(front_c, light_c, rng.random() * 0.4) if draw is df else back_c
            leaf(draw, kind, x, y, size * rng.uniform(0.85, 1.1), rng.uniform(0, math.tau), colour)
            if bloom and rng.random() < bloom * 2:
                blossom(df, x + size * 0.4, y - size * 0.3, size * 0.55, rng)
        stake_x = bx - 30
        df.line([(stake_x, by + 4), (stake_x + 3, by - h * 0.72)], fill=BAMBOO + (255,), width=6)
        tie = by - h * 0.5
        df.line([(stake_x, tie), (bx, tie)], fill=(232, 222, 196, 255), width=3)
        df.ellipse((bx - 5, tie - 5, bx + 5, tie + 5), outline=(232, 222, 196, 255), width=2)
        return

    # young / grown: separate leaf clumps (young keeps a visible gap between them)
    density = st["density"]
    for fx, fy, fr in st["clumps"]:
        x, y = to_px(stage, fx, fy)
        r = fr * h
        blob = r * 0.42
        for layer_draw, colour, scale, count in ((db, back_c, 1.0, 60), (df, front_c, 0.86, 36)):
            for _ in range(int(count * density)):
                a, d = rng.uniform(0, math.tau), math.sqrt(rng.random())
                px, py = x + math.cos(a) * r * scale * d, y + math.sin(a) * r * 0.85 * scale * d + (r * 0.12 if layer_draw is df else 0)
                br = blob * rng.uniform(0.55, 1.0)
                if bloom and rng.random() < bloom:  # cherry: blossoms take over the green leaves as it blooms
                    shade = mix(hex_rgb("#f2b4c6"), hex_rgb("#fde2ea"), rng.random())
                else:
                    shade = mix(colour, light_c, rng.random() * 0.25) if layer_draw is df else colour
                layer_draw.ellipse((px - br, py - br, px + br, py + br), fill=shade + (rng.randint(200, 240),))
        if kind != "cherry":  # a few single leaves on the rim so the shape reads as foliage, not a ball
            for _ in range(int(8 * density)):
                a = rng.uniform(0, math.tau)
                leaf(df, kind, x + math.cos(a) * r * 0.95, y + math.sin(a) * r * 0.8, blob * 0.55, a, light_c)


def draw_xmas(stage, layers, rng):
    back, trunk, front = layers
    db, dt, df = (ImageDraw.Draw(layer) for layer in layers)
    back_c, front_c, light_c = colours("xmas", stage)
    tiers = xmas_tiers(stage)
    bx, by = BASE
    trunk_w = max(8, stage_of(stage)["trunkWidth"] * 0.6)
    if stage == "sprout":
        mound(dt, 60, 22)
    tapered(dt, bx, by, bx, tiers[-1][1] - 4, trunk_w, trunk_w * 0.7, TRUNK)
    for i, (top, bottom, half) in enumerate(tiers):
        shade = mix(back_c, light_c, i / max(1, len(tiers) - 1) * 0.25)
        db.polygon([(bx, top - 4), (bx - half, bottom), (bx + half, bottom)], fill=shade + (250,))
        inner = half * 0.84
        zigzag = [(bx, top + 14)]
        steps = 6
        for k in range(steps + 1):  # ragged needle edge along the bottom of the front tier
            x = bx - inner + 2 * inner * k / steps
            zigzag.append((x, bottom - 4 - (10 if k % 2 else 0)))
        df.polygon(zigzag, fill=mix(front_c, light_c, rng.random() * 0.3) + (225,))


def draw_tree(species, stage, anchors):
    rng = random.Random(f"{species}-{stage}")
    layers = (new_layer(), new_layer(), new_layer())
    if species == "xmas":
        draw_xmas(stage, layers, rng)
    else:
        draw_deciduous(species, stage, layers, rng)
    back, trunk, front = layers
    # Punch soft-edged gaps through the front leaves where "mid" ornaments hang.
    s = STAGE_SCALE[stage]
    gaps = Image.new("L", front.size, 255)
    for name, slot in anchors["trees"][species][stage]["slots"].items():
        if name.startswith("branch") and slot["layer"] == "mid":
            hx, hy, hr = slot["x"], slot["y"] + 90 * s, 78 * s
            ImageDraw.Draw(gaps).ellipse((hx - hr, hy - hr, hx + hr, hy + hr), fill=0)
    front.putalpha(ImageChops.multiply(front.getchannel("A"), gaps.filter(ImageFilter.GaussianBlur(10))))
    # Falling leaves, ground litter and the contact shadow are drawn by the page (particles / shadow layer).
    for layer, name in ((back, "back"), (trunk, "trunk"), (front, "front")):
        art = ink_outline(soften(layer, 1.4 if name != "trunk" else 0.8))
        save(art, f"trees/{species}-{stage}-{name}.webp")


def draw_shadow():
    img = Image.new("L", (768, 192), 0)
    ImageDraw.Draw(img).ellipse((84, 60, 684, 132), fill=150)
    img = img.filter(ImageFilter.GaussianBlur(18))
    out = Image.new("RGBA", img.size, (92, 66, 44, 0))
    out.putalpha(img)
    save(out, "shadow.webp")


# ---------- items ----------

def canvas_for(group):
    return Image.new("RGBA", ITEM_BOX[group], (0, 0, 0, 0))


def hang(draw, w, y):
    draw.line([(w / 2, 0), (w / 2, y)], fill=INK + (220,), width=3)


def star(draw, cx, cy, r, color):
    pts = [(cx + math.cos(-math.pi / 2 + i * math.pi / 5) * (r if i % 2 == 0 else r * 0.45),
            cy + math.sin(-math.pi / 2 + i * math.pi / 5) * (r if i % 2 == 0 else r * 0.45)) for i in range(10)]
    draw.polygon(pts, fill=color)


ITEMS = {}


def item(item_id, group):
    def register(fn):
        ITEMS[item_id] = (group, fn)
        return fn
    return register


@item("star", "topper")
def _(d, w, h): star(d, w / 2, h * 0.55, 100, (244, 196, 64, 255))
@item("ribbon", "topper")
def _(d, w, h):
    d.polygon([(w / 2, h * 0.7), (40, h * 0.42), (52, h * 0.95)], fill=(204, 58, 58, 255))
    d.polygon([(w / 2, h * 0.7), (w - 40, h * 0.42), (w - 52, h * 0.95)], fill=(204, 58, 58, 255))
    d.ellipse((w / 2 - 22, h * 0.62, w / 2 + 22, h * 0.8), fill=(170, 40, 40, 255))
@item("bird", "topper")
def _(d, w, h):
    d.ellipse((60, 110, 190, 220), fill=(150, 104, 70, 255))
    d.ellipse((150, 84, 210, 144), fill=(150, 104, 70, 255))
    d.polygon([(206, 112), (238, 120), (206, 128)], fill=(236, 170, 60, 255))
    d.ellipse((182, 100, 192, 110), fill=(30, 24, 20, 255))
@item("ornament", "branch")
def _(d, w, h):
    hang(d, w, 60)
    d.ellipse((46, 56, 146, 156), fill=(204, 52, 52, 255))
    d.ellipse((70, 76, 92, 98), fill=(255, 220, 220, 200))
@item("fairy-lights", "branch")
def _(d, w, h):
    pts = [(10 + i * 34, 30 + 40 * math.sin(i / 1.6)) for i in range(6)]
    d.line(pts, fill=INK + (220,), width=3)
    for x, y in pts:
        d.ellipse((x - 11, y - 11, x + 11, y + 11), fill=(255, 226, 120, 255))
@item("cheongsachorong", "branch")
def _(d, w, h):
    hang(d, w, 40)
    d.rectangle((56, 40, 136, 96), fill=(46, 82, 160, 255))
    d.rectangle((56, 96, 136, 150), fill=(196, 44, 44, 255))
    d.rectangle((70, 150, 122, 160), fill=(220, 180, 70, 255))
@item("maple-mobile", "branch")
def _(d, w, h):
    hang(d, w, 150)
    for i, y in enumerate((50, 95, 140)):
        star(d, w / 2 + (-30 if i % 2 else 30), y, 26, (214, 72, 40, 255))
@item("cherry-ribbon", "branch")
def _(d, w, h):
    hang(d, w, 60)
    d.polygon([(w / 2, 90), (40, 60), (46, 120)], fill=(240, 150, 180, 255))
    d.polygon([(w / 2, 90), (w - 40, 60), (w - 46, 120)], fill=(240, 150, 180, 255))
    d.line([(w / 2, 90), (70, 170)], fill=(240, 150, 180, 255), width=10)
@item("gotgam", "branch")
def _(d, w, h):
    hang(d, w, 170)
    for y in (46, 86, 126, 166):
        d.ellipse((w / 2 - 22, y - 20, w / 2 + 22, y + 20), fill=(222, 120, 40, 255))
@item("gift", "ground")
def _(d, w, h):
    d.rectangle((120, 120, 264, 250), fill=(196, 52, 52, 255))
    d.rectangle((182, 120, 202, 250), fill=(244, 206, 90, 255))
    d.rectangle((110, 104, 274, 130), fill=(176, 40, 40, 255))
@item("snowman", "ground")
def _(d, w, h):
    d.ellipse((132, 120, 252, 250), fill=(250, 250, 248, 255))
    d.ellipse((152, 50, 232, 130), fill=(250, 250, 248, 255))
    d.polygon([(192, 88), (226, 96), (192, 102)], fill=(236, 130, 50, 255))
@item("leaf-pile", "ground")
def _(d, w, h):
    rng = random.Random(7)
    for _ in range(70):
        x, y = 70 + rng.random() * 244, 170 + rng.random() * 80
        star(d, x, y, 16, (210 + rng.randint(-20, 20), 90 + rng.randint(-30, 40), 40, 255))
@item("bench", "ground")
def _(d, w, h):
    for y in (130, 160):
        d.rectangle((60, y, 324, y + 20), fill=(150, 104, 66, 255))
    d.rectangle((60, 196, 324, 214), fill=(130, 88, 56, 255))
    for x in (80, 290):
        d.rectangle((x, 214, x + 16, 252), fill=(110, 76, 50, 255))
@item("squirrel", "ground")
def _(d, w, h):
    d.ellipse((120, 60, 220, 250), fill=(176, 104, 56, 255))
    d.ellipse((190, 130, 280, 250), fill=(150, 88, 50, 255))
    d.ellipse((240, 110, 300, 170), fill=(150, 88, 50, 255))
    d.ellipse((268, 126, 278, 136), fill=(30, 24, 20, 255))
@item("mushroom", "ground")
def _(d, w, h):
    d.rectangle((176, 170, 208, 252), fill=(244, 236, 220, 255))
    d.pieslice((120, 110, 264, 230), 180, 360, fill=(204, 56, 48, 255))
    for x, y in ((160, 150), (200, 136), (230, 156)):
        d.ellipse((x - 9, y - 9, x + 9, y + 9), fill=(255, 250, 240, 255))


def draw_items():
    for item_id, (group, fn) in ITEMS.items():
        img = canvas_for(group)
        fn(ImageDraw.Draw(img), *img.size)
        save(ink_outline(soften(img, 0.8), 120, 3), f"items/{item_id}.webp")


# ---------- backgrounds ----------

def gradient(top, bottom):
    img = Image.new("RGB", (CANVAS, CANVAS))
    d = ImageDraw.Draw(img)
    for y in range(CANVAS):
        t = y / (CANVAS - 1)
        d.line([(0, y), (CANVAS, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


def paper_wash(img, amount=0.35):
    paper = Image.open(PAPER).convert("RGB").resize((CANVAS, CANVAS))
    return Image.blend(img, ImageChops.multiply(img, paper), amount)


def draw_backgrounds():
    bgs = {
        "bg-hanji": gradient((246, 240, 226), (238, 228, 206)),
        "bg-autumn-dusk": gradient((250, 196, 140), (226, 120, 96)),
        "bg-snow-night": gradient((34, 44, 82), (82, 96, 138)),
        "bg-spring-river": gradient((226, 238, 236), (196, 222, 214)),
        "bg-summer-night": gradient((20, 46, 52), (44, 84, 78)),
    }
    d = ImageDraw.Draw(bgs["bg-autumn-dusk"])
    d.ellipse((620, 520, 820, 720), fill=(252, 226, 170))
    d.polygon([(0, 820), (300, 700), (620, 780), (1024, 690), (1024, 1024), (0, 1024)], fill=(176, 92, 70))
    d = ImageDraw.Draw(bgs["bg-snow-night"])
    d.ellipse((760, 110, 860, 210), fill=(240, 236, 216))
    d.polygon([(0, 860), (400, 780), (1024, 840), (1024, 1024), (0, 1024)], fill=(226, 232, 240))
    d = ImageDraw.Draw(bgs["bg-spring-river"])
    d.polygon([(0, 760), (1024, 690), (1024, 830), (0, 900)], fill=(150, 190, 206))
    d.polygon([(0, 900), (1024, 830), (1024, 1024), (0, 1024)], fill=(170, 206, 150))
    d = ImageDraw.Draw(bgs["bg-summer-night"])
    rng = random.Random(3)
    for _ in range(60):
        x, y = rng.random() * CANVAS, rng.random() * 600
        d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(240, 240, 200))
    d.polygon([(0, 850), (512, 790), (1024, 860), (1024, 1024), (0, 1024)], fill=(30, 60, 46))
    for item_id, img in bgs.items():
        path = OUT / "bg" / f"{item_id}.webp"
        path.parent.mkdir(parents=True, exist_ok=True)
        paper_wash(img.filter(ImageFilter.GaussianBlur(2))).save(path, "WEBP", quality=82, method=6)


# ---------- effect particles (used in step 4) ----------

def draw_fx():
    fx = {
        "snow": lambda d: d.ellipse((18, 18, 46, 46), fill=(255, 255, 255, 235)),
        "petal": lambda d: d.ellipse((14, 22, 50, 42), fill=(248, 182, 204, 235)),
        "leaf": lambda d: star(d, 32, 32, 24, (214, 92, 40, 235)),
        "firefly": lambda d: d.ellipse((22, 22, 42, 42), fill=(250, 244, 150, 255)),
    }
    # Tree particles: falling leaves and ground litter, green or ripe by the stage's ripeness.
    for species in ("maple", "ginkgo"):
        green, ripe = STAGE_DATA["species"][species]["green"][1], STAGE_DATA["species"][species]["ripe"][1]
        for tone, colour in (("green", green), ("ripe", ripe)):
            fx[f"leaf-{species}-{tone}"] = lambda d, s=species, c=hex_rgb(colour): leaf(d, s, 32, 32, 24, -math.pi / 2, c)
    fx["petal-cherry"] = lambda d: leaf(d, "cherry", 32, 32, 20, 0.6, hex_rgb("#f6bccc"))
    for name, fn in fx.items():
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        fn(ImageDraw.Draw(img))
        if name == "firefly":
            glow = img.filter(ImageFilter.GaussianBlur(8))
            img = Image.alpha_composite(glow, img)
        save(img.filter(ImageFilter.GaussianBlur(0.6)), f"fx/{name}.webp")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-anchors", action="store_true", help="Regenerate treeAnchors.json (overwrites hand tuning)")
    parser.add_argument("--only", nargs="*", choices=["trees", "items", "bg", "fx"])
    args = parser.parse_args()
    if args.write_anchors or not ANCHORS.exists():
        ANCHORS.write_text(json.dumps(build_anchors(), indent=1) + "\n", encoding="utf-8")
        print(f"wrote {ANCHORS.relative_to(ROOT)}")
    anchors = json.loads(ANCHORS.read_text(encoding="utf-8"))
    parts = set(args.only or ["trees", "items", "bg", "fx"])
    if "trees" in parts:
        for sp in SPECIES:
            for st in STAGES:
                draw_tree(sp, st, anchors)
        draw_shadow()
    if "items" in parts:
        draw_items()
    if "bg" in parts:
        draw_backgrounds()
    if "fx" in parts:
        draw_fx()
    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"{OUT.relative_to(ROOT)}: {sum(1 for p in OUT.rglob('*') if p.is_file())} files, {total / 1024:.0f} KB")
