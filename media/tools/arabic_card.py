#!/usr/bin/env python3
"""Render Arabic text on a background image with proper shaping (Pillow + arabic_reshaper + bidi).
Usage: python3 arabic_card.py <text> <width> <height> <fontsize> <bg_path|-> <out_path>
"""
import sys, os, subprocess, importlib, math

def ensure(*pkgs):
    for pkg, mod in pkgs:
        try:
            importlib.import_module(mod)
        except ImportError:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--quiet', pkg])

ensure(('Pillow', 'PIL'), ('arabic-reshaper', 'arabic_reshaper'), ('python-bidi', 'bidi'))

from PIL import Image, ImageDraw, ImageFont, ImageFilter
import arabic_reshaper
from bidi.algorithm import get_display

def find_arabic_font(size):
    candidates = [
        os.path.join(os.path.dirname(__file__), '..', 'brand', 'fonts', 'NotoNaskhArabic-Bold.ttf'),
        '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf',
        '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    ]
    for p in candidates:
        p = os.path.normpath(p)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def wrap(text, max_chars):
    words = text.split()
    rows, cur = [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if len(trial) <= max_chars:
            cur = trial
        else:
            if cur:
                rows.append(cur)
            cur = w
    if cur:
        rows.append(cur)
    return rows

def add_vignette(img):
    width, height = img.size
    vig = Image.new('L', (width, height), 0)
    vig_draw = ImageDraw.Draw(vig)
    cx, cy = width / 2, height / 2
    max_r = math.sqrt(cx**2 + cy**2)
    # Draw radial gradient as concentric rectangles
    steps = 60
    for i in range(steps, 0, -1):
        ratio = i / steps
        alpha = int(200 * (ratio ** 1.8))
        rx = int(cx * (1 - ratio * 0.95))
        ry = int(cy * (1 - ratio * 0.95))
        vig_draw.rectangle([cx - rx*2, cy - ry*2, cx + rx*2, cy + ry*2], fill=0)
        vig_draw.ellipse([cx - rx*1.6, cy - ry*1.6, cx + rx*1.6, cy + ry*1.6], fill=alpha)
    # Invert: center should be clear, edges dark
    vig = vig.point(lambda x: 255 - x)
    dark = Image.new('RGB', (width, height), (0, 0, 0))
    return Image.composite(dark, img, vig)

def render(text, width, height, fontsize, bg_path, out_path):
    # 1. Background
    if bg_path and bg_path != '-' and os.path.exists(bg_path):
        img = Image.open(bg_path).convert('RGB').resize((width, height), Image.LANCZOS)
        # Cinematic color grade: desaturate slightly + darken
        from PIL import ImageEnhance
        img = ImageEnhance.Color(img).enhance(0.75)
        img = ImageEnhance.Brightness(img).enhance(0.45)
        img = ImageEnhance.Contrast(img).enhance(1.15)
    else:
        img = Image.new('RGB', (width, height), (14, 10, 6))

    # 2. Blur background for depth of field feel
    img = img.filter(ImageFilter.GaussianBlur(radius=14))

    # 3. Vignette
    img = add_vignette(img)

    # 4. Wrap + reshape Arabic
    per = 10 if width < height else 16
    rows_raw = wrap(text, per)
    shaped_rows = [get_display(arabic_reshaper.reshape(r)) for r in rows_raw]

    font = find_arabic_font(fontsize)
    line_h = int(fontsize * 1.4)
    total_h = len(shaped_rows) * line_h
    y_start = (height - total_h) // 2

    draw = ImageDraw.Draw(img)

    # 5. Warm glow behind text (3 passes of decreasing radius)
    for i, row in enumerate(shaped_rows):
        y = y_start + i * line_h
        for radius, color, step in [
            (14, (160, 110, 10), 4),
            (8,  (200, 150, 20), 3),
            (4,  (220, 170, 30), 2),
        ]:
            for ox in range(-radius, radius+1, step):
                for oy in range(-radius, radius+1, step):
                    dist = math.sqrt(ox*ox + oy*oy)
                    if dist > radius:
                        continue
                    alpha = int(80 * (1 - dist/radius))
                    r, g, b = color
                    draw.text((width//2 + ox, y + oy), row, font=font,
                              fill=(r, g, b), anchor='mt')
        # Hard black outline
        for ox, oy in [(-5,0),(5,0),(0,-5),(0,5),(-4,-4),(4,-4),(-4,4),(4,4)]:
            draw.text((width//2 + ox, y + oy), row, font=font, fill=(0,0,0), anchor='mt')
        # Main gold
        draw.text((width//2, y), row, font=font, fill='#D4AF37', anchor='mt')

    # 6. Decorative gold bar
    bar_y = y_start + total_h + 36
    bar_cx = width // 2
    bar_w = min(400, width - 120)
    # Thin top line
    draw.rectangle([bar_cx - bar_w//2, bar_y, bar_cx + bar_w//2, bar_y + 2], fill='#8B6914')
    # Main thick line
    draw.rectangle([bar_cx - bar_w//2 + 24, bar_y + 4, bar_cx + bar_w//2 - 24, bar_y + 11], fill='#D4AF37')
    # Thin bottom line
    draw.rectangle([bar_cx - bar_w//2, bar_y + 13, bar_cx + bar_w//2, bar_y + 15], fill='#8B6914')
    # Center diamond
    diamond_size = 8
    pts = [(bar_cx, bar_y - diamond_size + 7),
           (bar_cx + diamond_size, bar_y + 7),
           (bar_cx, bar_y + diamond_size + 7),
           (bar_cx - diamond_size, bar_y + 7)]
    draw.polygon(pts, fill='#D4AF37')

    img.save(out_path, 'JPEG', quality=95)

if __name__ == '__main__':
    if len(sys.argv) < 7:
        print(f"Usage: {sys.argv[0]} text width height fontsize bg_path out_path")
        sys.exit(1)
    render(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], sys.argv[6])
    print(f"OK: {sys.argv[6]}")
