# OYW26 value frame tool

Schneider Electric × One Young World 2026 · "Pick your value" profile-picture tool.

A static, browser-only web app. Visitors add a photo, the face is found on-device
(TensorFlow.js BlazeFace, self-hosted), the photo is auto-framed inside the branded
frame, they pick the value they stand for, fine-tune, and save or share a 1080×1080
PNG (plus a 1080×1920 story version). No photo ever leaves the device. No backend.

## Structure

```
index.html            page
css/style.css         styling (Poppins, brand palette from Colors.svg)
js/app.js             app logic: compositing, gestures, detection, export
assets/frames/        shared frame background (transparent oval window) + placement config
assets/icons/         <value>-frame.svg (mint icon in frame coordinates), <value>.svg (gradient legend icon)
assets/fonts/         Poppins woff2 (self-hosted)
assets/bg-motion.mp4  "gradient motion" background loop, transcoded to 720p / ~290 KB
vendor/               tf.js + blazeface (UMD, self-hosted)
models/blazeface/     BlazeFace short-range model (self-hosted)
source/               the client's original SVGs (frames, icons, colours, patterns)
tools/build_assets.py regenerates assets/ from source/
```

## Swapping in the real Action frame

The client's `Action.svg` failed to upload, so the Action frame icon is currently
built from the standalone Action icon (`source/3.svg`) and centred in the usual slot.

1. Copy the real file to `source/Action.svg`.
2. Run `python3 tools/build_assets.py` (needs Pillow only to regenerate the WebP background).
3. Commit and push. Nothing else changes.

## Editing copy

Value names and one-line taglines live in `VALUES` at the top of `js/app.js`.
Event lines and share text live in `COPY` right below it.

## Local preview

Any static server works, e.g. `python3 -m http.server 8788` then open
http://localhost:8788/. Add `?photo=test/your.jpg` to load a same-origin test photo
without the picker, and `&debug` to expose internals on `window.__oyw`.

## Hosting

Plain static hosting (GitHub Pages, Netlify, Cloudflare Pages, or the client's own
subdomain). All paths are relative, so it works from a sub-path.
