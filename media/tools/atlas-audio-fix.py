"""Voices made while the job still sent a reading instruction speak that instruction first.
Egypt files: cut it off and save as <name>.v2.mp3 (no new voice quota). World files: make them again.
Originals are kept (Egypt) or copied to atlas/audio-old/ (world). Prints one FIX| line per file."""
import base64, difflib, json, os, re, subprocess, tempfile, time, urllib.request

BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev/'
KEY = os.environ['GEMINI_API_KEY_ATLAS_AUDIO']
MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
UA = {'User-Agent': 'Mozilla/5.0'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def heard(path):
    body = json.dumps({'contents': [{'parts': [
        {'inline_data': {'mime_type': 'audio/mpeg', 'data': base64.b64encode(open(path, 'rb').read()).decode()}},
        {'text': 'Write exactly the first 10 words spoken in this recording, in the language spoken. Output only those words.'}]}],
        'generationConfig': {'temperature': 0}}).encode()
    last = ''
    for _ in range(4):
        for m in MODELS:
            try:
                req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent', data=body,
                                             headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.load(r)['candidates'][0]['content']['parts'][0]['text'].strip().replace('\n', ' ')
            except Exception as e:
                last = str(e)
        time.sleep(30)
    raise RuntimeError('transcription unavailable: ' + last)


def words(t):
    return re.findall(r'[a-z0-9]+', t.lower().replace("'", '').replace('’', ''))


def starts_like(spoken, script):
    a, b = words(spoken)[:6], words(script)[:6]
    return bool(a and b) and difflib.SequenceMatcher(None, ' '.join(a)[:28], ' '.join(b)[:28]).ratio() >= 0.7


def silences(path):
    out = subprocess.run(['ffmpeg', '-i', path, '-t', '14', '-af', 'silencedetect=noise=-38dB:d=0.28', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    ends = [float(x) for x in re.findall(r'silence_end: ([0-9.]+)', out)]
    return [e for e in ends if 2.4 <= e <= 11]


def s3(*args):
    subprocess.run(['aws', 's3', *args, '--endpoint-url', os.environ['E'], '--no-progress'], check=True, capture_output=True)


bucket = f"s3://{os.environ['R2_BUCKET']}/"
tmp = tempfile.mkdtemp()
for key in os.environ['KEYS'].split():
    try:
        if key.startswith('atlas/places/') and key.endswith('/audio/en.mp3'):
            slug = key.split('/')[2]
            script = json.loads(get(f'https://www.zalavip.com/atlas-details/{slug}.json'))['script']['en']
            src, out = f'{tmp}/a.mp3', f'{tmp}/b.mp3'
            open(src, 'wb').write(get(BASE + key))
            first = heard(src)
            if os.environ.get('REMAKE') == '1' or slug in ('hurghada-marina', 'three-pools-dahab'):
                gen = subprocess.run(['node', 'media/tools/atlas-audio.mjs', 'eg', slug, 'en'], env={**os.environ, 'ATLAS_FORCE': '1', 'ATLAS_OUT_SUFFIX': '.v2'}, capture_output=True, text=True)
                print(f"FIX|{slug}|{'made again as v2' if gen.returncode == 0 else 'NOT MADE ' + (gen.stderr or '')[-120:]}", flush=True)
                continue
            if starts_like(first, script):
                print(f'FIX|{slug}|clean already', flush=True)
                continue
            done = False
            for end in silences(src)[:4]:
                subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{max(0, end - 0.12):.2f}', '-i', src, '-b:a', '96k', '-ar', '24000', '-ac', '1', out], check=True)
                now = heard(out)
                if starts_like(now, script):
                    new = key[:-len('en.mp3')] + 'en.v2.mp3'
                    s3('cp', out, bucket + new, '--content-type', 'audio/mpeg', '--cache-control', 'public, max-age=31536000, immutable')
                    print(f'FIX|{slug}|trimmed {end:.1f}s', flush=True)
                    done = True
                    break
                time.sleep(2)
            if not done:
                print(f'FIX|{slug}|NOT FIXED heard: {first[:60]}', flush=True)
        elif key.startswith('atlas/world/'):
            _, _, cc, _, name = key.split('/')
            slug, lang = name.rsplit('.', 2)[0], name.rsplit('.', 2)[1]
            s3('cp', bucket + key, bucket + 'atlas/audio-old/' + key)
            r = subprocess.run(['node', 'media/tools/atlas-audio.mjs', cc, slug, lang], env={**os.environ, 'ATLAS_FORCE': '1'}, capture_output=True, text=True)
            print(f"FIX|{slug}.{lang}|{'made again' if r.returncode == 0 else 'NOT MADE ' + (r.stderr or '')[-120:]}", flush=True)
        time.sleep(3)
    except Exception as e:  # noqa: BLE001
        print(f'FIX|{key}|ERROR {str(e)[:120]}', flush=True)
        if 'transcription unavailable' in str(e):
            break
