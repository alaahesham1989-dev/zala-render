#!/usr/bin/env bash
# One video through MAKE and QUALITY, then into the OUTBOX on R2 (the one plate every finished video lands on).
# The quality stage's findings go back to make (up to 3 rounds). Publishing is done later by publisher.mjs.
# Usage: bash media/tools/line/run.sh <id> <kind: episode|short|tour> [review.json from an earlier run]
# Writes PASS=yes|no and TRIES=<n> to $GITHUB_ENV when it is set.
set -uo pipefail
ID="$1"; KIND="$2"; LAST="${3:-}"
pass=no; tries=0
for attempt in 1 2 3; do
  tries=$attempt
  if [ "$attempt" = 1 ]; then review="$LAST"; else review="quality-$ID/verdict.json"; [ -f "quality-$ID/review.json" ] && review="quality-$ID/review.json"; fi
  bash media/tools/line/make.sh "$ID" "$KIND" "$review" || { echo "make stopped ($attempt)"; continue; }
  if bash media/tools/line/quality.sh "$ID" "quality-$ID"; then pass=yes; break; fi
  echo "QUALITY: $ID fixing what the check found (round $attempt)"
done
if [ "$pass" = yes ]; then node media/tools/outbox.mjs put "$ID" "$KIND" "$tries" || pass=no; fi
echo "LINE: $ID $KIND pass=$pass after $tries round(s)"
if [ -n "${GITHUB_ENV:-}" ]; then echo "PASS=$pass" >> "$GITHUB_ENV"; echo "TRIES=$tries" >> "$GITHUB_ENV"; fi
[ "$pass" = yes ]
