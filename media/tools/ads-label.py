#!/usr/bin/env python3
# Opens the sealed picture of the presenter (the R2 bucket is public: it only travels encrypted) and writes it to
# ads-local/owner.jpg at 1080x1920. No words are written on it (owner's decision 2026-11-26): the platform's
# AI-generated-content switch must be turned on when the ad is uploaded (see aiDisclosure in ads-partners.json).
import hashlib
import hmac
import io
import os
import sys
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageOps

job = sys.argv[1]
key = hmac.new(os.environ["R2_SECRET_ACCESS_KEY"].encode(), b"zala-lipsync-v1", hashlib.sha256).digest()
url = f"https://pub-20815a715a814497b24a479c98b1815e.r2.dev/handover/lipsync/{job}/face.png.box"
box = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ZALA-VIP-ads/1.0"}), timeout=60).read()
img = Image.open(io.BytesIO(AESGCM(key).decrypt(box[:12], box[12:], None))).convert("RGB")
img = ImageOps.fit(img, (1080, 1920), Image.LANCZOS, centering=(0.5, 0.3))

os.makedirs("ads-local", exist_ok=True)
img.save("ads-local/owner.jpg", quality=92)
print("presenter picture ready")
