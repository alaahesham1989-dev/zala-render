#!/usr/bin/env node
// media/tools/review-render.mjs — checks a finished episode on the cloud server and writes small review files.
// Picture sheets, what is really heard in each line, whether the picture fits the line, black frames, silences and reels.
// Usage: node media/tools/review-render.mjs <publish dir> <script.json> <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG, ff, durationOf } from '../lib/ff.mjs';
import { keyFor, markSpent } from '../lib/gemini-keys.mjs';
import { numerals } from '../lib/display-numbers.mjs';

const [publish, scriptFile, out] = process.argv.slice(2);
if (!process.env.CI) throw new Error('This review runs on the cloud server only.');
const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
const id = script.id;
const video = path.join(publish, `${id}.mp4`);
const tmp = path.join(out, '_tmp');
fs.mkdirSync(tmp, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const FONT = '/usr/share/fonts/truncated/noto/NotoSans-Bold.ttf';
const label = (text, size) => `drawtext=${fs.existsSync(FONT) ? `fontfile=${FONT}:` : ''}text='${text}':x=6:y=6:fontsize=${size}:fontcolor=yellow:box=1:boxcolor=black@0.75`;

function readSrt(file) {
  const clock = (t) => { const [h, m, s] = t.replace(',', '.').split(':'); return Number(h) * 3600 + Number(m) * 60 + Number(s); };
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n\r?\n/).map((block) => {
    const rows = block.split(/\r?\n/);
    const [a, b] = rows[1].split(' --> ');
    return { n: Number(rows[0]), start: clock(a), end: clock(b), text: rows.slice(2).join(' ') };
  });
}

async function ask(parts) {
  for (let round = 1; round <= 5; round++) {
    for (const model of MODELS) {
      const key = keyFor(model);
      if (!key) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }), signal: AbortSignal.timeout(180000),
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
        if (res.ok && text) return JSON.parse(text);
        if (JSON.stringify(data.error || '').includes('PerDay')) markSpent(model, key);
        console.log(`  ${model}: answered ${res.status}`);
      } catch (e) { console.log(`  ${model}: ${e.name}`); }
    }
    await sleep(15000 * round);
  }
  return null;
}

const frameOf = (file, t, filter, target) => ff(['-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', filter, '-q:v', '5', target]);

function sheet(frames, columns, rows, target) {
  const dir = fs.mkdtempSync(path.join(tmp, 'sheet-'));
  frames.forEach((f, i) => fs.copyFileSync(f, path.join(dir, `${String(i + 1).padStart(3, '0')}.jpg`)));
  ff(['-framerate', '1', '-i', path.join(dir, '%03d.jpg'), '-vf', `tile=${columns}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '6', target]);
}

const words = (s) => numerals(String(s)).toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
function compare(expected, heard) {
  const a = words(expected), b = words(heard);
  const have = new Map();
  b.forEach((w) => have.set(w, (have.get(w) || 0) + 1));
  const missing = a.filter((w) => { const n = have.get(w) || 0; if (n) have.set(w, n - 1); return !n; });
  const extra = [...have.entries()].flatMap(([w, n]) => Array(n).fill(w));
  return { missing, extra, plainMissing: missing.filter((w) => !nameWords(expected).has(w)), firstOk: a[0] === b[0], lastOk: a[a.length - 1] === b[b.length - 1] };
}
// Ancient names (Psusennes, Pinedjem, Duathathor-Henuttawy), Roman numerals and codes (NRT IV) are what speech
// recognition mishears, not what the voice gets wrong: a line only fails on its ordinary words.
function nameWords(text) {
  const out = new Set();
  const toks = String(text).split(/\s+/);
  toks.forEach((t, i) => {
    const prev = toks[i - 1] || '';
    const sentenceStart = i === 0 || /[.!?:]["')]*$/.test(prev);
    const clean = t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!clean) return;
    if ((/^[A-Z]/.test(clean) && !sentenceStart) || /^[IVXL]+$/.test(clean) || /^[A-Z]{2,}\d*$/.test(clean) || /-/.test(clean)) {
      for (const w of words(clean.replace(/-/g, ' '))) out.add(w);
    }
  });
  return out;
}

function detect(filter) {
  return String(spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', video, ...filter, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 27 }).stderr);
}

const srt = readSrt(path.join(publish, `${id}.en.srt`));
const lines = script.chapters.flatMap((c, ci) => c.lines.map((l, li) => ({ label: `c${ci + 1}.${li + 1}`, ...l })));
const report = { id, seconds: durationOf(video), srtLines: srt.length, scriptLines: lines.length, lines: [], audio: {}, reels: [] };

// picture sheets: two moments of every line
console.log('Sheets: main video');
const main = [];
for (const s of srt) {
  for (const [part, at] of [['a', 0.25], ['b', 0.75]]) {
    const f = path.join(tmp, `L${String(s.n).padStart(2, '0')}${part}.jpg`);
    frameOf(video, s.start + (s.end - s.start) * at, `scale=384:216,${label(`L${s.n}${part}`, 24)}`, f);
    main.push(f);
  }
}
for (let i = 0, k = 1; i < main.length; i += 20, k++) sheet(main.slice(i, i + 20), 5, 4, path.join(out, `main-${String(k).padStart(2, '0')}.jpg`));
const outro = [];
for (let i = 0; i < 5; i++) {
  const f = path.join(tmp, `outro${i}.jpg`);
  frameOf(video, srt[srt.length - 1].end + 0.5 + i * ((report.seconds - srt[srt.length - 1].end - 1) / 4), `scale=384:216,${label(`END${i + 1}`, 24)}`, f);
  outro.push(f);
}
sheet(outro, 5, 1, path.join(out, 'outro.jpg'));

// what is really heard, in the finished mix
console.log('Hearing every line');
const allAudio = path.join(tmp, 'all.mp3');
ff(['-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', allAudio]);
const heardRun = spawnSync(process.env.WHISPER_PY, [path.join(path.dirname(new URL(import.meta.url).pathname), 'words.py'), allAudio], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (heardRun.status !== 0) throw new Error(`hearing failed: ${String(heardRun.stderr).slice(-300)}`);
const heardWords = JSON.parse(heardRun.stdout);
for (const s of srt) {
  s.seconds = s.end - s.start;
  s.secPerWord = s.seconds / words(s.text).length;
  const mid = (w) => (w.start + w.end) / 2;
  s.heard = heardWords.filter((w) => mid(w) >= s.start - 0.15 && mid(w) <= s.end - 0.05).map((w) => w.w).join(' ');
  Object.assign(s, compare(s.text, s.heard));
  // a line that seems empty gets its own hearing before anyone calls it missing
  if (s.missing.length > words(s.text).length * 0.6) {
    const clip = path.join(tmp, `again${s.n}.mp3`);
    ff(['-ss', Math.max(0, s.start - 0.3).toFixed(2), '-to', (s.end + 0.3).toFixed(2), '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', clip]);
    const again = spawnSync(process.env.WHISPER_PY, [path.join(path.dirname(new URL(import.meta.url).pathname), 'words.py'), clip], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (again.status === 0) { s.heard = JSON.parse(again.stdout).map((w) => w.w).join(' '); Object.assign(s, compare(s.text, s.heard)); }
  }
}

// does the picture fit the words
console.log('Pictures against words');
for (let i = 0; i < srt.length; i += 6) {
  const group = srt.slice(i, i + 6);
  const parts = [{ text: `These frames come from a true-history video about Cleopatra's final years and the search for her tomb. For each numbered frame you get the sentence spoken over it. Judge: does the picture fit the sentence (exact event, person, place or period)? Note anything out of place: a wrong era, a cross, church or mosque, a modern object, a watermark, a stock logo, text on screen that is cut off or misspelled, a badly cropped subject. Set nudity true if bare breasts, genitals or a naked body are visible, even in art. Return only JSON {"items":[{"n":0,"fits":"yes|loosely|no","nudity":false,"shows":"what is really visible, short","problem":""}]}.` }];
  group.forEach((s, k) => {
    const f = path.join(tmp, `check${s.n}.jpg`);
    frameOf(video, (s.start + s.end) / 2, 'scale=640:-2', f);
    parts.push({ text: `Frame ${k}. Spoken: ${s.text}` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  });
  const a = (await ask(parts)) || (await ask(parts));
  (a?.items || []).forEach((r) => { const s = group[r.n]; if (s) Object.assign(s, { fits: r.fits, nudity: !!r.nudity, shows: r.shows, pictureProblem: r.problem || '' }); });
  console.log(`  ${Math.min(i + 6, srt.length)}/${srt.length}`);
  await sleep(5000);
}

report.lines = srt.map(({ clip, ...s }, i) => ({ ...s, label: lines[i]?.label, pictures: lines[i]?.pictures, same: lines[i] ? words(lines[i].en).join(' ') === words(s.text).join(' ') : false }));

// black frames, silences, loudness, frozen picture
console.log('Black frames and silences');
const black = detect(['-vf', 'blackdetect=d=0.4:pix_th=0.1', '-an']);
report.audio.black = [...black.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
const silent = detect(['-af', 'silencedetect=noise=-45dB:d=1.2', '-vn']);
report.audio.silence = [...silent.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ end: Number(m[1]), seconds: Number(m[2]) }));
const frozen = detect(['-vf', 'scale=320:-2,freezedetect=n=0.0005:d=8', '-an']);
report.audio.frozen = [...frozen.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map((m) => ({ start: Number(m[1]), seconds: Number(m[2]) }));

// reels
for (const name of fs.readdirSync(publish).filter((f) => /-R\d+\.mp4$/.test(f)).sort()) {
  const file = path.join(publish, name);
  const seconds = durationOf(file);
  const frames = [];
  for (let i = 0; i < 12; i++) {
    const f = path.join(tmp, `${name}-${i}.jpg`);
    frameOf(file, Math.min(seconds - 0.2, 0.2 + i * (seconds / 12)), `scale=240:-2,${label(String(Math.round(i * (seconds / 12))), 22)}`, f);
    frames.push(f);
  }
  sheet(frames, 6, 2, path.join(out, `reel-${name.replace(/.*-(R\d+)\.mp4/, '$1')}.jpg`));
  const clip = path.join(tmp, `${name}.mp3`);
  ff(['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', clip]);
  const a = await ask([{ text: 'Write exactly the words spoken in this short vertical video, in order, and say if the speech starts or ends cut off. Return only JSON {"heard":"","problem":""}.' }, { inlineData: { mimeType: 'audio/mpeg', data: fs.readFileSync(clip).toString('base64') } }]);
  const look = await ask([{ text: 'These are frames from one vertical video. Return only JSON {"nudity":false,"cutOffText":false,"note":""}. nudity: any bare breasts, genitals or naked body, even in art. cutOffText: words cut by the edge of the frame or printed over each other.' }, ...frames.map((x) => ({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(x).toString('base64') } }))]);
  report.reels.push({ name, seconds, heard: a?.heard, problem: a?.problem, nudity: !!look?.nudity, cutOffText: !!look?.cutOffText, note: look?.note });
  await sleep(4000);
}

// the finished thumbnail and covers, small
for (const name of fs.readdirSync(publish).filter((f) => /(_thumbnail(-\d)?|_cover)\.jpg$/.test(f))) ff(['-i', path.join(publish, name), '-vf', 'scale=480:-2', '-q:v', '6', path.join(out, `small-${name}`)]);

fs.rmSync(tmp, { recursive: true, force: true });
fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify(report, null, 1));

// the verdict: a video that fails is held and never published
const fail = [];
const pkgFile = path.join(publish, `${id}.youtube.json`);
const pkg = fs.existsSync(pkgFile) ? JSON.parse(fs.readFileSync(pkgFile, 'utf8')) : {};
const lastSpeech = srt[srt.length - 1].end;
if (srt.length !== lines.length) fail.push(`subtitles have ${srt.length} lines, the script ${lines.length}`);
for (const l of report.lines) {
  if (l.heard === undefined) fail.push(`line ${l.n}: could not be heard`);
  else if ((l.missing || []).length > words(l.text).length * 0.6) fail.push(`line ${l.n}: most words were not heard: ${l.text.slice(0, 60)}`);
  else if ((l.plainMissing || l.missing || []).length >= 4 && (l.extra || []).length >= 4) fail.push(`line ${l.n}: the voice and the words do not match: ${l.heard.slice(0, 80)}`);
  if (l.fits === undefined) fail.push(`line ${l.n}: picture not checked`);
  if (l.nudity || /nud|naked/i.test(l.pictureProblem || '')) fail.push(`line ${l.n}: nudity`);
  const source = lines[l.n - 1] || {};
  if (l.fits === 'no' && !source.clip && !(source.card && !source.pictures?.length)) fail.push(`line ${l.n}: wrong picture: ${String(l.shows).slice(0, 80)}`);
}
const loose = report.lines.filter((l) => l.fits === 'loosely').length;
if (loose > report.lines.length * 0.25) fail.push(`${loose} of ${report.lines.length} pictures only loosely fit`);
for (const [a, b] of report.audio.black) if (b < lastSpeech) fail.push(`black screen at ${a.toFixed(1)}s`);
for (const x of report.audio.silence) if (x.end - x.seconds < lastSpeech - 0.5 && x.seconds > 2.5) fail.push(`${x.seconds.toFixed(1)}s of silence before ${x.end.toFixed(1)}s`);
if (report.audio.silence.some((x) => x.end >= report.seconds - 0.2 && x.seconds > 3)) fail.push('the ending is silent');
for (const x of report.reels) { if (x.nudity) fail.push(`${x.name}: nudity`); if (x.cutOffText) console.log(`Note: ${x.name}: ${String(x.note).slice(0, 100)}`); }
for (const x of report.reels) if (x.problem && !/^(none|no)\b/i.test(x.problem)) fail.push(`${x.name}: ${String(x.problem).slice(0, 90)}`);
// what keeps a viewer watching
const eng = pkg.engagement || {};
if (eng.longestStill > 7) fail.push(`one picture stays ${eng.longestStill}s without a cut`);
if (eng.longestClip > 14) fail.push(`one moving clip runs ${eng.longestClip}s`);
if (!(eng.teasers >= eng.minutes * 1.5)) fail.push(`only ${eng.teasers} lines at the top for ${eng.minutes} minutes`);
if (!(eng.wordTimed >= eng.lines * 0.95)) fail.push(`captions follow the spoken words on only ${eng.wordTimed} of ${eng.lines} lines`);
if (!eng.licensedMusic) fail.push('no licensed music: the built-in bed was used');
if (eng.cards > 7) fail.push(`${eng.cards} text cards, too many`);
if ((pkg.thumbnails || []).length < 3) fail.push(`only ${(pkg.thumbnails || []).length} thumbnails`);
const blob = [pkg.title, pkg.description].join(' ');
for (const bad of (script.bannedWords || [])) if (new RegExp(`\\b${bad}\\b`, 'i').test(blob)) fail.push(`publishing text says "${bad}"`);
// cards in a row, reused from the director's rule, and pictures showing nudity are removed for the next run
const nude = [...new Set(report.lines.filter((l) => l.nudity).flatMap((l) => l.pictures || []))];
if (nude.length) {
  const lib = path.join('content', 'library', 'items.jsonl');
  if (fs.existsSync(lib)) {
    const rows = fs.readFileSync(lib, 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    for (const it of rows) if (nude.includes(it.id) && it.seen) it.seen.check = { ...(it.seen.check || {}), nudity: true, note: 'flagged by quality control' };
    fs.writeFileSync(lib, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
    delete script.directed;
    fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n');
    console.log(`Quality control removed ${nude.length} pictures for the next run`);
  }
}
const verdict = { id, pass: fail.length === 0, reasons: fail, checkedAt: new Date().toISOString() };
fs.writeFileSync(path.join(out, 'verdict.json'), JSON.stringify(verdict, null, 1));
console.log(verdict.pass ? 'QUALITY: PASSED' : `QUALITY: HELD\n${fail.map((x) => `  - ${x}`).join('\n')}`);
const unheard = report.lines.filter((l) => l.heard === undefined).length;
console.log(`Review done: ${report.lines.length} lines, ${unheard} not heard, ${fs.readdirSync(out).length} files.`);
