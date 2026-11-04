// The free plan allows few voice requests a day, so several story lines go in one request
// and the narration is then cut back into one file per line, always at a pause.
import { ff } from './ff.mjs';
import { alignLines } from './align.mjs';

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

// A storyteller's pauses can be short: try the clearest reading of them first, then look for finer ones.
const PAUSE_READINGS = [{ noise: '-40dB', minDur: 0.22 }, { noise: '-35dB', minDur: 0.16 }, { noise: '-30dB', minDur: 0.12 }, { noise: '-26dB', minDur: 0.08 }];

function cutPoints(chunk, texts, reading) {
  const { lines, rate } = alignLines(chunk, texts.map((text) => ({ text })), reading);
  for (const l of lines) {
    const ratio = (l.t1 - l.t0) / (l.syl / rate);
    if (!(ratio > 0.5 && ratio < 2.2)) throw new Error(`a line came out ${ratio.toFixed(2)} times its expected length`);
  }
  return lines;
}

/** Cuts one narration into line files. Throws when the pauses do not fit the lines, so no line is ever cut wrongly. */
export function splitChunk(chunk, texts, files) {
  let lines = null, problem = null;
  for (const reading of PAUSE_READINGS) {
    try { lines = cutPoints(chunk, texts, reading); break; } catch (e) { problem = e; }
  }
  if (!lines) throw problem;
  lines.forEach((l, i) => {
    ff(['-ss', l.t0.toFixed(3), '-to', l.t1.toFixed(3), '-i', chunk, '-af', 'afade=t=in:d=0.015,areverse,afade=t=in:d=0.015,areverse', '-ar', '48000', files[i]]);
  });
}
