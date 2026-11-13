"""Thumbnails that make people click: the most striking picture of the episode, bright and sharp, with two or three
huge words in gold. Runs on the server after the render and replaces the old thumbnails and reel covers.

How the picture is chosen, with no AI requests: every picture the episode shows is scored here for
  colour (rich and warm, gold counts most), contrast, sharpness and size, and CLIP's sense of "gold, treasure, statue, temple".
Text comes from the script (thumbnailText) and each reel's hook.

Usage: python thumbs.py <publish dir> <episode id>
"""
import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageStat

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTENT = os.path.join(REPO, "content")
FONT = os.path.join(REPO, "media", "brand", "fonts", "Anton-Regular.ttf")
GOLD = (255, 205, 40)
UA = {"User-Agent": "ZalaRender/1.0 (https://www.zalavip.com)"}


def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return None


def colourfulness(img):
    small = img.resize((160, 90))
    px = list(small.getdata())
    rg = [abs(r - g) for r, g, b in px]
    yb = [abs(0.5 * (r + g) - b) for r, g, b in px]
    mean = lambda v: sum(v) / len(v)
    std = lambda v: (sum((x - mean(v)) ** 2 for x in v) / len(v)) ** 0.5
    warm = mean([1 if (r > 150 and g > 110 and b < 110) else 0 for r, g, b in px])   # gold and sand light
    return (std(rg) ** 2 + std(yb) ** 2) ** 0.5 + 0.3 * (mean(rg) ** 2 + mean(yb) ** 2) ** 0.5, warm


def score(img, clip):
    col, warm = colourfulness(img)
    grey = img.convert("L")
    contrast = ImageStat.Stat(grey).stddev[0]
    sharp = ImageStat.Stat(grey.filter(ImageFilter.FIND_EDGES)).mean[0]
    size = min(img.size)
    s = col * 1.0 + warm * 120 + contrast * 0.6 + sharp * 2 + min(size, 1600) / 80
    if clip:
        s += clip(img) * 80
    return s


def clip_scorer():
    try:
        import open_clip
        import torch
        model, _, pre = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
        tok = open_clip.get_tokenizer("ViT-B-32")
        model.eval()
        good = ["a stunning photo of ancient Egyptian gold treasure", "a dramatic photo of a giant ancient Egyptian statue",
                "a dramatic photo of an ancient Egyptian temple"]
        bad = ["a dull photo of a museum label", "a photo of tourists", "a blurry old document", "a map"]
        with torch.no_grad():
            t = model.encode_text(tok(good + bad))
            t = t / t.norm(dim=-1, keepdim=True)

        def f(img):
            with torch.no_grad():
                v = model.encode_image(pre(img).unsqueeze(0))
                v = v / v.norm(dim=-1, keepdim=True)
                p = (100 * v @ t.T).softmax(dim=-1)[0].tolist()
            return sum(p[: len(good)])
        return f
    except Exception as e:
        print("[thumbs] no CLIP, colour score only:", e)
        return None


def object_box(img):
    """Where the real object sits in a photo shot on a plain studio background (most museum photos), so the crop
    zooms onto it instead of onto empty white. Returns None for a busy picture (a video frame, a real scene) —
    those have no large flat background to begin with, so the usual centered crop already suits them."""
    gw, gh = 96, 120
    small = img.convert("L").resize((gw, gh))
    px = small.load()
    corner = lambda cx, cy: [px[cx + dx, cy + dy] for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2)]
    samples = corner(3, 3) + corner(gw - 4, 3) + corner(3, gh - 4) + corner(gw - 4, gh - 4)
    bg = sorted(samples)[len(samples) // 2]
    mask = [[1 if abs(px[x, y] - bg) > 20 else 0 for x in range(gw)] for y in range(gh)]
    filled = sum(sum(row) for row in mask)
    if not (0.06 < filled / (gw * gh) < 0.75):
        return None   # almost all background (nothing found) or almost none (already a busy photo): skip
    xs = [x for y in range(gh) for x in range(gw) if mask[y][x]]
    ys = [y for y in range(gh) for x in range(gw) if mask[y][x]]
    return min(xs) / gw, min(ys) / gh, (max(xs) + 1) / gw, (max(ys) + 1) / gh


def cover(img, w, h, focus_y=0.42):
    box = object_box(img)
    if box:
        bx0, by0, bx1, by1 = box
        # generous padding around the object so nothing gets cropped off, then grown to the card's own aspect ratio
        pad = 0.16
        bx0, by0 = max(0, bx0 - pad), max(0, by0 - pad)
        bx1, by1 = min(1, bx1 + pad), min(1, by1 + pad)
        cx, cy = (bx0 + bx1) / 2 * img.width, (by0 + by1) / 2 * img.height
        bw, bh = max((bx1 - bx0) * img.width, 10), max((by1 - by0) * img.height, 10)
        target = w / h
        if bw / bh > target: bh = bw / target
        else: bw = bh * target
        # never zoom in past the source picture's own sharpness, and never crop past its edges
        bw, bh = min(bw, img.width), min(bh, img.height)
        x0, y0 = max(0, min(img.width - bw, cx - bw / 2)), max(0, min(img.height - bh, cy - bh / 2))
        img = img.resize((w, h), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))
    else:
        scale = max(w / img.width, h / img.height) * 1.06   # a touch closer than the full picture
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
        x = (img.width - w) // 2
        y = int((img.height - h) * focus_y)
        img = img.crop((x, y, x + w, y + h))
    img = ImageEnhance.Color(img).enhance(1.35)
    img = ImageEnhance.Contrast(img).enhance(1.18)
    img = ImageEnhance.Sharpness(img).enhance(1.6)
    # soft vignette so the words and the subject stand out
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.25, -h * 0.3, w * 1.25, h * 1.3), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) // 6))
    dark = ImageEnhance.Brightness(img).enhance(0.45)
    return Image.composite(img, dark, mask)


def scrim(img, top):
    """A soft dark gradient from `top` to the bottom edge, so text stays readable over any picture underneath —
    no hard box edge, it just gently darkens toward the bottom of the frame."""
    column = Image.new("L", (1, img.height), 0)
    for y in range(img.height):
        t = max(0, (y - top) / max(1, (img.height - top)))
        column.putpixel((0, y), int(210 * min(1, t * 1.4) ** 1.3))
    alpha = column.resize((img.width, img.height))
    dark = Image.new("RGB", img.size, (6, 6, 8))
    return Image.composite(dark, img, alpha)


def words(draw, img, text, box, size):
    lines, cur = [], ""
    for w in text.upper().split():
        if cur and len(cur) + 1 + len(w) > 11:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    lines.append(cur)
    x0, y0, x1, y1 = box
    while size > 40:
        font = ImageFont.truetype(FONT, size)
        sizes = [draw.textbbox((0, 0), l, font=font, stroke_width=size // 12) for l in lines]
        tw = max(b[2] - b[0] for b in sizes)
        th = sum(b[3] - b[1] for b in sizes) + (len(lines) - 1) * size * 0.08
        if tw <= x1 - x0 and th <= y1 - y0:
            break
        size -= 6
    y = y0 + ((y1 - y0) - th) / 2
    for i, l in enumerate(lines):
        b = draw.textbbox((0, 0), l, font=font, stroke_width=size // 12)
        x = x0 + ((x1 - x0) - (b[2] - b[0])) / 2
        colour = GOLD if i == len(lines) - 1 else (255, 255, 255)
        draw.text((x + 6, y + 8), l, font=font, fill=(0, 0, 0), stroke_width=size // 12, stroke_fill=(0, 0, 0))   # shadow
        draw.text((x, y), l, font=font, fill=colour, stroke_width=size // 12, stroke_fill=(0, 0, 0))
        y += (b[3] - b[1]) + size * 0.08


def main():
    pub, ep = sys.argv[1], sys.argv[2]
    script = json.load(open(os.path.join(CONTENT, "youtube", f"{ep}.json"), encoding="utf-8"))
    items = {}
    for line in open(os.path.join(CONTENT, "library", "items.jsonl"), encoding="utf-8"):
        if line.strip():
            i = json.loads(line)
            items[i["id"]] = i
    ids = []
    for c in script["chapters"]:
        for l in c["lines"]:
            ids += [p for p in l.get("pictures") or [] if p not in ids]
    import re
    topics = json.load(open(os.path.join(CONTENT, "library", "topics.json"), encoding="utf-8"))
    about = re.compile(topics.get(ep, {}).get("match", "$^"), re.I)
    text_of = lambda it: " ".join(str(x) for x in [it.get("title"), it.get("seen", {}).get("what"), it.get("seen", {}).get("subject"), it.get("seen", {}).get("place")])
    first = set(script["chapters"][0]["lines"][0].get("pictures") or [])
    # only pictures that really show the episode's subject; the opening picture, which the director picked as the most striking, counts most
    pool = [p for p in ids if p in items and about.search(text_of(items[p]))] or ids
    clip = clip_scorer()
    ranked = []
    for pid in pool[:60]:
        it = items.get(pid)
        if not it or (it.get("seen", {}).get("check") or {}).get("modern"):
            continue
        img = fetch(it["url"])
        if not img or min(img.size) < 700:
            continue
        col, _ = colourfulness(img)
        if col < 18:          # black and white or washed out: never on a thumbnail
            continue
        ranked.append((score(img, clip) + (60 if pid in first else 0), pid, img))
    ranked.sort(key=lambda x: -x[0])
    if not ranked:
        print("[thumbs] no picture to use")
        return
    print("[thumbs] best pictures:", [(round(s), p) for s, p, _ in ranked[:5]])
    pkg_file = os.path.join(pub, f"{ep}.youtube.json")
    pkg = json.load(open(pkg_file, encoding="utf-8"))
    # A viewer in America does not know "Abu Simbel" or "Tanis": the thumbnail never leads with a place or a name.
    # A small line says what world this is (ANCIENT EGYPT), and the big words are the hook from the title.
    name_words = set(re.findall(r"[a-z]{3,}", topics.get(ep, {}).get("match", "").lower()))

    def hook(t, n=5):
        t = str(t or "").strip()
        part = t.split(":", 1)[1] if ":" in t else t
        w = [x for x in part.replace("'s", "").split() if not any(nw in x.lower() for nw in name_words)]
        while w and w[0].lower() in ("the", "inside", "a", "an"):
            w = w[1:]
        return " ".join(w[-n:]) if len(w) > n else " ".join(w)

    def label(img, text, box, size):
        d = ImageDraw.Draw(img)
        f = ImageFont.truetype(FONT, size)
        b = d.textbbox((0, 0), text, font=f)
        x = box[0] + ((box[2] - box[0]) - (b[2] - b[0])) / 2
        pad = size // 4
        d.rectangle((x - pad, box[1] - pad // 2, x + (b[2] - b[0]) + pad, box[1] + (b[3] - b[1]) + pad), fill=(0, 0, 0))
        d.text((x, box[1] - b[1] // 2), text, font=f, fill=GOLD)

    main_text = hook(script["title"]) or hook(script.get("thumbnailText"))
    texts = [main_text] + [hook(r.get("hook") or r.get("title"), 4) or main_text for r in script.get("reels", [])][:2]
    made = []
    for n, text in enumerate(texts[:3]):
        _, pid, img = ranked[n % len(ranked)]
        t = cover(img, 1280, 720)
        d = ImageDraw.Draw(t)
        label(t, "ANCIENT EGYPT", (40, 360, 1240, 400), 44)
        words(d, t, text, (40, 420, 1240, 700), 160)   # big words across the lower part, the subject stays on top
        name = f"{ep}_thumbnail.jpg" if n == 0 else f"{ep}_thumbnail-{n + 1}.jpg"
        t.save(os.path.join(pub, name), "JPEG", quality=92)
        made.append(name)
    for n, r in enumerate(pkg.get("reels", [])):
        _, pid, img = ranked[(n + 1) % len(ranked)]
        c = cover(img, 1080, 1920, 0.4)
        label(c, "ANCIENT EGYPT", (60, 1110, 1020, 1160), 56)
        words(ImageDraw.Draw(c), c, hook((script.get("reels") or [{}] * 3)[n].get("hook") or r.get("title", ""), 4) or main_text, (60, 1200, 1020, 1700), 190)
        c.save(os.path.join(pub, r["file"].replace(".mp4", "_cover.jpg")), "JPEG", quality=92)
    pkg["thumbnail"], pkg["thumbnails"] = made[0], made
    json.dump(pkg, open(pkg_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("[thumbs] made", made)


if __name__ == "__main__":
    main()
