#!/usr/bin/env node
// media/tools/hear-check.mjs — listens to a finished video again without rendering anything, and measures its loudness.
// Used to calibrate the limits in lib/heard.mjs on approved videos, and to recheck a video on its own.
// Usage: node media/tools/hear-check.mjs <video.mp4> <review.json or .srt> <lang> <out.json>   (needs WHISPER_PY)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FFMPEG } from '../lib/ff.mjs';
import { hearLines, hearTotals, hearProblems, matchScore } from '../lib/heard.mjs';

const [video, linesFile, lang, outFile] = process.argv.slice(2);
if (!outFile) throw new Error('usage: hear-check.mjs <video> <review.json|srt> <lang> <out.json>');

const clock = (t) => { const [h, m, s] = t.replace(',', '.').split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
const srt = linesFile.endsWith('.json')
  ? JSON.parse(fs.readFileSync(linesFile, 'utf8')).lines.map((l) => ({ n: l.n, start: l.start, end: l.end, text: l.text }))
  : fs.readFileSync(linesFile, 'utf8').trim().split(/\r?\n\r?\n/).map((b) => { const r = b.split(/\r?\n/); const [a, z] = r[1].split(' --> '); return { n: Number(r[0]), start: clock(a), end: clock(z), text: r.slice(2).join(' ') }; });

const audio = `${outFile}.mp3`;
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(String(r.stderr).slice(-400)); return r; };
run(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', audio]);
const started = Date.now();
const heard = JSON.parse(run(process.env.WHISPER_PY, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'words.py'), audio, lang]).stdout);
const listenSeconds = Math.round((Date.now() - started) / 1000);
fs.rmSync(audio, { force: true });

const scored = hearLines(srt, heard, lang);
const totals = hearTotals(scored, srt, heard, lang);
// control: what each line would score against the words of a different part of the video. The gap to `near` is
// the room there is for a limit.
const wrong = srt.map((s, i) => matchScore(s.text, scored[(i + Math.ceil(srt.length / 2)) % srt.length].heard, lang));
const q = (list, p) => { const v = [...list].sort((a, b) => a - b); return Number((v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0).toFixed(3)); };
const near = scored.filter((x) => x.letters >= 8).map((x) => x.near);

const loud = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', video, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stderr;
const tail = loud.slice(loud.lastIndexOf('Summary:'));
const num = (re) => Number((tail.match(re) || [])[1] ?? NaN);

const result = {
  video: path.basename(video), lang, model: lang === 'en' ? 'base.en' : process.env.WHISPER_MODEL || 'small', listenSeconds,
  lines: srt.length, totals,
  lineScores: { min: q(near, 0), p5: q(near, 0.05), p25: q(near, 0.25), median: q(near, 0.5) },
  wrongPairScores: { median: q(wrong, 0.5), p95: q(wrong, 0.95), max: q(wrong, 1) },
  loudness: { lufs: num(/I:\s*(-?[\d.]+) LUFS/), truePeak: num(/Peak:\s*(-?[\d.]+) dBFS/), range: num(/LRA:\s*([\d.]+) LU/) },
  problems: hearProblems(scored, totals, srt, lang),
  scored: scored.map((x) => ({ ...x, text: srt.find((s) => s.n === x.n)?.text })),
};
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, scored: undefined, problems: result.problems.length }));
for (const x of [...result.scored].filter((x) => x.letters >= 8).sort((a, b) => a.near - b.near).slice(0, 5)) console.log(`  worst line ${x.n} near=${x.near} wide=${x.wide}\n    written: ${x.text}\n    heard:   ${x.heard}`);
