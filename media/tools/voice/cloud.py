"""Runner side of box.mjs. `fetch` opens the encrypted bundle into $WORK; `seal` encrypts the results back.
Only these two steps see the storage secrets; the model code (speak.py) runs without them."""
import hashlib, hmac, io, os, sys, urllib.request, zipfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

JOB, WORK = os.environ['JOB'], os.environ['WORK']
KEY = hmac.new(os.environ['R2_SECRET_ACCESS_KEY'].encode(), b'zala-voice-v1', hashlib.sha256).digest()
BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev'

if sys.argv[1] == 'fetch':
    req = urllib.request.Request(f'{BASE}/handover/voice/{JOB}/bundle.box', headers={'User-Agent': 'zala-render'})
    box = urllib.request.urlopen(req, timeout=120).read()
    os.makedirs(WORK, exist_ok=True)
    open(f'{WORK}/bundle.json', 'wb').write(AESGCM(KEY).decrypt(box[:12], box[12:], None))
    print('bundle opened')
else:
    import boto3
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, 'w') as z:
        for name in sorted(os.listdir(f'{WORK}/out')):
            z.write(f'{WORK}/out/{name}', name)
    iv = os.urandom(12)
    s3 = boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                      aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                      aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto')
    s3.put_object(Bucket=os.environ['R2_BUCKET'], Key=f'handover/voice/{JOB}/result.box',
                  Body=iv + AESGCM(KEY).encrypt(iv, mem.getvalue(), None))
    print('result sealed')
