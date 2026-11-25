"""Runs inside a private Kaggle GPU kernel: MuseTalk 1.5 (MIT, commercial use allowed) lip-syncs one still
picture to one voice file. Everything heavy lives in /kaggle/tmp so only the video and a short log come out."""
import glob, os, pathlib, shutil, subprocess

TMP = pathlib.Path('/kaggle/tmp')
OUT = pathlib.Path('/kaggle/working')
TMP.mkdir(parents=True, exist_ok=True)
STEPS = OUT / 'steps.txt'
VENV = TMP / 'venv'
PY = str(VENV / 'bin' / 'python')
REPO = TMP / 'MuseTalk'


def note(text):
    with open(STEPS, 'a') as f:
        f.write(text + '\n')
    print(text, flush=True)


def sh(cmd, cwd=None, env=None):
    note('$ ' + cmd[:140])
    r = subprocess.run(cmd, shell=True, cwd=cwd, env=env, capture_output=True, text=True)
    if r.returncode:
        note((r.stdout + r.stderr)[-2000:])
        raise SystemExit(f'step failed: {cmd[:80]}')


def find(name):
    hits = glob.glob(f'/kaggle/input/**/{name}', recursive=True)
    if not hits:
        raise SystemExit(f'input missing: {name}')
    return hits[0]


face, voice = find('face.png'), find('voice.wav')
sh('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader >> /kaggle/working/steps.txt')

# MuseTalk wants Python 3.10 and torch 2.0.1; the Kaggle image is newer, so it gets its own environment.
sh('pip -q install uv')
sh(f'uv venv --seed --python 3.10 {VENV}')
sh(f'uv pip install --python {PY} "setuptools<70" wheel')
sh(f'uv pip install --python {PY} torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118')
sh(f'git clone --depth 1 https://github.com/TMElyralab/MuseTalk {REPO}')
wanted = [l.strip() for l in (REPO / 'requirements.txt').read_text().splitlines()
          if l.strip() and not l.startswith(('#', 'tensorflow', 'tensorboard', 'gradio'))]
(TMP / 'req.txt').write_text('\n'.join(wanted) + '\n')
sh(f'uv pip install --python {PY} -r {TMP}/req.txt')
sh(f'uv pip install --python {PY} openmim cython "numpy==1.23.5"')
sh(f'{PY} -m pip install -q --no-build-isolation chumpy')
mim = f'{VENV}/bin/mim'
sh(f'{mim} install mmengine')
sh(f'{mim} install "mmcv==2.0.1"')
sh(f'{mim} install "mmdet==3.1.0"')
sh(f'{mim} install "mmpose==1.1.0"')

fetch = f'''
from huggingface_hub import hf_hub_download as d
M = "{REPO}/models"
for repo, files, sub in [
    ("TMElyralab/MuseTalk", ["musetalkV15/musetalk.json", "musetalkV15/unet.pth"], ""),
    ("stabilityai/sd-vae-ft-mse", ["config.json", "diffusion_pytorch_model.bin"], "sd-vae"),
    ("openai/whisper-tiny", ["config.json", "pytorch_model.bin", "preprocessor_config.json"], "whisper"),
    ("yzd-v/DWPose", ["dw-ll_ucoco_384.pth"], "dwpose"),
]:
    for f in files:
        d(repo_id=repo, filename=f, local_dir=M + ("/" + sub if sub else ""))
'''
(TMP / 'fetch.py').write_text(fetch)
sh(f'{PY} {TMP}/fetch.py')
fp = REPO / 'models' / 'face-parse-bisent'
fp.mkdir(parents=True, exist_ok=True)
sh(f'{PY} -m gdown 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O {fp}/79999_iter.pth')
sh(f'curl -sSL https://download.pytorch.org/models/resnet18-5c106cde.pth -o {fp}/resnet18-5c106cde.pth')

(TMP / 'task.yaml').write_text(f'task_0:\n  video_path: "{face}"\n  audio_path: "{voice}"\n  result_name: "talk.mp4"\n')
env = dict(os.environ, PYTHONPATH=str(REPO))
sh(f'{PY} -m scripts.inference --inference_config {TMP}/task.yaml --result_dir {TMP}/results '
   f'--unet_model_path models/musetalkV15/unet.pth --unet_config models/musetalkV15/musetalk.json '
   f'--version v15 --fps 25', cwd=REPO, env=env)

videos = sorted(glob.glob(f'{TMP}/results/**/*.mp4', recursive=True), key=os.path.getsize)
if not videos:
    raise SystemExit('no video produced')
shutil.copy(videos[-1], OUT / 'result.mp4')
note(f'done: {os.path.getsize(OUT / "result.mp4")} bytes')
