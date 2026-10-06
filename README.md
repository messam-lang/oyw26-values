# OYW26 employee toolkit

Schneider Electric × One Young World 2026 · "Energized By Each Other" employee toolkit.

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

`js/toolkit.js`, constant `TEST_MODE`:

- `TEST_MODE = true` (testing): two buttons, *I work at Schneider Electric* and
  *I'm with Enactus*, plus the email field for African Explorers. Deep links such as `#posts`
  work and the gate jumps to the Posts tab.
- `TEST_MODE = false` (live, current since 4 Oct 2026): the email decides. A Schneider domain (`se.com`,
  `schneider-electric.com`, and their subdomains) makes a standard employee; if the hashed email
  matches an Explorer, that person sees only their own folder; any other domain is Enactus.
  Every visit starts on the first tab (Profile frame), whatever link brought the visitor.
- On localhost only, `?gate=live` or `?gate=test` overrides it for one visit. The public site ignores it.

The email is hashed on the device (SHA-256 with the salt in `data/posts.json`) and compared with
the hashed roster; it is never sent anywhere. The choice is remembered in localStorage (for
Schneider emails, with the name and email, see below); *Change* in the welcome bar resets it.

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

## Name and signature pre-fill (Schneider emails)

When a Schneider Electric email is entered at the gate, the name is read from it
(`firstname.lastname@se.com` → "Firstname Lastname"; Explorers keep the spelling printed on their
visuals, given name first). It is used to welcome the visitor ("Welcome, …" bar, toast, Posts
heading) and to fill in the name and email fields of the Email signature tab, where both stay
editable. Values typed by hand in the signature are never overwritten. The email and name are kept
in localStorage on the device only; nothing is sent anywhere. Addresses without a clear
first.last pattern get the generic welcome and only the email is filled in. The test-mode buttons
have no email, so no name.

## Reminders (employees and Explorers)

The Posts tab has an *Add posting days to my calendar* button: an `.ics` built in the browser with
one 09:00 event on the morning each remaining post opens, each with a link back to the toolkit.
No server. (An email-reminder backend was drafted and dropped on 4 Oct 2026.)

## Visual shell

Brick bands along the top and bottom edges (`assets/band-top.webp`, `assets/band-bottom.webp`,
from the designer's *Top banner* / *Bottom banner* PNGs, in flow so nothing overlaps them), the
white OYW logo in the hero, and a background tint that darkens to the left and lifts towards
bright green on the right, after the designer's example.

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

GitHub Pages from `main` (root). All paths are relative, so it works from a sub-path or a domain root.

Live at **https://energizedbyeachother.com/** since 4 Oct 2026 (domain at GoDaddy; `CNAME` file in the repo
root; HTTPS enforced; GitHub renews the certificate, which covers the apex and `www`). The old
`messam-lang.github.io/oyw26-values/` address redirects to it. DNS records at GoDaddy:

| Type | Name | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | messam-lang.github.io |

GoDaddy asks for an emailed one-time code on every DNS change. If the domain is ever moved, change
DNS first and the Pages custom domain second: the reverse order redirects visitors to a domain that
does not serve the site yet. The gate carries a plain-JS SHA-256 fallback so it also works over http.
