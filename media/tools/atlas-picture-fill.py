"""Bring every place up to nine pictures (owner, 2026-11-27). Runs after the picture reviewer.

For places with fewer than nine good pictures: look for free-licensed ones on Wikimedia Commons (by name and by position)
and Openverse, let the same vision model refuse what does not belong, and add the rest. Places still short are listed in
atlas/world/pictures-missing.json for whoever produces pictures. Nothing is downloaded except thumbnails for the check.

State: atlas-work/_review/pictures-filled.json. Lists the site reads: atlas/world/added-pictures.json.
"""
import importlib.util, json, os, re, sys, time, urllib.parse

spec = importlib.util.spec_from_file_location('review', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'atlas-picture-review.py'))
lib = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lib)
get, thumb, clean, look, pull, push, load_json = lib.get, lib.thumb, lib.clean, lib.look, lib.pull, lib.push, lib.load_json

TARGET = 9
LIMIT = int(os.environ.get('FILL_LIMIT') or 150)
ONLY = set((os.environ.get('ONLY') or '').split())
FREE = re.compile(r'^(cc0|public domain|pd|cc by(-sa)? [0-9.]+|by(-sa)?|cc0 1\.0)', re.I)
NOT_PHOTO = re.compile(r'map|plan|stamp|coin|banknote|drawing|logo|flag|diagram|poster|portrait|locator', re.I)
openverse_left = 80  # the anonymous allowance is small

ASK = """These numbered pictures were found by search and may be added to the gallery of ONE place in a travel guide.
PLACE: {name} ({category}). {summary}
Be strict: ACCEPT a picture only when you are confident it shows THIS place (its outside, inside, details, or exhibits if it is a
museum). Refuse anything of another or an unidentifiable place, people as the subject, goods, food, cars, maps, documents,
graves, protest, police or soldiers, and poor or near-duplicate pictures.
Answer JSON only: {{"accept": [1, 4]}}"""


def name_of(url):
    """The file itself, whatever size or address it is linked by."""
    last = urllib.parse.unquote(clean(url).rsplit('/', 1)[-1])
    return re.sub(r'^(lossy-page1-)?\d+px-', '', last).replace(' ', '_').lower()


def plain(v):
    return ' '.join(re.sub(r'<[^>]+>', ' ', str(v or '')).split())


def commons(params):
    q = {'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata', **params}
    data = load_json('https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(q)) or {}
    for page in sorted(data.get('query', {}).get('pages', {}).values(), key=lambda p: p.get('index', 0)):
        info = (page.get('imageinfo') or [{}])[0]
        meta = info.get('extmetadata', {})
        licence = plain(meta.get('LicenseShortName', {}).get('value'))
        url = info.get('url', '').split('?')[0]
        if (FREE.match(licence) and info.get('width', 0) >= 900 and re.search(r'\.(jpe?g|png)$', url, re.I) and not NOT_PHOTO.search(page.get('title', ''))):
            yield {'u': url, 'a': plain(meta.get('Artist', {}).get('value'))[:80] or 'Wikimedia Commons', 'l': licence, 's': info.get('descriptionurl', '')}


def openverse(name):
    global openverse_left
    if openverse_left <= 0:
        return
    openverse_left -= 1
    data = load_json('https://api.openverse.org/v1/images/?' + urllib.parse.urlencode(
        {'q': f'"{name}"', 'license_type': 'commercial,modification', 'page_size': 10, 'mature': 'false'})) or {}
    for r in data.get('results', []):
        if r.get('width') and r['width'] >= 900 and not NOT_PHOTO.search(r.get('title') or ''):
            yield {'u': r['url'], 'a': plain(r.get('creator'))[:80] or r.get('source', 'Openverse'),
                   'l': f"CC {r.get('license', '').upper()} {r.get('license_version') or ''}".strip().replace('CC CC0', 'CC0'), 's': r.get('foreign_landing_url', '')}


def candidates(name_en, name_ar, lat, lng, known):
    found = {}
    searches = [commons({'generator': 'search', 'gsrnamespace': 6, 'gsrlimit': 20, 'gsrsearch': f'"{name_en}"'})]
    if name_ar and name_ar != name_en:
        searches.append(commons({'generator': 'search', 'gsrnamespace': 6, 'gsrlimit': 10, 'gsrsearch': f'"{name_ar}"'}))
    if lat is not None:
        searches.append(commons({'generator': 'geosearch', 'ggsnamespace': 6, 'ggslimit': 20, 'ggsradius': 150, 'ggscoord': f'{lat}|{lng}'}))
    searches.append(openverse(name_en))
    for search in searches:
        for c in search:
            key = name_of(c['u'])
            if key not in known and key not in found:
                found[key] = c
        if len(found) >= 14:
            break
        time.sleep(0.5)
    return list(found.values())[:14]


def places(cc):
    if cc == 'eg':
        for p in load_json(f'{lib.SITE}/atlas-places.json') or []:
            yield (f"eg/{p['slug']}", p['name']['en'], p['name'].get('ar'), p.get('category', ''), (p.get('summary') or {}).get('en', ''),
                   p.get('lat'), p.get('lng'), [i.get('url') for i in p.get('images') or []])
    else:
        for r in load_json(f'{lib.SITE}/world/{cc}.json') or []:
            yield (f"{cc}/{r['s']}", r['n']['en'], r['n'].get('ar'), r.get('t', ''), (r.get('d') or {}).get('en', ''), r.get('la'), r.get('lo'),
                   [i['u'] for i in r.get('p', [])])


seen = pull('atlas-work/_review/pictures.json', {})
hidden = pull('atlas/world/hidden-pictures.json', {})
filled = pull('atlas-work/_review/pictures-filled.json', {})
added = pull('atlas/world/added-pictures.json', {})
missing = pull('atlas/world/pictures-missing.json', {})
done = gained = fails = 0


def save():
    push('atlas-work/_review/pictures-filled.json', filled, 'no-cache')
    push('atlas/world/added-pictures.json', added, 'public, max-age=3600')
    push('atlas/world/pictures-missing.json', missing, 'public, max-age=3600')


for cc in lib.ORDER:
    if done >= LIMIT or fails >= 4:
        break
    if ONLY and cc not in {o.split('/')[0] for o in ONLY}:
        continue
    for pid, name_en, name_ar, category, summary, lat, lng, urls in places(cc):
        if done >= LIMIT or fails >= 4:
            break
        if (ONLY and pid not in ONLY) or (not ONLY and (pid in filled or pid not in seen)):
            continue  # only places whose own pictures were looked at, once each
        refused = {name_of(u) for u in hidden}
        # an earlier addition that is really one of the place's own files is dropped from our list
        own = {name_of(u) for u in urls if u}
        added[pid] = [a for a in added.get(pid, []) if name_of(a['u']) not in own]
        if not added[pid]:
            del added[pid]
        good = [name_of(u) for u in urls if u and clean(u) not in hidden] + [name_of(a['u']) for a in added.get(pid, [])]
        good = list(dict.fromkeys(good))
        need = TARGET - len(good)
        if need <= 0:
            filled[pid] = len(good)
            missing.pop(pid, None)
            continue
        known = own | set(good) | refused
        pool = candidates(name_en, name_ar, lat, lng, known)
        images, kept = [], []
        for c in pool:
            data = get(thumb(c['u']) if 'wikimedia' in c['u'] else c['u'], tries=1)
            if data and len(data) < 900_000 and data[:3] in (b'\xff\xd8\xff', b'\x89PN'):
                kept.append(c)
                images.append((len(kept), data))
            time.sleep(0.2)
        accept = []
        if images:
            answer = look(ASK.format(name=name_en, category=category, summary=summary[:300]), images)
            if answer is None:
                fails += 1
                continue
            accept = [int(n) for n in answer.get('accept', []) if str(n).isdigit() and 1 <= int(n) <= len(kept)]
        fails = 0
        done += 1
        new = [kept[n - 1] for n in dict.fromkeys(accept)][:need]
        if new:
            added[pid] = added.get(pid, []) + new
            gained += len(new)
        total = len(good) + len(new)
        filled[pid] = total
        if total < TARGET:
            missing[pid] = {'name': name_en, 'ar': name_ar, 'have': total, 'need': TARGET - total}
        else:
            missing.pop(pid, None)
        print(f'  {pid}: had {len(good)}, added {len(new)} of {len(kept)} found', flush=True)
        if done % 20 == 0:
            save()
        time.sleep(3)
save()
print(f'[fill] places searched {done}, pictures added {gained}, places still under nine {len(missing)}', flush=True)
