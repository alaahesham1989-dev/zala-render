#!/usr/bin/env python3
# Opens the sealed picture of the presenter (the R2 bucket is public: it only travels encrypted) and writes it to
# ads-local/owner.jpg at 1080x1920 with the words "AI scene" burnt in, so no use of it can lose the label.
import hashlib
import hmac
import io
import os
import sys
import urllib.request

import arabic_reshaper
from bidi.algorithm import get_display
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageDraw, ImageFont, ImageOps

job = sys.argv[1]
key = hmac.new(os.environ["R2_SECRET_ACCESS_KEY"].encode(), b"zala-lipsync-v1", hashlib.sha256).digest()
url = f"https://pub-20815a715a814497b24a479c98b1815e.r2.dev/handover/lipsync/{job}/face.png.box"
box = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ZALA-VIP-ads/1.0"}), timeout=60).read()
img = Image.open(io.BytesIO(AESGCM(key).decrypt(box[:12], box[12:], None))).convert("RGB")
img = ImageOps.fit(img, (1080, 1920), Image.LANCZOS, centering=(0.5, 0.3))

d = ImageDraw.Draw(img, "RGBA")
font = None
for path in ("/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf", "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf", "media/brand/fonts/NotoNaskhArabic-Bold.ttf"):
    if os.path.exists(path):
        font = ImageFont.truetype(path, 38, layout_engine=ImageFont.Layout.BASIC)
        break
if font is None:
    sys.exit("no Arabic font: the AI label cannot be written, so the picture is not used")
text = get_display(arabic_reshaper.reshape("مشهد بالذكاء الاصطناعي"))
w = d.textlength(text, font=font)
x, y = (1080 - w) / 2, 118
d.rounded_rectangle([x - 24, y - 10, x + w + 24, y + 62], radius=14, fill=(0, 0, 0, 170))
d.text((x, y), text, font=font, fill=(244, 226, 180, 255))
os.makedirs("ads-local", exist_ok=True)
img.save("ads-local/owner.jpg", quality=92)
print("presenter picture ready, labelled")
