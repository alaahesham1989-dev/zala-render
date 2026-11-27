// media/lib/listen.mjs — runs the free speech-to-text (tools/words.py) on a finished video and scores every caption line.
// A line that comes out badly is heard once more on its own before anyone calls it wrong: over a long file Whisper can
// skip a stretch that is perfectly there.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FFMPEG } from './ff.mjs';
import { hearLines, hearTotals, hearProblems, matchScore, LIMITS } from './heard.mjs';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'words.py');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`hearing failed: ${String(r.stderr).slice(-300)}`);
  return r;
}

/** Words heard in the whole file, or in [from, to] of it, with times on the file's own clock. */
export function transcribe(video, lang, work, from, to) {
  const audio = path.join(work, `listen-${process.pid}.mp3`);
  const cut = from === undefined ? [] : ['-ss', Math.max(0, from).toFixed(2), '-to', to.toFixed(2)];
  run(FFMPEG, ['-y', '-loglevel', 'error', ...cut, '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]);
  const words = JSON.parse(run(process.env.WHISPER_PY, [TOOL, audio, lang]).stdout);
  fs.rmSync(audio, { force: true });
  const shift = Math.max(0, from || 0);
  return words.map((w) => ({ ...w, start: w.start + shift, end: w.end + shift }));
}

/** Length of the sound track, which can be shorter than the picture. */
export function soundSeconds(video) {
  const r = spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' });
  return Number(String(r.stdout).trim()) || null;
}

/** @param {{ n: number, start: number, end: number, text: string }[]} srt */
export function hearVideo(video, srt, lang, work) {
  const heard = transcribe(video, lang, work);
  const scored = hearLines(srt, heard, lang);
  const limit = LIMITS[lang]?.line ?? 0.5;
  for (const x of scored.filter((y) => y.near < limit + 0.1).slice(0, 25)) {
    const s = srt.find((l) => l.n === x.n);
    let again = '';
    try { again = transcribe(video, lang, work, s.start - 0.3, s.end + 0.3).map((w) => w.w).join(' '); }
    catch { console.log(`  line ${x.n}: there is no sound to hear again at ${s.start.toFixed(1)}s (video sound ${soundSeconds(video)}s)`); }
    const score = Number(matchScore(s.text, again, lang).toFixed(3));
    x.again = again;
    if (score > x.near) { x.near = score; x.wide = Math.max(x.wide, score); x.heard = again; }
  }
  const totals = hearTotals(scored, srt, heard, lang);
  return { heard, scored, totals, problems: hearProblems(scored, totals, srt, lang) };
}

/** Integrated loudness (LUFS) and true peak (dBFS) of a file. */
export function loudness(video) {
  const out = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;
  const tail = out.slice(out.lastIndexOf('Summary:'));
  const num = (re) => { const m = tail.match(re); return m ? Number(m[1]) : null; };
  return { lufs: num(/I:\s*(-?[\d.]+) LUFS/), truePeak: num(/Peak:\s*(-?[\d.]+) dBFS/) };
}

/** YouTube plays everything near -14 LUFS: a track far from it, or one that clips, is a spoiled sound. */
export function loudnessProblems({ lufs, truePeak }) {
  const out = [];
  if (lufs === null || truePeak === null) return ['the loudness could not be measured'];
  if (lufs < -17 || lufs > -11) out.push(`the sound is ${lufs} LUFS, it should be near -14`);
  if (truePeak > 0.5) out.push(`the sound clips (true peak ${truePeak} dBFS)`);
  return out;
}
