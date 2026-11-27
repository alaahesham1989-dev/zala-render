"""The picture reviewer (owner, 2026-11-27): a vision model looks at every picture of every place and hides the ones that do
not belong (books on a pavement under a historic house, a person's portrait, a cemetery under a mosque...). Nothing is deleted:
the site reads the hidden list and skips those pictures. One request per place, thumbnails only, on GitHub, free quota.

State: atlas-work/_review/pictures.json (what was looked at). List the site reads: atlas/world/hidden-pictures.json.
"""
import base64, datetime, json, os, re, subprocess, tempfile, time, urllib.parse, urllib.request

SITE = 'https://www.zalavip.com'
BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev'
UA = {'User-Agent': 'ZalaAtlasPictureCheck/1.0 (https://www.zalavip.com)'}
KEYS = [k for k in (os.environ.get('GEMINI_API_KEY_ATLAS_AUDIO'), os.environ.get('GEMINI_API_KEY_ATLAS')) if k]
MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']
LIMIT = int(os.environ.get('PICTURE_LIMIT') or 300)
ONLY = set((os.environ.get('ONLY') or '').split())
BUCKET = f"s3://{os.environ['R2_BUCKET']}"
TODAY = datetime.date.today().isoformat()
ORDER = 'eg sa ae jo om qa kw bh lb tn ma dz iq mr tr fr it es gb gr de pt nl at ch us jp th mx my id vn in kr sg br ar pe cl co ca za ke tz et gh'.split()
tmp = tempfile.mkdtemp()

ASK = """These numbered pictures are shown to visitors as the gallery of ONE place in a travel guide.
PLACE: {name} ({category}). {summary}
For each picture decide if it belongs. HIDE a picture when it: shows something else than this place or what is inside it
(goods or books on a street, food, cars, a market that is not the place, another building); is mainly a person or a group
(a portrait, a selfie); is a map, plan, drawing, document, poster, logo or stamp (unless the place is a museum and it is one of
its exhibits); shows graves, injury, protest, police or soldiers; or is so dark, blurred or broken that it shows nothing.
KEEP views of the place from outside or inside, its details, its surroundings when the place is clearly visible, and museum exhibits.
If you are not sure, keep it.
Answer JSON only: {{"hide": [{{"n": 3, "why": "a few words"}}]}}"""


def aws(*args, check=True):
    return subprocess.run(['aws', 's3', *args, '--endpoint-url', os.environ['E'], '--no-progress'], check=check, capture_output=True, text=True)


def get(url, tries=3):
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
        except Exception:  # noqa: BLE001
            time.sleep(3 * (i + 1))
    return None


def load_json(url):
    raw = get(url)
    return json.loads(raw) if raw else None


def thumb(url):
    m = re.match(r'https://(?:upload|thumb)\.wikimedia\.org/wikipedia/commons/(?:thumb/)?([0-9a-f]/[0-9a-f]{2})/([^/]+)', url)
    if not m:
        return url
    name = m.group(2)
    suffix = f'lossy-page1-330px-{name}.jpg' if re.search(r'\.tiff?$', name, re.I) else f'330px-{name}.png' if name.lower().endswith('.svg') else f'330px-{name}'
    return f'https://upload.wikimedia.org/wikipedia/commons/thumb/{m.group(1)}/{name}/{suffix}'


def clean(url):
    return url.split('?')[0]


def places(cc):
    """(id, name, category, summary, picture addresses) of one country, as the site shows them."""
    if cc == 'eg':
        for p in load_json(f'{SITE}/atlas-places.json') or []:
            details = load_json(f"{SITE}/atlas-details/{p['slug']}.json") or {}
            pictures = [i.get('url') for i in (p.get('images') or []) + (details.get('images') or [])]
            yield f"eg/{p['slug']}", p['name']['en'], p.get('category', ''), (p.get('summary') or {}).get('en', ''), pictures
    else:
        for r in load_json(f'{SITE}/world/{cc}.json') or []:
            yield f"{cc}/{r['s']}", r['n']['en'], r.get('t', ''), (r.get('d') or {}).get('en', ''), [i['u'] for i in r.get('p', [])]


def look(question, images):
    parts = [{'text': question}]
    for n, data in images:
        kind = 'image/png' if data[:4] == b'\x89PNG' else 'image/jpeg'
        parts += [{'text': f'Picture {n}:'}, {'inline_data': {'mime_type': kind, 'data': base64.b64encode(data).decode()}}]
    body = json.dumps({'contents': [{'parts': parts}], 'generationConfig': {'temperature': 0, 'responseMimeType': 'application/json'}}).encode()
    for model in MODELS:
        for key in KEYS:
            try:
                req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', data=body,
                                             headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
                with urllib.request.urlopen(req, timeout=150) as r:
                    return json.loads(json.load(r)['candidates'][0]['content']['parts'][0]['text'])
            except Exception:  # noqa: BLE001 - next key or model
                time.sleep(4)
    return None


def pull(key, default):
    path = f'{tmp}/{os.path.basename(key)}'
    if aws('cp', f'{BUCKET}/{key}', path, check=False).returncode == 0:
        return json.load(open(path, encoding='utf-8'))
    return default


def push(key, data, cache):
    path = f'{tmp}/{os.path.basename(key)}'
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    aws('cp', path, f'{BUCKET}/{key}', '--content-type', 'application/json; charset=utf-8', '--cache-control', cache)


def main():
    seen = pull('atlas-work/_review/pictures.json', {})
    hidden = pull('atlas/world/hidden-pictures.json', {})
    looked = removed = fails = 0


    def save():
        push('atlas-work/_review/pictures.json', seen, 'no-cache')
        push('atlas/world/hidden-pictures.json', hidden, 'public, max-age=3600')


    for cc in ORDER:
        if looked >= LIMIT or fails >= 4:
            break
        if ONLY and cc not in {o.split('/')[0] for o in ONLY}:
            continue
        for pid, name, category, summary, urls in places(cc):
            if looked >= LIMIT or fails >= 4:
                break
            if (ONLY and pid not in ONLY) or (not ONLY and pid in seen):
                continue
            urls = list(dict.fromkeys(clean(u) for u in urls if u and u.startswith('http')))[:14]
            images = []
            for n, u in enumerate(urls, 1):
                data = get(thumb(u), tries=2)
                if data and len(data) < 900_000:
                    images.append((n, data))
                time.sleep(0.2)
            if not images:
                continue
            answer = look(ASK.format(name=name, category=category, summary=summary[:300]), images)
            if answer is None:
                fails += 1
                continue
            fails = 0
            looked += 1
            drop = {int(h['n']): str(h.get('why', ''))[:80] for h in answer.get('hide', []) if str(h.get('n', '')).isdigit() and 1 <= int(h['n']) <= len(urls)}
            record = {'date': TODAY, 'pictures': len(images), 'hidden': len(drop)}
            if drop and len(drop) >= len(images):
                record = {**record, 'hidden': 0, 'note': 'every picture was refused: needs a person'}
                drop = {}
            for n, why in drop.items():
                hidden[urls[n - 1]] = why
                removed += 1
                print(f'  {pid} picture {n} hidden: {why} | {urllib.parse.unquote(urls[n - 1].rsplit("/", 1)[-1])[:60]}', flush=True)
            seen[pid] = record
            if looked % 20 == 0:
                save()
            time.sleep(3)
    save()
    print(f'[pictures] places looked at {looked}, pictures hidden {removed}, places done so far {len(seen)}', flush=True)


if __name__ == '__main__':
    main()
