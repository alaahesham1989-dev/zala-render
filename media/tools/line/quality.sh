#!/usr/bin/env bash
# STAGE 3 — QUALITY, the same for every kind of video. It never throws a video away: what it finds goes back to
# the make stage as a list of fixes (wrong pictures replaced, unheard lines re-voiced) and the video is made again.
#   what is checked: every spoken line against the words (faster-whisper), every picture against its line (Gemini),
#   black frames, silences, the reels, nudity, thumbnails and pacing for long videos.
# Usage: bash media/tools/line/quality.sh <id> <out dir>    -> <out dir>/verdict.json, exit 0 when it passed
set -uo pipefail
ID="$1"; OUT="${2:-review-out}"
rm -rf "$OUT"
node media/tools/review-render.mjs "media/out/${ID}/publish" "content/youtube/${ID}.json" "$OUT" || true
node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1])).pass?0:1)' "$OUT/verdict.json"
