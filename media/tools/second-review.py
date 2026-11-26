# A second pair of ears and eyes on finished test videos: Gemini listens to and watches each one.
# Runs on the cloud server only. The key comes from the repository secret and is never printed. Read only.
import json, os, time, urllib.request, urllib.error

KEY = os.environ['GEMINI_API_KEY']
B = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev/renders'
G = 'https://generativelanguage.googleapis.com'
MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
UA = {'User-Agent': 'zala-review/1.0'}

def fetch(url, timeout=600):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()

def get_json(url):
    try:
        return json.loads(fetch(url, 60).decode('utf-8'))
    except Exception:
        return None

def narration(script):
    out = []
    def walk(o):
        if isinstance(o, dict):
            for l in o.get('lines') if isinstance(o.get('lines'), list) else []:
                if isinstance(l, dict):
                    t = l.get('ar') or l.get('es') or l.get('text') or l.get('en')
                    if t:
                        out.append(str(t))
            for k, v in o.items():
                if k != 'lines':
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(script or {})
    return out

def upload(vid, blob):
    start = urllib.request.Request(f'{G}/upload/v1beta/files', data=json.dumps({'file': {'display_name': vid}}).encode(), headers={
        'x-goog-api-key': KEY, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': str(len(blob)), 'X-Goog-Upload-Header-Content-Type': 'video/mp4', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(start, timeout=120) as r:
        url = r.headers['X-Goog-Upload-URL']
    done = urllib.request.Request(url, data=blob, headers={'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'Content-Length': str(len(blob))})
    with urllib.request.urlopen(done, timeout=900) as r:
        info = json.loads(r.read())['file']
    for _ in range(90):
        if info.get('state') != 'PROCESSING':
            break
        time.sleep(4)
        info = json.loads(fetch_with_key(f"{G}/v1beta/{info['name']}"))
    return info['uri']

def fetch_with_key(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'x-goog-api-key': KEY}), timeout=60) as r:
        return r.read()

PROMPT = '''You are a strict quality inspector. Listen to the whole audio and watch the whole video. The narration language is {lang}.
The intended narration lines are below, in order. Answer in English as JSON only:
{{"audio_ok": true|false,
 "audio_problems": [{{"time":"m:ss","problem":"mispronounced / garbled / cut off / missing line / wrong language / robotic / music too loud / silence"}}],
 "lines_missing_or_changed": ["..."],
 "captions_problems": [{{"time":"m:ss","problem":""}}],
 "picture_problems": [{{"time":"m:ss","problem":"repeated picture / unrelated to the words / watermark / too dark / low quality"}}],
 "subscribe_spoken": true|false,
 "overall": "one sentence"}}
Only report what you actually hear or see. Intended narration:
{lines}'''

for vid, lang in [('ZV-ART01', 'Egyptian Arabic'), ('ZV-ENT01', 'English'), ('ZV-EST01', 'Spanish')]:
    lines = narration(get_json(f'{B}/{vid}/script.json'))
    uri = upload(vid, fetch(f'{B}/{vid}/publish/{vid}.mp4'))
    body = {'contents': [{'parts': [
        {'file_data': {'file_uri': uri, 'mime_type': 'video/mp4'}},
        {'text': PROMPT.format(lang=lang, lines='\n'.join(f'{i + 1}. {t}' for i, t in enumerate(lines)) or '(not available)')}]}],
        'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0.1}}
    for model in MODELS:
        req = urllib.request.Request(f'{G}/v1beta/models/{model}:generateContent', data=json.dumps(body).encode(),
                                     headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.loads(r.read().decode('utf-8'))
            review = json.loads(data['candidates'][0]['content']['parts'][0]['text'])
            print('REVIEW', vid, model, f'lines={len(lines)}', json.dumps(review, ensure_ascii=False, separators=(',', ':')), flush=True)
            break
        except urllib.error.HTTPError as e:
            print(vid, model, e.code, e.read().decode('utf-8', 'replace')[:200].replace('\n', ' '), flush=True)
        except Exception as e:
            print(vid, model, type(e).__name__, str(e)[:150], flush=True)
