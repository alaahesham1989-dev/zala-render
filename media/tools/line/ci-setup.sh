# Shared setup of the shorts jobs. Usage: bash media/tools/line/ci-setup.sh content|tools|render
set -euo pipefail
case "$1" in
  content)   # scripts, picture index and plans as every job must see them
    aws s3 sync "s3://${R2_BUCKET}/render-state/content" content --endpoint-url "$E" --no-progress
    git checkout -- content/meta-queue.json
    git checkout -- content/outbox.json 2>/dev/null || true   # the outbox list lives in git like the queue
    mkdir -p content/library && cp media/tools/treasures.json content/library/treasures.json
    ;;
  tools)     # enough to plan and to publish
    sudo apt-get update -y >/dev/null
    sudo apt-get install -y ffmpeg fonts-noto-core >/dev/null
    (cd media && npm ci)
    ;;
  render)    # everything a render needs
    sudo apt-get update -y >/dev/null
    sudo apt-get install -y ffmpeg fonts-noto-core libcairo2-dev libpango1.0-dev pkg-config python3-dev >/dev/null
    (cd media && npm ci && node tools/fetch-fonts.mjs && mkdir -p ~/.local/share/fonts && cp brand/fonts/*.ttf ~/.local/share/fonts/ && fc-cache -f)
    python3 -m venv /tmp/whisper && /tmp/whisper/bin/pip install --quiet faster-whisper
    echo "WHISPER_PY=/tmp/whisper/bin/python" >> "$GITHUB_ENV"
    python3 -m venv /tmp/manim && /tmp/manim/bin/pip install --quiet "manim==0.18.1" "pillow==10.4.0"
    python3 -m venv /tmp/lib && /tmp/lib/bin/pip install --quiet torch torchvision --index-url https://download.pytorch.org/whl/cpu
    /tmp/lib/bin/pip install --quiet open_clip_torch transformers pillow
    for d in voice meta music; do aws s3 sync "s3://${R2_BUCKET}/render-cache/$d" "media/cache/$d" --endpoint-url "$E" --no-progress; done
    ;;
  *) echo "usage: ci-setup.sh content|tools|render"; exit 2 ;;
esac
