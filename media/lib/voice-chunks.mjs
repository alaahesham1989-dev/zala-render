// The free plan allows few voice requests a day, so several story lines go in one request
// and the narration is then cut back into one file per line.
// Cuts follow the words actually heard. Pauses alone once moved five lines of Cleopatra by half a sentence.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, durationOf } from './ff.mjs';
import { alignLines, detectSilences } from './align.mjs';

const wordsOf = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

/** Neighbouring lines grouped up to maxWords. A line already made elsewhere ends the group, so the order stays right. */
export function groupLines(pending, flat, maxWords) {
  const place = new Map(flat.map((f, i) => [f, i]));
  const groups = [];
  let group = [], words = 0, last = -2;
  for (const f of pending) {
    const w = wordsOf(f.say);
    const at = place.get(f);
    if (group.length && (at !== last + 1 || words + w > maxWords)) { groups.push(group); group = []; words = 0; }
    group.push(f);
    words += w;
    last = at;
  }
  if (group.length) groups.push(group);
  return groups;
}

export const tokens = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** Longest common sequence between the script's words and the heard words: script word index -> heard word index. */
export function matchWords(script, heard) {
  const n = script.length, m = heard.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = script[i] === heard[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const map = new Array(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (script[i] === heard[j]) { map[i] = j; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  return map;
}

/**
 * Where each line starts and ends. Between the last word recognised in one line and the first recognised in the next,
 * the cut goes in the longest pause. heard: [{w, start, end}], silences: [{s, e, d}], duration of the file.
 */
export function cutsFromWords(texts, heard, silences, duration) {
  const lineTokens = texts.map(tokens);
  const script = lineTokens.flat();
  const said = heard.flatMap((h, idx) => tokens(h.w).map((w) => ({ w, idx })));
  const map = matchWords(script, said.map((x) => x.w));
  const found = map.filter((x) => x >= 0).length;
  if (found / script.length < 0.6) throw new Error(`only ${Math.round((found / script.length) * 100)}% of the words were recognised`);
  const wordAt = (i) => heard[said[map[i]].idx];
  const starts = [];
  lineTokens.reduce((at, l, i) => { starts[i] = at; return at + l.length; }, 0);
  const lines = texts.map(() => ({}));
  for (let k = 1; k < texts.length; k++) {
    let p = starts[k] - 1; while (p >= 0 && map[p] < 0) p--;
    let q = starts[k]; while (q < script.length && map[q] < 0) q++;
    const a = p >= 0 ? wordAt(p).end : 0;
    const b = q < script.length ? wordAt(q).start : duration;
    const inside = silences.map((s) => ({ s: Math.max(s.s, a), e: Math.min(s.e, b) })).filter((s) => s.e - s.s > 0.02);
    if (inside.length) {
      const best = inside.reduce((x, y) => (y.e - y.s > x.e - x.s ? y : x));
      lines[k - 1].t1 = best.s + 0.06;
      lines[k].t0 = Math.max(best.s + 0.06, best.e - 0.05);
    } else {
      const unknownBefore = starts[k] - p - 1, unknownAfter = q - starts[k];
      const at = a + (b - a) * ((unknownBefore + 0.5) / (unknownBefore + unknownAfter + 1));
      lines[k - 1].t1 = at;
      lines[k].t0 = at;
    }
  }
  lines[0].t0 = 0;
  lines[lines.length - 1].t1 = duration;
  return { lines, recognised: found / script.length };
}

function heardWords(file) {
  const cache = `${file}.words.json`;
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  const py = process.env.WHISPER_PY;
  if (!py) return null;
  const tool = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'tools', 'words.py');
  const r = spawnSync(py, [tool, file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.log(`  word timing failed: ${String(r.stderr).slice(-300)}`); return null; }
  fs.writeFileSync(cache, r.stdout);
  return JSON.parse(r.stdout);
}

// A storyteller's pauses can be short: try the clearest reading of them first, then look for finer ones.
const PAUSE_READINGS = [{ noise: '-40dB', minDur: 0.22 }, { noise: '-35dB', minDur: 0.16 }, { noise: '-30dB', minDur: 0.12 }, { noise: '-26dB', minDur: 0.08 }];

function cutByPauses(chunk, texts) {
  let problem = null;
  for (const reading of PAUSE_READINGS) {
    try {
      const { lines, rate } = alignLines(chunk, texts.map((text) => ({ text })), reading);
      for (const l of lines) {
        const ratio = (l.t1 - l.t0) / (l.syl / rate);
        if (!(ratio > 0.5 && ratio < 2.2)) throw new Error(`a line came out ${ratio.toFixed(2)} times its expected length`);
      }
      return lines;
    } catch (e) { problem = e; }
  }
  throw problem;
}

/** Cuts one narration into line files, by the words heard when that is possible. Throws rather than cut a line wrongly. */
export function splitChunk(chunk, texts, files) {
  let lines = null;
  const heard = heardWords(chunk);
  if (heard?.length) {
    const silences = detectSilences(chunk, '-34dB', 0.07);
    const cut = cutsFromWords(texts, heard, silences, durationOf(chunk));
    lines = cut.lines;
    console.log(`  words recognised: ${Math.round(cut.recognised * 100)}%`);
  } else {
    if (process.env.CI) throw new Error('word timing is not available on the server');
    lines = cutByPauses(chunk, texts);
  }
  lines.forEach((l, i) => {
    ff(['-ss', l.t0.toFixed(3), '-to', l.t1.toFixed(3), '-i', chunk, '-af', 'afade=t=in:d=0.015,areverse,afade=t=in:d=0.015,areverse', '-ar', '48000', files[i]]);
  });
}
