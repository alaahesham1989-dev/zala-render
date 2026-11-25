"""Runs on the GitHub runner: open the encrypted inputs, make a PRIVATE Kaggle dataset and a PRIVATE GPU kernel,
wait for it, and send the finished video back encrypted. Nothing personal is printed or kept as an artifact."""
import hashlib, hmac, json, os, pathlib, subprocess, sys, time, urllib.request

import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

JOB = os.environ['JOB']
assert JOB.isalnum() and 12 <= len(JOB) <= 40, 'bad job name'
USER = os.environ['KAGGLE_USERNAME']
BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev'
KEY = hmac.new(os.environ['R2_SECRET_ACCESS_KEY'].encode(), b'zala-lipsync-v1', hashlib.sha256).digest()
HERE = pathlib.Path(__file__).parent
WORK = pathlib.Path('/tmp/lipsync')
SLUG = f'zala-guide-{JOB[:12]}'


def sh(*args, check=True):
    r = subprocess.run(args, capture_output=True, text=True)
    out = (r.stdout + r.stderr).replace(USER, '<user>')
    print('$', ' '.join(args[:3]), '->', r.returncode)
    if r.returncode and check:
        print(out[-1500:])
        raise SystemExit(1)
    return out


def deliver(got):
    """Fetch what the kernel left and send the video back encrypted."""
    sh('kaggle', 'kernels', 'output', f'{USER}/{SLUG}-run', '-p', str(got), check=False)
    for log in got.glob('steps.txt'):
        print(log.read_text()[-2500:])
    result = got / 'result.mp4'
    if not result.exists():
        raise SystemExit('no video came back')
    iv = os.urandom(12)
    s3 = boto3.client('s3', endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                      aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
                      aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'], region_name='auto')
    s3.put_object(Bucket=os.environ['R2_BUCKET'], Key=f'handover/lipsync/{JOB}/result.mp4.box',
                  Body=iv + AESGCM(KEY).encrypt(iv, result.read_bytes(), None))
    print('result sent back encrypted,', result.stat().st_size, 'bytes')


def status():
    out = sh('kaggle', 'kernels', 'status', f'{USER}/{SLUG}-run', check=False).lower()
    return next((s for s in ('complete', 'error', 'cancel') if s in out), '')


def main():
    data, kern, got = WORK / 'data', WORK / 'kernel', WORK / 'out'
    for d in (data, kern, got):
        d.mkdir(parents=True, exist_ok=True)
    if os.environ.get('FETCH_ONLY') == 'yes':                     # a kernel that waited in Kaggle's queue
        state = status()
        print('kernel state:', state or 'still queued or running')
        if state:
            deliver(got)
        return
    for name in ('face.png', 'voice.wav'):
        req = urllib.request.Request(f'{BASE}/handover/lipsync/{JOB}/{name}.box', headers={'User-Agent': 'zala-render'})
        box = urllib.request.urlopen(req, timeout=120).read()
        (data / name).write_bytes(AESGCM(KEY).decrypt(box[:12], box[12:], None))
        print('opened', name)

    (data / 'dataset-metadata.json').write_text(json.dumps(
        {'title': SLUG, 'id': f'{USER}/{SLUG}', 'licenses': [{'name': 'unknown'}]}))
    sh('kaggle', 'datasets', 'create', '-p', str(data))          # private unless --public is passed
    for _ in range(40):
        if 'ready' in sh('kaggle', 'datasets', 'status', f'{USER}/{SLUG}', check=False).lower():
            break
        time.sleep(15)

    (kern / 'run.py').write_text((HERE / 'kernel.py').read_text())
    (kern / 'kernel-metadata.json').write_text(json.dumps({
        'id': f'{USER}/{SLUG}-run', 'title': f'{SLUG}-run', 'code_file': 'run.py', 'language': 'python',
        'kernel_type': 'script', 'is_private': True, 'enable_gpu': True, 'enable_internet': True,
        'dataset_sources': [f'{USER}/{SLUG}'], 'competition_sources': [], 'kernel_sources': []}))
    print(sh('kaggle', 'kernels', 'push', '-p', str(kern))[-300:])

    state = ''
    for i in range(220):                                          # up to ~110 minutes
        time.sleep(30)
        state = status()
        if state:
            break
    print('kernel state:', state or 'still queued or running: run again with fetch=yes')
    if state:
        deliver(got)

main()
