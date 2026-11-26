"""Speak the bundle's lines in the reference voice with VoiceTut-TTS (Egyptian Arabic, apache-2.0) on CPU.
The log is public: print ids and timings only, never the words."""
import base64, json, os, time
from voicetut_tts import VoiceTutTTS

WORK = os.environ['WORK']
b = json.load(open(f'{WORK}/bundle.json', encoding='utf-8'))
os.makedirs(f'{WORK}/out', exist_ok=True)
t = time.time()
tts = VoiceTutTTS.from_pretrained('mohammedaly22/VoiceTut-TTS', device='cpu', dtype='float32')
print(f'model loaded in {time.time() - t:.0f}s', flush=True)
for ref in b['refs']:
    path = f"{WORK}/{ref['id']}.wav"
    open(path, 'wb').write(base64.b64decode(ref['wav']))
    for line in b['lines']:
        t = time.time()
        tts.synthesize(line['text'], ref_audio=path, ref_text=ref['text'], output=f"{WORK}/out/{line['id']}_{ref['id']}.wav")
        print(f"{line['id']} {ref['id']} done in {time.time() - t:.0f}s", flush=True)
