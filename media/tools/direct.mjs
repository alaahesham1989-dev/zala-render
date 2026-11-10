// Runs only the director on an episode (the same work as stageDirector in zala-render.mjs, which has no command of its own),
// so gapfill.mjs can fill the empty lines before the pictures and the render. Pictures the library builder already
// checked are not looked at again, which saves Gemini requests.
// Usage: node media/tools/direct.mjs ZV-T01
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CONTENT, CACHE } from '../lib/paths.mjs';
import { keyFor, markSpent } from '../lib/gemini-keys.mjs';
import { screenPictures, directEpisode } from '../lib/director.mjs';

const id = process.argv[2];
if (!id) throw new Error('usage: node media/tools/direct.mjs <episode id>');
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const ITEMS = path.join(CONTENT, 'library', 'items.jsonl');
const scriptFile = path.join(CONTENT, 'youtube', `${id}.json`);

const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
if (script.directed === 8) { log(`Director: ${id} is directed already`); process.exit(0); }
const all = fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
let rule = null;
try { const f = JSON.parse(fs.readFileSync(path.join(CONTENT, 'library', 'topics.json'), 'utf8'))[id]?.forbid; if (f) rule = new RegExp(f, 'i'); } catch {}
const pics = all.filter((i) => i.kind === 'image' && i.seen?.usable && !i.r2_pending && i.topics?.includes(id)
  && !(rule && rule.test([i.title, i.note, i.seen.what, i.seen.subject, i.seen.place].join(' '))));

async function downloadImage(url) {
  const dir = path.join(CACHE, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hash(url)}${/\.png($|\?)/i.test(url) ? '.png' : '.jpg'}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 3000) return file;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'ZALA-VIP-media/1.0 (https://www.zalavip.com)' }, signal: AbortSignal.timeout(90000) });
      if (res.ok) { fs.writeFileSync(file, Buffer.from(await res.arrayBuffer())); return file; }
    } catch {}
    await sleep(8000 * attempt);
  }
  return null;
}
const jpeg = (file, w) => execFileSync(FF, ['-loglevel', 'error', '-i', file, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'], { maxBuffer: 64 << 20 }).toString('base64');
const thumb = async (p) => { const f = await downloadImage(p.url); try { return f ? jpeg(f, 512) : null; } catch { return null; } };
const thumbLarge = async (p) => { const f = await downloadImage(p.url); try { return f ? jpeg(f, 1024) : null; } catch { return null; } };
const addPicture = (p) => { const item = { id: hash(p.source_url).slice(0, 14), ...p }; all.push(item); return item; };
let places = [];
try { places = JSON.parse(fs.readFileSync(path.join(CONTENT, 'library', 'places.json'), 'utf8')); } catch {}
const tools = { thumb, thumbLarge, addPicture, log, sleep, keyFor, markSpent, places };

const clean = await screenPictures(pics, tools);
fs.writeFileSync(ITEMS, all.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
if (clean.length < 4) throw new Error(`Only ${clean.length} clean pictures for ${id}, the director will not go on`);
await directEpisode(script, clean, tools);
fs.writeFileSync(ITEMS, all.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
const seenPlaces = new Set();
for (const l of script.chapters.flatMap((c) => c.lines)) {
  delete l.map;
  const place = !l.noMap && places.find((p) => !seenPlaces.has(p.name) && new RegExp(p.match).test(l.en));
  if (place) { seenPlaces.add(place.name); l.map = place.name; }
}
fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n', 'utf8');
fs.rmSync(path.join(CONTENT, 'youtube', `${id}.shots.json`), { force: true });
log('Director: done');
