"""Tile every screenshot of a walk into one image, with its click box and pin boxes drawn, to check by eye that each
box sits on the control it names. build_page.py refuses boxes with no size; this catches a box in the wrong place.

    python3 -I sheet.py <walk dir> <out.jpg> [--cols 3] [--tile 520]

Click boxes are blue. Pins are numbered and coloured by kind: red must, orange should, yellow nit, grey note.
A box with no width or height is drawn as a red X with "NO SIZE".
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("sheet.py needs Pillow: python3 -m pip install pillow")

CLICK = (37, 99, 235)
KIND = {"must": (220, 38, 38), "should": (234, 88, 12), "nit": (202, 138, 4), "info": (100, 116, 139)}
LABEL_H = 36


def draw_box(d: ImageDraw.ImageDraw, b: dict, scale: float, color: tuple, width: int, tag: str) -> None:
    x, y = b.get("x", 0) * scale, b.get("y", 0) * scale
    w, h = (b.get("w") or 0) * scale, (b.get("h") or 0) * scale
    if w <= 0 or h <= 0:
        r = 14
        d.line([(x - r, y - r), (x + r, y + r)], fill=KIND["must"], width=4)
        d.line([(x - r, y + r), (x + r, y - r)], fill=KIND["must"], width=4)
        d.text((x + r + 4, y - 8), f"{tag} NO SIZE", fill=KIND["must"])
        return
    d.rectangle([x, y, x + w, y + h], outline=color, width=width)
    if tag:
        d.rectangle([x - 2, y - 18, x + 8 * len(tag) + 6, y], fill=color)
        d.text((x + 2, y - 16), tag, fill=(255, 255, 255))


def tile(walk_dir: Path, st: dict, size: int, font) -> Image.Image:
    shot = Image.open(walk_dir / st["shot"]).convert("RGB")
    scale = shot.width / st["size"][0]
    d = ImageDraw.Draw(shot)
    if st.get("click") is not None:
        draw_box(d, st["click"], scale, CLICK, max(3, round(3 * scale)), "")
    for k, p in enumerate(st["pins"], 1):
        if p.get("box") is not None:
            draw_box(d, p["box"], scale, KIND.get(p["kind"], KIND["info"]), max(2, round(2 * scale)), str(k))
    shot.thumbnail((size, size * 2))
    out = Image.new("RGB", (size, shot.height + LABEL_H), (255, 255, 255))
    out.paste(shot, (0, LABEL_H))
    lab = ImageDraw.Draw(out)
    lab.text((6, 4), f"{st['id']}  {st['change']} · {st['side']} · {st['role']}", fill=(15, 23, 42), font=font)
    lab.text((6, 19), st["caption"][:90], fill=(71, 85, 105), font=font)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("walk_dir", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--tile", type=int, default=520, help="tile width in pixels")
    a = ap.parse_args()
    data = json.loads((a.walk_dir / "walk.json").read_text())
    font = ImageFont.load_default()
    tiles = [tile(a.walk_dir, st, a.tile, font) for st in data["steps"]]
    if not tiles:
        raise SystemExit("no steps in walk.json")
    rows = [tiles[i:i + a.cols] for i in range(0, len(tiles), a.cols)]
    gap = 8
    heights = [max(t.height for t in r) for r in rows]
    sheet = Image.new("RGB", (a.cols * (a.tile + gap) + gap, sum(heights) + gap * (len(rows) + 1)), (226, 232, 240))
    y = gap
    for r, h in zip(rows, heights):
        for c, t in enumerate(r):
            sheet.paste(t, (gap + c * (a.tile + gap), y))
        y += h + gap
    sheet.save(a.out, quality=80)
    print(a.out, f"{len(tiles)} screens", f"{a.out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
