#!/usr/bin/env python3
"""Reshape + bidi-reorder Arabic text for renderers that do not shape it on their own (ffmpeg/libass, found
broken on ZV-AR01's word-timed captions: connected letters came out disconnected and in the wrong order).
Already used the same way for static title cards — see arabic_card.py.
Usage: one text per line on stdin -> the same number of lines on stdout, each shaped for display.
"""
import sys
import subprocess
import importlib


def ensure(pkg, mod):
    try:
        importlib.import_module(mod)
    except ImportError:
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', pkg])


ensure('arabic-reshaper', 'arabic_reshaper')
ensure('python-bidi', 'bidi')

import arabic_reshaper
from bidi.algorithm import get_display

for raw in sys.stdin:
    line = raw.rstrip('\n')
    print(get_display(arabic_reshaper.reshape(line)) if line else '')
