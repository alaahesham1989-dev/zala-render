#!/usr/bin/env python3
# Prints word timings of one narration as JSON. Runs on the cloud server only, free and without any API.
# ffmpeg reads the audio, so this does not depend on the version of the audio library the model ships with.
# Usage: words.py <audio> [language]   English (default) keeps the small English model; any other language
# uses a multilingual one (WHISPER_MODEL overrides it).
import json
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel

ffmpeg = os.environ.get("FFMPEG_PATH", "ffmpeg")
lang = sys.argv[2] if len(sys.argv) > 2 else "en"
raw = subprocess.run([ffmpeg, "-v", "error", "-i", sys.argv[1], "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], check=True, capture_output=True).stdout
audio = np.frombuffer(raw, dtype=np.float32)

if lang == "en":
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio, word_timestamps=True, beam_size=1, vad_filter=False, language="en")
else:
    model = WhisperModel(os.environ.get("WHISPER_MODEL") or "small", device="cpu", compute_type="int8")
    # no text from the script is ever given to the model: it must hear on its own, or the check proves nothing
    segments, _ = model.transcribe(audio, word_timestamps=True, beam_size=1, vad_filter=False, language=lang, condition_on_previous_text=False)
out = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)} for s in segments for w in (s.words or [])]
json.dump(out, sys.stdout)
