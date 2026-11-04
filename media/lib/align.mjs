// media/lib/align.mjs — find where each script sentence starts/ends inside one narration file.
// ElevenLabs (browser) gives no word timings, so we use the pauses: detect silences with ffmpeg, then choose the
// K-1 silences that make every sentence's *speech time* match its syllable count at a steady speaking rate (dynamic programming).
import { spawnSync } from 'node:child_process';
import { FFMPEG, durationOf } from './ff.mjs';

export function detectSilences(file, noise = '-40dB', minDur = 0.22) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${noise}:d=${minDur}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = [];
  let cur = null;
  for (const line of String(r.stderr).split('\n')) {
    const a = line.match(/silence_start: ([\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
    if (a) cur = { s: Number(a[1]) };
    if (b && cur) { cur.e = Number(b[1]); cur.d = Number(b[2]); out.push(cur); cur = null; }
  }
  return out;
}

const NUM = { '2013': 'twenty thirteen' };
export function syllables(text) {
  let t = text.toLowerCase();
  for (const [k, v] of Object.entries(NUM)) t = t.replace(new RegExp(k, 'g'), v);
  t = t.replace(/\bbc\b/g, 'bee see').replace(/\bv i p\b/g, 'vee eye pee').replace(/\bdot com\b/g, 'dot com');
  let n = 0;
  for (const w of t.split(/[^a-z']+/).filter(Boolean)) {
    let c = (w.replace(/'s$/, '').match(/[aeiouy]+/g) || []).length;
    if (/[^aeiouy]e$/.test(w) && !/le$/.test(w) && c > 1) c--;
    n += Math.max(1, c);
  }
  return n;
}

/**
 * @param {string} file narration audio
 * @param {{ text: string, paragraphBreakAfter?: boolean }[]} lines  in spoken order
 */
export function alignLines(file, lines, { noise, minDur } = {}) {
  const D = durationOf(file);
  const sil = detectSilences(file, noise, minDur);
  let speechStart = 0, speechEnd = D;
  if (sil.length && sil[0].s < 0.05) speechStart = sil[0].e;
  const tail = sil[sil.length - 1];
  if (tail && Math.abs(tail.e - D) < 0.25) speechEnd = tail.s;
  const cands = sil.filter((x) => x.s > speechStart + 0.25 && x.e < speechEnd - 0.15);
  const M = cands.length;

  // spoken time up to the START of each candidate silence (all detected silences are excluded from "speech")
  let cumSil = 0;
  const S = [];
  for (const x of sil) { x.cum = cumSil; cumSil += x.d; }
  const spokenAt = (t) => t - sil.filter((x) => x.e <= t).reduce((a, x) => a + x.d, 0) - (speechStart > 0 ? 0 : 0);
  const Sc = cands.map((c) => spokenAt(c.s));
  const S0 = spokenAt(speechStart + 1e-6);
  const SEnd = spokenAt(speechEnd);

  const K = lines.length - 1;
  const syl = lines.map((l) => syllables(l.text));
  const totalSyl = syl.reduce((a, b) => a + b, 0);
  const rate = totalSyl / (SEnd - S0);                    // syllables per second of actual speech
  const exp = syl.map((s) => s / rate);

  const INF = 1e9;
  const cost = (k, spoken, j) => {
    const r = Math.max(0.05, spoken) / exp[k];
    let c = 2.2 * Math.log(r) ** 2;
    const d = j == null ? 0 : cands[j].d;
    if (j != null) c -= Math.min(d, 1.0) * 0.9;             // longer pauses are more likely sentence ends
    if (j != null && lines[k].paragraphBreakAfter) c -= Math.min(d, 1.6) * 2.2;
    return c;
  };
  const dp = Array.from({ length: K }, () => new Array(M).fill(INF));
  const prev = Array.from({ length: K }, () => new Array(M).fill(-1));
  for (let j = 0; j < M; j++) dp[0][j] = cost(0, Sc[j] - S0, j);
  for (let k = 1; k < K; k++) {
    for (let j = 0; j < M; j++) {
      let best = INF, bi = -1;
      for (let i = 0; i < j; i++) {
        if (dp[k - 1][i] >= INF) continue;
        const c = dp[k - 1][i] + cost(k, Sc[j] - Sc[i], j);
        if (c < best) { best = c; bi = i; }
      }
      dp[k][j] = best; prev[k][j] = bi;
    }
  }
  let bj = -1, bc = INF;
  for (let j = 0; j < M; j++) {
    if (dp[K - 1][j] >= INF) continue;
    const c = dp[K - 1][j] + cost(K, SEnd - Sc[j], null);
    if (c < bc) { bc = c; bj = j; }
  }
  if (bj < 0) throw new Error('alignLines: could not place sentence boundaries');
  const chosen = new Array(K);
  for (let k = K - 1, j = bj; k >= 0; k--) { chosen[k] = j; j = prev[k][j]; }

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t0 = i === 0 ? speechStart : cands[chosen[i - 1]].e - 0.05;
    const t1 = i === K ? speechEnd : cands[chosen[i]].s + 0.08;
    out.push({ t0: Math.max(0, t0), t1: Math.min(D, t1), pauseAfter: i < K ? cands[chosen[i]] : null, syl: syl[i] });
  }
  return { lines: out, duration: D, speechStart, speechEnd, rate };
}
