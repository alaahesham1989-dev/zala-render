#!/usr/bin/env python3
"""Reshape Arabic text for renderers.
- With --no-bidi (default for ASS / libass): reshapes connected glyphs ONLY, keeping natural order so libass's native FriBidi handles RTL layout without double-reversal.
- Without --no-bidi (or --bidi, for LTR renderers like Pillow/OpenCV): reshapes and reorders characters via python-bidi.
Usage: one text per line on stdin -> shaped text on stdout.
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

no_bidi = '--no-bidi' in sys.argv

config = {
    'delete_harakat': False,
    'support_ligatures': True,
}
reshaper = arabic_reshaper.ArabicReshaper(configuration=config)

for raw in sys.stdin:
    line = raw.rstrip('\n')
    if not line:
        print('')
        continue
    reshaped = reshaper.reshape(line)
    if no_bidi:
        print(reshaped)
    else:
        print(get_display(reshaped))
