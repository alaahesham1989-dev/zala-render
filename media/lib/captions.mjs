// media/lib/captions.mjs — burned-in captions as an ASS subtitle file.
//   short: 2–4 words on screen, the spoken word lights up in gold (Shorts/Reels style)
//   long:  one calm subtitle line at the bottom
const GOLD = '&H0000D7FF&';   // #D4AF37 in ASS (&HAABBGGRR)
const WHITE = '&H00FFFFFF&';

const esc = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '');
const ts = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};

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
  const size = short ? Math.round(W * 0.15) : Math.round(H * 0.05);
  const marginV = short ? Math.round(H * 0.27) : Math.round(H * 0.07);
  const font = short ? 'Anton' : 'Lato';
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${font},${size},${WHITE},${WHITE},&H00000000&,&H80000000&,${short ? 0 : -1},0,0,0,100,100,${short ? 1 : 0},0,1,${short ? 8 : 3},${short ? 3 : 1},2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  const groups = chunk(words, short ? 3 : 9, short ? 20 : 60);
  for (const g of groups) {
    const end = g[g.length - 1].t1;   // never past the next group's start, or two captions print over each other
    if (!short) {
      lines.push(`Dialogue: 0,${ts(g[0].t0)},${ts(end)},Cap,,0,0,0,,${esc(g.map((x) => x.w).join(' '))}`);
      continue;
    }
    g.forEach((cur, i) => {
      const t1 = i + 1 < g.length ? g[i + 1].t0 : end;
      const text = g.map((x, j) => (j === i ? `{\\c${GOLD}}${esc(x.w.toUpperCase())}{\\c${WHITE}}` : esc(x.w.toUpperCase()))).join(' ');
      // small pop-in on the first word of each group
      const pop = i === 0 ? '{\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}' : '';
      lines.push(`Dialogue: 0,${ts(cur.t0)},${ts(t1)},Cap,,0,0,0,,${pop}${text}`);
    });
  }
  return header + lines.join('\n') + '\n';
}
