# OYW26 employee toolkit

Schneider Electric × One Young World 2026 · "Powered By Each Other" employee toolkit.

A static, browser-only web app. A gate asks who the visitor is, then four tabs:

1. **Profile frame** – add a photo, the face is found on-device (TensorFlow.js BlazeFace,
   self-hosted), the photo is auto-framed inside the branded frame, pick the value you stand
   for, fine-tune, save or share a 1080×1080 PNG (plus a 1080×1920 story version).
2. **Email signature** – two designs (white with moving stripes, mint with the pattern reveal).
   Name, title, email and phone are typed into the design in Poppins; the designer's alpha
   animation plays on top; export an animated GIF (600×150, encoded in the browser with gifenc)
   or a static PNG, with per-mail-client install steps. Hidden for Enactus delegates.
3. **LinkedIn banner** – four banners at 1584×396 with a preview of where the profile photo lands.
4. **Posts** – the scheduled LinkedIn campaign (6 Oct to 27 Nov 2026) from the client's
   "Toolkit Deliverables" folder: visual, caption, download, **Post on LinkedIn** (copies the
   caption and opens LinkedIn's composer with it prefilled; no LinkedIn API), and the phone share
   sheet with the image attached. What shows depends on the gate (below).

(The earlier generic Captions tab was removed on 4 Oct 2026: the Posts tab covers it.)

No photo or detail ever leaves the device. No backend.

## The gate (who is this for)

`js/posts.js`, constant `TEST_MODE`:

- `TEST_MODE = true` (current, for testing): two buttons, *I work at Schneider Electric* and
  *I'm with Enactus*, plus the email field for African Explorers.
- `TEST_MODE = false` (live): the email decides. A Schneider domain (`se.com`,
  `schneider-electric.com`, and their subdomains) makes a standard employee; if the hashed email
  matches an Explorer, that person sees only their own folder; any other domain is Enactus.
- Override per visit with `?gate=live` or `?gate=test`.

The email is hashed on the device (SHA-256 with the salt in `data/posts.json`) and compared with
the hashed roster; it is never stored or sent. The choice is remembered in localStorage; *Change*
next to "Viewing as" resets it.

Audience rules: employees get the First-Year-Graduates set (5 posts, voices A–D); Explorers get
their personal posts (EN, plus FR for the five French speakers); Enactus gets the Enactus set
(4 posts, voices A–D) and no signature tab.

Posting windows are enforced for employees and Explorers: a post opens on its planned date
(`posting_date`, which spaces people out inside a shared window) and closes at the end of its
window. Outside that range the Post on LinkedIn, Download, Copy and Share actions are disabled and
the caption is read-only (the visual stays visible with a lock badge). "Today" is taken from the server's `Date` header on the data
file, so a wrong device clock does not open a post early. Enactus posts are never locked. In test
mode the Posts tab shows an "Unlock everything for testing" toggle (per browser session). Instead of a shared download counter (which needs a
server) the suggested voice is derived from the email hash, so it spreads evenly across people
and stays stable for each person. Anyone can switch voice, globally or per post.

## Updating the posts

The source of truth is the client's Drive folder *Toolkit Deliverables* (manifest.json + README +
one folder per post with caption.txt and the PNGs). It is mirrored, **not committed**, into
`source/posts/` because the manifest and captions carry work emails.

1. Mirror the Drive folder into `source/posts/` (same structure as Drive).
2. `python3 tools/build_posts.py` → `assets/posts/**.jpg` (downloads), `**.webp` (previews) and
   `data/posts.json` (captions, schedule, hashed roster). The script lists anything missing.
3. Bump `?v=` in `index.html`, commit, push.

The 10th Explorer (`Explorer-10-TBC`) is skipped until the manifest has their email and files.
Captions are parsed from the `=== VARIATION A … ===` / `=== CAPTION (EN|FR) … ===` blocks; posting
windows come from the manifest's `window` strings (table at the top of the build script).

## Structure

```
index.html            page
css/style.css         styling (Poppins, brand palette from Colors.svg)
js/app.js             profile frame: compositing, gestures, detection, export
js/signature.js       email signature: layout, sprite animation, GIF/PNG export
js/toolkit.js         tabs, LinkedIn banners, captions
assets/frames/        shared frame background (transparent oval window) + placement config
assets/icons/         <value>-frame.svg (mint icon in frame coordinates), <value>.svg (gradient legend icon)
assets/fonts/         Poppins woff2 (self-hosted)
assets/bg-motion.mp4  "gradient motion" background loop, transcoded to 720p / ~290 KB
vendor/               tf.js + blazeface (UMD) and gifenc (ESM), self-hosted
assets/signature/     logos + sprite strips (a/, b/) with manifests; preview-a/b.png style thumbnails
assets/banners/       LinkedIn banners 1584×396 + thumbnails
source/signature/     designer's AE hand-off: alpha layers (.mov, not committed), logos, reference frames
models/blazeface/     BlazeFace short-range model (self-hosted)
source/               the client's original SVGs (frames, icons, colours, patterns)
tools/build_assets.py            regenerates the frame assets from source/
tools/build_signature_assets.py  regenerates assets/signature from source/signature (ffmpeg + Pillow + numpy)
```

## Swapping in the real Action frame

The client's `Action.svg` failed to upload, so the Action frame icon is currently
built from the standalone Action icon (`source/3.svg`) and centred in the usual slot.

1. Copy the real file to `source/Action.svg`.
2. Run `python3 tools/build_assets.py` (needs Pillow only to regenerate the WebP background).
3. Commit and push. Nothing else changes.

## Email signature notes

- The AE alpha layers are premultiplied; the build un-premultiplies them, otherwise the
  semi-transparent stripes render grey.
- Option B is re-cut so frame 0 is the clean design (Outlook for Windows shows only the first
  frame). Its text and logos fade with the pattern, driven by the per-frame `coverage` in the
  manifest.
- Option A never returns to its first frame, so the loop is cut at 4.5 s and closed with a
  crossfade. 10 fps keeps the GIFs around 780 KB (A) and 380 KB (B).
- Text layout and colours were measured from the designer's finished frames
  (`source/signature/reference-option-*.png`); `DESIGNS` in `js/signature.js` holds them.

## Cache busting

Script and style URLs in `index.html` carry `?v=…`. Bump it when deploying changes to those
files. Sprite strips use the manifest's `built` stamp automatically.

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
