#!/usr/bin/env python3
# Prints word timings of one narration as JSON. Runs on the cloud server only, free and without any API.
import json
import sys

from faster_whisper import WhisperModel

model = WhisperModel("base.en", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], word_timestamps=True, beam_size=1, vad_filter=False, language="en")
out = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for s in segments for w in (s.words or [])]
json.dump(out, sys.stdout)
