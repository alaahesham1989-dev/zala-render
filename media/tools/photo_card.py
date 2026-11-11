"""A 1080x1350 picture post: the treasure in full colour, a small ANCIENT EGYPT line and a few big words.
Usage: python photo_card.py <picture url> <words> <out.jpg>
"""
import os
import sys

from PIL import ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from thumbs import FONT, GOLD, cover, fetch, words  # noqa: E402


def main():
    url, text, out = sys.argv[1], sys.argv[2], sys.argv[3]
    img = fetch(url)
    if img is None:
        raise SystemExit(f"could not fetch {url}")
    c = cover(img, 1080, 1350, 0.35)
    d = ImageDraw.Draw(c)
    f = ImageFont.truetype(FONT, 46)
    t = "ANCIENT EGYPT"
    b = d.textbbox((0, 0), t, font=f)
    x = (1080 - (b[2] - b[0])) / 2
    d.rectangle((x - 14, 900 - 8, x + (b[2] - b[0]) + 14, 900 + (b[3] - b[1]) + 14), fill=(0, 0, 0))
    d.text((x, 900 - b[1] // 2), t, font=f, fill=GOLD)
    if text.strip():
        words(d, c, text, (60, 975, 1020, 1300), 150)
    c.save(out, "JPEG", quality=92)
    print("[card]", out)


if __name__ == "__main__":
    main()
