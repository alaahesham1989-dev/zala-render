// media/lib/punch.mjs — what keeps a viewer watching: big captions timed to the spoken words,
// short lines at the top of the screen, drifting gold dust, light sweeps and impact flashes.
// Everything here is drawn by the subtitle engine, so it is free and needs no extra media.
import fs from 'node:fs';
import { tokens, matchWords } from './voice-chunks.mjs';

const YELLOW = '&H0000D7FF&', WHITE = '&H00FFFFFF&', GOLD = '&H0037AFD4&', BLACK = '&H00000000&';

export const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const esc = (s) => String(s).replace(/[{}\\]/g, '');

/** Reads the word timing saved when a narration was cut, or null when a line has none. */
export function heardOf(voiceFile) {
  try { return JSON.parse(fs.readFileSync(`${voiceFile}.words.json`, 'utf8')); } catch { return null; }
}

/**
 * Times every caption word by what was really heard. Numbers shown as digits rarely match the spoken words,
 * so anything unmatched is spread evenly between its matched neighbours. Returns times inside [0, dur].
 */
export function timedWords(text, heard, dur) {
  const shown = String(text).split(/\s+/).filter(Boolean);
  const weight = (w) => w.length + 1.5;
  const even = (from, to, list) => {
    const sum = list.reduce((a, w) => a + weight(w), 0);
    let t = from;
    return list.map((w) => { const d = ((to - from) * weight(w)) / sum; const o = { w, t0: t, t1: t + d }; t += d; return o; });
  };
  if (!heard?.length) return even(0, dur, shown);
  const parts = shown.map((w) => tokens(w));
  const script = parts.flat();
  const said = heard.flatMap((h, idx) => tokens(h.w).map((w) => ({ w, idx })));
  const map = matchWords(script, said.map((x) => x.w));
  let at = 0;
  const anchors = shown.map((w, i) => {
    const hit = parts[i].map((_, k) => map[at + k]).find((x) => x >= 0);
    at += parts[i].length;
    return hit === undefined ? null : heard[said[hit].idx];
  });
  const out = new Array(shown.length);
  let i = 0;
  while (i < shown.length) {
    if (anchors[i]) { out[i] = { w: shown[i], t0: anchors[i].start, t1: anchors[i].end }; i++; continue; }
    let j = i;
    while (j < shown.length && !anchors[j]) j++;
    const from = i > 0 ? anchors[i - 1].end : 0;
    const to = j < shown.length ? anchors[j].start : dur;
    even(from, Math.max(to, from + 0.05), shown.slice(i, j)).forEach((x, k) => { out[i + k] = x; });
    i = j;
  }
  // one clean, ever-forward clock
  let last = 0;
  for (const w of out) { w.t0 = Math.max(w.t0, last); w.t1 = Math.max(w.t1, w.t0 + 0.04); last = w.t1; }
  return out;
}

function groupWords(words, maxWords, maxChars) {
  const out = [];
  let cur = [];
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    const ended = cur.length && /[.!?,:;]$/.test(cur[cur.length - 1].w);
    if (cur.length && (cur.length >= maxWords || len > maxChars || ended)) { out.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Words on the final timeline → caption events: white words, the spoken one yellow and slightly larger. */
export function captionEvents(words, { style, maxWords = 4, maxChars = 26, layer = 7, hold = 0.35 } = {}) {
  const groups = groupWords(words, maxWords, maxChars);
  const ev = [];
  groups.forEach((g, n) => {
    const next = groups[n + 1]?.[0]?.t0 ?? Infinity;
    const groupEnd = Math.min(g[g.length - 1].t1 + hold, next);
    g.forEach((cur, i) => {
      const t1 = i + 1 < g.length ? g[i + 1].t0 : groupEnd;
      if (t1 - cur.t0 < 0.01) return;
      const text = g.map((x, j) => {
        const shown = esc(x.w.toUpperCase());
        return j === i ? `{\\c${YELLOW}\\fscx108\\fscy108}${shown}{\\c${WHITE}\\fscx100\\fscy100}` : shown;
      }).join(' ');
      ev.push(`Dialogue: ${layer},${assTime(cur.t0)},${assTime(t1)},${style},,0,0,0,,${i === 0 ? '{\\fad(40,0)}' : ''}${text}`);
    });
  });
  return ev;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const circle = (r) => `m 0 ${-r} b ${r * 0.55} ${-r} ${r} ${-r * 0.55} ${r} 0 b ${r} ${r * 0.55} ${r * 0.55} ${r} 0 ${r} b ${-r * 0.55} ${r} ${-r} ${r * 0.55} ${-r} 0 b ${-r} ${-r * 0.55} ${-r * 0.55} ${-r} 0 ${-r}`;

/** Gold dust and a few soft glowing orbs that drift slowly upwards for the whole video, under all text. */
export function dustEvents(from, to, W, H, { style = 'Fx', seed = 7, every = 0.55, orbsEvery = 3.2 } = {}) {
  const r = seeded(seed), ev = [];
  const scale = Math.min(W, H) / 1080;
  const add = (t, life, size, alpha, blur, color, travel) => {
    const x = r() * W, y = r() * H;
    const dx = (r() - 0.5) * 240 * scale, dy = -travel * scale * (0.6 + r() * 0.8);
    const fade = Math.round(life * 280);
    ev.push(`Dialogue: 1,${assTime(t)},${assTime(t + life)},${style},,0,0,0,,{\\an7\\move(${x.toFixed(0)},${y.toFixed(0)},${(x + dx).toFixed(0)},${(y + dy).toFixed(0)})\\fad(${fade},${fade})\\bord0\\shad0\\blur${blur}\\1c${color}\\1a&H${alpha}&\\p1}${circle(Math.round(size * scale))}{\\p0}`);
  };
  for (let t = from; t < to; t += every * (0.7 + r() * 0.6)) add(t, 7 + r() * 6, 2 + r() * 3.5, r() < 0.3 ? '20' : '50', 1.5, GOLD, 170);
  for (let t = from + 1; t < to; t += orbsEvery * (0.7 + r() * 0.6)) add(t, 9 + r() * 5, 26 + r() * 34, 'D8', 16, GOLD, 120);
  return ev;
}

/** A soft beam of light crossing the frame. */
export function sweepEvent(t, W, H, style = 'Fx') {
  const h = Math.round(Math.max(W, H) * 1.1);
  return `Dialogue: 2,${assTime(t)},${assTime(t + 1)},${style},,0,0,0,,{\\an5\\move(${-Math.round(W * 0.2)},${Math.round(H / 2)},${Math.round(W * 1.2)},${Math.round(H / 2)})\\frz18\\bord0\\shad0\\blur40\\1c${WHITE}\\1a&HBB&\\p1}m -110 ${-h} l 110 ${-h} 110 ${h} -110 ${h}{\\p0}`;
}

/** A short flash on the hardest moments. */
export function flashEvent(t, W, H, style = 'Fx') {
  return `Dialogue: 3,${assTime(t)},${assTime(t + 0.26)},${style},,0,0,0,,{\\an7\\pos(0,0)\\fad(30,200)\\bord0\\shad0\\1c${WHITE}\\1a&H70&\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`;
}

/**
 * The short line at the top of the screen, sliding in on a gold plate with dark text.
 * busy: time ranges where another top element shows; a line waits until it is over.
 */
export function teaserEvents(teasers, { W, top = 26, size = 54, seconds = 4.4, busy = [], style = 'Tease', plate = 'Plate', charW = 0.3 } = {}) {
  const ev = [];
  let last = -Infinity;
  for (const x of [...teasers].sort((a, b) => a.t - b.t)) {
    let t = Math.max(x.t, last + 0.5);
    for (const [a, b] of busy) if (t < b && t + seconds > a) t = b + 0.2;
    const text = esc(String(x.text).toUpperCase());
    const w = Math.round(text.length * size * charW + size * 1.2);
    const h = Math.round(size * 1.45);
    const cx = Math.round(W / 2), x0 = cx - Math.round(w / 2);
    ev.push(`Dialogue: 5,${assTime(t)},${assTime(t + seconds)},${plate},,0,0,0,,{\\an7\\move(${x0},${-h},${x0},${top},0,220)\\fad(0,260)\\bord0\\shad3\\1c${YELLOW}\\p1}m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\\p0}`);
    ev.push(`Dialogue: 6,${assTime(t)},${assTime(t + seconds)},${style},,0,0,0,,{\\an5\\move(${cx},${-Math.round(h / 2)},${cx},${top + Math.round(h / 2)},0,220)\\fad(0,260)\\bord0\\shad0\\1c${BLACK}}${text}`);
    last = t + seconds;
  }
  return ev;
}
