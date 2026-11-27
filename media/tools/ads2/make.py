"""Partner ad editor: one fixed script, one JSON spec per ad (9:16, voice-over led).
Scenes: hook clip, road clip, Egypt map, real sign-up form in a phone, presenter clip, end card.
Everything it needs arrives in $WORK/bundle.json; results go to $WORK/out. The log is public: no personal data."""
import base64, difflib, json, math, os, re, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, features

WORK = os.environ['WORK']
OUT = f'{WORK}/out'
os.makedirs(OUT, exist_ok=True)
B = json.load(open(f'{WORK}/bundle.json', encoding='utf-8'))
HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = json.load(open(os.path.join(HERE, B['spec']['name'].replace('_ad', '') + '.json'), encoding='utf-8'))
for name, data in B['files'].items():
    with open(f'{WORK}/{name}', 'wb') as f:
        f.write(base64.b64decode(data))
assert features.check('raqm'), 'Pillow cannot shape Arabic'

W, H, FPS, SR = 1080, 1920, 30, 48000
BLACK, GOLD, WHITE = (14, 12, 10), (201, 164, 92), (255, 255, 255)
FONTS = {'bold': f'{WORK}/fonts/plex.ttf', 'serif': f'{WORK}/fonts/amiri.ttf'}


def font(kind, size):
    return ImageFont.truetype(FONTS[kind], size, layout_engine=ImageFont.Layout.RAQM)


def is_ar(s):
    return bool(re.search('[؀-ۿ]', s))


def kw(s):
    return {'direction': 'rtl', 'language': 'ar'} if is_ar(s) else {'direction': 'ltr'}


def text(d, xy, s, f, fill=WHITE, anchor='mm', stroke=0, stroke_fill=(0, 0, 0)):
    d.text(xy, s, font=f, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill, **kw(s))


def ease(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def pop(x):
    x = max(0.0, min(1.0, x))
    return 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2


# ---------------------------------------------------------------- audio of the voice
def run(*a):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *a], check=True)


def read_audio(path, filt='anull'):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-af', filt, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def split_lines(x, n):
    """Cut the narration at its n-1 longest pauses."""
    win = SR // 50
    rms = np.sqrt(np.array([np.mean(x[i:i + win] ** 2) for i in range(0, len(x) - win, win)]) + 1e-12)
    quiet = 20 * np.log10(rms) < -40
    voiced = np.where(~quiet)[0]
    gaps, i = [], voiced[0]
    while i <= voiced[-1]:
        if quiet[i]:
            j = i
            while quiet[j]:
                j += 1
            gaps.append((j - i, i, j))
            i = j
        i += 1
    cuts = sorted(sorted(gaps, reverse=True)[:n - 1], key=lambda g: g[1])
    edges = [voiced[0]] + [v for g in cuts for v in (g[1], g[2])] + [voiced[-1] + 1]
    return [x[max(0, edges[2 * k] * win - SR // 20): edges[2 * k + 1] * win + SR // 10] for k in range(n)]


def tighten(seg, k):
    p = f'{WORK}/seg{k}.wav'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-af',
                    'silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB,atempo=%s' % SPEC.get('tempo', 1.08), p],
                   input=seg.tobytes(), check=True)
    return p, read_audio(p)


# ---------------------------------------------------------------- word timing
def norm(w):
    w = re.sub('[ً-ٰٟـ]', '', w)
    w = w.translate(str.maketrans('أإآىة', 'ااايه'))
    return re.sub(r'[^\w]', '', w)


def word_times(model, path, spoken, dur):
    """Start/end of every known word: whisper's clock, matched to our own words; gaps are shared by length."""
    heard = []
    # hand whisper the samples ourselves: its own file reader breaks with newer PyAV
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    segs, _ = model.transcribe(np.frombuffer(raw, dtype=np.float32).copy(), language='ar', word_timestamps=True, beam_size=5, initial_prompt=' '.join(spoken))
    for s in segs:
        heard += [(norm(w.word), w.start, w.end) for w in s.words]
    times = [None] * len(spoken)
    m = difflib.SequenceMatcher(a=[norm(w) for w in spoken], b=[h[0] for h in heard], autojunk=False)
    for a, b, size in m.get_matching_blocks():
        for i in range(size):
            times[a + i] = (heard[b + i][1], heard[b + i][2])
    matched = sum(t is not None for t in times)
    i = 0
    while i < len(spoken):
        if times[i] is None:
            j = i
            while j < len(spoken) and times[j] is None:
                j += 1
            t0 = times[i - 1][1] if i else 0.05
            t1 = times[j][0] if j < len(spoken) else dur - 0.1
            lens = [max(1, len(norm(w))) for w in spoken[i:j]]
            acc = 0
            for k, n in enumerate(lens):
                times[i + k] = (t0 + (t1 - t0) * acc / sum(lens), t0 + (t1 - t0) * (acc + n) / sum(lens))
                acc += n
            i = j
        i += 1
    return times, matched


# ---------------------------------------------------------------- captions
def caption_tokens(line, times):
    """Caption token -> time span; a token may stand for several spoken words (ZALA VIP)."""
    out, i = [], 0
    for shown, n in line['caption']:
        out.append((shown, times[i][0], times[min(len(times), i + n) - 1][1]))
        i += n
    return out


def chunks(tokens):
    out, cur = [], []
    for tok in tokens:
        cur.append(tok)
        if len(cur) == 4 or re.search('[؟.،]$', tok[0]):
            if len(cur) >= 2 or re.search('[؟.]$', tok[0]):
                out.append(cur)
                cur = []
    if cur:
        out.append(cur)
    return out


def draw_caption(img, groups, t, y):
    cur = None
    for k, g in enumerate(groups):
        nxt = groups[k + 1][0][1] if k + 1 < len(groups) else 1e9
        if g[0][1] - 0.08 <= t < nxt - 0.08:
            cur = g
    if cur is None:
        return
    d = ImageDraw.Draw(img)
    size = 74
    while True:
        f = font('bold', size)
        widths = [d.textlength(w[0].rstrip('،.'), font=f, **kw(w[0])) * 1.1 for w in cur]
        total = sum(widths) + 22 * (len(cur) - 1)
        if total <= W - 150 or size <= 50:
            break
        size -= 4
    grow = pop((t - (cur[0][1] - 0.08)) / 0.18)
    x = W / 2 + total / 2                              # right to left
    for (word, a, b), wd in zip(cur, widths):
        shown = word.rstrip('،.')
        active = a - 0.04 <= t
        last = active and t < b + 0.12
        ff = font('bold', int(size * (1.08 if last else 1.0) * (0.85 + 0.15 * grow)))
        text(d, (x - wd / 2, y), shown, ff, fill=GOLD if last else WHITE, stroke=8)
        x -= wd + 22


# ---------------------------------------------------------------- picture sources
def clip_frames(path, start, end, count):
    """`count` frames covering start..end seconds of a clip (speeds up or slows down to fit)."""
    speed = (end - start) / (count / FPS)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-ss', str(start), '-t', str(end - start + 0.2), '-i', path, '-an', '-vf',
                          f'setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    last = None
    for _ in range(count):
        raw = p.stdout.read(W * H * 3)
        if len(raw) == W * H * 3:
            last = Image.frombytes('RGB', (W, H), raw)
        yield last.copy()
    p.stdout.close()
    p.wait()


def shade():
    """Soft dark band behind captions plus a light vignette, drawn once."""
    y = np.arange(H, dtype=np.float32)[:, None]
    x = np.arange(W, dtype=np.float32)[None, :]
    band = np.exp(-((y - 1400) / 230) ** 2) * 0.45
    vig = np.clip((((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2) * 0.9 - 0.12, 0, 0.5)
    a = np.clip(band + vig, 0, 0.75)
    return Image.fromarray((a * 255).astype(np.uint8), 'L')


SHADE = shade()
DARK = Image.new('RGB', (W, H), BLACK)

EGYPT = [(24.70, 22.00), (24.70, 29.20), (24.85, 30.20), (25.15, 31.65), (27.20, 31.35), (29.00, 30.85), (30.00, 31.25), (30.90, 31.55),
         (31.90, 31.50), (32.30, 31.25), (33.20, 31.10), (34.22, 31.32), (34.90, 29.50), (34.75, 28.20), (34.25, 27.73), (33.60, 28.30),
         (32.90, 29.20), (32.55, 29.97), (32.35, 29.60), (32.70, 28.90), (33.20, 28.20), (33.80, 27.30), (34.00, 26.60), (34.90, 25.20),
         (35.80, 23.90), (36.90, 22.00)]


def project(lon, lat):
    return (90 + (lon - 24.5) / 12.8 * 900, 360 + (31.9 - lat) / 10.2 * 815)


def glow_layer(draw_fn, blur):
    layer = Image.new('RGB', (W, H), (0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def map_base():
    pts = [project(*p) for p in EGYPT]
    img = DARK.copy()
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=(30, 25, 18))
    from PIL import ImageChops
    img = ImageChops.add(img, glow_layer(lambda g: g.line(pts + pts[:1], fill=(120, 95, 50), width=14, joint='curve'), 14))
    ImageDraw.Draw(img).line(pts + pts[:1], fill=GOLD, width=4, joint='curve')
    return img


def map_frame(base, t, cities):
    img = base.copy()
    d = ImageDraw.Draw(img)
    hub = project(*cities[0]['pos'])
    for i, c in enumerate(cities):
        k = (t - c['at'] + 0.12) / 0.45
        if k <= 0:
            continue
        p = project(*c['pos'])
        if i:
            q = ease(k)
            mid = ((hub[0] + p[0]) / 2, (hub[1] + p[1]) / 2 - 110)
            curve = [((1 - u) ** 2 * hub[0] + 2 * (1 - u) * u * mid[0] + u * u * p[0],
                      (1 - u) ** 2 * hub[1] + 2 * (1 - u) * u * mid[1] + u * u * p[1]) for u in np.linspace(0, q, 40)]
            d.line([tuple(map(float, v)) for v in curve], fill=GOLD, width=5, joint='curve')
        s = pop(k)
        r = 16 * s
        ring = 18 + 46 * ((t - c['at']) % 1.1)
        d.ellipse([p[0] - ring, p[1] - ring, p[0] + ring, p[1] + ring], outline=(110, 90, 52), width=3)
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=GOLD, outline=WHITE, width=3)
        text(d, (p[0] + c.get('dx', 0), p[1] + c.get('dy', -58)), c['name'], font('bold', int(52 * max(0.2, s))), stroke=7)
    return img


def phone_frame(bg, shots, t, dur, chips):
    img = Image.blend(bg.filter(ImageFilter.GaussianBlur(18)), DARK, 0.55)
    idx = min(len(shots) - 1, int(max(0, t) / (dur * 0.8) * len(shots)))
    pw, ph = 540, 1080
    rise = ease(t / 0.45)
    x, y = (W - pw) // 2, int(90 + (1 - rise) * 500)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x - 16, y - 16, x + pw + 16, y + ph + 16], radius=72, fill=(6, 6, 6), outline=GOLD, width=3)
    shot = shots[idx].resize((pw, ph), Image.LANCZOS)
    mask = Image.new('L', (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw, ph], radius=56, fill=255)
    img.paste(shot, (x, y), mask)
    d = ImageDraw.Draw(img)
    for i, c in enumerate(chips):
        k = (t - c['at'] + 0.1) / 0.3
        if k <= 0:
            continue
        s = pop(k)
        cx, cy = W - 190 - i * 350, 1265
        d.rounded_rectangle([cx - 150 * s, cy - 55 * s, cx + 150 * s, cy + 55 * s], radius=55 * s, fill=BLACK, outline=GOLD, width=4)
        text(d, (cx - 24 * s, cy), c['name'], font('bold', int(50 * max(0.2, s))))
        tx = cx + 92 * s
        d.line([(tx - 24 * s, cy), (tx - 8 * s, cy + 18 * s), (tx + 24 * s, cy - 20 * s)], fill=GOLD, width=max(2, int(10 * s)), joint='curve')
    return img


def cards_frame(bg, t, cards):
    """Golden cards that flip open one after the other."""
    img = Image.blend(bg.filter(ImageFilter.GaussianBlur(14)), DARK, 0.6)
    d = ImageDraw.Draw(img)
    for i, c in enumerate(cards):
        k = (t - c['at'] + 0.15) / 0.4
        if k <= 0:
            continue
        s = max(0.02, pop(k))
        cy = 620 + i * 380
        d.rounded_rectangle([W / 2 - 400 * s, cy - 140, W / 2 + 400 * s, cy + 140], radius=36 * min(1, s), fill=BLACK, outline=GOLD, width=5)
        if s > 0.6:
            text(d, (W / 2, cy), c['name'], font('serif', int(104 * min(1.05, s))), fill=GOLD)
    return img


def end_card(t, logo):
    img = DARK.copy()
    from PIL import ImageChops
    img = ImageChops.add(img, glow_layer(lambda g: g.ellipse([240, 520, 840, 1120], fill=(48, 37, 18)), 150))
    d = ImageDraw.Draw(img)
    if logo is not None:
        lw = int(360 * (0.8 + 0.2 * ease(t / 0.5)))
        lg = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
        img.paste(lg, ((W - lg.width) // 2, 520 - lg.height // 2), lg)
    e = SPEC['end']
    text(d, (W / 2, 880), e['title'], font('serif', int(170 * (0.6 + 0.4 * pop(t / 0.4)))), fill=GOLD)
    d.line([(W / 2 - 260 * ease((t - 0.2) / 0.5), 1010), (W / 2 + 260 * ease((t - 0.2) / 0.5), 1010)], fill=GOLD, width=3)
    if t > 0.25:
        text(d, (W / 2, 1100), e['url'], font('bold', 72))
    if t > 0.45:
        text(d, (W / 2, 1210), e['bio'], font('bold', 56), fill=(220, 212, 196))
    if t > 0.8:
        s = pop((t - 0.8) / 0.35) * (1 + 0.04 * math.sin(max(0, t - 1.15) * 9))
        d.rounded_rectangle([W / 2 - 180 * s, 1400 - 62 * s, W / 2 + 180 * s, 1400 + 62 * s], radius=62 * s, fill=GOLD)
        text(d, (W / 2, 1400), e['follow'], font('bold', int(60 * max(0.2, s))), fill=BLACK)
    return img


def whip(prev, cur, k):
    """Camera snaps sideways with motion blur and a gold light streak."""
    q = ease(k)
    img = Image.new('RGB', (W, H), BLACK)
    shift = int(W * q)
    img.paste(prev, (-shift, 0))
    img.paste(cur, (W - shift, 0))
    power = math.sin(math.pi * min(1, k))
    if power > 0.05:
        small = img.resize((max(24, int(W * (1 - 0.95 * power))), H), Image.BILINEAR).resize((W, H), Image.BILINEAR)
        img = Image.blend(img, small, min(1.0, power * 1.2))
        from PIL import ImageChops
        cx = int(-300 + (W + 600) * k)
        streak = glow_layer(lambda g: g.polygon([(cx - 90, 0), (cx + 90, 0), (cx - 160, H), (cx - 340, H)],
                                                fill=(int(150 * power), int(118 * power), int(60 * power))), 60)
        img = ImageChops.add(img, streak)
    return img


# ---------------------------------------------------------------- sound design (all synthesised: free of rights)
rng = np.random.default_rng(7)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(1e-4, attack)) * np.exp(-t / decay)


def tone(freq, dur, decay, attack=0.004):
    n = int(dur * SR)
    return np.sin(2 * np.pi * freq * np.arange(n) / SR) * env(n, attack, decay)


def noise_band(dur, f0, f1):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    out, lp, lp2 = np.empty(n), 0.0, 0.0
    cut = np.geomspace(f0, f1, n)
    a = 1 - np.exp(-2 * np.pi * cut / SR)
    for i in range(n):
        lp += a[i] * (x[i] - lp)
        lp2 += a[i] * (lp - lp2)
        out[i] = lp2
    return out / (np.max(np.abs(out)) + 1e-9)


def whoosh():
    s = noise_band(0.5, 300, 6000)
    return s * np.sin(np.linspace(0, np.pi, len(s))) ** 2 * 0.35


def tick():
    return (tone(2100, 0.08, 0.018, 0.001) + tone(3150, 0.08, 0.012, 0.001) * 0.5) * 0.22


def ting():
    return (tone(1320, 0.9, 0.22) + tone(1980, 0.9, 0.16) * 0.5 + tone(2640, 0.9, 0.1) * 0.25) * 0.16


def drum():
    n = int(0.5 * SR)
    f = 55 + 90 * np.exp(-np.arange(n) / SR / 0.05)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, 0.14) * 0.6


def thud():
    s = noise_band(0.3, 500, 120) * env(int(0.3 * SR), 0.002, 0.06) * 0.55
    return s + tone(80, 0.3, 0.08) * 0.35


def buzz():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 90 * t) + 0.4 * np.sin(2 * np.pi * 7000 * t) * rng.random(n)) * env(n, 0.02, 0.13) * 0.2


def music(total):
    """Calm minor pad with a heartbeat that grows towards the end."""
    n = int(total * SR)
    t = np.arange(n) / SR
    chords = [(110.0, 130.81, 164.81), (87.31, 110.0, 130.81), (130.81, 164.81, 196.0), (98.0, 123.47, 146.83)]
    out = np.zeros(n)
    bar = 3.4
    for i in range(int(total / bar) + 1):
        a, b = int(i * bar * SR), min(n, int((i + 1) * bar * SR + SR // 2))
        if a >= n:
            break
        tt = t[a:b] - t[a]
        shape = np.minimum(1, tt / 0.8) * np.minimum(1, np.maximum(0, (tt[-1] - tt) / 0.6))
        for f in chords[i % 4]:
            out[a:b] += shape * (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2.003 * f * tt) + 0.12 * np.sin(2 * np.pi * 3.01 * f * tt)) * 0.05
    beat = drum() * 0.35
    step = 0.8
    k = 0
    while k * step < total - 0.6:
        a = int(k * step * SR)
        level = 0.35 + 0.65 * (k * step / total)
        out[a:a + len(beat)] += beat[:n - a] * level
        k += 1
    out *= np.minimum(1, t / 0.3) * np.minimum(1, (total - t) / 1.2)
    return out


# ---------------------------------------------------------------- assemble
def main():
    from faster_whisper import WhisperModel
    lines = SPEC['lines']
    raw = read_audio(f'{WORK}/voice.wav')
    parts = [tighten(seg, k) for k, seg in enumerate(split_lines(raw, len(lines)))]
    model = WhisperModel('small', device='cpu', compute_type='int8')
    info, timing = [], []
    for (path, audio), line in zip(parts, lines):
        spoken = line['spoken'].split()
        assert sum(n for _, n in line['caption']) == len(spoken), 'caption map does not cover the spoken words'
        times, matched = word_times(model, path, spoken, len(audio) / SR)
        timing.append(times)
        info.append({'seconds': round(len(audio) / SR, 2), 'words': len(spoken), 'matched': matched})
    print('lines', info, flush=True)

    # scene lengths: lead-in + voice + gap; the end card follows the last line
    starts, t = [], 0.0
    lead = 0.12
    for (path, audio) in parts:
        starts.append(t)
        t += lead + len(audio) / SR + 0.22
    card_at = t + 0.15
    total = card_at + 2.6
    ends = starts[1:] + [total]
    frame_of = lambda s: int(round(s * FPS))

    logo = Image.open(f'{WORK}/logo.png').convert('RGBA') if os.path.exists(f'{WORK}/logo.png') else None
    shots = [Image.open(f'{WORK}/form/{n}').convert('RGB') for n in sorted(os.listdir(f'{WORK}/form'))]
    base = map_base()

    sounds = [(0.05, buzz() if SPEC.get('opening', 'buzz') == 'buzz' else ting()), (0.1, drum()), (card_at, drum()), (card_at + 0.05, ting()), (card_at + 0.85, ting() * 0.8)]
    video = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                              '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', f'{WORK}/video.mp4'],
                             stdin=subprocess.PIPE)
    prev_last, keep = None, {}
    marks = {frame_of(x) for x in np.arange(0.7, total, total / 12)}
    for i, line in enumerate(lines):
        a, b = frame_of(starts[i]), frame_of(ends[i])
        n = b - a
        dur = n / FPS
        offs = [(lead + s, lead + e) for s, e in timing[i]]
        groups = chunks(caption_tokens(line, offs))
        kind = line['scene']
        gen = None
        if kind == 'clip':
            gen = clip_frames(f"{WORK}/{line['clip']}", line['from'], line['to'], n)
            if 'thud_at_word' in line:
                sounds.append((starts[i] + offs[line['thud_at_word']][0] + 0.15, thud()))
        elif kind in ('phone', 'cards'):
            gen = clip_frames(f"{WORK}/{line['clip']}", line['from'], line['to'], n)
        elif kind == 'present':
            body = frame_of(card_at - starts[i])
            gen = clip_frames(f"{WORK}/{line['clip']}", line['from'], line['to'], body)
        marks_here = [dict(m, at=offs[m['word']][0]) for m in line.get('marks', [])]
        for m in marks_here:
            sounds.append((starts[i] + m['at'], tick() if kind == 'map' else ting() * 0.7))
        if kind == 'phone':
            sounds += [(starts[i] + 0.25 + 0.16 * j, tick() * 0.45) for j in range(int(dur * 0.7 / 0.16))]
        if i:
            sounds.append((starts[i] - 0.12, whoosh()))
        cur = None
        for j in range(n):
            tt = j / FPS
            if kind == 'clip':
                cur = next(gen)
                cur = ImageEnhance.Contrast(cur).enhance(1.05)
                if i == 0 and tt < 0.35:
                    cur = ImageEnhance.Brightness(cur).enhance(0.35 + 0.65 * tt / 0.35)
                cur = Image.composite(DARK, cur, SHADE)
            elif kind == 'map':
                cur = map_frame(base, tt, marks_here)
            elif kind == 'cards':
                cur = cards_frame(next(gen), tt, marks_here)
            elif kind == 'phone':
                cur = phone_frame(next(gen), shots, tt, dur, marks_here)
            else:
                body = frame_of(card_at - starts[i])
                if j < body:
                    cur = Image.composite(DARK, next(gen), SHADE)
                else:
                    cur = end_card((j - body) / FPS, logo)
                    if j - body < 6:
                        cur = Image.blend(Image.new('RGB', (W, H), (255, 226, 160)), cur, 0.4 + (j - body) / 10)
            shown = cur
            if i and j < 9:
                shown = whip(prev_last, cur, (j + 1) / 10)
            else:
                shown = cur.copy()
            if not (kind == 'present' and tt >= card_at - starts[i]):
                draw_caption(shown, groups, tt, 1425)
            video.stdin.write(shown.tobytes())
            if a + j in marks:
                keep[a + j] = shown.resize((270, 480), Image.LANCZOS)
        prev_last = cur
        if gen is not None:
            gen.close()
        print('scene', i + 1, kind, f'{dur:.1f}s', flush=True)
    video.stdin.close()
    assert video.wait() == 0

    # sound: voice on top, music ducked under it
    n = int(total * SR) + SR
    voice, fx = np.zeros(n), np.zeros(n)
    for (path, audio), s in zip(parts, starts):
        a = int((s + lead) * SR)
        voice[a:a + len(audio)] += audio
    for at, snd in sounds:
        a = max(0, int(at * SR))
        fx[a:a + len(snd)] += snd[:n - a]
    voice *= 0.7 / (np.max(np.abs(voice)) + 1e-9)
    k = SR // 10
    acc = np.concatenate([[0.0], np.cumsum(np.abs(voice))])
    idx = np.arange(n)
    level = (acc[np.minimum(n, idx + k // 2)] - acc[np.maximum(0, idx - k // 2)]) / k
    duck = 1 - 0.6 * np.clip(level / 0.04, 0, 1)
    bed = np.zeros(n)
    m = music(total)
    bed[:len(m)] = m
    mix = voice + bed * duck * 0.8 + fx * 0.75
    mix = mix[:int(total * SR)]
    mix.astype(np.float32).tofile(f'{WORK}/mix.f32')
    run('-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', f'{WORK}/mix.f32', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9', '-ar', str(SR), f'{WORK}/mix.wav')
    name = SPEC['name']
    run('-i', f'{WORK}/video.mp4', '-i', f'{WORK}/mix.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', f'{OUT}/{name}.mp4')
    run('-i', f'{OUT}/{name}.mp4', '-vf', 'scale=540:960', '-c:v', 'libx264', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', f'{OUT}/{name}_small.mp4')

    tiles = [keep[k] for k in sorted(keep)]
    sheet = Image.new('RGB', (270 * 6, 480 * math.ceil(len(tiles) / 6)), (40, 40, 40))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, (270 * (i % 6), 480 * (i // 6)))
    sheet.save(f'{OUT}/sheet.jpg', quality=82)
    json.dump({'total': round(total, 2), 'lines': info, 'form_shots': len(shots)}, open(f'{OUT}/info.json', 'w'))
    print('done', round(total, 1), 's', flush=True)


main()
