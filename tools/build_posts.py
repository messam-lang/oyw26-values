#!/usr/bin/env python3
"""Build the ready-made LinkedIn posts for the toolkit from the mirrored Drive folder.

Run from the webtool folder:  python3 tools/build_posts.py
Needs: Pillow.

Input  source/posts/            a mirror of the client's "Toolkit Deliverables" Drive folder (NOT committed:
                                 manifest.json and every caption.txt carry the Explorers' work emails)
Output assets/posts/<...>.jpg   the visuals as JPG (quality 90) for download, same basename as the PNG
       assets/posts/<...>.webp  720px-wide WebP previews for the cards
       data/posts.json          everything the page needs: sets, posts, captions, Explorer roster with HASHED emails

Emails never reach the repo. Each Explorer's work email is stored as sha256(SALT + ":" + email.lower()) and the page
hashes what the visitor types the same way before comparing. The hash is what the toolkit matches on.

Caption files have a "Key: value" header, then one or more blocks opened by a line starting with "===":
  === VARIATION A · Archetype 1 — The Builder — file: X.png ===      (Enactus and graduates: one block per variation)
  === CAPTION (EN) — file: X_EN.png ===  /  === CAPTION (FR) — ... === (Explorers: one block per language)
A file with no "===" blocks is treated as one caption shared by every variation.
"""
import hashlib
import json
import os
import re
import sys
import time

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# POSTS_SRC / POSTS_OUT let a snapshot be test-built somewhere else before it replaces the live one
SRC = os.environ.get("POSTS_SRC") or os.path.join(ROOT, "source", "posts")
_OUT = os.environ.get("POSTS_OUT") or ROOT
OUT_IMG = os.path.join(_OUT, "assets", "posts")
OUT_DATA = os.path.join(_OUT, "data")
SALT = "oyw26-powered-by-each-other"
SCHNEIDER_DOMAINS = ["se.com", "schneider-electric.com"]
JPG_QUALITY = 90
THUMB_W = 720
THUMB_QUALITY = 82

# Posting windows as written in the manifest -> ISO dates (year 2026). Anything unknown falls back to date..date+4.
WINDOWS = {
    "6–10 Oct": ("2026-10-06", "2026-10-10"),
    "13–17 Oct": ("2026-10-13", "2026-10-17"),
    "13–21 Oct": ("2026-10-13", "2026-10-21"),
    "w/c 20 Oct": ("2026-10-20", "2026-10-24"),
    "19–30 Oct": ("2026-10-19", "2026-10-30"),
    "3–6 Nov": ("2026-11-03", "2026-11-06"),
    "9–20 Nov": ("2026-11-09", "2026-11-20"),
    "9–27 Nov": ("2026-11-09", "2026-11-27"),
}
MONTHS = {"Oct": 10, "Nov": 11, "Sep": 9, "Dec": 12}

# One line per archetype so people can pick the voice that fits them (names from the client's README).
ARCHETYPES = {
    "enactus": [
        ("A", "The Builder", "You made something real with your team and want to see if it holds up."),
        ("B", "The Changemaker", "Your project started close to home, with one community and one problem."),
        ("C", "The Pitcher", "You are bringing an idea to pitch to a room that has heard it all."),
        ("D", "The First-Generation Delegate", "You are the first from your university or family in a room like this."),
    ],
    "graduates": [
        ("A", "The New Engineer", "First role after university, still learning how the work really gets done."),
        ("B", "The Remote / Field Hire", "You work on site or far from head office, closer to customers than to meetings."),
        ("C", "The Career-Switcher", "You came to Schneider from another path and see things differently."),
        ("D", "The Early Achiever", "You already lead something and want to measure it against the world."),
    ],
}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def sha(email):
    return hashlib.sha256((SALT + ":" + email.strip().lower()).encode("utf-8")).hexdigest()


def window_dates(win, date):
    win = (win or "").strip()
    for key, span in WINDOWS.items():
        if key in win:
            return span
    m = re.search(r"(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(Oct|Nov|Sep|Dec)", win)
    if m:
        mo = MONTHS[m.group(3)]
        return ("2026-%02d-%02d" % (mo, int(m.group(1))), "2026-%02d-%02d" % (mo, int(m.group(2))))
    m = re.search(r"w/c\s+(\d{1,2})\s+(Oct|Nov|Sep|Dec)", win)
    if m:
        mo = MONTHS[m.group(2)]
        d = int(m.group(1))
        return ("2026-%02d-%02d" % (mo, d), "2026-%02d-%02d" % (mo, d + 4))
    m = re.fullmatch(r"(\d{1,2})\s+(Oct|Nov|Sep|Dec)", win)          # a single day, e.g. "30 Oct"
    if m:
        day = "2026-%02d-%02d" % (MONTHS[m.group(2)], int(m.group(1)))
        return (day, day)
    import datetime as dt
    d0 = dt.date.fromisoformat(date)
    return (date, (d0 + dt.timedelta(days=4)).isoformat())


def parse_caption(text):
    """-> (header dict, {blockKey: body}) where blockKey is 'A'..'D', 'EN', 'FR' or '*' for a single caption."""
    lines = text.replace("\r\n", "\n").split("\n")
    header, blocks, cur, body = {}, {}, None, []
    in_header = True
    for ln in lines:
        if ln.startswith("==="):
            if cur is not None:
                blocks[cur] = "\n".join(body).strip()
            head = ln.strip("= ").strip()
            m = re.search(r"VARIATION\s+([A-D])\b", head, re.I)
            m2 = re.search(r"\((EN|FR)\)", head, re.I)
            cur = m.group(1).upper() if m else (m2.group(1).upper() if m2 else head)
            body = []
            in_header = False
            continue
        if in_header:
            if ln.strip() == "---":
                in_header = False
                cur, body = "*", []
                continue
            m = re.match(r"^([A-Za-z][A-Za-z \-/()]*):\s*(.*)$", ln)
            if m and cur is None:
                header[m.group(1).strip()] = m.group(2).strip()
                continue
            if ln.strip() == "":
                continue
            # free text before any block: a single shared caption
            in_header = False
            cur, body = "*", [ln]
            continue
        body.append(ln)
    if cur is not None:
        blocks[cur] = "\n".join(body).strip()
    return header, {k: v for k, v in blocks.items() if v}


def convert_image(src_path, rel_dir, basename):
    """PNG -> JPG (download) + WebP preview. Returns (jpg_rel, webp_rel, w, h)."""
    out_dir = os.path.join(OUT_IMG, rel_dir)
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(basename)[0]
    jpg = os.path.join(out_dir, stem + ".jpg")
    webp = os.path.join(out_dir, stem + ".webp")
    im = Image.open(src_path)
    w, h = im.size
    if not (os.path.exists(jpg) and os.path.getmtime(jpg) >= os.path.getmtime(src_path)):
        rgb = im.convert("RGB")
        rgb.save(jpg, quality=JPG_QUALITY, optimize=True, progressive=True)
        th = rgb.copy()
        th.thumbnail((THUMB_W, THUMB_W * 2), Image.LANCZOS)
        th.save(webp, quality=THUMB_QUALITY, method=5)
    rel = lambda p: os.path.relpath(p, ROOT).replace(os.sep, "/")
    return rel(jpg), rel(webp), w, h


def find_image(folder, basename):
    """Match on basename, not extension (the manifest allows png or jpg)."""
    stem = os.path.splitext(basename)[0]
    for ext in (".png", ".jpg", ".jpeg", ".PNG", ".JPG"):
        p = os.path.join(folder, stem + ext)
        if os.path.exists(p):
            return p
    return None


def post_meta(p, folder_name):
    date = p.get("posting_date") or folder_name[:10]
    start, end = window_dates(p.get("window"), date)
    return {
        "id": folder_name,
        "type": p.get("post_type") or folder_name[11:],
        "title": clean_title(p.get("title") or p.get("post_type") or folder_name[11:]),
        "date": date,
        "window": p.get("window") or "",
        "windowStart": start,
        "windowEnd": end,
        "format": "carousel" if "carousel" in (p.get("format") or "").lower() else "single",
    }


def clean_title(t):
    # "Pass the Question (1 card, no hand-off) — Enactus opens the chain" -> "Pass the Question"
    t = re.sub(r"\s*\(.*?\)", "", t)
    t = re.split(r"\s+[—-]\s+", t)[0]
    return t.strip()


def build_set(key, spec, rel_base, warnings):
    posts = []
    for p in spec["posts"]:
        folder_name = p["folder"].split("/")[-1]
        folder = os.path.join(SRC, rel_base, folder_name)
        if not os.path.isdir(folder):
            warnings.append("missing folder: %s/%s" % (rel_base, folder_name))
            continue
        meta = post_meta(p, folder_name)
        cap_path = os.path.join(folder, p.get("caption_file", "caption.txt").split("/")[-1])
        header, blocks = parse_caption(read(cap_path)) if os.path.exists(cap_path) else ({}, {})
        if not os.path.exists(cap_path):
            warnings.append("missing caption: %s/%s" % (rel_base, folder_name))
        meta["tag"] = header.get("Tag", "")
        meta["note"] = header.get("Note", "")
        variants = {}
        for v in p.get("variations", ["A", "B", "C", "D"]):
            names = [f for f in p.get("expected_files", []) if re.search(r"_%s(_card\d)?(\.\w+)?$" % v, f)]
            names.sort()
            cards = []
            for name in names:
                src = find_image(folder, name)
                if not src:
                    warnings.append("missing image: %s/%s/%s" % (rel_base, folder_name, name))
                    continue
                jpg, webp, w, h = convert_image(src, os.path.join(rel_base, folder_name), name)
                cards.append({"src": jpg, "thumb": webp, "name": os.path.splitext(name)[0] + ".jpg"})
            caption = blocks.get(v) or blocks.get("*") or ""
            if not caption:
                warnings.append("no caption for variation %s: %s/%s" % (v, rel_base, folder_name))
            variants[v] = {"cards": cards, "caption": caption}
        meta["variants"] = variants
        posts.append(meta)
    posts.sort(key=lambda x: x["date"])
    return {
        "key": key,
        "archetypes": [{"key": k, "name": n, "blurb": b} for k, n, b in ARCHETYPES[key]],
        "hashtags": spec.get("hashtags", []),
        "note": spec.get("note", ""),
        "posts": posts,
    }


def build_explorers(roster, warnings):
    out = []
    for x in roster:
        email = (x.get("email") or "").strip()
        folder_rel = x["folder"]
        if not email or "@" not in email or "TBC" in email.upper():
            warnings.append("explorer skipped (no email yet): %s" % x.get("name"))
            continue
        base = os.path.join(SRC, folder_rel)
        if not os.path.isdir(base):
            warnings.append("missing explorer folder: %s" % folder_rel)
            continue
        first = email.split("@")[0].split(".")[0]
        first = first[:1].upper() + first[1:]
        lang = "FR" if (x.get("language") or "").lower().startswith("fr") else "EN"
        posts = []
        for p in x.get("posts", []):
            folder_name = p["folder"].split("/")[-1]
            folder = os.path.join(base, folder_name)
            if not os.path.isdir(folder):
                warnings.append("missing folder: %s/%s" % (folder_rel, folder_name))
                continue
            meta = post_meta(p, folder_name)
            cap_path = os.path.join(folder, "caption.txt")
            header, blocks = parse_caption(read(cap_path)) if os.path.exists(cap_path) else ({}, {})
            meta["tag"] = header.get("Tag", "")
            meta["chain"] = header.get("Chain", "")
            langs = {}
            for L in ("EN", "FR"):
                names = sorted(f for f in p.get("expected_files", []) if re.search(r"_%s(\.\w+)?$" % L, f))
                if not names:
                    continue
                cards = []
                for name in names:
                    src = find_image(folder, name)
                    if not src:
                        warnings.append("missing image: %s/%s/%s" % (folder_rel, folder_name, name))
                        continue
                    jpg, webp, w, h = convert_image(src, os.path.join(folder_rel, folder_name), name)
                    cards.append({"src": jpg, "thumb": webp, "name": os.path.splitext(name)[0] + ".jpg"})
                caption = blocks.get(L) or (blocks.get("*") if L == "EN" else "") or ""
                if not caption:
                    warnings.append("NO %s CAPTION: %s/%s" % (L, folder_rel, folder_name))
                langs[L] = {"cards": cards, "caption": caption}
            meta["langs"] = langs
            posts.append(meta)
        posts.sort(key=lambda q: q["date"])
        out.append({
            "id": folder_rel.split("/")[-1].lower(),
            "name": x.get("name", ""),
            "first": first,
            "hash": sha(email),
            "language": lang,
            "role": x.get("role", ""),
            "country": x.get("country", ""),
            "theme": x.get("plenary_theme", ""),
            "posts": posts,
        })
    return out


def build_speakers(spec_path, warnings):
    """speakers_manifest.json: Schneider speakers at the Summit, one undated 'Meet the Speakers' post each (never locked).
    Routing (per the file): checked before the main manifest; a matching email sees only their own post."""
    if not os.path.exists(spec_path):
        return []
    sm = json.load(open(spec_path, encoding="utf-8"))
    out = []
    for s in sm.get("speakers", []):
        email = (s.get("email") or "").strip()
        if "@" not in email:
            warnings.append("speaker skipped (no email): %s" % s.get("name"))
            continue
        if not os.path.isdir(os.path.join(SRC, s["folder"])):
            warnings.append("missing speaker folder: %s" % s["folder"])
            continue
        posts = []
        for p in s.get("posts", []):
            folder = os.path.join(SRC, p["folder"])
            if not os.path.isdir(folder):
                warnings.append("missing folder: %s" % p["folder"])
                continue
            cap_path = os.path.join(folder, "caption.txt")
            header, blocks = parse_caption(read(cap_path)) if os.path.exists(cap_path) else ({}, {})
            cards = []
            for key in (p.get("expected_files") or p.get("file_keys") or []):
                src = find_image(folder, key)
                if not src:
                    warnings.append("missing image: %s/%s" % (p["folder"], key))
                    continue
                jpg, webp, w, h = convert_image(src, p["folder"], os.path.splitext(key)[0] + ".png")
                cards.append({"src": jpg, "thumb": webp, "name": os.path.splitext(key)[0] + ".jpg"})
            caption = blocks.get("EN") or blocks.get("*") or ""
            if not caption:
                warnings.append("NO CAPTION: speaker %s" % s.get("name"))
            posts.append({
                "id": p.get("post_type") or "Meet-the-Speakers",
                "type": p.get("post_type") or "Meet-the-Speakers",
                "title": clean_title(p.get("title") or "Meet the Speakers"),
                "date": None, "window": "", "windowStart": None, "windowEnd": None,   # undated: share any time
                "format": "carousel" if len(cards) > 1 else "single",
                "tag": header.get("Tag", ""),
                "langs": {"EN": {"cards": cards, "caption": caption}},
            })
        name = s.get("name", "")
        out.append({
            "id": s["folder"].split("/")[-1].lower(),
            "name": name,
            "first": name.split()[0] if name else "",
            "hash": sha(email),
            "language": "EN",
            "role": s.get("title", ""),
            "posts": posts,
        })
    return out


def main():
    man_path = os.path.join(SRC, "manifest.json")
    if not os.path.exists(man_path):
        sys.exit("source/posts/manifest.json not found. Mirror the Drive folder into source/posts/ first.")
    man = json.load(open(man_path, encoding="utf-8"))
    os.makedirs(OUT_IMG, exist_ok=True)
    os.makedirs(OUT_DATA, exist_ok=True)
    warnings = []
    data = {
        "built": int(time.time()),
        "campaign": man.get("campaign", ""),
        "summit": man.get("summit", ""),
        "salt": SALT,
        "schneiderDomains": SCHNEIDER_DOMAINS,
        "sets": {
            "enactus": build_set("enactus", man["enactus"], "Enactus", warnings),
            "graduates": build_set("graduates", man["schneider"]["first_year_graduates"], "Schneider/First-Year-Graduates", warnings),
        },
        "explorers": build_explorers(man["schneider"]["african_explorers"], warnings),
        "speakers": build_speakers(os.path.join(SRC, "speakers_manifest.json"), warnings),
    }
    with open(os.path.join(OUT_DATA, "posts.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    n_img = sum(len(files) for _, _, files in os.walk(OUT_IMG))
    print("sets: enactus %d posts, graduates %d posts; explorers: %d; speakers: %d" % (
        len(data["sets"]["enactus"]["posts"]), len(data["sets"]["graduates"]["posts"]), len(data["explorers"]), len(data["speakers"])))
    print("assets/posts: %d files, %.1f MB" % (n_img, sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(OUT_IMG) for f in fs) / 1e6))
    print("data/posts.json: %d KB" % (os.path.getsize(os.path.join(OUT_DATA, "posts.json")) // 1024))
    if warnings:
        print("\n%d warning(s):" % len(warnings))
        for w in warnings:
            print("  -", w)


if __name__ == "__main__":
    main()
