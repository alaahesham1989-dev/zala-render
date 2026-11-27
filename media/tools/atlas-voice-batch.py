"""Daily voices for the world map, with a listener (owner, 2026-11-27): use the free voice quota every day, and never publish
a voice that does not say its text.

1) For reviewed guide texts that have no voice yet: make it, have a second model write down what it hears, compare, and upload
   only when they match. Uses the fallback voice models only, so the first one stays for visitors who ask on the spot.
2) Listen to a few older voices each day and record the ones that do not match their text (nothing is changed or removed).
"""
import base64, datetime, difflib, json, os, re, subprocess, tempfile, time, urllib.request

BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev'
SITE = 'https://www.zalavip.com'
UA = {'User-Agent': 'Mozilla/5.0'}
AUDIO_KEY = os.environ['GEMINI_API_KEY_ATLAS_AUDIO']
HEAR_KEYS = [k for k in (AUDIO_KEY, os.environ.get('GEMINI_API_KEY_ATLAS')) if k]
TTS = ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']
HEAR = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
ORDER = 'sa ae jo om qa kw bh lb tn ma dz iq mr tr fr it es gb gr de pt nl at ch us jp th mx my id vn in kr sg br ar pe cl co ca za ke tz et gh'.split()
PLACES = int(os.environ.get('VOICE_PLACES') or 10)  # both languages of each
AUDIT = int(os.environ.get('AUDIT_LIMIT') or 40)
BUCKET = f"s3://{os.environ['R2_BUCKET']}"
TODAY = datetime.date.today().isoformat()
tmp = tempfile.mkdtemp()
spent = set()  # voice models whose daily quota is gone


def aws(*args, check=True):
    return subprocess.run(['aws', 's3', *args, '--endpoint-url', os.environ['E'], '--no-progress'], check=check, capture_output=True, text=True)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def there(key):
    try:
        urllib.request.urlopen(urllib.request.Request(f'{BASE}/{key}', method='HEAD', headers=UA), timeout=30)
        return True
    except Exception:  # noqa: BLE001
        return False


def gemini(model, key, body, timeout=180):
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': key})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def speak(text, voice):
    for model in TTS:
        if model in spent:
            continue
        try:
            out = gemini(model, AUDIO_KEY, {'contents': [{'parts': [{'text': text}]}], 'generationConfig': {
                'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}})
            return base64.b64decode(out['candidates'][0]['content']['parts'][0]['inlineData']['data']), model
        except urllib.error.HTTPError as e:
            if e.code in (429, 404):
                spent.add(model)
            time.sleep(8)
        except Exception:  # noqa: BLE001
            time.sleep(8)
    return None, None


def hear(mp3):
    body = {'contents': [{'parts': [{'inline_data': {'mime_type': 'audio/mpeg', 'data': base64.b64encode(open(mp3, 'rb').read()).decode()}},
                                    {'text': 'Write down every word spoken in this recording, exactly, in the language spoken. Output only the words.'}]}],
            'generationConfig': {'temperature': 0}}
    for _ in range(2):
        for key in HEAR_KEYS:
            for model in HEAR:
                try:
                    return gemini(model, key, body)['candidates'][0]['content']['parts'][0]['text']
                except Exception:  # noqa: BLE001
                    time.sleep(4)
        time.sleep(40)
    return None


def plain(text):
    text = re.sub(r'[ً-ْـ]', '', str(text).lower())
    text = text.translate(str.maketrans('أإآىة', 'اااية'[:5])).replace('’', '').replace("'", '')
    return ' '.join(re.findall(r'[\w]+', text))


def says(heard, text):
    """How close what was heard is to the text, and whether it starts and ends where the text does."""
    a, b = plain(heard), plain(text)
    score = difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()
    edge = lambda x, y: difflib.SequenceMatcher(None, x, y, autojunk=False).ratio() >= 0.55
    return score, score >= 0.78 and edge(a[:30], b[:30]) and edge(a[-30:], b[-30:])


# the honorifics the site shows are spoken too (same rules as atlas-audio.mjs)
def reverent(text):
    out = subprocess.run(['node', '-e', "const s=require('fs').readFileSync('media/tools/atlas-audio.mjs','utf8');"
                          "const a=s.indexOf('const AR_MARKS'), b=s.indexOf('const voice = ');"
                          "const f=new Function(s.slice(a,b)+';return reverent;')();process.stdout.write(f(process.argv[1]))", text],
                         capture_output=True, text=True)
    return out.stdout or text


def make_new():
    aws('sync', f'{BUCKET}/atlas-work', f'{tmp}/w', '--exclude', '*', '--include', '*/scripts/*')
    made = refused = 0
    places = set()
    for cc in ORDER:
        try:
            ranked = [p['slug'] for p in json.loads(get(f'{BASE}/atlas/world/{cc}/places.json'))]
        except Exception:  # noqa: BLE001
            continue
        for slug in ranked:
            path = f'{tmp}/w/{cc}/scripts/{slug}.json'
            if not os.path.exists(path):
                continue
            script = json.load(open(path, encoding='utf-8'))
            if not (script.get('model') == 'curated' or (script.get('review') or {}).get('verdict') in ('ok', 'fix')):
                continue  # only texts the reviewer has passed
            for lang in ('ar', 'en'):
                key = f'atlas/world/{cc}/audio/{slug}.{lang}.mp3'
                if (len(places) >= PLACES and f'{cc}/{slug}' not in places) or len(spent) == len(TTS):
                    return made, refused
                if there(key):
                    continue
                text = reverent(' '.join(str((script.get('narration') or {}).get(lang) or '').split()))
                if not text or len(text) > 2500:
                    continue
                voice = (os.environ.get('ATLAS_VOICE_AR') if lang == 'ar' else os.environ.get('ATLAS_VOICE_EN')) or 'Orus'
                pcm, model = speak(text, voice)
                if not pcm:
                    continue
                pcm_file, mp3 = f'{tmp}/a.pcm', f'{tmp}/a.mp3'
                open(pcm_file, 'wb').write(pcm)
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm_file, '-b:a', '96k', mp3], check=True)
                heard = hear(mp3)
                if heard is None:
                    print('[voices] nobody left to listen today: stopping', flush=True)
                    return made, refused
                score, good = says(heard, text)
                if not good:
                    refused += 1
                    print(f'  refused {cc}/{slug}.{lang} (match {score:.2f}): heard "{heard[:60]}"', flush=True)
                    continue
                aws('cp', mp3, f'{BUCKET}/{key}', '--content-type', 'audio/mpeg', '--cache-control', 'public, max-age=31536000, immutable')
                meta = {'status': 'ready', 'key': key, 'bytes': os.path.getsize(mp3), 'durationSec': round(len(pcm) / 48000), 'voice': voice,
                        'model': model, 'chars': len(text), 'checked': round(score, 2), 'generatedAt': TODAY}
                json.dump(meta, open(f'{tmp}/meta.json', 'w'))
                aws('cp', f'{tmp}/meta.json', f'{BUCKET}/atlas/audio-meta/{cc}__{slug}__{lang}.json', '--content-type', 'application/json')
                made += 1
                places.add(f'{cc}/{slug}')
                print(f'  made {cc}/{slug}.{lang} (match {score:.2f})', flush=True)
                time.sleep(6)
    return made, refused


def audit_old():
    """A few older voices a day: does each one say its written words? Only a record, for a person to look at."""
    log = f'{tmp}/audit.json'
    aws('cp', f'{BUCKET}/atlas-work/_review/audio-audit.json', log, check=False)
    done = json.load(open(log, encoding='utf-8')) if os.path.exists(log) else {}
    items = []
    for p in json.loads(get(f'{SITE}/atlas-places.json')):
        for lang, key in ((p.get('narration') or {}).get('audioKey') or {}).items():
            items.append((key, f"{SITE}/atlas-details/{p['slug']}.json", 'script', lang))
    checked = bad = 0
    for key, text_url, field, lang in items:
        if checked >= AUDIT:
            break
        if key in done:
            continue
        try:
            text = json.loads(get(text_url))[field][lang]
            open(f'{tmp}/o.mp3', 'wb').write(get(f'{BASE}/{key}'))
        except Exception:  # noqa: BLE001
            done[key] = {'result': 'missing file or text', 'date': TODAY}
            continue
        heard = hear(f'{tmp}/o.mp3')
        if heard is None:
            break
        score, good = says(heard, reverent(text))
        done[key] = {'match': round(score, 2), 'result': 'ok' if good else 'differs', 'heard': '' if good else heard[:120], 'date': TODAY}
        checked += 1
        bad += not good
        time.sleep(3)
    json.dump(done, open(log, 'w', encoding='utf-8'), ensure_ascii=False)
    aws('cp', log, f'{BUCKET}/atlas-work/_review/audio-audit.json', '--content-type', 'application/json')
    return checked, bad, len(items) - len([k for k, *_ in items if k in done])


made, refused = make_new()
checked, bad, left = audit_old()
print(f'[voices] made {made} voices, refused {refused}; older voices listened to {checked}, differing {bad}, still to hear {left}', flush=True)
