#!/usr/bin/env bash
# STAGE 2 — MAKE (the director and the editor), the same for every kind of video:
#   episode  a long episode (8–14 min) with its 3 reels
#   short    a standalone short (45–55 s, its own topic)
#   tour     a virtual tour (long); tour-short its short version. The map flight was made in the prep stage
# Picture library, director, gap fill (or the quality stage's fixes), voice, render, thumbnails.
# Usage: bash media/tools/line/make.sh <id> <kind> [quality review.json to fix]
set -uo pipefail
ID="$1"; KIND="$2"; REVIEW="${3:-}"
PY=/tmp/lib/bin/python
case "$KIND" in short|tour-short) SHORT=yes;; *) SHORT=no;; esac
WAIT=$([ $SHORT = yes ] && echo 120 || echo 600)

# a library of checked pictures for this video (the episode keeps more to choose from)
TARGET=$([ "$KIND" = episode ] && echo 220 || echo 40)
$PY media/tools/library_build.py "$ID" --target "$TARGET" || { [ "$KIND" = episode ] && exit 1; echo "make: $ID keeps the pictures it has"; }

# Gemini is sometimes busy for a while: wait and try again instead of giving up the day
if [ "$KIND" = episode ]; then
  ok=no; for i in 1 2 3 4; do node media/zala-render.mjs story "$ID" && { ok=yes; break; }; echo "make: story busy, waiting"; sleep "$WAIT"; done; [ $ok = yes ] || exit 1
fi
if [ -z "$REVIEW" ]; then
  ok=no; for i in 1 2 3 4; do node media/tools/direct.mjs "$ID" && { ok=yes; break; }; echo "make: director busy, waiting"; sleep "$WAIT"; done; [ $ok = yes ] || exit 1
fi

# empty lines get pictures, the quality stage's refused pictures are replaced
if [ -n "$REVIEW" ] && [ -f "$REVIEW" ]; then node media/tools/gapfill.mjs "$ID" --review "$REVIEW"; else node media/tools/gapfill.mjs "$ID"; fi

node media/zala-render.mjs all "$ID" || exit 1
if [ $SHORT = yes ]; then node media/tools/shorts.mjs package "$ID" || exit 1; else $PY media/tools/thumbs.py "media/out/${ID}/publish" "$ID" || true; fi
echo "MAKE: $ID done"
