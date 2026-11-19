#!/usr/bin/env python3
# Audience cue (subscribe / follow / like) for every video: an animated panel in the brand look, a soft chime when the
# button is pressed and, on a long video, a short spoken line when its audio file exists. Never in the first 3 s of a
# short or the first 15 s of a long. Never fatal: if anything fails the video is left exactly as it was.
# Usage: cta.py <id> --lang en|ar [--kind auto|short|long] [--dir media/out/<id>/publish]
#        cta.py --file in.mp4 --out out.mp4 --lang ar --force        (preview / test)
# The switch per language is media/brand/cta/enabled.json; --force ignores it.
import argparse, glob, hashlib, json, math, os, subprocess, sys, tempfile

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception as e:  # pillow missing: skip quietly
    print(f"cta: Pillow not available ({e}), skipped")
    sys.exit(0)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FPS = 30
S = 2  # supersampling
GOLD = (201, 164, 92, 255)
RED = (230, 33, 23, 255)
GREY = (58, 54, 48, 255)
CREAM = (243, 237, 226, 255)
INK = (14, 12, 10, 255)
PANEL = (14, 12, 10, 236)

FONTS = {
    'en': ['media/brand/fonts/Lato-Bold.ttf', '/usr/share/fonts/**/Lato-Bold.ttf', '/usr/share/fonts/**/DejaVuSans-Bold.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
    'ar': ['/usr/share/fonts/**/NotoNaskhArabic-Bold.ttf', '/usr/share/fonts/**/NotoNaskhArabic*.ttf', '/usr/share/fonts/**/NotoSansArabic*Bold*.ttf',
           '/usr/share/fonts/**/NotoSansArabic*.ttf', '/usr/share/fonts/**/Amiri*.ttf', 'C:/Windows/Fonts/arialbd.ttf'],
}


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe(path):
    j = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]).stdout)
    v = next(s for s in j['streams'] if s['codec_type'] == 'video')
    has_audio = any(s['codec_type'] == 'audio' for s in j['streams'])
    return float(j['format']['duration']), int(v['width']), int(v['height']), has_audio


def sha1(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def font_path(lang):
    for pat in FONTS[lang]:
        hits = sorted(glob.glob(pat if os.path.isabs(pat) or ':' in pat else os.path.join(ROOT, pat), recursive=True))
        if hits:
            return hits[0]
    raise RuntimeError(f'no font for {lang}')


def shape(text, lang):
    if lang != 'ar':
        return text
    import arabic_reshaper
    from bidi.algorithm import get_display
    return get_display(arabic_reshaper.reshape(text))


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def ease_out(x):
    return 1 - (1 - clamp(x)) ** 3


def lerp(a, b, k):
    return tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(4))


# ---------- drawing ----------
def bell_layer(size, angle, fill):
    s = int(size)
    layer = Image.new('RGBA', (3 * s, 3 * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = 1.5 * s, 1.5 * s
    d.ellipse([cx - .30 * s, cy - .46 * s, cx + .30 * s, cy + .14 * s], fill=fill)
    d.polygon([(cx - .30 * s, cy - .10 * s), (cx + .30 * s, cy - .10 * s), (cx + .44 * s, cy + .26 * s), (cx - .44 * s, cy + .26 * s)], fill=fill)
    d.rounded_rectangle([cx - .48 * s, cy + .22 * s, cx + .48 * s, cy + .32 * s], radius=.05 * s, fill=fill)
    d.ellipse([cx - .09 * s, cy + .34 * s, cx + .09 * s, cy + .52 * s], fill=fill)
    d.ellipse([cx - .06 * s, cy - .56 * s, cx + .06 * s, cy - .44 * s], fill=fill)
    return layer.rotate(angle, center=(cx, cy - .50 * s), resample=Image.BICUBIC)


def draw_thumb(d, cx, cy, size, fill, bg):
    s = size
    d.rounded_rectangle([cx - .44 * s, cy - .04 * s, cx - .20 * s, cy + .42 * s], radius=.05 * s, fill=fill)
    d.rounded_rectangle([cx - .14 * s, cy - .02 * s, cx + .46 * s, cy + .42 * s], radius=.09 * s, fill=fill)
    d.rounded_rectangle([cx - .06 * s, cy - .42 * s, cx + .16 * s, cy + .06 * s], radius=.10 * s, fill=fill)
    for k in (0.10, 0.21, 0.32):
        d.line([cx - .10 * s, cy + k * s, cx + .40 * s, cy + k * s], fill=bg, width=max(1, int(.025 * s)))


class Cue:
    def __init__(self, ctype, length, press, cfg, lang, W, H, voiced=False):
        self.ctype, self.L, self.press, self.lang = ctype, length, press, lang
        self.rtl = lang == 'ar'
        self.u = u = min(W, H) / 1080.0
        lab, tag = cfg['labels'], cfg['taglines']
        if ctype == 'short':
            if voiced:   # the spoken line says subscribe, so the button says it too
                self.tag, self.b0, self.b1, self.style = tag['short'], lab['subscribe'], lab['subscribed'], 'red'
            else:
                self.tag, self.b0, self.b1, self.style = tag['short'], lab['follow'], lab['followed'], 'gold'
        elif ctype == 'main':
            self.tag, self.b0, self.b1, self.style = tag['long_main'], lab['subscribe'], lab['subscribed'], 'red'
        else:
            self.tag, self.b0, self.b1, self.style = None, lab['subscribe'], lab['subscribed'], 'red'
        self.like = ctype != 'soft'
        fp = font_path(lang)
        self.f_btn = ImageFont.truetype(fp, int(34 * u * S))
        self.f_tag = ImageFont.truetype(fp, int(27 * u * S))
        probe_d = ImageDraw.Draw(Image.new('RGBA', (10, 10)))
        wid = lambda t, f: probe_d.textlength(shape(t, lang), font=f) / S
        self.bw = max(wid(self.b0, self.f_btn), wid(self.b1, self.f_btn)) + 70 * u
        self.bh = 62 * u
        self.icon = 58 * u
        gap = 22 * u
        self.gap = gap
        row_w = self.icon + gap + self.bw + ((gap + self.icon) if self.like else 0)
        tag_w = wid(self.tag, self.f_tag) if self.tag else 0
        pad = 26 * u
        self.pad = pad
        self.row_w = row_w
        self.pw = max(row_w, tag_w) + 2 * pad
        self.tag_h = 38 * u if self.tag else 0
        self.ph = self.bh + 2 * pad + self.tag_h
        self.slide = 46 * u
        self.cw, self.ch = int(math.ceil(self.pw)), int(math.ceil(self.ph + self.slide))
        # where the canvas goes in the video; all of it stays above the bottom 20% and inside the side margins
        if ctype == 'short':
            self.x, self.y = int((W - self.pw) / 2), int(H * 0.30)
        else:
            self.x = int(W - 0.05 * W - self.pw) if self.rtl else int(0.05 * W)
            self.y = int(H * 0.70 - self.ph)

    def box(self):
        return [self.x, self.y, self.cw, self.ch]

    def frame(self, t):
        u = self.u
        img = Image.new('RGBA', (self.cw * S, self.ch * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        a_in = ease_out(t / 0.45)
        a_out = 1 - clamp((t - (self.L - 0.4)) / 0.4)
        alpha = a_in * a_out
        yo = (1 - a_in) * self.slide
        d.rounded_rectangle([0, yo * S, self.pw * S, (yo + self.ph) * S], radius=22 * u * S, fill=PANEL, outline=GOLD, width=max(2, int(2.5 * u * S)))
        if self.tag:
            d.text((self.pw / 2 * S, (yo + self.pad + 14 * u) * S), shape(self.tag, self.lang), font=self.f_tag, fill=CREAM, anchor='mm')
        row_y = yo + self.pad + self.tag_h + self.bh / 2
        order = ['bell', 'btn'] + (['thumb'] if self.like else [])
        if self.rtl:
            order.reverse()
        x = (self.pw - self.row_w) / 2
        tt = t - self.press
        for item in order:
            if item == 'btn':
                cx = x + self.bw / 2
                pressed = tt >= 0
                k = clamp(tt / 0.12) if pressed else 0
                sc = 1 + 0.025 * math.sin(2 * math.pi * t * 1.6) if not pressed else (0.93 + 0.07 * clamp((tt - 0.1) / 0.12) if tt < 0.22 else 1.0)
                base = RED if self.style == 'red' else GOLD
                fill = lerp(base, GREY, k)
                w, h = self.bw * sc, self.bh * sc
                d.rounded_rectangle([(cx - w / 2) * S, (row_y - h / 2) * S, (cx + w / 2) * S, (row_y + h / 2) * S], radius=h / 2 * S, fill=fill,
                                    outline=GOLD if pressed else None, width=max(2, int(2 * u * S)))
                txt_col = CREAM if (self.style == 'red' or pressed) else INK
                d.text((cx * S, row_y * S), shape(self.b1 if pressed else self.b0, self.lang), font=self.f_btn, fill=txt_col, anchor='mm')
                if 0 <= tt < 0.55:
                    p = tt / 0.55
                    ring = Image.new('RGBA', img.size, (0, 0, 0, 0))
                    rd = ImageDraw.Draw(ring)
                    r = (self.bh * 0.55 + 26 * u * p) * S
                    rd.ellipse([cx * S - r, row_y * S - r, cx * S + r, row_y * S + r], outline=(201, 164, 92, int(200 * (1 - p))), width=max(2, int(3 * u * S)))
                    img = Image.alpha_composite(img, ring)
                    d = ImageDraw.Draw(img)
                x += self.bw + self.gap
            elif item == 'bell':
                cx = x + self.icon / 2
                ang = 18 * math.exp(-tt * 2.2) * math.sin(tt * 22) if 0 <= tt < 1.7 else 0
                ringing = 0 <= tt < 1.7
                layer = bell_layer(self.icon * S * 0.9, ang, GOLD if ringing else CREAM)
                bb = layer.getbbox()
                tight = layer.crop(bb)
                img.alpha_composite(tight, (int(cx * S - layer.width / 2 + bb[0]), int(row_y * S - layer.height / 2 + 0.06 * self.icon * S + bb[1])))
                d = ImageDraw.Draw(img)
                x += self.icon + self.gap
            else:
                cx = x + self.icon / 2
                x0 = self.press + 0.7
                pulse = 1 + 0.2 * math.sin(math.pi * clamp((t - x0) / 0.6)) if x0 <= t <= x0 + 0.6 else 1
                lit = t >= x0
                draw_thumb(d, cx * S, row_y * S, self.icon * 0.9 * S * pulse, GOLD if lit else CREAM, PANEL)
                x += self.icon + self.gap
        if alpha < 1:
            img.putalpha(img.getchannel('A').point(lambda v: int(v * alpha)))
        return img.resize((self.cw, self.ch), Image.LANCZOS)


# ---------- plan ----------
def plan(kind, dur, cfg, lang, W, H, voiced=False):
    cues = []
    if kind == 'long':
        main_start = max(dur - 21.0, dur * 0.75)
        soft_start = max(17.0, dur * 0.38)
        if soft_start + 3.4 < main_start - 6:
            cues.append((Cue('soft', 3.4, 1.1, cfg, lang, W, H), soft_start))
        cues.append((Cue('main', 4.8, 1.6, cfg, lang, W, H), main_start))
    else:
        start = max(3.5, dur - 3.3)
        if dur >= 7:
            cues.append((Cue('short', 3.0, 1.0, cfg, lang, W, H, voiced), start))
    return cues


# ---------- compose ----------
def process(src, out, lang, kind, vid, force):
    cfg = json.load(open(os.path.join(ROOT, 'media/brand/cta', f'{lang}.json'), encoding='utf-8'))
    dur, W, H, has_audio = probe(src)
    if kind == 'auto':
        kind = 'short' if (H > W or dur <= 75) else 'long'
    files = sorted(glob.glob(os.path.join(ROOT, cfg['voice_dir'], '*.mp3')) + glob.glob(os.path.join(ROOT, cfg['voice_dir'], '*.wav')))
    voice = files[int(hashlib.sha1(vid.encode()).hexdigest(), 16) % len(files)] if files else None
    cues = plan(kind, dur, cfg, lang, W, H, bool(voice))
    if not cues:
        print(f'cta: {os.path.basename(src)} too short for a cue, skipped')
        return
    tmp = tempfile.mkdtemp(prefix='cta_')
    cmd = ['ffmpeg', '-y', '-v', 'error', '-i', src]
    fc, aud = [], []
    vlabel = '0:v'
    idx = 1
    for n, (c, start) in enumerate(cues):
        d = os.path.join(tmp, f'c{n}')
        os.makedirs(d)
        for i in range(int(math.ceil(c.L * FPS))):
            c.frame(i / FPS).save(os.path.join(d, f'f_{i:04d}.png'), compress_level=1)
        cmd += ['-framerate', str(FPS), '-i', os.path.join(d, 'f_%04d.png')]
        fc.append(f'[{idx}:v]format=rgba,setpts=PTS-STARTPTS+{start:.3f}/TB[q{n}]')
        fc.append(f"[{vlabel}][q{n}]overlay=x={c.x}:y={c.y}:eof_action=pass:enable='between(t,{start:.3f},{start + c.L:.3f})'[v{n}]")
        vlabel = f'v{n}'
        idx += 1
    chimes = []
    for n, (c, start) in enumerate(cues):
        cmd += ['-f', 'lavfi', '-i', 'aevalsrc=0.8*sin(2*PI*1568*t)*exp(-7*t)+0.5*sin(2*PI*2349*t)*exp(-9*t):d=0.7:s=48000']
        ms = int((start + c.press) * 1000)
        fc.append(f'[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={ms}:all=1,volume=0.16[ch{n}]')
        chimes.append(f'[ch{n}]')
        idx += 1
    voice_note = None
    tail = 0.0   # a short whose last seconds are too few for the spoken line is held on its last frame so the line can finish
    if has_audio:
        base = '[0:a]aformat=sample_rates=48000:channel_layouts=stereo'
    else:
        cmd += ['-f', 'lavfi', '-t', f'{dur:.3f}', '-i', 'anullsrc=r=48000:cl=stereo']
        base = f'[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo'
        idx += 1
    vparts = []
    if voice:
        vd = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', voice]).stdout.strip())
        main_c, main_start = cues[-1]
        vs = main_start + 0.4
        if kind == 'short':
            tail = max(0.0, vs + vd + 0.5 - dur)
        cmd += ['-i', voice]
        base += f",volume=0.55:enable='between(t,{vs:.3f},{vs + vd:.3f})'"
        if tail > 0:
            base += f",apad=pad_dur={tail:.3f}"
        vparts.append(f'[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay={int(vs * 1000)}:all=1[vv]')
        voice_note = {'file': os.path.relpath(voice, ROOT), 'start': round(vs, 2), 'seconds': round(vd, 2)}
        idx += 1
    fc.append(base + '[a0]')
    fc += vparts
    mix_in = ['[a0]'] + chimes + (['[vv]'] if voice else [])
    fc.append(''.join(mix_in) + f'amix=inputs={len(mix_in)}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=0.95[a]')
    fc.append(f'[{vlabel}]tpad=stop_mode=clone:stop_duration={tail:.3f},format=yuv420p[v]' if tail > 0 else f'[{vlabel}]format=yuv420p[v]')
    tmp_out = out + '.tmp.mp4'
    cmd += ['-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', '-map_metadata', '0', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp_out]
    run(cmd)
    d2 = probe(tmp_out)[0]
    if abs(d2 - (dur + tail)) > 0.6:
        os.remove(tmp_out)
        raise RuntimeError(f'duration changed {dur + tail:.2f} -> {d2:.2f}')
    os.replace(tmp_out, out)
    side = {'lang': lang, 'kind': kind, 'size': [W, H], 'duration': round(dur + tail, 2), 'tail': round(tail, 2), 'voice': voice_note,
            'cues': [{'type': c.ctype, 'start': round(s, 2), 'end': round(s + c.L, 2), 'press': round(s + c.press, 2), 'box': c.box()} for c, s in cues],
            'out_sha1': sha1(out)}
    json.dump(side, open(out + '.cta.json', 'w'), indent=2)
    print(f'cta: {os.path.basename(out)} ({kind}, {lang}): ' + ', '.join(f"{c.ctype}@{s:.1f}s" for c, s in cues) + (', voice line' if voice else ''))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('id', nargs='?', default='video')
    ap.add_argument('--lang', default='en', choices=['en', 'ar'])
    ap.add_argument('--kind', default='auto', choices=['auto', 'short', 'long'])
    ap.add_argument('--dir')
    ap.add_argument('--file')
    ap.add_argument('--out')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    try:
        flags = json.load(open(os.path.join(ROOT, 'media/brand/cta/enabled.json')))
    except Exception:
        flags = {}
    if not a.force and not flags.get(a.lang):
        print(f'cta: switched off for {a.lang} (media/brand/cta/enabled.json)')
        return
    jobs = []
    if a.file:
        jobs.append((a.file, a.out or a.file))
    elif a.dir and os.path.isdir(a.dir):
        for f in sorted(glob.glob(os.path.join(a.dir, '*.mp4'))):
            if not f.endswith('.tmp.mp4'):
                jobs.append((f, f))
    for src, out in jobs:
        try:
            side = out + '.cta.json'
            if os.path.exists(side) and src == out and json.load(open(side)).get('out_sha1') == sha1(out):
                print(f'cta: {os.path.basename(out)} already has its cue')
                continue
            process(src, out, a.lang, a.kind, a.id, a.force)
        except Exception as e:
            msg = getattr(e, 'stderr', '') or str(e)
            print(f'cta: {os.path.basename(src)} left as it was ({str(msg)[-400:]})')


if __name__ == '__main__':
    main()
