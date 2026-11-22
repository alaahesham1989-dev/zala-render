// media/lib/captions.mjs — burned-in captions as an ASS subtitle file.
//   short: 2–4 words on screen, the spoken word lights up in gold (Shorts/Reels style)
//   long:  one calm subtitle line at the bottom
//   Arabic: one static shaped line per group — libass renders connected Arabic letters disconnected and in
//   the wrong order when a line is split into several override-coded spans (found on ZV-AR01), so no per-word
//   highlight and the text is pre-shaped by the same arabic_reshaper + bidi pass arabic_card.py already uses.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const GOLD = '&H0000D7FF&';   // #D4AF37 in ASS (&HAABBGGRR)
const WHITE = '&H00FFFFFF&';
const YELLOW = '&H001FE5FF&';  // #FFE51F in ASS (&HAABBGGRR)
const CYAN = '&H00FFFF00&';    // #00FFFF in ASS (&HAABBGGRR)

const esc = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '');
const ts = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

/** Reshapes a batch of Arabic lines in one Python call.
 * For libass (ASS subtitles): bidi is false by default so libass handles RTL ordering natively without double-reversal. */
export function shapeArabic(texts, { bidi = false } = {}) {
  if (!texts.length) return texts;
  const script = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'tools', 'arabic_shape.py');
  const py = process.env.MANIM_PY || (process.platform === 'win32' ? 'python' : 'python3');
  const args = bidi ? [script] : [script, '--no-bidi'];
  const r = spawnSync(py, args, { input: texts.join('\n'), encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0 || !r.stdout) return texts;
  const out = r.stdout.split('\n');
  return texts.map((t, i) => out[i] ?? t);
}

function chunk(words, maxWords, maxChars) {
  const out = [];
  let cur = [];
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    const sentenceEnd = cur.length && /[.!?]$/.test(cur[cur.length - 1].w);
    if (cur.length && (cur.length >= maxWords || len > maxChars || sentenceEnd)) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * @param {{ w: string, t0: number, t1: number }[]} words  timings already shifted to the video timeline
 * @param {{ W: number, H: number, mode: 'short'|'long' }} fmt
 */
export function buildAss(words, { W, H, mode }) {
  const short = mode === 'short';
  const arabic = words.some((w) => /[؀-ۿ]/.test(w.w));
  const size = arabic ? (short ? 92 : 46) : (short ? Math.round(W * 0.12) : Math.round(H * 0.05));
  const marginV = arabic ? (short ? 360 : Math.round(H * 0.07)) : (short ? Math.round(H * 0.27) : Math.round(H * 0.07));
  const font = arabic ? 'Noto Naskh Arabic' : (process.env.ZALA_CAPTION_FONT || (short ? 'Anton' : 'Lato'));
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${font},${size},${WHITE},${WHITE},&H00000000&,&H80000000&,-1,0,0,0,100,100,${short ? (arabic ? 0 : 1) : 0},0,1,${short ? (arabic ? 6 : 8) : 3},${short ? (arabic ? 3 : 3) : 1},2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  const groups = chunk(words, short ? (arabic ? 2 : 3) : 9, short ? (arabic ? 12 : 13) : 60);
  const shaped = arabic ? shapeArabic(groups.map((g) => g.map((x) => x.w).join(' '))) : null;
  groups.forEach((g, gi) => {
    const end = g[g.length - 1].t1;   // never past the next group's start, or two captions print over each other
    if (!short) {
      lines.push(`Dialogue: 0,${ts(g[0].t0)},${ts(end)},Cap,,0,0,0,,${esc(arabic ? shaped[gi] : g.map((x) => x.w).join(' '))}`);
      return;
    }
    if (arabic) {
      const text = esc(shaped[gi] ?? '');
      if (!text.trim()) return;
      const rawText = g.map((x) => x.w).join(' ');
      const isClimax = /[!؟?]/.test(rawText) || /(سر|مات|قام|أوزيريس|حورس|ست|ذهب|خلود|لعنة|ملك|سحر|أول|دم|حقيقة|قبر|موت)/i.test(rawText);

      let tag = '';
      if (isClimax) {
        const c = gi % 2 === 0 ? GOLD : YELLOW;
        tag = `\\fscx82\\fscy82\\c${c}\\t(0,70,\\fscx108\\fscy108)\\t(70,140,\\fscx100\\fscy100)`;
      } else {
        const accent = (gi % 3 === 0) ? GOLD : ((gi % 3 === 1) ? YELLOW : CYAN);
        tag = `\\fscx82\\fscy82\\c${accent}\\t(0,70,\\fscx108\\fscy108)\\t(70,140,\\fscx100\\fscy100)\\t(70,150,\\c${WHITE})`;
      }
      lines.push(`Dialogue: 0,${ts(g[0].t0)},${ts(end)},Cap,,0,0,0,,{${tag}}${text}`);
      return;
    }
    g.forEach((cur, i) => {
      const t1 = i + 1 < g.length ? g[i + 1].t0 : end;
      const text = g.map((x, j) => (j === i ? `{\\c${GOLD}}${esc(x.w.toUpperCase())}{\\c${WHITE}}` : esc(x.w.toUpperCase()))).join(' ');
      // small pop-in on the first word of each group
      const pop = i === 0 ? '{\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}' : '';
      lines.push(`Dialogue: 0,${ts(cur.t0)},${ts(t1)},Cap,,0,0,0,,${pop}${text}`);
    });
  });
  return header + lines.join('\n') + '\n';
}
