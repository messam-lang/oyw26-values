#!/usr/bin/env python3
"""Rebuild web assets from the client's source SVGs.

Run from the webtool folder:  python3 tools/build_assets.py

Inputs  (source/):
  <Value>.svg   frame files from the client: a 1080x1080 embedded PNG background (identical in every
                frame, with a transparent oval window) + the value icon drawn as <rect> elements in mint.
  1.svg ... 6.svg  the standalone gradient icons used in the legend.

Outputs (assets/):
  frames/frame-bg.png, frames/frame-bg-lossless.webp   shared background (taken from the first frame found)
  icons/<value>-frame.svg   the mint icon in frame coordinates (drawn on top of the background)
  icons/<value>.svg         the gradient legend icon
  frames/frames-config.json placement info

If a frame file is missing or empty (e.g. Action.svg failed to upload), the frame icon is built from the
standalone icon instead and centred in the usual icon slot; the config marks it "placeholder": true.
Drop the real <Value>.svg into source/ and re-run to replace it.
"""
import base64
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source")
OUT_ICONS = os.path.join(ROOT, "assets", "icons")
OUT_FRAMES = os.path.join(ROOT, "assets", "frames")
MINT = "#e7ffd9"

# value id -> (frame file, standalone legend icon). Welcome is the opening-ceremony mark, not a personal value.
VALUES = {
    "community":  ("Community.svg",  "1.svg"),
    "friendship": ("Friendship.svg", "2.svg"),
    "knowledge":  ("Knowledge.svg",  "5.svg"),
    "action":     ("Action.svg",     "3.svg"),
    "progress":   ("Progress.svg",   "6.svg"),
}
EXTRA_LEGEND = {"welcome": "4.svg"}
PLACEHOLDER_CENTER = (262.0, 208.5)   # where the designer put the Friendship icon; used for placeholders


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def rects(svg):
    return re.findall(r"<rect[^>]*/>", svg)


def parse_rect(r):
    def num(k, d=0.0):
        m = re.search(r"\b" + k + r'="([-\d.]+)"', r)
        return float(m.group(1)) if m else d
    t = re.search(r'transform="([^"]+)"', r)
    return num("x"), num("y"), num("width"), num("height"), (t.group(1) if t else "")


def corners(x, y, w, h, t):
    tx = ty = 0.0
    ang = 0.0
    m = re.search(r"translate\(([-\d.]+)[ ,]([-\d.]+)\)", t)
    if m:
        tx, ty = float(m.group(1)), float(m.group(2))
    m = re.search(r"rotate\(([-\d.]+)\)", t)
    if m:
        ang = math.radians(float(m.group(1)))
    pts = [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]
    return [(px * math.cos(ang) - py * math.sin(ang) + tx, px * math.sin(ang) + py * math.cos(ang) + ty) for px, py in pts]


def bbox(rs):
    pts = [c for r in rs for c in corners(*parse_rect(r))]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def mint(r):
    r = re.sub(r'class="[^"]+"', 'fill="%s"' % MINT, r)
    if "fill=" not in r:
        r = r.replace("<rect", '<rect fill="%s"' % MINT, 1)
    return r


def frame_icon_svg(rs, translate=None):
    body = "\n".join("    " + mint(r) for r in rs)
    if translate:
        body = '  <g transform="translate(%.2f %.2f)">\n%s\n  </g>' % (translate[0], translate[1], body)
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">\n%s\n</svg>\n' % body


def legend_icon_svg(svg):
    vb = re.search(r'viewBox="([^"]+)"', svg).group(1).split()
    svg = re.sub(r"<svg ", '<svg width="%s" height="%s" ' % (vb[2], vb[3]), svg, count=1)
    return re.sub(r'\s*id="Layer_[^"]*"|\s*data-name="[^"]*"', "", svg)


def main():
    os.makedirs(OUT_ICONS, exist_ok=True)
    os.makedirs(OUT_FRAMES, exist_ok=True)
    config = {}
    bg_written = False

    for vid, (frame_file, icon_file) in VALUES.items():
        frame_path = os.path.join(SRC, frame_file)
        icon_svg = read(os.path.join(SRC, icon_file))
        frame_svg = read(frame_path) if os.path.exists(frame_path) else ""
        frame_rects = rects(frame_svg)
        m = re.search(r'xlink:href="data:image/png;base64,([^"]+)"', frame_svg)

        if m and not bg_written:
            png = base64.b64decode(m.group(1))
            with open(os.path.join(OUT_FRAMES, "frame-bg.png"), "wb") as f:
                f.write(png)
            try:
                from PIL import Image
                im = Image.open(os.path.join(OUT_FRAMES, "frame-bg.png")).convert("RGBA")
                im.save(os.path.join(OUT_FRAMES, "frame-bg.png"), optimize=True)
                im.save(os.path.join(OUT_FRAMES, "frame-bg-lossless.webp"), lossless=True, quality=100, method=6)
            except ImportError:
                print("Pillow not installed: frame-bg-lossless.webp not regenerated", file=sys.stderr)
            bg_written = True

        if frame_rects:
            svg = frame_icon_svg(frame_rects)
            b = bbox(frame_rects)
            config[vid] = {"frameIcon": "assets/icons/%s-frame.svg" % vid, "bbox": [round(v, 1) for v in b], "source": frame_file}
        else:
            rs = rects(icon_svg)
            b = bbox(rs)
            dx = PLACEHOLDER_CENTER[0] - (b[0] + b[2]) / 2
            dy = PLACEHOLDER_CENTER[1] - (b[1] + b[3]) / 2
            svg = frame_icon_svg(rs, (dx, dy))
            config[vid] = {"frameIcon": "assets/icons/%s-frame.svg" % vid,
                           "bbox": [round(b[0] + dx, 1), round(b[1] + dy, 1), round(b[2] + dx, 1), round(b[3] + dy, 1)],
                           "placeholder": True, "source": "%s (placeholder: %s missing or empty)" % (icon_file, frame_file)}
            print("NOTE: %s built as placeholder from %s" % (vid, icon_file))

        with open(os.path.join(OUT_ICONS, "%s-frame.svg" % vid), "w", encoding="utf-8") as f:
            f.write(svg)
        with open(os.path.join(OUT_ICONS, "%s.svg" % vid), "w", encoding="utf-8") as f:
            f.write(legend_icon_svg(icon_svg))
        config[vid]["legendIcon"] = "assets/icons/%s.svg" % vid

    for vid, icon_file in EXTRA_LEGEND.items():
        with open(os.path.join(OUT_ICONS, "%s.svg" % vid), "w", encoding="utf-8") as f:
            f.write(legend_icon_svg(read(os.path.join(SRC, icon_file))))

    with open(os.path.join(OUT_FRAMES, "frames-config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    print(json.dumps(config, indent=1))


if __name__ == "__main__":
    main()
