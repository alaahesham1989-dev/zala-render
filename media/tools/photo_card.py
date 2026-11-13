"""A 1080x1350 picture post: the treasure in full colour, a small ANCIENT EGYPT line and a few big words.
Usage: python photo_card.py <picture url> <words> <out.jpg>
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from thumbs import FONT, GOLD, colourfulness, cover, fetch, scrim, words  # noqa: E402


def measures(img):
    """Numbers the quality check needs: size, colour, light, sharpness, and frames (old slides and scans have dark or pale borders)."""
    from PIL import ImageFilter, ImageStat
    col, warm = colourfulness(img)
    grey = img.convert("L")
    small = grey.resize((200, 200))
    border = [small.crop(b) for b in ((0, 0, 200, 12), (0, 188, 200, 200), (0, 0, 12, 200), (188, 0, 200, 200))]
    flat_border = sum(1 for b in border if ImageStat.Stat(b).stddev[0] < 6)
    return {
        "w": img.width, "h": img.height, "colour": round(col, 1), "warm": round(warm, 3),
        "light": round(ImageStat.Stat(grey).mean[0], 1), "contrast": round(ImageStat.Stat(grey).stddev[0], 1),
        "sharp": round(ImageStat.Stat(grey.filter(ImageFilter.FIND_EDGES)).mean[0], 2), "flat_borders": flat_border,
    }


def passes(m):
    reasons = []
    if min(m["w"], m["h"]) < 900: reasons.append("too small")
    if m["colour"] < 28: reasons.append("dull colours")
    if not 55 <= m["light"] <= 200: reasons.append("too dark or too bright")
    if m["contrast"] < 38: reasons.append("flat, no contrast")
    if m["sharp"] < 6: reasons.append("blurry")
    if m["flat_borders"] >= 3: reasons.append("frame or border (old slide or scan)")   # most edges flat: a real scan/slide border, not just a plain backdrop (the smart crop already zooms past that)
    return reasons


def normalize(img, m):
    """A fix before a give-up: an old scan's plain border is cropped off, washed-out colour gets its saturation
    back, and weak contrast or bad exposure are corrected — the same photo, properly exposed, not a different one.
    Only size and real blur cannot be fixed this way (no edit restores detail a photo never captured)."""
    from PIL import ImageEnhance, ImageOps
    if m["flat_borders"] >= 3:
        w, h = img.size
        img = img.crop((int(w * 0.06), int(h * 0.06), int(w * 0.94), int(h * 0.94)))
    if not 55 <= m["light"] <= 200 or m["contrast"] < 38:
        img = ImageOps.autocontrast(img, cutoff=2)
    if m["colour"] < 28:
        img = ImageEnhance.Color(img).enhance(2.0)
    return img


def main():
    if sys.argv[1] == "--check":
        import json
        img = fetch(sys.argv[2])
        if img is None:
            print(json.dumps({"ok": False, "reasons": ["could not fetch"]}))
            return
        m = measures(img)
        r = passes(m)
        if r and not ({"too small", "blurry"} & set(r)):   # try the fix before giving up on an otherwise usable photo
            img2 = normalize(img, m)
            m2 = measures(img2)
            r2 = passes(m2)
            if not r2: m, r = m2, r2
        print(json.dumps({"ok": not r, "reasons": r, **m}))
        return
    url, text, out = sys.argv[1], sys.argv[2], sys.argv[3]
    # --trim l,t,r,b (each 0 to 0.3): a second try at a picture the reviewer flagged for something at one edge
    # (a museum label, a reflection, someone in the background) — cut that edge off instead of giving the picture up
    trim = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4].startswith("--trim=") else None
    img = fetch(url)
    if img is None:
        raise SystemExit(f"could not fetch {url}")
    if trim:
        tl, tt, tr, tb = [min(0.3, max(0, float(x))) for x in trim.split("=", 1)[1].split(",")]
        w0, h0 = img.size
        img = img.crop((int(w0 * tl), int(h0 * tt), int(w0 * (1 - tr)), int(h0 * (1 - tb))))
    else:
        m = measures(img)
        if passes(m): img = normalize(img, m)   # the same fix the check already approved, applied to what we post
    c = cover(img, 1080, 1350, 0.35, smart=True)
    c = scrim(c, 760)   # a gentle dark gradient under the words, instead of hard black boxes on top of the picture
    c = c.convert("RGBA")
    f = ImageFont.truetype(FONT, 36)
    t = "ANCIENT EGYPT"
    probe = ImageDraw.Draw(c)
    b = probe.textbbox((0, 0), t, font=f)
    tw, th = b[2] - b[0], b[3] - b[1]
    x = (1080 - tw) / 2
    # a small translucent pill behind the eyebrow tag, so it stays crisp this high up even before the gradient deepens
    pill = Image.new("RGBA", c.size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(pill)
    pd.rounded_rectangle((x - 22, 878, x + tw + 22, 878 + th + 28), radius=22, fill=(10, 10, 10, 150))
    c = Image.alpha_composite(c, pill)
    d = ImageDraw.Draw(c)
    d.text((x, 892 - b[1]), t, font=f, fill=GOLD, stroke_width=2, stroke_fill=(0, 0, 0))
    if text.strip():
        words(d, c, text, (60, 955, 1020, 1270), 140)
    c.convert("RGB").save(out, "JPEG", quality=92)
    print("[card]", out)


if __name__ == "__main__":
    main()
