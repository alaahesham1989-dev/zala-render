#!/usr/bin/env node
// media/zala-render.mjs — the one ZALA VIP channel renderer: script JSON → finished YouTube + Reels package.
//
//   node media/zala-render.mjs all ZV-L01        the whole episode, no human steps: library → story from its pictures → voice → Meta motion → render → checks
//   node media/zala-render.mjs check ZV-L01      validate the script, key, fonts; print what the voice will need
//   node media/zala-render.mjs sample ZV-L01     one voice line to audition voice + style (1 request)
//   node media/zala-render.mjs story|voice|images|animate|render ZV-L01    one step only; every step keeps its finished work
//   node media/zala-render.mjs meta-login        visible window, sign in to meta.ai once with the channel's separate account
//   node media/zala-render.mjs meta-test ZV-L01  animate one picture and keep a screenshot of every step
//
// Flags: --voice-from <dir> (reuse c01_l01_line.mp3 clips)  --limit <n> (first n lines only)  --no-meta  --no-reels  --reels-only
//
// Everything in media/out/<id>/publish is English only. Arabic lives only in media/out/<id>/DO-NOT-PUBLISH-internal.
//
// The library (media/library-harvest.mjs, content/library) comes first: stories are written from its checked pictures, never the other way round.
//
// Script additions (all optional): voice, voiceStyle, voiceTempo, description, tags, sources, outroNext, thumbnailShot ("1.1"),
//   reels: [{ chapter, title, badge, hook, sub }]. Line: say (TTS text if different from en), shot {q, m}, callout {big, small}, sfx.
// Music, first one found: media/brand/music.mp3, then Lyria (cached per episode), then the synthesized bed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { FFMPEG, ff, durationOf, dimensionsOf, filterPath } from './lib/ff.mjs';
import { buildAss as buildReelAss } from './lib/captions.mjs';
import { CACHE, CONTENT, OUT, TMP, FONTS, BRAND, REPO } from './lib/paths.mjs';
import { geminiKeys, keyFor, markSpent, clearSpent, keyRefused } from './lib/gemini-keys.mjs';
import { groupLines, splitChunk } from './lib/voice-chunks.mjs';
import { numerals } from './lib/display-numbers.mjs';
import { screenPictures, directEpisode } from './lib/director.mjs';
import { timedWords, heardOf, captionEvents, dustEvents, sweepEvent, flashEvent, teaserEvents } from './lib/punch.mjs';

const W = 1920, H = 1080, FPS = 30;
const VW = 1080, VH = 1920;
const SW = 2880, SH = 1620;   // working size of stills for smooth camera moves
const LEAD = 0.5, LINE_GAP = 0.2, CHAPTER_GAP = 0.7, STING = 2.2, OUTRO = 10, TAIL = 1.0;
const SHOT_MAX = 4;   // a still never sits longer than this before the camera cuts to a new move
const REEL_MAX = 58, REEL_OUTRO = 3.2;
const X264 = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS)];
const DEFAULT_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
const DEFAULT_VOICE = 'Orus';
const DEFAULT_STYLE = 'A gripping storyteller telling a true story to a friend: warm, confident and full of suspense, lively pace, natural pauses before the big reveals.';
const AUDIO_TOKENS_PER_SEC = 25;   // measured on gemini-3.8-flash-tts
const VOICE_WORDS_PER_REQUEST = 190;   // the free plan allows 10 voice requests a day: a 12-minute episode fits in them
const VOICE_REQUEST_GAP = 21000;   // and 3 a minute
const GOLD = '&H0037AFD4&', WHITE = '&H00FFFFFF&';
// the factory can add lighter models when these are all busy (GEMINI_TEXT_MODELS, comma separated)
const TEXT_MODELS = process.env.GEMINI_TEXT_MODELS ? process.env.GEMINI_TEXT_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
  : ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];
const MUSIC_MODEL = 'lyria-3-pro-preview';
const META_URL = 'https://www.meta.ai/';
const META_PROFILE = path.join(CACHE, 'meta-profile');
const META_MAX_CLIPS = 30;      // per run; finished clips are kept, so the next run carries on
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UA = 'ZALA-VIP-media/1.0 (https://www.zalavip.com)';
const SITE = (id, medium) => `https://www.zalavip.com/?utm_source=youtube&utm_medium=${medium}&utm_campaign=${id}`;

const log = (...a) => console.log(...a);
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── script loading ───────────────────────────────────────────────────────────
function sentences(text) {
  return String(text || '').match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

/** Old shorts-*.json / long-*.json items (narration + broll) become the same chapters → lines shape. */
function normalize(s) {
  if (s.chapters?.[0]?.lines) return s;
  const toLines = (text, broll = []) => sentences(text).map((en, i, all) => {
    const b = broll.length ? broll[Math.min(broll.length - 1, Math.floor((i * broll.length) / all.length))] : { query: s.title };
    return { en, shot: { q: b.query, hint: b.source_hint } };
  });
  if (s.chapters) {
    const chapters = s.chapters.map((c) => ({ title: c.title, lines: toLines(c.narration, c.broll) }));
    if (s.hook) chapters.unshift({ title: 'Intro', lines: toLines(s.hook, s.chapters[0]?.broll) });
    return { ...s, chapters };
  }
  const body = String(s.narration || '');
  const text = s.hook && !body.toLowerCase().startsWith(String(s.hook).toLowerCase().slice(0, 18)) ? `${s.hook} ${body}` : body;
  return { ...s, verticalOnly: true, chapters: [{ title: s.title, lines: toLines(text, s.broll) }] };
}

function loadScript(arg) {
  const dir = path.join(CONTENT, 'youtube');
  const direct = [arg, path.join(dir, `${arg}.json`)].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (direct) return normalize(JSON.parse(fs.readFileSync(direct, 'utf8')));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const hit = Array.isArray(list) && list.find((x) => x.id === arg && (x.narration || x.chapters));
      if (hit) return normalize(hit);
    } catch {}
  }
  throw new Error(`No script found for "${arg}" in content/youtube`);
}

function flatten(script, limit = 0) {
  const flat = [];
  script.chapters.forEach((c, ci) => c.lines.forEach((l, li) => flat.push({
    ci, li, key: `${ci}.${li}`, label: `c${String(ci + 1).padStart(2, '0')}_l${String(li + 1).padStart(2, '0')}`,
    en: l.en, cap: numerals(l.en), ar: l.ar, say: l.say || l.en, shot: l.shot, pictures: l.pictures, card: l.card, map: l.map, sfx: l.sfx, callout: l.callout, part: l.part, clip: l.clip, extra: l.extra,
  })));
  return limit ? flat.slice(0, limit) : flat;
}

const workDir = (id) => path.join(TMP, 'render', id);
const outDir = (id) => path.join(OUT, id, 'publish');
const reviewDir = (id) => path.join(OUT, id, 'DO-NOT-PUBLISH-internal');
const shotsFile = (id) => path.join(CONTENT, 'youtube', `${id}.shots.json`);

// ── ffmpeg helpers ───────────────────────────────────────────────────────────
function runAsync(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-900)}`))));
  });
}
async function pool(tasks, limit, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < tasks.length) {
      const k = i++;
      await fn(tasks[k], k);
      done++;
      if (done % 5 === 0 || done === tasks.length) log(`  ${done}/${tasks.length}`);
    }
  }));
}
/** Writes through a temp name so an interrupted render never leaves a half file that looks finished. */
async function encodeTo(file, argsFor) {
  const part = `${file}.part.mp4`;
  await runAsync(argsFor(part));
  for (let tries = 0; ; tries++) {
    try { fs.renameSync(part, file); return; } catch (e) {
      if (tries >= 20 || !/EBUSY|EPERM|EACCES/.test(e.code || '')) throw e;
      await sleep(500);
    }
  }
}
const okClip = (p) => { try { return fs.existsSync(p) && durationOf(p) > 0.3; } catch { return false; } };

function curve(points) {
  const fx = (n) => Number(n).toFixed(3);
  let e = String(points[points.length - 1][1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, g0] = points[i], [t1, g1] = points[i + 1];
    const lerp = t1 === t0 ? g1 : `${fx(g0)}+(${fx(g1 - g0)})*(t-${fx(t0)})/${fx(t1 - t0)}`;
    e = `if(lt(t,${fx(t1)}),${lerp},${e})`;
  }
  return `if(lt(t,${fx(points[0][0])}),${fx(points[0][1])},${e})`;
}

// ── voice ────────────────────────────────────────────────────────────────────
function pronounce(text) {
  try {
    const { entries = {} } = JSON.parse(fs.readFileSync(path.join(CONTENT, 'youtube', 'pronunciation.json'), 'utf8'));
    return Object.keys(entries).sort((a, b) => b.length - a.length)
      .reduce((t, k) => t.replace(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), entries[k]), text);
  } catch { return text; }
}
const voiceParams = (script) => ({
  model: DEFAULT_MODEL, voice: script.voice || DEFAULT_VOICE, style: script.voiceStyle || DEFAULT_STYLE, tempo: Number(script.voiceTempo) || 1,
});
const voiceFileOf = (script, f, vp = voiceParams(script)) => f.extra ? extraVoice(script, f.say) :
  path.join(CACHE, 'voice', script.id, `${f.label}-${hash([f.say, vp.model, vp.voice, vp.style, vp.tempo].join('|'))}.wav`);

const extraVoice = (script, text) => path.join(CACHE, 'voice', script.id, `x-${hash(text)}.wav`);

function findAudio(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'audio' && node.data) return node.data;
  if (node.inlineData?.data) return node.inlineData.data;
  for (const v of Object.values(node)) { const hit = findAudio(v); if (hit) return hit; }
  return null;
}

class QuotaError extends Error {}
/** Daily quotas reset at midnight Pacific. */
function msToQuotaReset() {
  const pt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const next = new Date(pt);
  next.setHours(24, 2, 0, 0);
  return Math.max(60000, next - pt);
}

async function speakLine(text, vp, file) {
  if (!geminiKeys.length) throw new Error('GEMINI_API_KEY is missing from .env.local');
  const body = {
    model: vp.model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: pronounce(text), annotations: [{ type: 'speech_metadata', style: vp.style }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: vp.voice }] },
  };
  for (let attempt = 1, waits = 0; ; attempt++) {
    const key = keyFor(vp.model);
    if (!key) throw new QuotaError('every key has used up its day');
    let res, data;
    try {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000),
      });
      data = await res.json();
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(3000 * attempt);
      continue;
    }
    const b64 = findAudio(data);
    if (res.ok && b64) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const raw = `${file}.raw.wav`;
      fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
      const tempo = vp.tempo !== 1 ? `atempo=${vp.tempo},` : '';
      // the API returns WAV with its own header; ffmpeg reads the header, so no click at the start of each line
      ff(['-i', raw, '-af', `${tempo}highpass=f=70,lowpass=f=12000,silenceremove=start_periods=1:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-45dB:detection=peak,areverse`, '-ar', '48000', file]);
      fs.rmSync(raw, { force: true });
      return;
    }
    const msg = String(data?.error?.message || JSON.stringify(data).slice(0, 300));
    if (res.status === 429) {
      if (/per.?day|daily|PerDay|RPD/i.test(msg) || waits >= 2) {
        log(`  voice: today's free requests are used up on key ${markSpent(vp.model, key)}`);
        waits = 0;
        continue;
      }
      waits++;
      log(`  speed limit reached, waiting a minute…`);
      await sleep(65000);
      continue;
    }
    if (keyRefused(res.status, data?.error)) { log(`  voice: Google refused key ${markSpent(vp.model, key)}`); continue; }
    if (res.status >= 500 && attempt < 5) { await sleep(4000 * attempt); continue; }
    throw new Error(`Gemini voice error ${res.status}: ${msg}`);
  }
}

async function stageVoice(script, flat, { voiceFrom } = {}) {
  const vp = voiceParams(script);
  log(`Voice: ${vp.voice} on ${vp.model}`);
  const todo = flat.filter((f) => !fs.existsSync(voiceFileOf(script, f, vp)));
  let made = 0;
  const pending = [];
  for (const f of todo) {
    const legacy = voiceFrom && path.join(voiceFrom, `${f.label}_line.mp3`);
    if (legacy && fs.existsSync(legacy)) {
      const file = voiceFileOf(script, f, vp);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      ff(['-i', legacy, '-ar', '48000', file]);
    } else pending.push(f);
  }
  // a finished narration for a chapter (media/cache/narration/<id>/chapter-N.mp3) is cut into its lines and needs no voice requests
  const narrated = path.join(CACHE, 'narration', script.id);
  // fixes.json: [{ file, lines: [text] }] lists sentences the voice service skipped, made again in their own short files
  let repairs = [];
  try { repairs = JSON.parse(fs.readFileSync(path.join(narrated, 'fixes.json'), 'utf8')); } catch {}
  const repaired = new Set(repairs.flatMap((r) => r.lines));
  for (const r of repairs) {
    const group = r.lines.map((text) => flat.find((x) => x.say === text)).filter(Boolean);
    if (group.length !== r.lines.length) throw new Error(`${r.file}: a repaired sentence is not in the script`);
    const files = group.map((x) => voiceFileOf(script, x, vp));
    fs.mkdirSync(path.dirname(files[0]), { recursive: true });
    splitChunk(path.join(narrated, r.file), r.lines, files);
    for (const x of group) { const at = pending.indexOf(x); if (at >= 0) pending.splice(at, 1); }
    log(`  ${r.file}: ${group.length} repaired lines`);
  }
  // a script whose lines say which part of the narration holds them is cut part by part; older chapter files are then ignored
  const byParts = flat.some((f) => f.part);
  for (const name of fs.existsSync(narrated) ? fs.readdirSync(narrated) : []) {
    const number = Number(name.match(byParts ? /^part-(\d+)\./ : /^chapter-(\d+)\./)?.[1]);
    if (!number) continue;
    const group = flat.filter((f) => (byParts ? f.part === number : Number(f.label.match(/^c(\d+)_/)?.[1]) === number) && !repaired.has(f.say));
    const files = group.map((f) => voiceFileOf(script, f, vp));
    const cutMark = path.join(CACHE, 'voice', script.id, byParts ? `cut-v4-part-${number}.txt` : `cut-v3-chapter-${number}.txt`);
    if (!group.length || (fs.existsSync(cutMark) && files.every((x) => fs.existsSync(x)))) continue;
    fs.mkdirSync(path.dirname(files[0]), { recursive: true });
    splitChunk(path.join(narrated, name), group.map((f) => f.say), files);
    fs.writeFileSync(cutMark, 'words');
    log(`  chapter ${number}: narration cut into ${group.length} lines, ${durationOf(path.join(narrated, name)).toFixed(1)}s`);
    for (const f of group) { const at = pending.indexOf(f); if (at >= 0) pending.splice(at, 1); }
  }
  // lines spoken only in the reels: their hooks and the closing line
  const extras = script.reelLines || [];
  const extraSource = ['reel-lines.mp3', 'hooks.mp3'].map((x) => path.join(narrated, x)).find((x) => fs.existsSync(x)) || '';
  if (extras.length && fs.existsSync(extraSource) && !extras.every((x) => fs.existsSync(extraVoice(script, x)))) {
    fs.mkdirSync(path.join(CACHE, 'voice', script.id), { recursive: true });
    splitChunk(extraSource, extras, extras.map((x) => extraVoice(script, x)));
    log(`  reel lines: ${extras.length} cut`);
  }
  for (const f of [...pending]) if (fs.existsSync(voiceFileOf(script, f, vp))) pending.splice(pending.indexOf(f), 1);
  if (pending.length && script.handWritten) throw new Error(`${pending.length} lines have no narration, for example: ${pending[0].say.slice(0, 80)}`);
  const queue = groupLines(pending, flat, VOICE_WORDS_PER_REQUEST);
  log(`Voice: ${pending.length} lines in ${queue.length} requests`);
  while (queue.length) {
    const group = queue.shift();
    const files = group.map((f) => voiceFileOf(script, f, vp));
    const chunk = path.join(CACHE, 'voice', script.id, `chunk-${hash([...group.map((f) => f.say), vp.model, vp.voice, vp.style, vp.tempo].join('|'))}.wav`);
    try {
      if (group.length === 1) {
        await speakLine(group[0].say, vp, files[0]);
        made++;
        log(`  [${group[0].label}] ${durationOf(files[0]).toFixed(1)}s`);
        await sleep(VOICE_REQUEST_GAP);
      } else {
        // a narration already made is never paid for twice: the file stays until its lines are cut
        const fresh = !fs.existsSync(chunk);
        if (fresh) { await speakLine(group.map((f) => f.say).join('\n\n'), { ...vp, style: `${vp.style} Leave a clear one-second pause between paragraphs.` }, chunk); made++; }
        try {
          splitChunk(chunk, group.map((f) => pronounce(f.say)), files);
          log(`  [${group[0].label} to ${group[group.length - 1].label}] ${durationOf(chunk).toFixed(1)}s, ${group.length} lines`);
        } catch (e) {
          log(`  [${group[0].label}] could not cut this narration at its pauses (${e.message}), asking for these lines in two smaller parts`);
          files.forEach((x) => fs.rmSync(x, { force: true }));
          const half = Math.ceil(group.length / 2);
          queue.unshift(group.slice(0, half), group.slice(half));
        }
        if (fresh) await sleep(VOICE_REQUEST_GAP);
      }
    } catch (e) {
      if (!(e instanceof QuotaError)) throw e;
      const left = flat.filter((x) => !fs.existsSync(voiceFileOf(script, x, vp))).length;
      // the server stops here and saves its work: the next run carries on from the same line
      if (process.env.CI) throw new Error(`Gemini's daily voice limit is used up on every key. ${left} of ${flat.length} lines left, saved work carries on in the next run.`);
      const wait = msToQuotaReset();
      log(`Gemini's daily voice limit is used up. ${left} of ${flat.length} lines left. Waiting ${Math.round(wait / 60000)} minutes for the reset, then carrying on.`);
      log(`If this computer is turned off, run the same command again and it continues from here.`);
      await sleep(wait);
      clearSpent();
      queue.unshift(group);
    }
  }
  log(`Voice ready: ${flat.length} lines (${made} new requests, ${flat.length - todo.length} already saved).`);
}

// ── Gemini text + vision ─────────────────────────────────────────────────────
/** One JSON answer from the first text model that responds; null when none does, so callers fall back instead of stopping. */
async function askGemini(parts) {
  for (let round = 1; round <= 5; round++) {
    for (const model of TEXT_MODELS) {   // when one model is busy the next usually isn't, so move on at once
      const key = keyFor(model);   // models that used up today's free requests on every key: no point waiting on them
      if (!key) continue;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
          signal: AbortSignal.timeout(240000),
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
        if (res.ok && text) return JSON.parse(text);
        if (JSON.stringify(data.error || '').includes('PerDay')) log(`  ${model}: today's free Gemini requests are used up on key ${markSpent(model, key)}`);
        else if (keyRefused(res.status, data.error)) log(`  ${model}: Google refused key ${markSpent(model, key)}`);
        else log(`  ${model}: answered ${res.status} ${String(data.error?.status || '')}`);
      } catch (e) { log(`  ${model}: ${e.name}`); }
    }
    if (TEXT_MODELS.every((m) => !keyFor(m))) return null;
    await sleep(20000 * round);
  }
  return null;
}

// ── library: stories are built on the pictures we already hold ───────────────
const LIB_ITEMS = path.join(CONTENT, 'library', 'items.jsonl');
const LIB_TOPICS = path.join(CONTENT, 'library', 'topics.json');
const MIN_LIBRARY_PICTURES = 40;

function loadLibrary() {
  if (!fs.existsSync(LIB_ITEMS)) return [];
  return fs.readFileSync(LIB_ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Checked pictures of one episode that are already on R2, minus anything showing a sign that does not belong in its story (a cross in a Cleopatra episode). */
const usablePictures = (topicId) => {
  let rule = null;
  try { const f = JSON.parse(fs.readFileSync(LIB_TOPICS, 'utf8'))[topicId]?.forbid; if (f) rule = new RegExp(f, 'i'); } catch {}
  return loadLibrary().filter((i) => i.kind === 'image' && i.seen?.usable && !i.r2_pending && i.topics?.includes(topicId)
    && !(rule && rule.test([i.title, i.note, i.seen.what, i.seen.subject, i.seen.place, ...(i.seen.symbols || [])].join(' '))));
};

/** Fills the library for this episode when it is thin: collect, then let Gemini look at every picture. */
async function ensureLibrary(id) {
  const run = (...args) => spawnSync(process.execPath, [path.join(REPO, 'media', 'library-harvest.mjs'), ...args], { stdio: 'inherit' });
  if (usablePictures(id).length >= MIN_LIBRARY_PICTURES) return;
  log(`Library: only ${usablePictures(id).length} checked pictures for ${id}, collecting more`);
  run('harvest', id, '--limit', '90');
  run('describe', id, '--limit', '200');
  run('upload');
}

function factsFor(id, topic) {
  const dir = path.join(CONTENT, 'factbank');
  const re = new RegExp(topic.match, 'i');
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_') && x !== 'archival-vault.json')) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (re.test(f.replace(/-/g, ' ')) || re.test(String(d.topic || ''))) out.push({ topic: d.topic, summary: d.summary, facts: d.facts, common_myths: d.common_myths });
    } catch {}
  }
  return out;
}

const STORY_RULES = `You write for a YouTube channel that tells gripping true stories about ancient Egypt to American viewers. It is a storytelling channel, NOT a documentary or lecture: open with a hook, build suspense, follow people and what they wanted, end each chapter on a question that pulls the viewer on. Plain, vivid spoken American English.
HARD RULES:
1. Build the story FROM the picture catalog below. Every line must be something its pictures can actually show. Never write a moment you have no picture for; choose a different angle of the story instead.
2. Use only facts from the fact bank and the picture labels. If a claim is disputed, say so in the story ("some historians believe"). Do not invent names, dates, numbers, quotes or events. Follow the common_myths section: never repeat a myth as fact.
3. Each line is one or two spoken sentences, at most 34 words. Give each line 1 to 3 "pictures" (ids from the catalog) in the order they appear, about one picture per 12 words. Use a picture at most twice in the episode, and prefer variety.
4. Write "ar", a natural Arabic translation of each line, for internal review only. Everything else is English only.
Return only JSON:
{"title":"","thumbnailText":"max 3 words","description":"2-3 hook sentences","tags":[""],"outroNext":"","thumbnailShot":"1.1","sources":[{"url":""}],
"chapters":[{"title":"","lines":[{"en":"","ar":"","pictures":["id"],"callout":{"big":"short","small":"short"},"sfx":"impact|hit|whoosh|riser|shimmer"}]}],
"reels":[{"chapter":1,"title":"","badge":"","hook":"max 5 words","sub":""}]}
callout and sfx are optional and rare. Use exactly 3 reels, each from a chapter that stands alone. Use 4 or 5 chapters.`;

async function stageStory(id) {
  const file = path.join(CONTENT, 'youtube', `${id}.json`);
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  // a story written and voiced by hand is final: never replace it with a generated one
  if (old?.handWritten) { log(`Story: ${id} is hand written, keeping it`); return; }
  const topics = JSON.parse(fs.readFileSync(LIB_TOPICS, 'utf8'));
  const topic = topics[id];
  if (!topic) throw new Error(`${id} is not in content/library/topics.json`);
  const pics = usablePictures(id);
  if (!pics.length) throw new Error(`The library has no checked pictures for ${id}`);
  let plan = {};
  try { plan = JSON.parse(fs.readFileSync(path.join(CONTENT, 'youtube', 'production-matrix.json'), 'utf8')).long_episodes.find((e) => e.id === id) || {}; } catch {}
  const words = Math.round(((plan.target_duration_sec || 300) / 60) * 150);
  const spokenWords = (chapters) => (chapters || []).flatMap((c) => c.lines || []).reduce((n, l) => n + String(l.en || '').split(/\s+/).filter(Boolean).length, 0);
  // a story already written stays, unless it is clearly too short for the episode
  if (old?.fromLibrary && spokenWords(old.chapters) >= words * 0.8) return;
  const catalog = pics.slice(0, 220).map((p) => [p.id, p.seen.type, p.seen.subject, p.seen.what, p.seen.period, p.seen.place, p.seen.mood].join(' | ')).join('\n');
  log(`Story: writing ${id} from ${pics.length} library pictures`);
  const known = new Set(pics.map((p) => p.id));
  let story = null;
  let lastTry = '';
  for (let attempt = 1; attempt <= 3 && !story; attempt++) {
    const a = await askGemini([{ text: `${STORY_RULES}\n\nEpisode idea: ${plan.title_en || topic.title}\nStarting hook idea: ${plan.hook || ''}\nLength: ${words} spoken words in total, never under ${Math.round(words * 0.85)}. That is about ${Math.round(words / 24)} lines across 5 to 7 chapters. A shorter story is rejected. Reach the length by staying longer with the people, the places and what each picture shows, and by using every fact in the fact bank, never by inventing anything.${lastTry}\n\nFACT BANK:\n${JSON.stringify(factsFor(id, topic)).slice(0, 30000)}\n\nPICTURE CATALOG (id | type | subject | what is visible | period | place | mood):\n${catalog}` }]);
    const lines = a?.chapters?.flatMap((c) => c.lines || []) || [];
    if (!lines.length) continue;
    // long episodes run 8 to 12 minutes: a short story is never voiced, so no voice requests go to waste
    const spoken = spokenWords(a.chapters);
    if (spoken < words * 0.8) { log(`Story: ${spoken} words is too short for ${words}`); lastTry = ` Your last attempt had only ${spoken} words, so write much more this time.`; continue; }
    for (const l of lines) l.pictures = (l.pictures || []).filter((p) => known.has(p));
    if (lines.filter((l) => l.pictures.length).length / lines.length >= 0.9) story = a;
  }
  if (!story) throw new Error('Gemini could not write a story from the library');
  if (old) fs.writeFileSync(file.replace(/\.json$/, '.before-library.json'), JSON.stringify(old, null, 2));
  fs.writeFileSync(file, JSON.stringify({ id, series: old?.series || 'ZALA VIP Stories', fromLibrary: true, ...story, id }, null, 2) + '\n', 'utf8');
  fs.rmSync(shotsFile(id), { force: true });
  log(`Story: "${story.title}", ${story.chapters.flatMap((c) => c.lines).length} lines`);
}

// ── shots: every line plays the library pictures its story chose ─────────────
function loadShots(id) {
  try {
    const d = JSON.parse(fs.readFileSync(shotsFile(id), 'utf8'));
    return d.lines ? d : { lines: {} };
  } catch { return { lines: {} }; }
}
function saveShots(id, data) { fs.writeFileSync(shotsFile(id), JSON.stringify(data, null, 2) + '\n', 'utf8'); }
const abs = (p) => (path.isAbsolute(p) ? p : path.join(REPO, p));

/** The pictures of one line, in order; a Meta clip replaces its still once it exists. */
function lineAssets(data, key) {
  return (data.lines[key]?.beats || []).filter((b) => b.asset).map((b) => {
    const clip = b.clip && fs.existsSync(abs(b.clip));
    return clip ? { ...b.asset, kind: 'video', file: b.clip } : b.asset;
  });
}

const motionPrompt = (p) => `Very slow cinematic camera push-in across this photograph of ${p.seen.what} Only elements already in the photo that move in nature, such as water, clouds, dust or flame, may move gently; buildings, statues, faces and inscriptions stay perfectly still. Keep every detail of the photograph exactly as it is. No text, no logos, nothing added.`;

async function downloadImage(url) {
  const dir = path.join(CACHE, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hash(url)}${/\.png($|\?)/i.test(url) ? '.png' : '.jpg'}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 3000) return file;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
      if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return file; }
    } catch {}
    await sleep(8000 * attempt);
  }
  return null;
}
/** A moving clip from an open library, kept with its own extension so it is always read as video. */
async function downloadClip(url) {
  const dir = path.join(CACHE, 'clips');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hash(url)}.mp4`);
  if (fs.existsSync(file) && fs.statSync(file).size > 50000) return file;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
      if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return file; }
      log(`  clip answered ${res.status}`);
    } catch (e) { log(`  clip: ${e.name}`); }
    await sleep(8000 * attempt);
  }
  return null;
}
const lineSig = (f) => hash(f.en + (f.pictures || []).join() + (f.card || '') + (f.map || '') + (f.clip?.url || '') + 'v8');
const smallJpeg = (file) => ff(['-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1']).toString('base64');

/** A text card over a darkened picture, one version for wide video and one for reels. */
function cardStill(text, bg, vertical = false) {
  const dir = path.join(CACHE, 'cards');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hash([text, bg || '', vertical].join('|'))}.jpg`);
  if (fs.existsSync(file)) return file;
  const CW = vertical ? 1620 : SW, CH = vertical ? 2880 : SH, size = vertical ? 170 : 210, per = vertical ? 13 : 20;
  const words = numerals(text).toUpperCase().split(/\s+/);
  const rows = [];
  for (const w of words) { if (rows.length && `${rows[rows.length - 1]} ${w}`.length <= per) rows[rows.length - 1] += ` ${w}`; else rows.push(w); }
  const font = filterPath(path.join(FONTS, 'Anton-Regular.ttf'));
  const lineH = Math.round(size * 1.3);
  const top = Math.round(CH / 2 - (rows.length * lineH) / 2);
  const txts = rows.map((r, i) => { const t = path.join(dir, `${hash(file)}-${i}.txt`); fs.writeFileSync(t, r); return t; });
  const draw = txts.map((t, i) => `drawtext=fontfile='${font}':textfile='${filterPath(t)}':fontcolor=0xD4AF37:fontsize=${size}:borderw=6:bordercolor=black@0.7:x=(w-text_w)/2:y=${top + i * lineH}`).join(',');
  const bar = `drawbox=x=${Math.round(CW / 2) - 170}:y=${top + rows.length * lineH + 30}:w=340:h=10:color=0xD4AF37:t=fill`;
  const look = `scale=${CW}:${CH}:force_original_aspect_ratio=increase,crop=${CW}:${CH},gblur=sigma=26,eq=brightness=-0.32:saturation=0.55,vignette=PI/4`;
  const input = bg && fs.existsSync(bg) ? ['-i', bg] : ['-f', 'lavfi', '-i', `color=c=0x14100a:s=${CW}x${CH}:d=1`];
  ff([...input, '-frames:v', '1', '-vf', `${look},${bar},${draw}`, '-q:v', '3', file]);
  txts.forEach((t) => fs.rmSync(t, { force: true }));
  return file;
}

/** A real map of a place in the story, with its name on it. */
async function mapStill(place) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return null;
  const dir = path.join(CACHE, 'maps');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hash(place.name + place.zoom)}.jpg`);
  if (fs.existsSync(file)) return file;
  const url = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+d4af37(${place.lng},${place.lat})/${place.lng},${place.lat},${place.zoom},0/1280x720@2x?access_token=${token}`;
  try {
    const res = await fetch(url, { headers: { Referer: 'https://www.zalavip.com/' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) { log(`  map of ${place.name}: answered ${res.status}`); return null; }
    const raw = `${file}.raw`;
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    const font = filterPath(path.join(FONTS, 'Anton-Regular.ttf'));
    const small = filterPath(path.join(FONTS, 'Lato-Bold.ttf'));
    const name = `${file}.txt`;
    fs.writeFileSync(name, place.name.toUpperCase());
    ff(['-i', raw, '-frames:v', '1', '-vf', `eq=saturation=0.85:brightness=-0.04,drawtext=fontfile='${font}':textfile='${filterPath(name)}':fontcolor=0xD4AF37:fontsize=110:borderw=6:bordercolor=black@0.8:x=(w-text_w)/2:y=h*0.68,drawtext=fontfile='${small}':text='Mapbox / OpenStreetMap':fontcolor=white@0.8:fontsize=28:x=w-text_w-30:y=h-50`, '-q:v', '3', file]);
    fs.rmSync(raw, { force: true });
    fs.rmSync(name, { force: true });
    return file;
  } catch (e) { log(`  map of ${place.name}: ${e.message.slice(0, 80)}`); return null; }
}

const loadPlaces = () => { try { return JSON.parse(fs.readFileSync(path.join(CONTENT, 'library', 'places.json'), 'utf8')); } catch { return []; } };

/** The director's pass: runs once per story, and again whenever its rules change. */
async function stageDirector(script) {
  if (script.directed === 8) return;
  const id = script.id;
  const all = loadLibrary();
  const pics = usablePictures(id);
  const byId = new Map(all.map((i) => [i.id, i]));
  const live = pics.map((p) => byId.get(p.id)).filter(Boolean);
  const thumb = async (p) => { const file = await downloadImage(p.url); try { return file ? smallJpeg(file) : null; } catch { return null; } };
  const thumbLarge = async (p) => { const file = await downloadImage(p.url); try { return file ? ff(['-i', file, '-frames:v', '1', '-vf', 'scale=1024:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', 'pipe:1']).toString('base64') : null; } catch { return null; } };
  const addPicture = (p) => { const item = { id: hash(p.source_url).slice(0, 14), ...p }; all.push(item); return item; };
  const tools = { thumb, thumbLarge, addPicture, log, sleep, keyFor, markSpent, places: loadPlaces() };
  const clean = await screenPictures(live, tools);
  fs.writeFileSync(LIB_ITEMS, all.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  if (clean.length < 4) throw new Error(`Only ${clean.length} clean pictures for ${id}, the director will not go on`);
  await directEpisode(script, clean, tools);
  fs.writeFileSync(LIB_ITEMS, all.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  // the first time a place is named, the viewer sees where it is
  const seenPlaces = new Set();
  for (const l of script.chapters.flatMap((c) => c.lines)) {
    delete l.map;
    const place = !l.noMap && loadPlaces().find((p) => !seenPlaces.has(p.name) && new RegExp(p.match).test(l.en));
    if (place) { seenPlaces.add(place.name); l.map = place.name; }
  }
  fs.writeFileSync(path.join(CONTENT, 'youtube', `${id}.json`), JSON.stringify(script, null, 2) + '\n', 'utf8');
  fs.rmSync(shotsFile(id), { force: true });
}

async function stageImages(script, flat) {
  const id = script.id;
  const data = loadShots(id);
  const byId = new Map(loadLibrary().map((i) => [i.id, i]));
  for (const f of flat) {
    if (data.lines[f.key]?.sig === lineSig(f)) {
      // the plan is in git; fetch any picture this computer doesn't have yet
      for (const b of data.lines[f.key].beats) if (!fs.existsSync(abs(b.asset.file))) { if (b.asset.card) continue; const place = b.asset.map && loadPlaces().find((p) => p.name === b.asset.map); const file = place ? await mapStill(b.asset.wide ? { ...place, zoom: Math.max(3, place.zoom - 5) } : place) : b.asset.kind === 'video' ? await downloadClip(b.asset.url) : await downloadImage(b.asset.url); if (file) b.asset.file = rel(file); }
      continue;
    }
    const beats = [];
    if (f.map) {
      const place = loadPlaces().find((p) => p.name === f.map);
      const wide = place && await mapStill({ ...place, zoom: Math.max(3, place.zoom - 5) });
      if (wide) beats.push({ need: place.name, picture: null, animate: false, motion: '', asset: { kind: 'image', map: place.name, wide: true, file: rel(wide), url: '', page: '', attribution: 'Maps: Mapbox, OpenStreetMap' } });
      const file = place && await mapStill(place);
      if (file) beats.push({ need: place.name, picture: null, animate: false, motion: '', asset: { kind: 'image', map: place.name, file: rel(file), url: '', page: '', attribution: 'Maps: Mapbox, OpenStreetMap' } });
    }
    if (f.clip) {
      const file = await downloadClip(f.clip.url);
      if (file) beats.push({ need: f.clip.what || f.en, picture: null, animate: false, motion: '', asset: { kind: 'video', file: rel(file), url: f.clip.url, page: f.clip.page, attribution: f.clip.credit, license: f.clip.license, recon: !!f.clip.recon } });
    }
    // a line that opens with a map or a clip keeps at most one more picture, so its shots stay long enough to see
    for (const pid of (beats.length ? (f.en.length > 70 ? (f.pictures || []).slice(0, 1) : []) : f.pictures || [])) {
      const p = byId.get(pid);
      const file = p && await downloadImage(p.url);
      if (!file) continue;
      beats.push({
        need: p.seen?.what || p.title, picture: pid, animate: !!p.seen?.wide, motion: p.seen?.wide ? motionPrompt(p) : '',
        asset: { kind: 'image', file: rel(file), url: p.url, page: p.source_url, attribution: `"${String(p.title).slice(0, 80)}" by ${p.author}, ${p.license}, via ${p.source === 'ZALA vault' ? 'Wikimedia Commons' : p.source}`, license: p.license, recon: !!p.recon },
      });
    }
    if (!beats.length && f.card) beats.push({ need: f.card, picture: null, animate: false, motion: '', asset: { kind: 'image', card: f.card, file: '', url: '', page: '', attribution: '' } });
    data.lines[f.key] = { sig: lineSig(f), en: f.en, beats };
  }
  // cards sit on the last real picture shown, darkened
  const isPicture = (b) => b.asset && !b.asset.card && !b.asset.map && b.asset.file;
  let bg = flat.flatMap((f) => data.lines[f.key].beats).find(isPicture)?.asset.file;
  for (const f of flat) for (const b of data.lines[f.key].beats) {
    if (isPicture(b)) bg = b.asset.file;
    if (b.asset?.card) {
      b.asset.file = rel(cardStill(b.asset.card, bg && abs(bg)));
      b.asset.vfile = rel(cardStill(b.asset.card, bg && abs(bg), true));
    }
  }
  fallbackEmptyLines(flat, data);
  saveShots(id, data);
  writeImageSheet(script, flat, data);
  return data;
}

/** A line with no picture borrows the nearest one so the episode always finishes. */
function fallbackEmptyLines(flat, data) {
  const has = (f) => (data.lines[f.key]?.beats || []).some((b) => b.asset);
  flat.forEach((f, i) => {
    if (has(f)) return;
    const near = [...flat.slice(i + 1), ...flat.slice(0, i).reverse()].find(has);
    if (!near) return;
    data.lines[f.key].beats.push({ need: f.en, motion: '', animate: false, borrowed: true, asset: data.lines[near.key].beats.find((b) => b.asset).asset });
    log(`  ${f.label}: borrowed a picture from ${near.label}`);
  });
}

function writeImageSheet(script, flat, data) {
  const dir = reviewDir(script.id), thumbs = path.join(workDir(script.id), 'thumbs');
  fs.rmSync(thumbs, { recursive: true, force: true });
  fs.mkdirSync(thumbs, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const font = filterPath(path.join(FONTS, 'Lato-Bold.ttf'));
  const files = [];
  flat.forEach((f) => (data.lines[f.key]?.beats || []).filter((b) => b.asset).forEach((b) => {
    const thumb = path.join(thumbs, `${files.length + 1}.jpg`);
    ff(['-i', abs(b.asset.file), '-frames:v', '1', '-vf', `scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:black,drawtext=fontfile='${font}':text='${files.length + 1}':fontsize=24:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=6:x=6:y=6`, thumb]);
    files.push(thumb);
  }));
  if (!files.length) return;
  const cols = 10;
  const layout = files.map((_, i) => `${(i % cols) * 324}_${Math.floor(i / cols) * 184}`).join('|');
  ff([...files.flatMap((x) => ['-i', x]), '-filter_complex', `${files.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black[v]`, '-map', '[v]', '-frames:v', '1', '-q:v', '3', path.join(dir, `${script.id}_images.jpg`)]);
  log(`Pictures used: ${files.length}`);
}

// ── music ────────────────────────────────────────────────────────────────────
async function generateMusic(script) {
  if (fs.existsSync(path.join(BRAND, 'music.mp3'))) return null;
  const dir = path.join(CACHE, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const have = fs.readdirSync(dir).find((f) => f.startsWith(`${script.id}.`));
  if (have) return path.join(dir, have);
  const prompt = script.musicPrompt || `Instrumental underscore for a gripping story video about ${script.title}. Low strings, soft ney flute, frame drum, mysterious and slowly building, leaving room for a narrator. No vocals.`;
  try {
    log('Sound: composing music');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MUSIC_MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keyFor(MUSIC_MODEL) || '' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }), signal: AbortSignal.timeout(300000),
    });
    const data = await res.json();
    const audio = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!audio) { log(`  music model gave no audio (${res.status}), using the built-in bed`); return null; }
    const file = path.join(dir, `${script.id}.${/wav/.test(audio.mimeType) ? 'wav' : 'mp3'}`);
    fs.writeFileSync(file, Buffer.from(audio.data, 'base64'));
    return file;
  } catch (e) {
    log(`  music failed (${e.message}), using the built-in bed`);
    return null;
  }
}

// ── Meta AI: motion on our own checked pictures, in a background browser ─────
class MetaBlocked extends Error {}

async function openMeta(headless) {
  const puppeteer = (await import('puppeteer-core')).default;
  fs.mkdirSync(META_PROFILE, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless, userDataDir: META_PROFILE, defaultViewport: { width: 1280, height: 900 }, args: ['--lang=en-US', ...(process.env.CI ? ['--no-sandbox'] : [])] });
  // on the cloud server the saved sign-in arrives as a secret, because that machine starts empty every run
  if (process.env.META_COOKIES) await browser.setCookie(...JSON.parse(process.env.META_COOKIES));
  return browser;
}
// signed in only on meta.ai itself, once the page has really loaded: the sign-in pages on other sites have no "Log in" button either
const metaSignedIn = (page) => page.evaluate(() => /(^|\.)meta\.ai$/.test(location.hostname)
  && !!document.querySelector('textarea,[contenteditable=true],[role=textbox]')
  && ![...document.querySelectorAll('a,button,[role=button]')].some((e) => /^(log ?in|sign ?in|تسجيل الدخول)$/i.test(e.textContent.trim())));

async function metaLogin() {
  log('A Chrome window is opening. Sign in to Meta AI there with the channel\'s separate account. This window closes by itself afterwards.');
  const browser = await openMeta(false);
  const page = await browser.newPage();
  await page.goto(META_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    if (page.isClosed()) break;
    if (await metaSignedIn(page).catch(() => false)) {
      await sleep(8000);
      log('Signed in. The render can use Meta AI in the background from now on.');
      await browser.close();
      return;
    }
  }
  log('No sign-in detected within 10 minutes. Run meta-login again when ready.');
  await browser.close().catch(() => {});
}

/** One picture + one motion instruction → one MP4. Anything unexpected throws; the caller keeps the still. */
async function metaAnimate(page, image, motion, out, shots) {
  const snap = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }).catch(() => {}); };
  const videos = [];
  const onResponse = (r) => {
    const type = r.headers()['content-type'] || '';
    if (/video\/mp4/.test(type) || /\.mp4(\?|$)/.test(r.url())) videos.push(r.url());
  };
  page.on('response', onResponse);
  try {
    await page.goto(META_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(5000);
    await snap('1-opened');
    const guard = async () => {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      if (/captcha|checkpoint|confirm you.?re (a )?human|verify (it.?s )?you|تأكيد هويتك/i.test(text) || /checkpoint|captcha/.test(page.url())) throw new MetaBlocked('Meta asked for a human check');
      if (!(await metaSignedIn(page))) throw new MetaBlocked('Not signed in to Meta AI');
    };
    await guard();

    let input = await page.$('input[type=file]');
    if (!input) {
      const attach = await page.$('[aria-label*="ttach" i],[aria-label*="مرفق"],[aria-label*="Add" i]');
      if (attach) { await attach.click(); await sleep(1500); }
      input = await page.$('input[type=file]');
    }
    if (!input) throw new Error('no upload field');
    await input.uploadFile(image);
    await sleep(6000);
    await snap('2-uploaded');

    const box = await page.$('textarea,[contenteditable=true],input[type=text]');
    if (!box) throw new Error('no text box');
    await box.click();
    await page.keyboard.type(`Animate this exact image into a video. ${motion}`, { delay: 4 });
    await sleep(800);
    await page.keyboard.press('Enter');
    await sleep(3000);
    await snap('3-sent');

    const started = Date.now();
    let url = null;
    while (Date.now() - started < 300000) {
      await sleep(5000);
      await guard();
      const inPage = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.currentSrc || v.src).filter((s) => /^https?:/.test(s)));
      url = inPage[inPage.length - 1] || videos[videos.length - 1];
      if (url) break;
    }
    await snap('4-result');
    if (!url) throw new Error('no video within 5 minutes');
    await sleep(3000);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: META_URL } });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const tmp = `${out}.part`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    if (durationOf(tmp) < 1) { fs.rmSync(tmp, { force: true }); throw new Error('file is not a video'); }
    fs.renameSync(tmp, out);
  } finally {
    page.off('response', onResponse);
  }
}

/** Compare a frame of the clip with our photo: Meta must not have invented or melted anything. */
async function clipIsFaithful(clip, image, need) {
  const frame = ff(['-ss', '2', '-i', clip, '-frames:v', '1', '-vf', 'scale=512:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1']).toString('base64');
  const a = await askGemini([
    { text: `The first image is an authentic photograph used in a story video (${need}). The second is a frame from an AI animation of it. Answer only JSON {"faithful": true or false, "reason": "a few words"}. faithful is false if the subject changed shape or identity, faces or inscriptions are distorted, objects or people were added, or there is a watermark or text that was not in the photograph.` },
    { inlineData: { mimeType: 'image/jpeg', data: smallJpeg(image) } },
    { inlineData: { mimeType: 'image/jpeg', data: frame } },
  ]);
  return a ? a : { faithful: false, reason: 'no answer from Gemini' };
}

async function stageAnimate(script, flat) {
  const id = script.id;
  const data = loadShots(id);
  const todo = flat.flatMap((f) => (data.lines[f.key]?.beats || []).filter((b) => b.animate && b.motion && b.asset && !b.borrowed && !b.metaFailed && !(b.clip && fs.existsSync(abs(b.clip)))));
  if (!todo.length) { log('Meta: nothing to animate.'); return; }
  if (!process.env.META_COOKIES && !fs.existsSync(META_PROFILE)) { log('Meta: not signed in yet, this episode uses camera moves on the pictures instead.'); return; }
  log(`Meta: ${todo.length} shots to animate (up to ${META_MAX_CLIPS} this run)`);
  let browser;
  try {
    browser = await openMeta(true);
    const page = await browser.newPage();
    let made = 0, failedInARow = 0;
    for (const b of todo.slice(0, META_MAX_CLIPS)) {
      const out = path.join(CACHE, 'meta', id, `${hash(`${b.asset.file}|${b.motion}`)}.mp4`);
      try {
        if (!fs.existsSync(out)) await metaAnimate(page, abs(b.asset.file), b.motion, out);
        const check = await clipIsFaithful(out, abs(b.asset.file), b.need);
        if (check.faithful) {
          b.clip = rel(out);
          made++;
          log(`  clip ${made}: ${b.need.slice(0, 70)}`);
        } else {
          b.metaFailed = check.reason;
          log(`  clip rejected (${check.reason}), keeping the photograph`);
        }
        failedInARow = 0;
        saveShots(id, data);
        await sleep(20000);
      } catch (e) {
        if (e instanceof MetaBlocked) { log(`Meta: ${e.message}. Carrying on with the pictures.`); break; }
        failedInARow++;
        log(`  clip failed (${e.message}), keeping the photograph`);
        if (failedInARow >= 3) { log('Meta: three failures in a row. Carrying on with the pictures.'); break; }
      }
    }
    log(`Meta: ${made} new clips.`);
  } catch (e) {
    log(`Meta unavailable (${e.message}). Carrying on with the pictures.`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function metaTest(script, flat) {
  const data = loadShots(script.id);
  const b = flat.flatMap((f) => data.lines[f.key]?.beats || []).find((x) => x.animate && x.motion && x.asset);
  if (!b) throw new Error('No shot to test yet: run the direct and images steps first');
  const dir = path.join(reviewDir(script.id), 'meta-test');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await openMeta(true);
  const page = await browser.newPage();
  try {
    await metaAnimate(page, abs(b.asset.file), b.motion, path.join(dir, 'clip.mp4'), dir);
    log(`Worked: ${rel(path.join(dir, 'clip.mp4'))} (${durationOf(path.join(dir, 'clip.mp4')).toFixed(1)}s)`);
    log(JSON.stringify(await clipIsFaithful(path.join(dir, 'clip.mp4'), abs(b.asset.file), b.need)));
  } catch (e) {
    await page.screenshot({ path: path.join(dir, 'failed.png') }).catch(() => {});
    log(`Failed: ${e.message}. Screenshots are in ${rel(dir)}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── timeline ─────────────────────────────────────────────────────────────────
function buildTimeline(script, flat) {
  let t = LEAD, stingAt = null;
  flat.forEach((f, i) => {
    const isNewChapter = i > 0 && f.ci !== flat[i - 1].ci;
    if (isNewChapter && f.ci === 1 && !script.verticalOnly) {
      stingAt = t + 0.5;
      t = stingAt + STING + 0.5;
    } else {
      t += i === 0 ? 0 : isNewChapter ? CHAPTER_GAP : LINE_GAP;
    }
    f.voice = voiceFileOf(script, f);
    f.dur = durationOf(f.voice);
    f.T0 = t;
    f.T1 = t + f.dur;
    t = f.T1;
  });
  const mainEnd = t + TAIL;
  return { flat, stingAt, mainEnd, total: mainEnd + OUTRO };
}

// ── pictures ─────────────────────────────────────────────────────────────────
const MOTIONS = ['pushin', 'panright', 'pullout', 'diagin', 'punchin', 'tiltup', 'panleft', 'diagout', 'tiltdown'];
function motionExpr(name, FR) {
  const E = `((1-cos(PI*on/${FR}))/2)`;
  const cx = `x='iw/2-(iw/zoom/2)'`, cy = `y='ih/2-(ih/zoom/2)'`;
  switch (name) {
    case 'mapzoom': return `z='1+0.5*${E}':${cx}:${cy}`;
    case 'punchin': return `z='1.06+0.26*${E}':x='(iw-iw/zoom)*0.5':y='(ih-ih/zoom)*0.42'`;
    case 'pullout': return `z='1.26-0.26*${E}':${cx}:${cy}`;
    case 'panright': return `z='1.2':x='(iw-iw/zoom)*${E}':${cy}`;
    case 'panleft': return `z='1.2':x='(iw-iw/zoom)*(1-${E})':${cy}`;
    case 'tiltup': return `z='1.2':${cx}:y='(ih-ih/zoom)*(1-${E})'`;
    case 'tiltdown': return `z='1.2':${cx}:y='(ih-ih/zoom)*${E}'`;
    case 'diagin': return `z='1+0.28*${E}':x='(iw-iw/zoom)*(0.15+0.5*${E})':y='(ih-ih/zoom)*(0.1+0.4*${E})'`;
    case 'diagout': return `z='1.28-0.28*${E}':x='(iw-iw/zoom)*(0.75-0.5*${E})':y='(ih-ih/zoom)*(0.6-0.4*${E})'`;
    default: return `z='1+0.24*${E}':${cx}:${cy}`;
  }
}

function prepStill(src, out) {
  if (fs.existsSync(out) && fs.statSync(out).size > 5000) return out;
  const { width, height } = dimensionsOf(src);
  if (width / height >= 1.38) {
    ff(['-i', src, '-frames:v', '1', '-vf', `scale=${SW}:${SH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${SW}:${SH}`, out]);
  } else {
    ff(['-i', src, '-frames:v', '1', '-filter_complex',
      `[0:v]split[a][b];[a]scale=${SW}:${SH}:force_original_aspect_ratio=increase,crop=${SW}:${SH},gblur=sigma=50,eq=brightness=-0.14:saturation=0.85[bg];` +
      `[b]scale=${Math.round(SW * 0.8)}:${Math.round(SH * 0.93)}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`, out]);
  }
  return out;
}

/** A moving clip fitted to any frame: stretched in time up to 1.5×, then holds its last frame; a blurred copy fills any side bars. */
function clipArgs(src, w, h, FR, out) {
  const k = Math.min(1.5, Math.max(1, (FR / FPS) / Math.max(0.5, durationOf(src)))).toFixed(3);
  return ['-i', src, '-filter_complex',
    `[0:v]setpts=${k}*PTS,fps=${FPS},tpad=stop_mode=clone:stop_duration=30,split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=-0.14[bg];[b]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`,
    '-map', '[v]', '-frames:v', String(FR), '-an', ...X264, out];
}

function brandStill(out, { crestW, x, y, glow }) {
  if (fs.existsSync(out)) return out;
  const g = `exp(-((X-${glow.x})*(X-${glow.x})+(Y-${glow.y})*(Y-${glow.y}))/(2*${glow.r}*${glow.r}))`;
  const base = `${out}.glow.png`;
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-vf', `format=rgb24,geq=r='78*${g}':g='54*${g}':b='14*${g}'`, '-frames:v', '1', base]);
  ff(['-i', base, '-i', path.join(REPO, 'public', 'zala-crest-transparent.png'), '-filter_complex',
    `[1:v]scale=${crestW}:-1:flags=lanczos,format=rgba[c];[0:v][c]overlay=${x}:${y}:format=auto,format=yuv420p`, '-frames:v', '1', out]);
  fs.rmSync(base, { force: true });
  return out;
}

function planScenes(tl, data) {
  const items = [];
  tl.flat.forEach((f, i) => {
    const start = i === 0 ? 0 : (tl.stingAt != null && f.ci === 1 && f.li === 0) ? tl.stingAt + STING : f.T0 - 0.28;
    items.push({ type: 'img', start, key: f.key, ci: f.ci, li: f.li, motion: f.shot?.m, line: i, flash: f.sfx === 'impact' });
  });
  if (tl.stingAt != null) items.push({ type: 'sting', start: tl.stingAt });
  items.push({ type: 'outro', start: tl.mainEnd });
  items.sort((a, b) => a.start - b.start);
  items.forEach((it, i) => { it.span = (items[i + 1]?.start ?? tl.total) - it.start; });

  // every line is cut into its planned shots; a still that would sit too long gets a second camera move
  const scenes = [];
  let moveIdx = 0, last = null;
  for (const it of items) {
    if (it.type !== 'img') { scenes.push(it); continue; }
    const assets = lineAssets(data, it.key);
    if (!assets.length && !last) throw new Error(`Line ${it.key} has no image`);
    const list = assets.length ? assets : [last];
    const beatSpan = it.span / list.length;
    list.forEach((asset, b) => {
      last = asset;
      const parts = asset.kind === 'video' ? 1 : Math.max(1, Math.ceil(beatSpan / SHOT_MAX));
      let motion = asset.map ? 'mapzoom' : (b === 0 && it.motion) || MOTIONS[moveIdx % MOTIONS.length];
      for (let p = 0; p < parts; p++) {
        const span = beatSpan / parts;
        scenes.push({ ...it, asset, motion, start: it.start + b * beatSpan + p * span, span, part: b + p });
        const alt = MOTIONS.filter((m) => m !== motion && !(motion.startsWith('pan') && m.startsWith('pan')));
        motion = alt[(moveIdx + p * 3 + 1) % alt.length];
      }
      moveIdx++;
    });
  }
  scenes.forEach((s, i) => {
    if (i === 0) { s.tr = null; return; }
    const prev = scenes[i - 1];
    const chapterStart = s.type === 'img' && s.part === 0 && s.li === 0 && s.ci > 0;
    s.tr = s.type === 'outro' ? { name: 'fadeblack', d: 0.9 }
      : (s.type === 'sting' || prev.type === 'sting' || chapterStart) ? { name: 'fadeblack', d: 0.45 }
      : s.flash && s.part === 0 ? { name: 'fadewhite', d: 0.3 }
      : prev.line === s.line ? { name: 'fade', d: 0.12 }   // inside one sentence: a quick cut
      : { name: 'fade', d: 0.28 };
    s.tr.d = Math.min(s.tr.d, prev.span * 0.45, s.span * 0.45);
  });
  scenes.forEach((s, i) => { s.dur = s.span + (scenes[i + 1]?.tr.d || 0); });
  return scenes;
}

async function renderPicture(scenes, work) {
  const sceneDir = path.join(work, 'scenes'), prepDir = path.join(work, 'stills');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(prepDir, { recursive: true });
  for (const s of scenes) {
    const dur = s.dur.toFixed(3);
    if (s.type === 'img') {
      const isVideo = s.asset.kind === 'video';
      s.src = isVideo ? abs(s.asset.file) : prepStill(abs(s.asset.file), path.join(prepDir, `${hash(s.asset.file)}.png`));
      s.isVideo = isVideo;
      s.out = path.join(sceneDir, `${hash(`${s.asset.file}|${s.motion}|${dur}`)}.mp4`);
    } else {
      s.src = s.type === 'sting'
        ? brandStill(path.join(prepDir, 'sting.png'), { crestW: 1180, x: 370, y: -30, glow: { x: 960, y: 520, r: 460 } })
        : brandStill(path.join(prepDir, 'outro.png'), { crestW: 560, x: 70, y: 40, glow: { x: 360, y: 320, r: 520 } });
      s.motion = 'pushin';
      s.out = path.join(sceneDir, `${s.type}-${dur}.mp4`);
    }
  }
  const seen = new Set();
  const todo = scenes.filter((s) => !okClip(s.out) && !seen.has(s.out) && seen.add(s.out));
  log(`Picture: ${todo.length} scenes to draw (${scenes.length - todo.length} already done)`);
  await pool(todo, 3, (s) => encodeTo(s.out, (part) => {
    const FR = Math.max(2, Math.round(s.dur * FPS));
    if (s.isVideo) return clipArgs(s.src, W, H, FR, part);
    const fades = s.type === 'sting' ? `,fade=t=in:st=0:d=0.9,fade=t=out:st=${(s.dur - 0.7).toFixed(2)}:d=0.7` : '';
    return ['-i', s.src, '-vf', `zoompan=${motionExpr(s.motion, FR)}:d=${FR}:s=${W}x${H}:fps=${FPS}${fades},setsar=1,format=yuv420p`, '-frames:v', String(FR), ...X264, part];
  }));

  // crossfades, in segments of 9 so ffmpeg's memory stays sane; each later segment opens with the previous scene's tail
  const chain = path.join(work, `chain-${hash(scenes.map((s) => s.out).join('|'))}.mp4`);
  if (okClip(chain)) return chain;
  log('Picture: joining scenes');
  const N = 9, segFiles = [];
  for (let a0 = 0, si = 0; a0 < scenes.length; a0 += N, si++) {
    const list = scenes.slice(a0, a0 + N);
    const head = a0 > 0 ? scenes[a0 - 1] : null;
    const ins = head ? [head, ...list] : list;
    let g = '', last = '[0:v]', cum = 0;
    if (head) { g += `[0:v]trim=start=${head.span.toFixed(3)},setpts=PTS-STARTPTS[h0];`; last = '[h0]'; }
    for (let k = 1; k < ins.length; k++) {
      cum += k === 1 && head ? 0 : ins[k - 1].span;
      g += `${last}[${k}:v]xfade=transition=${ins[k].tr.name}:duration=${ins[k].tr.d.toFixed(3)}:offset=${cum.toFixed(3)}[x${k}];`;
      last = `[x${k}]`;
    }
    const segF = path.join(work, `seg-${hash(ins.map((s) => s.out).join('|'))}.mp4`);
    segFiles.push(segF);
    if (okClip(segF)) continue;
    const gf = path.join(work, `chain${si}.filter`);
    fs.writeFileSync(gf, g.replace(/;$/, '') || 'null');
    const segLen = list.reduce((x, y) => x + y.span, 0).toFixed(3);
    await encodeTo(segF, (part) => [...ins.flatMap((x) => ['-i', x.out]), '-filter_complex_script', gf, '-map', last, '-t', segLen, ...X264, '-preset', 'veryfast', part]);
  }
  const lst = path.join(work, 'segments.txt');
  fs.writeFileSync(lst, segFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  await encodeTo(chain, (part) => ['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', part]);
  return chain;
}

// ── sound ────────────────────────────────────────────────────────────────────
function synthSfx(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, `${n}.wav`);
  const st = (a, b) => `${a}|${b || a}`;
  const lav = (expr, d) => ['-f', 'lavfi', '-i', `aevalsrc='${expr}':d=${d}:s=48000`];
  if (!fs.existsSync(f('impact'))) {
    const body = '0.95*sin(2*PI*(46+70*exp(-10*t))*t)*exp(-2.4*t)+0.32*sin(2*PI*92*t)*exp(-4*t)';
    ff([...lav(st(body, body.replace('92', '93')), 2.4), '-f', 'lavfi', '-i', "anoisesrc=d=2.4:c=brown:a=0.7:r=48000,volume='exp(-9*t)':eval=frame,lowpass=f=2200",
      '-filter_complex', '[0][1]amix=inputs=2:normalize=0,aecho=0.8:0.55:90|220:0.35|0.2,alimiter=limit=0.9', f('impact')]);
  }
  if (!fs.existsSync(f('hit'))) {
    ff([...lav(st('0.9*sin(2*PI*(58+34*exp(-14*t))*t)*exp(-7.5*t)'), 1.0), '-af', 'aecho=0.8:0.5:70:0.25,alimiter=limit=0.9', f('hit')]);
  }
  if (!fs.existsSync(f('whoosh'))) {
    ff(['-f', 'lavfi', '-i', 'anoisesrc=d=1.5:c=pink:a=0.55:r=48000', '-af',
      "highpass=f=380,lowpass=f=6200,volume='pow(sin(PI*t/1.5),2)*1.5':eval=frame,flanger=delay=2:depth=5:speed=0.5,aformat=channel_layouts=stereo,stereotools=mlev=0.9:slev=1.4,aecho=0.8:0.4:60:0.2", f('whoosh')]);
  }
  if (!fs.existsSync(f('riser'))) {
    ff([...lav(st('0.5*sin(2*PI*(140*t+100*t*t))*pow(t/2.8,2.2)'), 2.8), '-f', 'lavfi', '-i', "anoisesrc=d=2.8:c=white:a=0.5:r=48000,highpass=f=1200,volume='pow(t/2.8,2.6)*0.7':eval=frame",
      '-filter_complex', '[0][1]amix=inputs=2:normalize=0,afade=t=out:st=2.7:d=0.1,aecho=0.7:0.5:140:0.3,alimiter=limit=0.9', f('riser')]);
  }
  if (!fs.existsSync(f('pop'))) {
    ff([...lav(st('0.5*sin(2*PI*1320*t)*exp(-26*t)+0.25*sin(2*PI*1980*t)*exp(-30*t)'), 0.4), '-af', 'aecho=0.8:0.4:60:0.3', f('pop')]);
  }
  if (!fs.existsSync(f('shimmer'))) {
    const b = '0.07*(sin(2*PI*1760*t)+0.8*sin(2*PI*2349*t)+0.6*sin(2*PI*3136*t)+0.5*sin(2*PI*3951*t))*exp(-1.5*t)*(1-exp(-30*t))';
    ff([...lav(st(b, b.replace('1760', '1762')), 3.6), '-af', 'aecho=0.85:0.6:240|480:0.4|0.3', f('shimmer')]);
  }
  return f;
}

function musicBed(work, T, marks) {
  const owned = path.join(BRAND, 'music.mp3');
  if (fs.existsSync(owned)) return { file: owned, loop: true };
  const generated = marks.generated;
  if (generated && fs.existsSync(generated)) return { file: generated, loop: true };
  const out = path.join(work, `music-${Math.round(T)}.wav`);
  if (fs.existsSync(out)) return { file: out, loop: false };
  log('Sound: writing the music bed');
  const { lift, end } = marks;
  const vol = curve([[0, 0], [1.2, 0.5], [lift - 1, 0.6], [lift + 3, 1], [end - 4, 0.75], [end + OUTRO - 1, 0.5], [end + OUTRO, 0]]);
  const pad = (a, b, c, d) => `0.12*(sin(2*PI*${110 * a}*t)+0.8*sin(2*PI*${164.81 * b}*t)+0.55*sin(2*PI*${220 * c}*t)+0.45*sin(2*PI*${261.63 * d}*t+0.5*sin(2*PI*0.11*t)))*(0.72+0.28*sin(2*PI*0.043*t))+0.2*sin(2*PI*55*t)`;
  const padF = path.join(work, 'm-pad.wav'), windF = path.join(work, 'm-wind.wav');
  ff(['-f', 'lavfi', '-i', `aevalsrc='${pad(1, 1, 1.002, 1)}|${pad(1.0015, 0.9985, 0.999, 1.002)}':d=${T.toFixed(2)}:s=48000`, '-af', 'lowpass=f=1150,aecho=0.7:0.7:900|1500:0.4|0.28,tremolo=f=0.1:d=0.25', padF]);
  ff(['-f', 'lavfi', '-i', `anoisesrc=d=${T.toFixed(2)}:c=pink:a=0.5:r=48000`, '-af', 'bandpass=f=620:width_type=h:w=520,tremolo=f=0.2:d=0.5,volume=0.045,aformat=channel_layouts=stereo', windF]);
  ff(['-i', padF, '-i', windF, '-filter_complex', `[0][1]amix=inputs=2:normalize=0,volume='${vol}':eval=frame,alimiter=limit=0.9`, out]);
  fs.rmSync(padF, { force: true });
  fs.rmSync(windF, { force: true });
  return { file: out, loop: false };
}

/** Licensed tracks, one per stretch of the story, all brought to one level so the voice always sits on top. */
async function licensedScore(script, tl, work) {
  if (!script.music?.length) return null;
  const dir = path.join(CACHE, 'music', 'tracks');
  fs.mkdirSync(dir, { recursive: true });
  const starts = script.music.map((m, i) => (i === 0 ? 0 : tl.flat.find((f) => f.ci === m.chapter)?.T0 ?? tl.mainEnd));
  const parts = [];
  for (let i = 0; i < script.music.length; i++) {
    const m = script.music[i];
    const src = path.join(dir, `${m.track.replace(/\W+/g, '-')}.mp3`);
    if (!fs.existsSync(src) || fs.statSync(src).size < 100000) {
      const res = await fetch(`https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(m.track)}.mp3`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) }).catch(() => null);
      if (!res?.ok) { log(`  music: ${m.track} could not be fetched, using the built-in bed`); return null; }
      fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    }
    const len = ((starts[i + 1] ?? tl.total) - starts[i]) + 1.5;
    const out = path.join(work, `score-${i}.wav`);
    ff(['-stream_loop', '-1', '-ss', String(m.from || 0), '-i', src, '-t', len.toFixed(2), '-af', `loudnorm=I=-19:TP=-2:LRA=11,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=1.5,afade=t=out:st=${(len - 2).toFixed(2)}:d=2`, out]);
    parts.push({ out, at: starts[i] });
  }
  const score = path.join(work, 'score.wav');
  const gr = parts.map((p, i) => `[${i}:a]adelay=${Math.round(p.at * 1000)}|${Math.round(p.at * 1000)}[p${i}]`).join(';') + `;${parts.map((_, i) => `[p${i}]`).join('')}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,alimiter=limit=0.9[o]`;
  ff([...parts.flatMap((p) => ['-i', p.out]), '-filter_complex', gr, '-map', '[o]', '-t', tl.total.toFixed(2), score]);
  log(`Sound: score of ${parts.length} licensed tracks`);
  return { file: score, loop: false, licensed: true };
}

/** voices: [{file, t}], events: [{name, t, g}] → loudness-managed mix at YouTube's -14 LUFS, music ducking under the voice. */
async function mixAudio({ voices, events, music, musicFrom = 0, total, out, work, tag }) {
  const sfx = synthSfx(path.join(TMP, 'render', '_sfx'));
  const fc = [];
  const args = [];
  voices.forEach((v, i) => {
    args.push('-i', v.file);
    const ms = Math.round(v.t * 1000);
    fc.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
  });
  const nV = voices.length;
  fc.push(`${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${nV}:normalize=0:dropout_transition=0,acompressor=threshold=-21dB:ratio=2.6:attack=12:release=260:makeup=2,apad=whole_dur=${total.toFixed(2)},asplit[vo][vsc]`);
  args.push(...(music.loop ? ['-stream_loop', '-1'] : []), '-ss', musicFrom.toFixed(2), '-i', music.file);
  const mIdx = nV;
  const fadeOut = Math.max(0, total - 2).toFixed(2);
  fc.push(`[${mIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:d=0.6,afade=t=out:st=${fadeOut}:d=2[mraw]`);
  fc.push(`[mraw][vsc]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=420:makeup=1[md]`);
  const labels = [];
  events.forEach((e, i) => {
    args.push('-i', sfx(e.name));
    const ms = Math.round(Math.max(0, e.t) * 1000);
    fc.push(`[${nV + 1 + i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${e.g},adelay=${ms}|${ms}[s${i}]`);
    labels.push(`[s${i}]`);
  });
  if (labels.length) {
    fc.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,volume=0.9[sfxbus]`);
    fc.push(`[vo][md][sfxbus]amix=inputs=3:normalize=0:weights='1 0.85 0.8':duration=first,loudnorm=I=-14:LRA=9:TP=-1.5,aresample=48000[out]`);
  } else {
    fc.push(`[vo][md]amix=inputs=2:normalize=0:weights='1 0.85':duration=first,loudnorm=I=-14:LRA=9:TP=-1.5,aresample=48000[out]`);
  }
  const gf = path.join(work, `mix-${tag}.filter`);
  fs.writeFileSync(gf, fc.join(';\n'));
  await runAsync([...args, '-filter_complex_script', gf, '-map', '[out]', '-c:a', 'aac', '-b:a', '256k', '-t', total.toFixed(2), out]);
}

// ── text on screen ───────────────────────────────────────────────────────────
const ass_t = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const aesc = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '').replace(/\n/g, '\\N');
const RLM = '\u200F';
const ASS_FORMAT = 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding';
const style = (name, font, size, color, { bold = 0, sp = 0, out = 2, sh = 1, an = 7, mv = 0, ml = 0 } = {}) =>
  `Style: ${name},${font},${size},${color},${color},&H00000000,&H90000000,${bold},0,0,0,100,100,${sp},0,1,${out},${sh},${an},${ml},${ml},${mv},1`;

function chunkText(s, max = 64) {
  if (s.length <= max) return [s];
  const mid = s.length / 2;
  let best = -1, bd = 1e9;
  for (const m of s.matchAll(/[,:;—] /g)) {
    const i = m.index + 1, d = Math.abs(i - mid);
    if (i > s.length * 0.25 && i < s.length * 0.78 && d < bd) { bd = d; best = i; }
  }
  if (best < 0) for (const m of s.matchAll(/ (and|but|so|to|with|from|where|while|in|of) /g)) { const d = Math.abs(m.index - mid); if (d < bd) { bd = d; best = m.index; } }
  if (best < 0) best = s.lastIndexOf(' ', mid);
  return [...chunkText(s.slice(0, best).trim(), max), ...chunkText(s.slice(best).trim(), max)];
}

function masterAss(tl, script, { arabic, data = { lines: {} } }) {
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n${ASS_FORMAT}\n` + [
    style('En', 'Lato', 60, WHITE, { bold: -1, out: 3, sh: 1.5, an: 2, mv: arabic ? 128 : 56, ml: 160 }),
    style('Cap', 'Anton', 112, WHITE, { sp: 1, out: 7, sh: 3, an: 2, mv: 64, ml: 90 }),
    style('Fx', 'Lato', 20, WHITE, { out: 0, sh: 0 }),
    style('Tease', 'Anton', 64, '&H00000000', { sp: 1, out: 0, sh: 0, an: 5 }),
    style('Plate', 'Lato', 20, WHITE, { out: 0, sh: 0 }),
    style('Recon', 'Lato', 24, WHITE, { bold: -1, sp: 2, out: 2, sh: 1, an: 9 }),
    style('Ar', 'Segoe UI', 44, GOLD, { bold: -1, out: 3, sh: 1.2, an: 2, mv: 40, ml: 160 }),
    style('Big', 'Anton', 92, GOLD, { sp: 1, out: 3, sh: 2 }),
    style('Sub', 'Lato', 28, WHITE, { bold: -1, sp: 2, out: 2 }),
    style('ChNo', 'Lato', 26, GOLD, { bold: -1, sp: 6, out: 2 }),
    style('ChTitle', 'DM Serif Display', 58, WHITE, { out: 3, sh: 2 }),
    style('Out1', 'Anton', 112, GOLD, { sp: 2, out: 3, sh: 2 }),
    style('Out2', 'Lato', 46, WHITE, { bold: -1, sp: 4, out: 2.5, sh: 1.5 }),
    style('Out3', 'Lato', 36, WHITE, { bold: -1, sp: 2 }),
    style('Next1', 'Lato', 32, GOLD, { bold: -1, sp: 6 }),
    style('Next2', 'Anton', 60, WHITE, { sp: 1, out: 3, sh: 2 }),
    style('Stamp', 'Lato', 30, '&H004040FF&', { bold: -1, sp: 3, out: 2 }),
  ].join('\n') + '\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  const ev = [];
  const dl = (layer, a, b, st, text) => ev.push(`Dialogue: ${layer},${ass_t(a)},${ass_t(b)},${st},,0,0,0,,${text}`);

  // big captions timed to the words really spoken; the Arabic review copy keeps its calm two lines
  if (!arabic) {
    const said = tl.flat.flatMap((f) => timedWords(f.cap, heardOf(f.voice), f.dur).map((w) => ({ w: w.w, t0: w.t0 + f.T0, t1: w.t1 + f.T0 })));
    ev.push(...captionEvents(said, { style: 'Cap' }));
    ev.push(...dustEvents(0, tl.mainEnd, W, H));
    tl.flat.forEach((f) => {
      if (f.sfx === 'impact') ev.push(flashEvent(f.T0 + 0.3, W, H));
      if (f.li === 0 && f.ci > 0) ev.push(sweepEvent(f.T0 + 0.1, W, H));
      if (lineAssets(data, f.key).some((a) => a.recon)) dl(4, f.T0, f.T1, 'Recon', `{\\an9\\pos(${W - 40},${H - 44})\\fad(200,200)}ARTISTIC RECONSTRUCTION`);
    });
  }
  (arabic ? tl.flat : []).forEach((f, i) => {
    const next = tl.flat[i + 1];
    const end = Math.min(f.T1 + 0.25, next ? next.T0 - 0.03 : f.T1 + 0.5);
    const parts = chunkText(f.cap);
    const tot = parts.reduce((a, p) => a + p.length, 0);
    let t = f.T0 - 0.03;
    parts.forEach((p) => {
      const share = (p.length / tot) * (end - f.T0);
      dl(2, t, t + share, 'En', `{\\fad(60,60)}${aesc(p)}`);
      t += share;
    });
    if (arabic && f.ar) dl(2, f.T0, end, 'Ar', `{\\fad(120,120)}${RLM}${aesc(f.ar)}${RLM}`);
  });

  // chapter cards top-left (the first chapter is the cold open and has none)
  const firstOf = new Map();
  tl.flat.forEach((f) => { if (!firstOf.has(f.ci)) firstOf.set(f.ci, f); });
  const cards = [...firstOf.entries()].filter(([ci]) => ci > 0).map(([ci, f]) => ({ ci, t0: f.T0 - 0.15 }));
  cards.forEach(({ ci, t0 }) => {
    dl(6, t0, t0 + 4.2, 'ChNo', `{\\an7\\pos(84,62)\\fad(300,500)\\1c${GOLD}\\p1}m 0 0 l 4 0 4 104 0 104{\\p0}`);
    dl(6, t0, t0 + 4.2, 'ChNo', `{\\an7\\pos(106,62)\\fad(500,600)}CHAPTER ${ci}`);
    dl(6, t0, t0 + 4.2, 'ChTitle', `{\\an7\\pos(104,94)\\fad(600,600)}${aesc(script.chapters[ci].title)}`);
  });

  // call-outs on a compact plate, moved down when a chapter card is showing
  const callouts = tl.flat.filter((f) => f.callout);
  callouts.forEach((f, k) => {
    const a = f.T0 + 0.25;
    const b = Math.min(a + 3.6, callouts[k + 1] ? callouts[k + 1].T0 + 0.1 : a + 3.6, f.T1 + 0.2);
    const dy = cards.some(({ t0 }) => a < t0 + 4.2 && b > t0) ? 150 : 0;
    const big = aesc(f.callout.big), small = aesc(f.callout.small || '');
    const plateW = Math.round(Math.min(1400, Math.max(320, big.length * 34 + 70, small.length * 17 + 70)));
    const y = 56 + dy;
    dl(4, a, b, 'Sub', `{\\an7\\pos(70,${y})\\fad(220,300)\\1c&H000000&\\1a&H55&\\bord0\\shad0\\p1}m 0 0 l ${plateW} 0 ${plateW} 176 0 176{\\p0}`);
    dl(4, a, b, 'Sub', `{\\an7\\pos(70,${y})\\fad(220,300)\\1c${GOLD}\\bord0\\shad0\\p1}m 0 0 l 7 0 7 176 0 176{\\p0}`);
    dl(5, a, b, 'Big', `{\\pos(96,${y + 2})\\fad(260,300)\\fscx90\\fscy90\\t(0,320,\\fscx100\\fscy100)}${big}`);
    if (small) dl(5, a + 0.1, b, 'Sub', `{\\pos(100,${y + 130})\\fad(320,300)}${small}`);
  });

  // the short lines at the top wait for any chapter card or call-out to clear
  if (!arabic && script.teasers?.length) {
    const busy = [...cards.map(({ t0 }) => [t0, t0 + 4.2]), ...callouts.map((f) => [f.T0 + 0.25, f.T0 + 3.85])].sort((a, b) => a[0] - b[0]);
    ev.push(...teaserEvents(script.teasers.map((x) => ({ t: (tl.flat[x.line]?.T0 ?? 0) + 0.1, text: x.text })).filter((x) => x.t < tl.mainEnd - 6), { W, busy, size: 64 }));
  }
  if (arabic) dl(9, 0, tl.total, 'Stamp', '{\\an7\\pos(620,18)}INTERNAL REVIEW - DO NOT PUBLISH');

  // end card: the right half stays free for YouTube's end-screen elements
  const o = tl.mainEnd;
  dl(6, o + 1.0, o + OUTRO - 0.8, 'Out1', '{\\an7\\pos(92,640)\\fad(500,500)}SUBSCRIBE');
  dl(6, o + 1.6, o + OUTRO - 0.8, 'Out2', '{\\an7\\pos(96,780)\\fad(500,500)}LIKE  ·  COMMENT  ·  SHARE');
  dl(6, o + 2.2, o + OUTRO - 0.8, 'Out3', '{\\an7\\pos(98,860)\\fad(500,500)}Plan your Egypt trip:  zalavip.com');
  dl(6, o + 2.6, o + OUTRO - 0.8, 'Next1', '{\\an7\\pos(1010,96)\\fad(500,500)}WATCH NEXT');
  dl(6, o + 2.6, o + OUTRO - 0.8, 'Next2', `{\\an7\\pos(1010,140)\\fad(500,500)}${aesc(script.nextPublished || 'THE NEXT CASE IS COMING')}`);
  return head + ev.join('\n') + '\n';
}

function fontsRun() {
  const dir = path.join(TMP, 'fonts-run');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(FONTS)) fs.copyFileSync(path.join(FONTS, f), path.join(dir, f));
  for (const f of ['segoeui.ttf', 'segoeuib.ttf']) { const p = path.join('C:\\Windows\\Fonts', f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dir, f)); }
  return dir;
}
const subsFilter = (ass) => `subtitles='${filterPath(ass)}':fontsdir='${filterPath(fontsRun())}'`;
const GRADE = 'eq=contrast=1.09:saturation=1.14:gamma=0.97,colorbalance=rs=0.03:bs=-0.04:rm=0.025:bm=-0.03,vignette=angle=PI/5,noise=alls=4:allf=t';

async function finalPass({ chain, mix, ass, out, tl, crf = 19 }) {
  const a = (tl.stingAt != null ? tl.stingAt + STING + 0.8 : 0.5), b = tl.mainEnd - 0.3;
  const fc = `[0:v]${GRADE}[g];[2:v]scale=-2:96,format=rgba,colorchannelmixer=aa=0.8[wm];[g][wm]overlay=W-w-56:34:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'[o];[o]${subsFilter(ass)}[v]`;
  await encodeTo(out, (part) => ['-i', chain, '-i', mix, '-loop', '1', '-i', path.join(BRAND, 'mark.png'), '-filter_complex', fc, '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-maxrate', '12M', '-bufsize', '24M', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-t', tl.total.toFixed(2), part]);
}

// ── vertical reels ───────────────────────────────────────────────────────────
function pickReels(script, flat) {
  const plan = script.reels?.length ? script.reels
    : script.verticalOnly ? [{ chapter: 1, title: script.title, hook: script.thumbnailText || script.title }]
    : [1, Math.ceil(script.chapters.length / 2) + 1, script.chapters.length - 1]
      .filter((c, i, all) => c >= 1 && c <= script.chapters.length && all.indexOf(c) === i)
      .map((chapter) => ({ chapter, title: script.chapters[chapter - 1].title, hook: script.chapters[chapter - 1].title }));
  return plan.map((r, i) => {
    const lines = [];
    let t = 0;
    for (const f of flat.filter((x) => x.ci === r.chapter - 1).slice(r.from || 0)) {
      const d = durationOf(voiceFileOf(script, f));
      const said = [r.say, script.reelCta].filter(Boolean).map((x) => extraVoice(script, x)).filter((x) => fs.existsSync(x)).reduce((a, x) => a + durationOf(x) + 0.25, 0);
      if (lines.length && t + d + 0.25 > REEL_MAX - Math.max(REEL_OUTRO, said)) break;
      lines.push(f);
      t += d + 0.25;
    }
    return { ...r, num: i + 1, id: script.verticalOnly ? script.id : `${script.id}-R${i + 1}`, lines };
  }).filter((r) => r.lines.length);
}

function reelScene(s, out) {
  const FR = Math.max(2, Math.round(s.dur * FPS));
  const src = abs(s.asset.vfile || s.asset.file);
  if (s.asset.kind === 'video') return ['-i', src, '-vf', `fps=${FPS},tpad=stop_mode=clone:stop_duration=30,scale=${VW}:${VH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${VW}:${VH},setsar=1,format=yuv420p`, '-frames:v', String(FR), '-an', ...X264, out];
  const { width, height } = dimensionsOf(src);
  const tall = 2880, cropW = Math.round((tall * VW) / VH);
  const fullW = Math.round((width / height) * tall);
  if (fullW > cropW * 1.15) {
    // a wide photo travels across the frame so the whole picture is seen, nothing is lost to a centre crop
    const E = `((1-cos(PI*t/${s.dur.toFixed(3)}))/2)`;
    const x = s.idx % 2 ? `(iw-ow)*${E}` : `(iw-ow)*(1-${E})`;
    return ['-loop', '1', '-framerate', String(FPS), '-i', src, '-frames:v', String(FR), '-vf',
      `scale=-2:${tall}:flags=lanczos,crop=${cropW}:${tall}:'${x}':0,scale=${VW}:${VH}:flags=bicubic,setsar=1,format=yuv420p`, ...X264, out];
  }
  return ['-i', src, '-vf', `scale=${cropW}:${tall}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cropW}:${tall},zoompan=${motionExpr(s.idx % 2 ? 'pullout' : 'pushin', FR)}:d=${FR}:s=${VW}x${VH}:fps=${FPS},setsar=1,format=yuv420p`, '-frames:v', String(FR), ...X264, out];
}

function reelAss(reel, words, total, outro = REEL_OUTRO, speechEnd = total) {
  const base = buildReelAss(words, { W: VW, H: VH, mode: 'short' });
  const styles = [
    style('Badge', 'Lato', 34, GOLD, { bold: -1, sp: 4, out: 3, sh: 1 }),
    style('Hook', 'Anton', 176, '&H0000D7FF&', { sp: 1, out: 9, sh: 4 }),
    style('HookSub', 'Lato', 52, WHITE, { bold: -1, out: 4, sh: 2 }),
    style('End1', 'Anton', 84, GOLD, { sp: 1, out: 4, sh: 2, an: 8 }),
    style('End2', 'Lato', 46, WHITE, { bold: -1, out: 3, sh: 1, an: 8 }),
    style('Fx', 'Lato', 20, WHITE, { out: 0, sh: 0 }),
  ].join('\n');
  const dl = (a, b, st, text) => `Dialogue: 3,${ass_t(a)},${ass_t(b)},${st},,0,0,0,,${text}`;
  const lines = [];
  const hookEnd = 3.4;
  if (reel.badge) lines.push(dl(0.1, hookEnd, 'Badge', `{\\an7\\pos(64,210)\\fad(150,250)}${aesc(reel.badge)}`));
  // wrap the hook by hand: libass' balance is poor at this size
  const words2 = String(reel.hook || reel.title).toUpperCase().split(/\s+/);
  const rows = [];
  for (const w of words2) { if (rows.length && `${rows[rows.length - 1]} ${w}`.length <= 14) rows[rows.length - 1] += ` ${w}`; else rows.push(w); }
  lines.push(dl(0.1, hookEnd, 'Hook', `{\\an7\\pos(60,262)\\fad(120,250)\\fscx90\\fscy90\\t(0,200,\\fscx100\\fscy100)}${aesc(rows.join('\n'))}`));
  if (reel.sub) lines.push(dl(0.3, hookEnd, 'HookSub', `{\\an7\\pos(64,${290 + rows.length * 216})\\fad(200,250)}${aesc(reel.sub)}`));
  const e0 = total - outro + 0.2;
  lines.push(dl(e0, total, 'End1', `{\\an8\\pos(${VW / 2},1250)\\fad(250,0)}ZALA VIP CONCIERGE`));
  lines.push(dl(e0 + 0.2, total, 'End2', `{\\an8\\pos(${VW / 2},1370)\\fad(250,0)}FULL STORY ON YOUTUBE  ·  zalavip.com`));
  return base.replace('\n\n[Events]', `\n${styles}\n\n[Events]`) + [...lines, ...dustEvents(0, speechEnd, VW, VH, { every: 0.4, orbsEvery: 2.4, seed: 11 }), sweepEvent(0.15, VW, VH)].join('\n') + '\n';
}

function spreadWords(text, t0, dur) {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = words.map((w) => w.length + 1.5);
  const sum = weight.reduce((a, b) => a + b, 0);
  let t = t0;
  return words.map((w, i) => { const d = (weight[i] / sum) * dur; const o = { w, t0: t, t1: t + d }; t += d; return o; });
}

async function renderReel(script, reel, data, music, tl, dir, work) {
  const rw = path.join(work, 'reels', reel.id);
  fs.mkdirSync(rw, { recursive: true });
  let t = 0.25;
  const scenes = [], voices = [], words = [], events = [];
  let lastAsset = null;
  // the spoken hook runs over the first picture
  const hookVoice = reel.say && extraVoice(script, reel.say);
  if (hookVoice && fs.existsSync(hookVoice)) {
    const d = durationOf(hookVoice);
    voices.push({ file: hookVoice, t });
    words.push(...timedWords(numerals(reel.say), heardOf(hookVoice), d).map((w) => ({ w: w.w, t0: w.t0 + t, t1: w.t1 + t })));
    events.push({ name: 'hit', t, g: 0.8 });
    t += d + 0.25;
  }
  reel.lines.forEach((f, i) => {
    const d = durationOf(voiceFileOf(script, f));
    const start = i === 0 ? 0 : t - 0.1;
    const list = lineAssets(data, f.key).filter((a) => !a.card && !a.map);
    const anyPicture = () => reel.lines.flatMap((x) => lineAssets(data, x.key)).find((a) => !a.card && !a.map) || tl.flat.flatMap((x) => lineAssets(data, x.key)).find((a) => !a.card && !a.map);
    const assets = list.length ? list : [lastAsset || anyPicture()];
    const lineSpan = d + 0.35;
    voices.push({ file: voiceFileOf(script, f), t });
    words.push(...timedWords(f.cap, heardOf(voiceFileOf(script, f)), d).map((w) => ({ w: w.w, t0: w.t0 + t, t1: w.t1 + t })));
    assets.forEach((asset, b) => {
      lastAsset = asset;
      scenes.push({ asset, start: start + (b * lineSpan) / assets.length, idx: scenes.length, sfx: f.sfx });
    });
    if (f.sfx === 'impact') events.push({ name: 'impact', t: t + 0.3, g: 0.7 });
    if (f.sfx === 'hit') events.push({ name: 'hit', t, g: 0.8 });
    if (i > 0) events.push({ name: 'whoosh', t: start - 0.2, g: 0.3 });
    t += d + 0.25;
  });
  const speechEnd = t;
  // the close is spoken over the end card, naming the brand
  const ctaVoice = script.reelCta && extraVoice(script, script.reelCta);
  let outro = REEL_OUTRO;
  if (ctaVoice && fs.existsSync(ctaVoice)) {
    const d = durationOf(ctaVoice);
    voices.push({ file: ctaVoice, t: speechEnd + 0.15 });
    outro = Math.max(REEL_OUTRO, d + 0.9);
  }
  events.push({ name: 'shimmer', t: speechEnd, g: 0.6 });
  const total = speechEnd + outro;
  scenes.forEach((s, i) => { s.span = (scenes[i + 1]?.start ?? speechEnd) - s.start; });
  const fade = 0.25;
  scenes.forEach((s, i) => { s.dur = s.span + (i < scenes.length - 1 ? fade : 0); });

  const clips = [];
  await pool(scenes.map((s, i) => ({ s, i })), 3, async ({ s }) => {
    s.out = path.join(rw, `${hash(`${s.asset.file}|${s.idx}|${s.dur.toFixed(3)}`)}.mp4`);
    if (!okClip(s.out)) await encodeTo(s.out, (part) => reelScene(s, part));
  });
  clips.push(...scenes.map((s) => s.out));

  // end card: dark gold glow + crest
  const endStill = brandStill(path.join(rw, 'end.png'), { crestW: 620, x: 650, y: 140, glow: { x: 960, y: 440, r: 460 } });
  const endClip = path.join(rw, `end-${outro.toFixed(2)}.mp4`);
  if (!okClip(endClip)) {
    await encodeTo(endClip, (part) => ['-loop', '1', '-framerate', String(FPS), '-i', endStill, '-frames:v', String(Math.round(outro * FPS)), '-vf',
      `crop=608:1080:656:0,scale=${VW}:${VH}:flags=lanczos,fade=t=in:st=0:d=0.3,setsar=1,format=yuv420p`, ...X264, part]);
  }

  // the picture: crossfades between scenes, then the end card
  let g = '', last = '[0:v]', cum = 0;
  for (let k = 1; k < clips.length; k++) {
    cum += scenes[k - 1].span;
    g += `${last}[${k}:v]xfade=transition=fade:duration=${fade}:offset=${cum.toFixed(3)}[x${k}];`;
    last = `[x${k}]`;
  }
  const n = clips.length;
  g += `${last}trim=0:${speechEnd.toFixed(3)},setpts=PTS-STARTPTS[pic];[${n}:v]setpts=PTS-STARTPTS[end];[pic][end]concat=n=2:v=1:a=0[all]`;

  const assFile = path.join(rw, 'captions.ass');
  fs.writeFileSync(assFile, reelAss(reel, words, total, outro, speechEnd), 'utf8');
  g += `;[all]${GRADE}[gr];[${n + 1}:v]scale=-2:100,format=rgba,colorchannelmixer=aa=0.85[wm];[gr][wm]overlay=W-w-40:60:enable='lt(t,${(speechEnd).toFixed(2)})'[o];[o]${subsFilter(assFile)}[v]`;
  const gf = path.join(rw, 'graph.filter');
  fs.writeFileSync(gf, g);

  const mix = path.join(rw, 'mix.m4a');
  await mixAudio({ voices, events, music, musicFrom: reel.lines[0].T0 || 0, total, out: mix, work: rw, tag: 'reel' });

  const out = path.join(dir, `${reel.id}.mp4`);
  await encodeTo(out, (part) => [...clips.flatMap((c) => ['-i', c]), '-i', endClip, '-loop', '1', '-i', path.join(BRAND, 'mark.png'), '-i', mix,
    '-filter_complex_script', gf, '-map', '[v]', '-map', `${n + 2}:a`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', '-t', total.toFixed(2), part]);
  ff(['-ss', '1.6', '-i', out, '-frames:v', '1', '-q:v', '2', path.join(dir, `${reel.id}_cover.jpg`)]);
  return { id: reel.id, title: reel.title, file: path.basename(out), duration: Math.round(total * 10) / 10 };
}

// ── thumbnail + upload package ───────────────────────────────────────────────
function thumbnail(script, tl, data, dir, work) {
  const tW = 1280, tH = 720;
  const beats = tl.flat.flatMap((f) => (data.lines[f.key]?.beats || []).map((x) => ({ ...x, en: f.en }))).filter((x) => x.asset && !x.asset.card && !x.asset.map && x.asset.kind !== 'video' && x.asset.file);
  const variants = script.thumbnails?.length ? script.thumbnails : [{ text: script.thumbnailText || script.title }];
  const used = new Set(), made = [];
  variants.forEach((v, i) => {
    const re = v.match ? new RegExp(v.match, 'i') : null;
    const pick = (re && beats.find((x) => !used.has(x.asset.file) && re.test(`${x.need} ${x.en}`))) || beats.find((x) => !used.has(x.asset.file)) || beats[0];
    used.add(pick.asset.file);
    const words = String(v.text).toUpperCase().split(/\s+/);
    const rows = [];
    for (const w of words) { if (rows.length && `${rows[rows.length - 1]} ${w}`.length <= 11) rows[rows.length - 1] += ` ${w}`; else rows.push(w); }
    const size = rows.length > 3 ? 112 : 150;
    const ass = path.join(work, `thumb-${i}.ass`);
    const body = rows.map((r, n) => (n === rows.length - 1 ? `{\\c&H0000D7FF&}${aesc(r)}` : `{\\c&H00FFFFFF&}${aesc(r)}`)).join('\\N');
    fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${tW}\nPlayResY: ${tH}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n${ASS_FORMAT}\n${style('T', 'Anton', size, WHITE, { sp: 1, out: 8, sh: 5, an: 4 })}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:10.00,T,,0,0,0,,{\\an4\\pos(44,${tH / 2})}${body}\n`, 'utf8');
    const file = path.join(dir, i === 0 ? `${script.id}_thumbnail.jpg` : `${script.id}_thumbnail-${i + 1}.jpg`);
    ff(['-i', abs(pick.asset.file), '-f', 'lavfi', '-i', `color=c=black:s=${tW}x${tH}`, '-i', path.join(BRAND, 'mark.png'), '-filter_complex',
      `[0:v]scale=${tW}:${tH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${tW}:${tH},eq=contrast=1.2:saturation=1.3:brightness=0.02,unsharp=5:5:0.8[pic];` +
      `[1:v]format=rgba,geq=r=0:g=0:b=0:a='235*pow(max(0\\,1-X/(W*0.72))\\,0.8)'[shade];[pic][shade]overlay=0:0:shortest=1[c];` +
      `[2:v]scale=-2:76,format=rgba[m];[c][m]overlay=W-w-22:18[o];[o]${subsFilter(ass)}[v]`, '-map', '[v]', '-frames:v', '1', '-q:v', '2', file]);
    made.push(path.basename(file));
  });
  return made;
}

function srt(tl, field) {
  const time = (t) => {
    const ms = Math.max(0, Math.round(t * 1000));
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return tl.flat.filter((f) => f[field]).map((f, i) => `${i + 1}\n${time(f.T0)} --> ${time(f.T1 + 0.2)}\n${f[field]}\n`).join('\n');
}

function uploadPackage(script, tl, data, reels, dir, masterFile, extra = {}) {
  const firstOf = new Map();
  tl.flat.forEach((f) => { if (!firstOf.has(f.ci)) firstOf.set(f.ci, f.T0); });
  const marks = [...firstOf.entries()].map(([ci, t]) => `${fmtTime(ci === 0 ? 0 : t)} ${script.chapters[ci].title}`);
  const credits = [...new Set(tl.flat.flatMap((f) => lineAssets(data, f.key)).map((a) => a.attribution).filter(Boolean))];
  const animated = tl.flat.some((f) => lineAssets(data, f.key).some((a) => a.recon || (a.kind === 'video' && !a.page)));
  const sources = [...new Set((script.sources || []).map((s) => s.url || s).filter(Boolean))];
  const body = String(script.description || tl.flat.slice(0, 2).map((f) => f.en).join(' '));
  let description = `${body}\n\nPlan your Egypt trip with ZALA VIP: ${SITE(script.id, 'video')}\n\nChapters:\n${marks.join('\n')}`;
  if (sources.length) description += `\n\nSources:\n${sources.map((u) => `• ${u}`).join('\n')}`;
  if (extra.licensedMusic) description += `\n\nMusic:\n${script.music.map((m) => m.track).filter((x, i, all) => all.indexOf(x) === i).map((t) => `• "${t}" Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 http://creativecommons.org/licenses/by/4.0/`).join('\n')}`;
  description += animated ? '\n\nNarration voice and the shots marked as artistic reconstruction are AI-generated.' : '\n\nNarration voice is AI-generated.';
  if (credits.length) {
    const short = credits.map((c) => `• ${c.replace(/^"(.{0,44}).*?" by /, '"$1" by ').replace(/, via (Wikimedia Commons|Europeana)$/, '').replace(/ \(https?:[^)]*\)/, '').replace(/\s+/g, ' ').slice(0, 72)}`);
    description += `\n\nImage and video credits:\n${short.join('\n')}`;
  }
  fs.writeFileSync(path.join(dir, `${script.id}.credits.txt`), credits.join('\n'), 'utf8');
  if (description.length > 4900) log(`Note: the description is ${description.length} characters, the last credits are cut; the full list is in ${script.id}.credits.txt`);
  const pkg = {
    id: script.id, title: script.title, description: description.slice(0, 4900),
    tags: script.tags || [script.series, 'Egypt', 'Ancient Egypt', 'Egypt history', 'Egypt travel'].filter(Boolean),
    file: path.basename(masterFile), thumbnail: `${script.id}_thumbnail.jpg`, thumbnails: extra.thumbnails || [], engagement: extra.engagement || {}, captions: { en: `${script.id}.en.srt` },
    duration: Math.round(tl.total * 10) / 10, voice: script.voiceNote || `${voiceParams(script).voice} / ${voiceParams(script).model}`,
    altered_content: animated, reels, renderedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${script.id}.youtube.json`), JSON.stringify(pkg, null, 2));
  fs.writeFileSync(path.join(dir, `${script.id}.en.srt`), srt(tl, 'cap'), 'utf8');
}

// ── final inspection ─────────────────────────────────────────────────────────
function inspect(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const summary = String(r.stderr).split('Summary:').pop();
  const { width, height } = dimensionsOf(file);
  return {
    file: path.basename(file), size: `${width}x${height}`, seconds: Math.round(durationOf(file) * 10) / 10, mb: Math.round(fs.statSync(file).size / 1048576),
    lufs: Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]), peak: Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]),
  };
}

// ── commands ─────────────────────────────────────────────────────────────────
function stageCheck(script, flat, { voiceFrom } = {}) {
  const problems = [], notes = [];
  if (!script.id) problems.push('The script has no id');
  flat.forEach((f) => {
    if (!f.en) problems.push(`${f.label}: no English text`);
    if (!f.pictures?.length) notes.push(`${f.label}: no library picture chosen, it will borrow the nearest one`);
  });
  for (const n of ['Anton-Regular.ttf', 'DMSerifDisplay-Regular.ttf', 'Lato-Bold.ttf']) if (!fs.existsSync(path.join(FONTS, n))) problems.push(`Font missing: ${n} (run: npm run fonts in media)`);
  for (const p of [path.join(BRAND, 'mark.png'), path.join(REPO, 'public', 'zala-crest-transparent.png')]) if (!fs.existsSync(p)) problems.push(`Brand file missing: ${rel(p)}`);
  if (!script.sources?.length) notes.push('No sources in the script: the description will have no Sources section');
  if (!flat.some((f) => f.ar)) notes.push('No Arabic text: the Arabic review copy will be skipped');
  const vp = voiceParams(script);
  const need = flat.filter((f) => !fs.existsSync(voiceFileOf(script, f, vp)) && !(voiceFrom && fs.existsSync(path.join(voiceFrom, `${f.label}_line.mp3`))));
  const needChars = need.reduce((a, f) => a + f.say.length, 0);
  const secs = needChars / 15;
  log(`${script.id}: ${script.title}`);
  log(`Chapters ${script.chapters.length}, lines ${flat.length}`);
  log(`Voice: ${vp.voice} on ${vp.model}, ${geminiKeys.length} Gemini keys`);
  log(`Voice still needed: ${need.length} lines, about ${Math.round(secs)}s of speech, about ${Math.round(secs * AUDIO_TOKENS_PER_SEC + needChars / 4)} tokens`);
  notes.forEach((n) => log(`Note: ${n}`));
  problems.forEach((n) => log(`PROBLEM: ${n}`));
  if (!geminiKeys.length) problems.push('GEMINI_API_KEY missing');
  return problems.length === 0;
}

async function stageRender(script, flat, { noReels, reelsOnly }) {
  const id = script.id;
  const data = loadShots(id);
  if (!flat.some((f) => lineAssets(data, f.key).length)) throw new Error('No images yet: run the images step first');
  const dir = outDir(id), work = workDir(id), review = reviewDir(id);
  for (const d of [dir, work, review]) fs.mkdirSync(d, { recursive: true });

  const tl = buildTimeline(script, flat);
  log(`Timeline: ${flat.length} lines, ${fmtTime(tl.total)} total`);
  const chapterStart = (ci) => tl.flat.find((x) => x.ci === ci)?.T0 ?? tl.mainEnd;
  const score = await licensedScore(script, tl, work);
  const generated = score || script.music?.length ? null : await generateMusic(script);
  const music = score || musicBed(work, tl.total + 1, { generated, lift: chapterStart(Math.min(3, script.chapters.length - 1)), end: tl.mainEnd });
  let thumbs = [], engagement = {};
  const master = path.join(dir, `${id}.mp4`);
  const results = [];

  if (!script.verticalOnly && !reelsOnly) {
    const scenes = planScenes(tl, data);
    log(`Shots: ${scenes.filter((s) => s.type === 'img').length} pictures, one every ${(tl.mainEnd / scenes.length).toFixed(1)}s`);
    const chain = await renderPicture(scenes, work);
    const pictures = scenes.filter((x) => x.type === 'img');
    engagement = {
      longestStill: Math.round(Math.max(...pictures.filter((x) => !x.isVideo).map((x) => x.span)) * 10) / 10,
      longestClip: Math.round(Math.max(0, ...pictures.filter((x) => x.isVideo).map((x) => x.span)) * 10) / 10,
      shots: pictures.length, clips: pictures.filter((x) => x.isVideo).length, maps: pictures.filter((x) => x.asset?.map).length, cards: new Set(pictures.filter((x) => x.asset?.card).map((x) => x.asset.card)).size,
      teasers: (script.teasers || []).length, minutes: Math.round((tl.mainEnd / 60) * 10) / 10, wordTimed: tl.flat.filter((f) => heardOf(f.voice)?.length).length, lines: tl.flat.length, licensedMusic: !!score,
    };
    log(`Keeping people watching: ${JSON.stringify(engagement)}`);

    log('Sound: mixing voice, music and effects');
    const events = [];
    const add = (name, t, g) => events.push({ name, t, g });
    if (tl.stingAt != null) { add('impact', tl.stingAt + 0.05, 0.95); add('shimmer', tl.stingAt + 0.25, 0.9); }
    add('shimmer', tl.mainEnd + 0.9, 0.7);
    tl.flat.forEach((f) => {
      if (f.sfx === 'impact') add('impact', f.T0 + 0.35, 0.8);
      if (f.sfx === 'hit') add('hit', f.T0 + 0.02, 0.85);
      if (f.sfx === 'whoosh') add('whoosh', f.T0 - 0.3, 0.7);
      if (f.sfx === 'riser') add('riser', f.T1 - 2.6, 0.7);
      if (f.sfx === 'shimmer') add('shimmer', f.T0, 0.7);
      if (f.callout) add('pop', f.T0 + 0.3, 0.55);
      if (!f.sfx && f.li % 4 === 3) add('whoosh', f.T0 - 0.2, 0.28);
    });
    (script.teasers || []).forEach((x) => { const f = tl.flat[x.line]; if (f) add('pop', f.T0 + 0.1, 0.4); });
    script.chapters.forEach((_, ci) => { if (ci > 0 && !(ci === 1 && tl.stingAt != null)) add('whoosh', chapterStart(ci) - 0.2, 0.55); });
    const mix = path.join(work, 'mix.m4a');
    await mixAudio({ voices: tl.flat.map((f) => ({ file: f.voice, t: f.T0 })), events, music, total: tl.total, out: mix, work, tag: 'master' });

    log('Final: master');
    const assEn = path.join(work, 'captions-en.ass');
    fs.writeFileSync(assEn, masterAss(tl, script, { arabic: false, data }), 'utf8');
    await finalPass({ chain, mix, ass: assEn, out: master, tl });
    results.push(inspect(master));
    if (tl.flat.some((f) => f.ar)) {
      log('Final: Arabic review copy');
      const assAr = path.join(work, 'captions-ar.ass');
      fs.writeFileSync(assAr, masterAss(tl, script, { arabic: true }), 'utf8');
      const reviewFile = path.join(review, `${id}_ARABIC-REVIEW_DO-NOT-PUBLISH.mp4`);
      await finalPass({ chain, mix, ass: assAr, out: reviewFile, tl, crf: 23 });
      fs.writeFileSync(path.join(review, `${id}.ar.srt`), srt(tl, 'ar'), 'utf8');
      results.push(inspect(reviewFile));
    }
    thumbs = thumbnail(script, tl, data, dir, work);
  }

  const reelMeta = [];
  if (!noReels) {
    for (const reel of pickReels(script, tl.flat)) {
      log(`Reel: ${reel.id} (${reel.lines.length} lines)`);
      const meta = await renderReel(script, reel, data, music, tl, dir, work);
      reelMeta.push(meta);
      results.push(inspect(path.join(dir, meta.file)));
    }
  }
  if (!script.verticalOnly && !reelsOnly) uploadPackage(script, tl, data, reelMeta, dir, master, { thumbnails: thumbs, engagement, licensedMusic: !!score });

  const arabic = /[\u0600-\u06FF]/;
  const leaks = fs.readdirSync(dir).filter((f) => /\.(json|srt)$/.test(f) && arabic.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  if (leaks.length) log(`WARNING: Arabic found in the publish folder: ${leaks.join(', ')}`);
  const stills = flat.flatMap((f) => data.lines[f.key]?.beats || []);
  const borrowed = stills.filter((b) => b.borrowed).length;
  const report = {
    results, englishOnly: leaks.length === 0,
    shots: stills.length, animated: stills.filter((b) => b.clip).length, borrowed,
  };
  fs.writeFileSync(path.join(review, `${id}_report.json`), JSON.stringify(report, null, 2));
  log('\nFinished:');
  results.forEach((r) => log(`  ${r.file}  ${r.size}  ${fmtTime(r.seconds)}  ${r.mb} MB  loudness ${r.lufs} LUFS`));
  log(`Folder: ${rel(dir)}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
  const opt = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const noMeta = flag('--no-meta'), noReels = flag('--no-reels'), reelsOnly = flag('--reels-only');
  const voiceFromArg = opt('--voice-from'), limit = Number(opt('--limit')) || 0;
  const voiceFrom = voiceFromArg ? path.resolve(voiceFromArg) : null;
  const [cmd, target] = argv;
  if (cmd === 'meta-login') return metaLogin();
  if (!cmd || !target) {
    log('usage: node media/zala-render.mjs <all|check|sample|story|voice|images|animate|render|meta-login|meta-test> <ID> [--voice-from dir] [--limit n] [--no-meta] [--no-reels] [--reels-only]');
    process.exit(1);
  }
  // the owner's data plan is never used for pictures or video: these steps run only on the cloud server
  if (['all', 'story', 'voice', 'images', 'animate', 'render', 'meta-test'].includes(cmd) && !process.env.CI) {
    log(`"${cmd}" runs on the cloud server only, not on this computer. Start it from GitHub Actions in zala-render.`);
    process.exit(1);
  }
  if (cmd === 'story' || cmd === 'all') {
    await ensureLibrary(target);
    await stageStory(target);
    if (cmd === 'story') return;
  }
  const script = loadScript(target);
  const flat = flatten(script, limit);

  if (cmd === 'check') { process.exit(stageCheck(script, flat, { voiceFrom }) ? 0 : 1); }
  if (cmd === 'sample') {
    const file = path.join(reviewDir(script.id), `${script.id}_voice-sample.wav`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await speakLine(flat[0].say, voiceParams(script), file);
    log(`Voice sample: ${rel(file)} (${durationOf(file).toFixed(1)}s)`);
    return;
  }
  if (cmd === 'voice') return stageVoice(script, flat, { voiceFrom });
  if (cmd === 'images') { await stageImages(script, flat); return; }
  if (cmd === 'animate') { await stageAnimate(script, flat); return; }
  if (cmd === 'meta-test') { await metaTest(script, flat); return; }
  if (cmd === 'render') return stageRender(script, flat, { noReels, reelsOnly });
  if (cmd === 'all') {
    if (!stageCheck(script, flat, { voiceFrom })) process.exit(1);
    await stageVoice(script, flat, { voiceFrom });
    if (!script.verticalOnly) {
      await stageDirector(script);
      const directed = flatten(script, limit);
      await stageImages(script, directed);
      if (!noMeta) await stageAnimate(script, directed);
      return stageRender(script, directed, { noReels, reelsOnly });
    }
    await stageImages(script, flat);
    if (!noMeta) await stageAnimate(script, flat);
    return stageRender(script, flat, { noReels, reelsOnly });
  }
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((e) => { console.error(`\nStopped: ${e.message}`); process.exit(1); });
