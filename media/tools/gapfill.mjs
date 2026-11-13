// Fills the lines the director left without a picture, so an episode never borrows a wrong picture from its neighbour.
// Runs after the director and before the images stage, on the server. No paid service, no AI requests.
//
// For each empty line, in this order:
//   1. a library picture whose description names the same person, place or thing (text match, never a guess);
//      a picture already used twice comes back as a different close-up crop, so the viewer never sees the same frame
//   2. a free Pixabay video for lines about landscape and light (sun, desert, sand, Nile, night sky)
//   3. an animated title scene drawn by Manim in the channel style: a year, a number, or the key words of the line
// It also tops up the short lines at the top of the screen to what the quality check asks for.
//
// Usage: node media/tools/gapfill.mjs ZV-L08 [--dry] [--review review.json]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { CONTENT, ROOT, TMP } from '../lib/paths.mjs';
import { numerals } from '../lib/display-numbers.mjs';
import { askJson } from './gemini-lite.mjs';

const id = process.argv[2];
const dry = process.argv.includes('--dry');
if (!id) throw new Error('usage: node media/tools/gapfill.mjs <episode id> [--dry]');
const log = (...a) => console.log('[gapfill]', ...a);
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

const BASE = process.env.GAPFILL_CONTENT || CONTENT;   // a copy of the content folder can be used for a dry run
const scriptFile = path.join(BASE, 'youtube', `${id}.json`);
const itemsFile = path.join(BASE, 'library', 'items.jsonl');
const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
if (script.directed !== 8) throw new Error(`${id} has not been through the director yet`);
const items = fs.readFileSync(itemsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byId = new Map(items.map((i) => [i.id, i]));
const lines = script.chapters.flatMap((c) => c.lines);
const chapterOf = new Map(script.chapters.flatMap((c) => c.lines.map((l) => [l, c])));

const MEDIA = String(process.env.VITE_MEDIA_BASE_URL || '').replace(/\/+$/, '');
const { R2_BUCKET, R2_ACCOUNT_ID } = process.env;
const ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
function upload(file, key, type) {
  if (dry) return `${MEDIA}/${key}`;
  execFileSync('aws', ['s3', 'cp', file, `s3://${R2_BUCKET}/${key}`, '--endpoint-url', ENDPOINT, '--content-type', type, '--no-progress'], { stdio: 'inherit' });
  return `${MEDIA}/${key}`;
}

// ── 1. text match against the library ────────────────────────────────
const TAIL = new Set('a an the as of in on at by to and but or was were is not so than that this out with for from its his her their'.split(' '));
const trimTail = (ws) => { while (ws.length > 3 && TAIL.has(ws[ws.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) ws.pop(); return ws; };
const STOP = new Set(('about above after again against all also among and another any are around because been before being below between both but '
  + 'came come could did does down during each even every few from further had has have having her here hers him his how into its itself just '
  + 'last later least less like made make many more most much must near never next nothing once only other over own same seen should since some '
  + 'still such than that their them then there these they this those though through time times under until very want was were what when where '
  + 'which while who whom whose why will with within without would year years your one two three four five six seven eight nine ten first second '
  + 'great small long left right away back known knew know found find told tell said says old new day days world people man men woman women thing '
  + 'things ever still always morning mornings each inside outside').split(' '));
const GENERIC = new Set('temple temples stone stones statue statues great small water built carved rock ancient gods god king kings river land giant giants colossal huge whole entire across behind beside inside mountain hall doorway entrance faces face front work plan wall walls'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' -]+/g, ' ').split(/[\s-]+/).map((w) => w.replace(/'s$/, '')).filter((w) => w.length >= 4 && !STOP.has(w) && !GENERIC.has(w));
/** Names in a line: capitalised words that are not just the first word of the sentence. */
const names = (s) => [...String(s || '').matchAll(/(^|[^.!?]\s)([A-Z][a-z]+(?:[- ][A-Z][a-z]+)*)/g)].filter((m) => m[1] !== '' || /[- ]/.test(m[2]))
  .map((m) => m[2].toLowerCase()).filter((n) => !STOP.has(n) && n.length >= 3 && !/^(egypt|egyptian|egyptians|ancient)$/.test(n));
const clean = items.filter((i) => i.kind === 'image' && i.seen?.usable && !i.r2_pending && i.topics?.includes(id)
  && i.seen.check && !i.seen.check.nudity && !i.seen.check.poor);
const MODERN_LINE = /\b(nineteen|two thousand|twenty|eighteen|today|modern|now|engineers?|crane|dam|lake nasser|unesco)\b/i;
const isModern = (p) => p.seen.check?.modern || /^modern/.test(p.seen.check?.kind || '');
const textOf = (p) => [p.title, p.seen.subject, p.seen.what, p.seen.place, p.seen.period, p.note].join(' ');

const TOPIC = (() => { try { return new RegExp(JSON.parse(fs.readFileSync(path.join(BASE, 'library', 'topics.json'), 'utf8'))[id]?.match || '$^', 'i'); } catch { return /$^/; } })();
/** How well a picture's own description covers the line. A specific name must match (the episode's main place alone is not enough),
 *  and a picture of a named place is never used for a line about another place. */
function score(line, p) {
  if (isModern(p) && !MODERN_LINE.test(line)) return 0;
  const hay = textOf(p).toLowerCase();
  const hayWords = new Set(words(hay));
  const nm = names(line).filter((n) => hay.includes(n));
  const strong = nm.filter((n) => !TOPIC.test(n));
  const w = [...new Set(words(line))].filter((x) => hayWords.has(x));
  if (!strong.length && !(nm.length && w.length >= 2)) return 0;
  return strong.length * 4 + nm.length + w.length;
}

const uses = new Map();
// what the review refused on any earlier render of this episode: picture ids and video pages, never chosen again
const banned = new Set(script.banned || []);
for (const l of lines) for (const p of l.pictures || []) uses.set(p, (uses.get(p) || 0) + 1);

const crops = ['left', 'right', 'top', 'center'];
async function cropOf(p, n) {
  if (dry) return { id: `${p.id}-${crops[n % crops.length]}` };   // a dry run downloads nothing
  const dir = path.join(TMP, 'gapfill', id);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, `${hash(p.url)}.src`);
  if (!fs.existsSync(src)) {
    const res = await fetch(p.url, { headers: { 'User-Agent': 'ZalaRender/1.0 (https://www.zalavip.com)' }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) return null;
    fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  }
  const where = crops[n % crops.length];
  const xy = { left: '0:(ih-oh)/2', right: 'iw-ow:(ih-oh)/2', top: '(iw-ow)/2:0', center: '(iw-ow)/2:(ih-oh)/2' }[where];
  const out = path.join(dir, `${hash(p.id + where)}.jpg`);
  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `crop=iw*0.62:ih*0.62:${xy},scale='max(1920,iw)':-2`, '-q:v', '3', out]);
  } catch { return null; }
  const key = `vault/gapfill/${id}/${path.basename(out)}`;
  const item = { ...p, id: `${p.id}-${where}`.slice(0, 24), url: upload(out, key, 'image/jpeg'), title: `${p.title} (detail)`, topics: [id],
    seen: { ...p.seen, what: `Close-up: ${p.seen.what}` } };
  items.push(item);
  byId.set(item.id, item);
  return item;
}

// ── 2. free landscape video ───────────────────────────────────────────
const ATMOSPHERE = [
  [/\b(sun|sunrise|sunlight|dawn|beam|ray)\b/i, 'sahara desert sunrise'],
  [/\b(sand|dune|dunes|desert|buried|swallowed)\b/i, 'sahara sand dunes wind'],
  [/\b(nile|river|lake|water|flood|flooded)\b/i, 'nile river egypt'],
  [/\b(night|darkness|stars)\b/i, 'desert night stars'],
];
// footage must look like Egypt: no animals or plants of other lands, no people, no towns, nothing made by AI
const BAD_TAGS = /halloween|haunted|spooky|ghost|witch|pumpkin|illustration|drawing|cartoon|anime|vector|christmas|africa|savanna|savannah|giraffe|safari|elephant|lion|zebra|acacia|jungle|forest|tropical|waterfall|fantasy|\bai\b|generated|3d|render|animation|cartoon|people|person|woman|\bman\b|girl|boy|city|car|road|camel ride|tourist/i;
const GOOD_TAGS = /desert|sand|dune|nile|egypt|river|sunrise|sunset|\bsun\b|night|stars|sky|sahara/i;
const usedVideos = new Set();
async function pixabayClip(line) {
  const key = dry ? '' : process.env.PIXABAY_API_KEY;
  const hit = ATMOSPHERE.find(([re]) => re.test(line));
  if (!key || !hit) return null;
  try {
    const res = await fetch(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(hit[1])}&safesearch=true&per_page=30`, { signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    for (const v of j.hits || []) {
      if (usedVideos.has(v.id) || banned.has(v.pageURL) || v.duration < 6 || BAD_TAGS.test(v.tags || '') || !GOOD_TAGS.test(v.tags || '')) continue;
      const pick = ['large', 'medium'].map((k) => v.videos?.[k]).find((f) => f?.url && f.width >= 1280 && f.width > f.height);
      if (!pick) continue;
      usedVideos.add(v.id);
      return { url: pick.url, page: v.pageURL, credit: `Video by ${v.user} on Pixabay`, license: 'Pixabay Content License', what: hit[1], gapfill: true };
    }
  } catch (e) { log(`pixabay: ${e.name}`); }
  return null;
}

// ── 3. animated title scenes (Manim) ─────────────────────────────────
function cardWords(l) {
  const plain = l.en.replace(/[.,!?]+$/, '');
  if (plain.split(/\s+/).length <= 7) return plain;
  const card = String(l.card || '').replace(/[.,!?]+$/, '');
  if (card && card.split(/\s+/).length <= 7 && l.en.toLowerCase().includes(card.toLowerCase())) return card;
  const clauses = l.en.split(/[,.;:?!]|\s(?:and|but|because|until|while|when)\s/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 2 && x.split(/\s+/).length <= 7);
  const meaning = (x) => words(x).length + names(` ${x}`).length * 2;
  const best = clauses.sort((a, b) => meaning(b) - meaning(a))[0];
  if (best) return best;
  // no short clause: the first words up to a natural stop
  const head = l.en.split(/\s+/).slice(0, 7);
  return trimTail(head).join(' ').replace(/[.,!?;:]+$/, '');
}
function sceneFor(l) {
  const n = numerals(l.en);
  const year = n.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  if (year) {
    const clause = n.split(/[,.;:]/).find((x) => x.includes(year[1])) || '';
    const small = clause.replace(year[1], '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6);
    const smallText = trimTail(small).join(' ').replace(/(in|of|on|by|the)$/i, '').trim();
    return { type: 'year', value: Number(year[1]), small: smallText };
  }
  const bc = n.match(/\b([0-9][0-9,]*)\s*(BC|BCE)\b/i);
  if (bc) return { type: 'number', value: Number(bc[1].replace(/,/g, '')), unit: 'BC', small: cardWords(l) };
  const num = n.match(/\b([0-9][0-9,]{0,9})\s+(meters?|metres?|years?|tons?|tonnes?|feet|kilometers?|miles?|statues?|blocks?|pieces?|days?|men|workers|countries)\b/i);
  if (num) return { type: 'number', value: Number(num[1].replace(/,/g, '')), unit: num[2].toUpperCase(), small: '' };
  return { type: 'phrase', text: cardWords(l) };
}

// ── start over where needed ─────────────────────────────────────────
// lines the last review said show the wrong picture lose that picture, and it is banned for this episode
const reviewAt = (() => { const i = process.argv.indexOf('--review'); return i > 0 ? process.argv[i + 1] : ''; })();
let rejected = 0;
if (reviewAt && fs.existsSync(reviewAt)) {
  const rev = JSON.parse(fs.readFileSync(reviewAt, 'utf8'));
  for (const r of rev.lines || []) {
    const l = lines[r.n - 1];
    if (!l || r.fits !== 'no') continue;
    for (const p of l.pictures || []) banned.add(p);
    if (l.clip?.page) banned.add(l.clip.page);
    if (l.clip?.prep) banned.add(l.clip.url);
    if ((l.pictures || []).length || l.clip?.page) rejected++;
    l.pictures = [];
    if (l.clip?.page || l.clip?.prep) delete l.clip;
  }
  script.banned = [...banned];
  // a line the voice does not match is re-rendered with the exact same words every time and fails the exact same way:
  // rewrite it in plainer, easy-to-pronounce spoken English (keeping the same meaning) so the next voice actually matches
  const bad = (rev.lines || []).filter((r) => lines[r.n - 1] && (r.heard === undefined || (r.missing || []).length >= 4 || (r.extra || []).length >= 4));
  // teaches every future episode at once: a word Whisper could not match, that looks like an unusual (Egyptological or
  // transliterated) term rather than an ordinary word Whisper simply misheard, is remembered so the review stops
  // failing lines over it at all — never on just one episode
  const hardFile = path.join(CONTENT, 'youtube', 'hard-words.json');
  const known = (() => { try { return JSON.parse(fs.readFileSync(hardFile, 'utf8')).words; } catch { return []; } })();
  const common = /^(their|there|which|would|should|could|about|through|before|after|because|these|those|where|while|every|still|being|between|people|years|world|great|first|never|again|around|other|among|within|across)$/;
  const candidates = [...new Set((rev.lines || []).flatMap((r) => r.missing || []))].filter((w) => w.length > 5 && /^[a-z']+$/.test(w) && !common.test(w));
  const learned = [...new Set([...known, ...candidates])];
  if (learned.length > known.length) { fs.mkdirSync(path.dirname(hardFile), { recursive: true }); fs.writeFileSync(hardFile, JSON.stringify({ words: learned.sort() }, null, 2) + '\n'); log(`learned ${learned.length - known.length} hard word(s) for every future episode: ${candidates.filter((w) => !known.includes(w)).join(', ')}`); }
  if (bad.length) {
    const fix = await askJson(`A text-to-speech voice could not clearly match these spoken lines to their written words (hard names, foreign spellings, or awkward phrasing).
Rewrite each line in plain, natural spoken American English a voice reads cleanly: same meaning and facts, same rough length, but avoid foreign
transliterated spellings, hyphenated names and tongue-twisting phrasing; spell a hard name the simple common way or describe it instead if needed.
Return JSON {"lines": [{"n": number, "en": "the rewritten line"}]}
LINES: ${JSON.stringify(bad.map((r) => ({ n: r.n, en: lines[r.n - 1].en, heard: r.heard })))}`, { temperature: 0.3 });
    let fixed = 0;
    for (const f of fix?.lines || []) { const l = lines[f.n - 1]; if (l && f.en) { l.en = f.en; delete l.ar; fixed++; } }
    log(`rewrote ${fixed} of ${bad.length} lines the voice could not match`);
  }
}
// clips this tool made on an earlier run are planned again, so a better rule applies to them too
let cleared = 0;
for (const l of lines) if (l.clip && (l.clip.gapfill || ['ZALA VIP', 'Pixabay Content License'].includes(l.clip.license))) { delete l.clip; cleared++; }
log(`replanned ${cleared} earlier clips, removed ${rejected} pictures the review rejected`);

// shots made in preparation (prep.mjs + flow-runner.mjs: Google Flow) go on their lines first, labelled as reconstructions
let fromPrep = 0;
try {
  // the shot list comes from prep.mjs, the finished videos from flow-runner.mjs (prep/<id>.flow.json)
  const made = JSON.parse(fs.readFileSync(path.join(BASE, 'prep', `${id}.flow.json`), 'utf8')).shots || [];
  for (const sh of made) {
    const l = lines.find((x) => x.en === sh.line) || lines[sh.n - 1];
    if (!l || !sh.url || banned.has(sh.url)) continue;
    if (/\.(jpe?g|png|webp)$/i.test(sh.url)) {
      // a Nano Banana still joins the library as a reconstruction picture; Meta may give it a slow camera move
      const pid = `nb-${hash(sh.url)}`;
      if (banned.has(pid)) continue;
      if (!byId.has(pid)) {
        const item = { id: pid, kind: 'image', title: 'Artistic reconstruction', url: sh.url, source: 'ZALA VIP', source_url: '', author: 'ZALA VIP',
          license: 'AI reconstruction (Google Nano Banana)', recon: true, topics: [id], seen: { usable: true, wide: true, what: sh.line, subject: 'reconstruction', check: { kind: 'reconstruction' } } };
        items.push(item); byId.set(pid, item);
      }
      delete l.clip;
      l.pictures = [pid];
      fromPrep++;
      continue;
    }
    l.clip = { url: sh.url, what: sh.kind || 'reconstruction', credit: 'AI reconstruction made with Google Flow', license: 'AI reconstruction (ZALA VIP)', recon: true, prep: true };
    l.pictures = [];
    fromPrep++;
  }
} catch { /* not prepared */ }
log(`prepared Flow shots placed: ${fromPrep}`);

// ── fill ─────────────────────────────────────────────────────────────
// the opening of a short decides if people stop scrolling: its first line prefers a sharp, rich, golden photograph or
// a reconstruction, never an old drawing, scan or black-and-white plate (owner rule: a professional opening frame)
const openingBoost = (l, p) => (!script.verticalOnly || l !== lines[0]) ? 0
  : (p.shine ? 3 : 0) + (p.recon ? 2 : 0) + (/photo/i.test(p.seen?.type || '') ? 2 : 0)
    - (/drawing|engraving|sketch|lithograph|scan|plate|black.and.white|line art|diagram|map/i.test(`${p.seen?.type || ''} ${p.seen?.what || ''} ${p.title || ''}`) ? 8 : 0);
const empty = lines.filter((l) => !(l.pictures || []).length && !l.map && !l.clip);
log(`${id}: ${empty.length} of ${lines.length} lines have nothing to show`);
const scenes = [];
let fromLibrary = 0, fromCrops = 0, fromVideo = 0;
for (const l of empty) {
  const ranked = clean.filter((p) => !banned.has(p.id)).map((p) => [p, score(l.en, p)]).filter(([, s]) => s >= 4).map(([p, s]) => [p, s + openingBoost(l, p)]).sort((a, b) => b[1] - a[1]);
  const fresh = ranked.find(([p]) => (uses.get(p.id) || 0) < 2);
  if (fresh) {
    l.pictures = [fresh[0].id];
    if (dry) log(`  ${l.en.slice(0, 70)}
      -> ${fresh[0].seen.what.slice(0, 90)} (${fresh[1]})`);
    uses.set(fresh[0].id, (uses.get(fresh[0].id) || 0) + 1);
    fromLibrary++;
    continue;
  }
  if (ranked.length) {
    const p = ranked[0][0];
    const n = uses.get(p.id) || 0;
    const c = n < 5 && await cropOf(p, n);
    if (c) { l.pictures = [c.id]; uses.set(p.id, n + 1); fromCrops++; continue; }
  }
  const clip = await pixabayClip(l.en);
  if (clip) { l.clip = clip; fromVideo++; continue; }
  // the title scene plays over a real picture from the same chapter, blurred and dark, so it never claims to show the line
  const near = chapterOf.get(l).lines.flatMap((x) => x.pictures || []).filter((x) => !banned.has(x)).map((x) => byId.get(x)).filter((p) => p && !/portrait|person|man |woman/i.test(p.seen.what || ''));
  const bg = near.length ? near[scenes.length % near.length] : clean.find((p) => TOPIC.test(textOf(p)));
  const s = { name: `${id}-${hash(l.en)}`, style: scenes.length % 3, ...sceneFor(l), bgUrl: bg?.url || '' };
  scenes.push(s);
  l.clip = { scene: s.name };
}
log(`library ${fromLibrary}, close-ups ${fromCrops}, landscape video ${fromVideo}, title scenes ${scenes.length}`);

if (scenes.length) {
  const dir = path.join(TMP, 'gapfill', id, 'scenes');
  fs.mkdirSync(dir, { recursive: true });
  const spec = path.join(dir, 'scenes.json');
  fs.writeFileSync(spec, JSON.stringify(scenes, null, 2));
  if (!dry) {
    for (const sc of scenes.filter((x) => x.bgUrl)) {
      try {
        const res = await fetch(sc.bgUrl, { headers: { 'User-Agent': 'ZalaRender/1.0 (https://www.zalavip.com)' }, signal: AbortSignal.timeout(60000) });
        const raw = path.join(dir, `${sc.name}.raw`);
        fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
        sc.bg = path.join(dir, `${sc.name}.bg.jpg`);
        execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf',
          'scale=2112:1188:force_original_aspect_ratio=increase,crop=2112:1188,gblur=sigma=6,eq=brightness=-0.22:saturation=0.75', '-q:v', '3', sc.bg]);
      } catch { delete sc.bg; }
    }
    fs.writeFileSync(spec, JSON.stringify(scenes, null, 2));
    const py = process.env.MANIM_PY || 'python3';
    const r = spawnSync(py, [path.join(ROOT, 'tools', 'gapfill_scenes.py'), spec, dir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('Manim could not draw the title scenes');
  }
  for (const l of lines.filter((x) => x.clip?.scene)) {
    const file = path.join(dir, `${l.clip.scene}.mp4`);
    if (!dry && !fs.existsSync(file)) throw new Error(`scene missing: ${l.clip.scene}`);
    l.clip = { url: upload(file, `vault/gapfill/${id}/${path.basename(file)}`, 'video/mp4'), page: 'https://www.zalavip.com', credit: '', license: 'ZALA VIP', what: 'title scene', gapfill: true };
  }
}

// lines at the top of the screen: the quality check wants about 1.5 a minute
const minutes = lines.reduce((n, l) => n + String(l.en).split(/\s+/).length, 0) / 150;
const want = Math.ceil(minutes * 1.7) + 2;   // narration is slower than 150 words a minute
const TEASERS = ['KEEP WATCHING', 'WATCH WHAT HAPPENS NEXT', 'STAY UNTIL THE END', 'THE BEST PART IS COMING', 'WAIT FOR IT', 'DO NOT LOOK AWAY'];
script.teasers ||= [];
for (let i = 3, k = 0; script.teasers.length < want && i < lines.length - 3; i += 1) {
  if (script.teasers.some((t) => Math.abs(t.line - i) < 3)) continue;
  script.teasers.push({ line: i, text: TEASERS[k++ % TEASERS.length] });
}
script.teasers.sort((a, b) => a.line - b.line);
log(`lines at the top: ${script.teasers.length} (wanted ${want})`);

// music: the review wants licensed tracks; a story with no list gets three Kevin MacLeod (CC BY) tracks across its chapters
if (!script.music?.length) {
  const SETS = [['Curse of the Scarab', 'Lightless Dawn', 'Crypto'], ['Desert City', 'Lightless Dawn', 'Curse of the Scarab'], ['Crypto', 'Curse of the Scarab', 'Lightless Dawn']];
  const set = SETS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % SETS.length];
  const nCh = script.chapters.length;
  script.music = [0, Math.floor(nCh / 2), nCh - 1].filter((c, i, a) => a.indexOf(c) === i).map((chapter, i) => ({ chapter, track: set[i] }));
  log(`music: ${script.music.map((m) => m.track).join(', ')}`);
}

script.gapfilled = { at: new Date().toISOString(), library: fromLibrary, crops: fromCrops, video: fromVideo, scenes: scenes.length };
if (!dry) {
  fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n', 'utf8');
  fs.writeFileSync(itemsFile, items.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  fs.rmSync(path.join(BASE, 'youtube', `${id}.shots.json`), { force: true });
}
log('done');
