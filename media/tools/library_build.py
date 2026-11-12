"""Builds the picture library for one episode on the server, with no paid service and no Gemini quota.

Sources (all open, all free):  Wikimedia Commons (open licences only), The Met Open Access (public domain),
and Pixabay photos (free key). Each picture is checked here, on this machine:
  - size: the short side must be at least 900 px
  - duplicates: the same picture from two sources is kept once (average hash)
  - CLIP (open_clip ViT-B-32): what kind of picture it is, whether it shows gold, jewellery or treasure,
    whether it is modern, poor, or shows nudity
  - BLIP: a short sentence of what is visible, so the story writer and the director know the picture
Good pictures go to R2 (vault/library/<episode>/) and into content/library/items.jsonl with the same fields
the director already uses, so the director does not need to look at them again.

Usage: python library_build.py <episode id> [--target 220]
The episode's title, words and searches come from content/library/treasures.json.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import torch
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CONTENT = os.path.join(REPO, "content")
ITEMS = os.path.join(CONTENT, "library", "items.jsonl")
TOPICS = os.path.join(CONTENT, "library", "topics.json")
PLAN = os.path.join(CONTENT, "youtube", "production-matrix.json")
UA = {"User-Agent": "ZalaRender/1.0 (https://www.zalavip.com)"}
OPEN = re.compile(r"^(cc0|cc by(-sa)?( [\d.]+)?|public domain|pd\b|no restrictions)", re.I)


def log(*a):
    print("[library]", *a, flush=True)


def get_json(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as e:
            log(f"  {type(e).__name__} on {url[:80]}")
            time.sleep(3 * (i + 1))
    return {}


def get_bytes(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
            return r.read()
    except Exception:
        return None


# ── sources ─────────────────────────────────────────────────────────────
def commons(query, limit=40):
    api = ("https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6"
           f"&gsrlimit={limit}&gsrsearch={urllib.parse.quote(query + ' filetype:bitmap')}"
           "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2400")
    out = []
    for p in (get_json(api).get("query", {}).get("pages", {}) or {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        lic = re.sub(r"<[^>]+>", "", (meta.get("LicenseShortName") or {}).get("value", "")).strip()
        if not ii or not OPEN.search(lic) or re.search(r"\bnc\b|\bnd\b", lic, re.I):
            continue
        if min(ii.get("width", 0), ii.get("height", 0)) < 900:
            continue
        author = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip()[:80] or "Wikimedia Commons"
        out.append({"title": p["title"].replace("File:", "").rsplit(".", 1)[0], "url": ii.get("thumburl") or ii["url"],
                    "source_url": ii.get("descriptionurl"), "license": lic, "author": author, "source": "Wikimedia Commons"})
    return out


def met(query, limit=40):
    ids = (get_json("https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=" + urllib.parse.quote(query))
           .get("objectIDs") or [])[:limit]
    out = []
    for oid in ids:
        o = get_json(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{oid}")
        if not o.get("isPublicDomain") or not o.get("primaryImage"):
            continue
        title = " ".join(x for x in [o.get("title"), o.get("objectDate"), o.get("medium")] if x)[:160]
        out.append({"title": title, "url": o["primaryImage"], "source_url": o.get("objectURL"), "license": "Public domain",
                    "author": "The Metropolitan Museum of Art", "source": "The Met Open Access"})
        time.sleep(0.15)
    return out


def pixabay(query, limit=30):
    key = os.environ.get("PIXABAY_API_KEY")
    if not key:
        return []
    j = get_json(f"https://pixabay.com/api/?key={key}&q={urllib.parse.quote(query[:100])}&image_type=photo&safesearch=true&per_page={limit}&min_width=1600")
    return [{"title": (h.get("tags") or query)[:120], "url": h["largeImageURL"], "source_url": h["pageURL"], "license": "Pixabay Content License",
             "author": h.get("user", "Pixabay"), "source": "Pixabay"} for h in j.get("hits", [])
            # stock search returns anything that shares a word (a suitcase of coins for "treasure"): keep only Egyptian pictures
            if EGYPT_TAGS.search(h.get("tags") or "")]


EGYPT_TAGS = re.compile(r"egypt|pharaoh|pyramid|hieroglyph|sphinx|tutankh|nile|luxor|karnak|giza|cairo|aswan|abu simbel|mummy|sarcophag|papyrus|anubis|horus|scarab|nefert|cleopatra|ramses|tanis|saqqara", re.I)


# ── local eyes ──────────────────────────────────────────────────────────
class Eyes:
    KINDS = {
        "ancient-object": "a photo of an ancient Egyptian museum object",
        "ancient-site": "a photo of an ancient Egyptian temple, tomb or pyramid",
        "ancient-art": "a photo of an ancient Egyptian painting or relief",
        "later-painting": "a 19th century painting",
        "later-engraving": "an old engraving or drawing",
        "map": "a map",
        "modern-photo": "a modern photo of people, streets or cars",
        "modern-building": "a modern building",
    }
    SHINE = ["a photo of gold", "a photo of golden jewellery", "a photo of a treasure", "a photo of precious gems"]
    PLAIN = ["a photo of plain stone", "a photo of sand", "a photo of a wall"]

    def __init__(self):
        import open_clip
        from transformers import BlipForConditionalGeneration, BlipProcessor
        self.model, _, self.pre = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
        self.tok = open_clip.get_tokenizer("ViT-B-32")
        self.model.eval()
        self.cap_proc = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
        self.cap = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base").eval()
        with torch.no_grad():
            self.kind_t = self.text(list(self.KINDS.values()))
            self.shine_t = self.text(self.SHINE + self.PLAIN)
            self.nude_t = self.text(["a photo of a nude person", "a photo of a clothed person", "a photo of an object"])
            self.poor_t = self.text(["a blurry low quality photo", "a sharp high quality photo"])

    def text(self, labels):
        t = self.model.encode_text(self.tok(labels))
        return t / t.norm(dim=-1, keepdim=True)

    def look(self, img):
        with torch.no_grad():
            v = self.model.encode_image(self.pre(img).unsqueeze(0))
            v = v / v.norm(dim=-1, keepdim=True)
            p = lambda t: (100 * v @ t.T).softmax(dim=-1)[0].tolist()
            kinds = p(self.kind_t)
            shine = p(self.shine_t)
            nude = p(self.nude_t)
            poor = p(self.poor_t)
            inputs = self.cap_proc(img.convert("RGB"), return_tensors="pt")
            what = self.cap_proc.decode(self.cap.generate(**inputs, max_new_tokens=30)[0], skip_special_tokens=True)
        kind = list(self.KINDS)[max(range(len(kinds)), key=kinds.__getitem__)]
        return {"kind": kind, "shine": round(sum(shine[:4]), 3), "nudity": nude[0] > 0.55, "poor": poor[0] > 0.7,
                "modern": kind.startswith("modern"), "what": what[:1].upper() + what[1:] + "."}


def ahash(img):
    small = img.convert("L").resize((8, 8))
    px = list(small.getdata())
    avg = sum(px) / 64
    return "".join("1" if x > avg else "0" for x in px)


def upload(data, key):
    bucket, acc = os.environ["R2_BUCKET"], os.environ["R2_ACCOUNT_ID"]
    subprocess.run(["aws", "s3", "cp", "-", f"s3://{bucket}/{key}", "--endpoint-url", f"https://{acc}.r2.cloudflarestorage.com",
                    "--content-type", "image/jpeg", "--no-progress"], input=data, check=True)
    return f"{os.environ['VITE_MEDIA_BASE_URL'].rstrip('/')}/{key}"


def main():
    ep = sys.argv[1]
    target = int(sys.argv[sys.argv.index("--target") + 1]) if "--target" in sys.argv else 220
    spec = json.load(open(os.path.join(CONTENT, "library", "treasures.json"), encoding="utf-8"))[ep]

    # the episode joins the topic list and the plan, so the story writer and the director know it
    topics = json.load(open(TOPICS, encoding="utf-8"))
    topics[ep] = {k: spec[k] for k in ("title", "match", "queries")} | {"archive": spec.get("archive", spec["title"])}
    json.dump(topics, open(TOPICS, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    plan = json.load(open(PLAN, encoding="utf-8"))
    plan["long_episodes"] = [e for e in plan["long_episodes"] if e.get("id") != ep] + [
        {"id": ep, "title_en": spec["title"], "hook": spec.get("hook", ""), "target_duration_sec": spec.get("seconds", 480)}]
    json.dump(plan, open(PLAN, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    items = [json.loads(l) for l in open(ITEMS, encoding="utf-8") if l.strip()]
    have = {i.get("source_url") for i in items}
    hashes = {i.get("ahash") for i in items if i.get("ahash")}
    mine = [i for i in items if ep in (i.get("topics") or []) and (i.get("seen") or {}).get("usable")]
    log(f"{ep}: {len(mine)} usable pictures already, target {target}")
    if len(mine) >= target:
        return

    eyes = Eyes()
    found = []
    for q in spec["queries"]:
        for src in (met, commons, pixabay):
            found += [c for c in src(q) if c["source_url"] not in have]
        have |= {c["source_url"] for c in found}
    log(f"{len(found)} candidates from {len(spec['queries'])} searches")

    added = 0
    for c in found:
        if len(mine) + added >= target:
            break
        data = get_bytes(c["url"])
        if not data:
            continue
        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            continue
        if min(img.size) < 900:
            continue
        h = ahash(img)
        if h in hashes:
            continue
        seen = eyes.look(img)
        if seen["nudity"] or seen["poor"]:
            continue
        hashes.add(h)
        img.thumbnail((2400, 2400))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        pid = hashlib.sha1(c["source_url"].encode()).hexdigest()[:14]
        url = upload(buf.getvalue(), f"vault/library/{ep}/{pid}.jpg")
        items.append({
            "id": pid, "kind": "image", "title": c["title"], "url": url, "source": c["source"], "source_url": c["source_url"],
            "license": c["license"], "author": c["author"], "note": "", "topics": [ep], "ahash": h, "shine": seen["shine"],
            "seen": {"usable": True, "what": seen["what"], "subject": c["title"][:80], "period": "", "place": "",
                     "type": seen["kind"], "mood": "golden" if seen["shine"] > 0.5 else "",
                     "check": {"nudity": False, "modern": seen["modern"], "poor": False, "kind": seen["kind"], "note": "local check"}},
        })
        added += 1
        if added % 20 == 0:
            log(f"  {added} added")
    with open(ITEMS, "w", encoding="utf-8") as f:
        f.write("\n".join(json.dumps(i, ensure_ascii=False) for i in items) + "\n")
    gold = sum(1 for i in items if ep in (i.get("topics") or []) and i.get("shine", 0) > 0.5)
    log(f"{ep}: added {added}, now {len(mine) + added} pictures, {gold} of them golden")


if __name__ == "__main__":
    main()
