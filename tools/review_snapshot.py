#!/usr/bin/env python3
"""Compare a new Drive mirror (source/posts-new) with the live one (source/posts), ignoring date prefixes.
Usage: python3 tools/review_snapshot.py [out_dir]   -> prints a summary; writes report.txt and copy-diffs.txt to out_dir.
Date prefixes (YYYY-MM-DD_) are stripped from paths so a reschedule shows as 'date-renamed', not as a change."""
import os, re, sys, hashlib, difflib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD, NEW = os.path.join(ROOT, 'source/posts'), os.path.join(ROOT, 'source/posts-new')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'source', '_review')
os.makedirs(OUT, exist_ok=True)
norm = lambda p: re.sub(r"\d{4}-\d{2}-\d{2}_", "", p)
def tree(base):
    d = {}
    for dp, dn, fn in os.walk(base):
        for f in fn:
            if f.startswith('.') or f.startswith('_listing'): continue
            rel = os.path.relpath(os.path.join(dp, f), base).replace(os.sep, '/')
            d.setdefault(norm(rel), []).append(rel)
    return d
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
old, new = tree(OLD), tree(NEW)
added = sorted(set(new) - set(old)); removed = sorted(set(old) - set(new)); common = sorted(set(old) & set(new))
same, moved, changed = [], [], []
for k in common:
    o, n = os.path.join(OLD, old[k][0]), os.path.join(NEW, new[k][0])
    if sha(o) == sha(n): (same if old[k][0] == new[k][0] else moved).append(k)
    else: changed.append(k)
rep = [f"old files {sum(len(v) for v in old.values())} | new files {sum(len(v) for v in new.values())}",
       f"identical in place {len(same)} | identical, date-renamed {len(moved)} | content changed {len(changed)} | added {len(added)} | removed {len(removed)}",
       "\n== ADDED ==\n" + "\n".join(added), "\n== REMOVED ==\n" + "\n".join(removed),
       "\n== DATE-RENAMED ONLY ==\n" + "\n".join(f"{old[k][0]}  ->  {new[k][0]}" for k in moved)]
hdr_only, copy, diffs, imgs = [], [], [], []
for k in changed:
    o, n = os.path.join(OLD, old[k][0]), os.path.join(NEW, new[k][0])
    if k.endswith(('.txt', '.md', '.json')):
        ot, nt = open(o, encoding='utf-8').read(), open(n, encoding='utf-8').read()
        if k.endswith('caption.txt'):
            split = lambda t: (t.split('\n===', 1) + [''])[:2]
            (oh, ob), (nh, nb) = split(ot), split(nt)
            if norm(ob).strip() == norm(nb).strip(): hdr_only.append(k)
            else:
                copy.append(k); diffs.append(f"\n### {k}\n" + "\n".join(difflib.unified_diff(norm(ob).splitlines(), norm(nb).splitlines(), 'live', 'new', lineterm='', n=1)))
        else:
            diffs.append(f"\n### {k}\n" + "\n".join(list(difflib.unified_diff(ot.splitlines(), nt.splitlines(), 'live', 'new', lineterm='', n=1))[:200]))
    else:
        try:
            from PIL import Image, ImageChops
            a, b = Image.open(o).convert('RGB'), Image.open(n).convert('RGB'); pct = None
            if a.size == b.size:
                A = a.resize((max(1, a.width // 10), max(1, a.height // 10))); B = b.resize(A.size)
                d = ImageChops.difference(A, B).convert('L'); pct = round(100 * sum(1 for v in d.getdata() if v > 24) / (A.width * A.height), 1)
            imgs.append(f"{k} | {a.size}->{b.size} | {pct}% pixels differ")
        except Exception as e: imgs.append(f"{k} | binary changed ({e})")
rep += [f"\n== CAPTIONS: header/dates only ({len(hdr_only)}) ==\n" + "\n".join(hdr_only), f"\n== CAPTIONS: copy changed ({len(copy)}) ==\n" + "\n".join(copy), f"\n== IMAGES/BINARIES changed ({len(imgs)}) ==\n" + "\n".join(imgs)]
open(os.path.join(OUT, 'report.txt'), 'w').write("\n".join(rep)); open(os.path.join(OUT, 'copy-diffs.txt'), 'w').write("\n".join(diffs))
print("\n".join(rep[:2])); print(f"added {len(added)}: {added[:6]}"); print(f"removed {len(removed)}: {removed[:6]}"); print("copy changed:", copy); print("\n".join(imgs))
