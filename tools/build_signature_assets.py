#!/usr/bin/env python3
"""Build the email-signature assets from the designer's After Effects hand-off.

Run from the webtool folder:  python3 tools/build_signature_assets.py
Needs: ffmpeg on PATH, Pillow.

Inputs (source/signature/):
  option-a-alpha.mov   ProRes 4444 alpha layer, white design: stripes along the top and bottom edges (24 fps loop)
  option-b-alpha.mov   ProRes 4444 alpha layer, mint design: diamond pattern washes over the name and clears (60 fps)
  se-wordmark-dark.png, se-wordmark-green.png, oyw-one.png   logos from the AE (Footage) folder

Outputs (assets/signature/):
  a/strip-NN.webp, b/strip-NN.webp sprite strips (FRAMES_PER_STRIP frames stacked vertically, 600x150 each, RGBA)
  a/manifest.json, b/manifest.json  frame count, fps, strip layout
  se-wordmark-dark.png, se-wordmark-green.png, oyw-one.png   logos downscaled for the web

Colour is un-premultiplied (AE exports matted/premultiplied alpha; canvas drawImage expects straight alpha).
The animation is resampled to FPS and, for option B, re-cut so frame 0 is the clean (pattern-free) state:
mail clients that do not animate GIFs (Outlook desktop) show the first frame only.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source", "signature")
OUT = os.path.join(ROOT, "assets", "signature")
W, H = 600, 150
FPS = 12
FRAMES_PER_STRIP = 8

OPTIONS = {
    # option: (alpha movie, source fps, first "clean" source frame to start the loop on, crossfade frames at the seam)
    "a": ("option-a-alpha.mov", 24, 0, 12),   # stripes never return to frame 0 exactly -> 1 s crossfade closes the loop
    "b": ("option-b-alpha.mov", 60, 76, 0),   # source already loops; re-cut so frame 0 is the clean state
}
STRIP_FORMAT = ("webp", {"quality": 92, "alpha_quality": 100, "method": 4})
LOGOS = {
    "se-wordmark-dark.png": 1200,
    "se-wordmark-green.png": 1200,
    "oyw-one.png": 700,
}


def unpremultiply(im):
    """AE writes ProRes 4444 with premultiplied colour; browsers expect straight alpha. Divide RGB by alpha."""
    import numpy as np
    arr = np.asarray(im.convert("RGBA")).astype(np.float32)
    a = arr[:, :, 3:4]
    rgb = arr[:, :, :3]
    scale = np.where(a > 0, 255.0 / np.maximum(a, 1.0), 1.0)
    rgb = np.clip(rgb * scale, 0, 255)
    out = np.concatenate([rgb, a], axis=2).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def extract_frames(movie, tmp):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", movie, "-pix_fmt", "rgba",
                    os.path.join(tmp, "f%04d.png")], check=True)
    return sorted(os.path.join(tmp, f) for f in os.listdir(tmp) if f.endswith(".png"))


def build_option(key, movie, src_fps, start, xfade):
    out_dir = os.path.join(OUT, key)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    with tempfile.TemporaryDirectory() as tmp:
        frames = extract_frames(os.path.join(SRC, movie), tmp)
        n = len(frames)
        order = list(range(start, n)) + list(range(0, start))      # re-cut so the loop starts on `start`
        step = src_fps / FPS
        picked = [order[int(round(i * step))] for i in range(int(n / step))]
        # loop seam report: how different are the first and last source frames?
        a = Image.open(frames[0]).convert("RGBA").getchannel("A").resize((150, 38))
        b = Image.open(frames[-1]).convert("RGBA").getchannel("A").resize((150, 38))
        seam = sum(abs(x - y) for x, y in zip(a.getdata(), b.getdata())) / (150 * 38)
        imgs = []
        for fi in picked:
            fr = unpremultiply(Image.open(frames[fi]))
            if fr.size != (W, H):
                fr = fr.resize((W, H), Image.LANCZOS)
            imgs.append(fr)
        if xfade:
            # blend the last `xfade` frames towards the first `xfade`, then drop the first ones: seamless loop
            n2 = len(imgs)
            for j in range(xfade):
                t = (j + 1) / (xfade + 1)
                imgs[n2 - xfade + j] = Image.blend(imgs[n2 - xfade + j], imgs[j], t)
            imgs = imgs[xfade:]
        ext, save_kw = STRIP_FORMAT
        strips = 0
        for s in range(0, len(imgs), FRAMES_PER_STRIP):
            chunk = imgs[s:s + FRAMES_PER_STRIP]
            strip = Image.new("RGBA", (W, H * len(chunk)), (0, 0, 0, 0))
            for i, fr in enumerate(chunk):
                strip.paste(fr, (0, i * H))
            strip.save(os.path.join(out_dir, "strip-%02d.%s" % (strips, ext)), **save_kw)
            strips += 1
        picked = imgs
        from PIL import ImageStat
        cov = [ImageStat.Stat(im.getchannel("A")).mean[0] for im in imgs]
        cmax = max(cov) or 1.0
        coverage = [round(c / cmax, 3) for c in cov]
        import time
        manifest = {"width": W, "height": H, "fps": FPS, "frames": len(picked), "framesPerStrip": FRAMES_PER_STRIP,
                    "coverage": coverage, "built": int(time.time()),
                    "strips": strips, "ext": ext, "crossfadeFrames": xfade, "sourceFrames": n, "sourceFps": src_fps, "loopStartSourceFrame": start,
                    "seamMeanAlphaDiff": round(seam, 2)}
        with open(os.path.join(out_dir, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=2)
        total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir))
        print("option %s: %d source frames @%d fps -> %d frames @%d fps in %d strips, %d KB, seam diff %.2f"
              % (key, n, src_fps, len(picked), FPS, strips, total // 1024, seam))


def build_logos():
    for name, max_w in LOGOS.items():
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            print("missing logo", name, file=sys.stderr)
            continue
        Image.MAX_IMAGE_PIXELS = None
        im = Image.open(p).convert("RGBA")
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        im.save(os.path.join(OUT, name), optimize=True)
        print("logo %s -> %dx%d %d KB" % (name, im.width, im.height, os.path.getsize(os.path.join(OUT, name)) // 1024))


def main():
    os.makedirs(OUT, exist_ok=True)
    build_logos()
    for key, (movie, fps, start, xfade) in OPTIONS.items():
        build_option(key, movie, fps, start, xfade)


if __name__ == "__main__":
    main()
