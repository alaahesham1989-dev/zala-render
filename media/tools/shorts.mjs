#!/usr/bin/env node
// Standalone shorts: each one its own topic, made from scratch as a short (not cut from an episode).
// Three kinds in turn: a mystery or shocking question, strange daily life, and a place from the ZALA Guide map.
//   node media/tools/shorts.mjs plan <count>      writes the day's short scripts, prints SHORT_IDS:<ids>
//   node media/tools/shorts.mjs package <id>      writes the publish package for a rendered short
//   node media/tools/shorts.mjs schedule <id>     YouTube (private with a publish time) + Facebook/Instagram queue
// State: content/shorts-state.json (topics already made, so nothing repeats).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { askJson } from './gemini-lite.mjs';
import { addVideo } from './atlas-link.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const CONTENT = path.join(REPO, 'content');
const STATE = path.join(CONTENT, 'shorts-state.json');
const log = (...a) => console.log('[shorts]', ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const state = readJson(STATE, { made: [] });
const UA = { 'User-Agent': 'ZALA-VIP-shorts/1.0 (https://www.zalavip.com)' };
const [cmd, arg] = process.argv.slice(2);

async function wikiText(queries) {
  const titles = [];
  for (const q of queries.slice(0, 4)) {
    try { const r = await (await fetch(`https://en.wikipedia.org/w/api.php?format=json&action=query&list=search&srlimit=2&srsearch=${encodeURIComponent(q)}`, { headers: UA })).json(); for (const s of r.query.search) if (!titles.includes(s.title)) titles.push(s.title); } catch { /* next */ }
  }
  let text = '';
  for (const t of titles.slice(0, 4)) {
    try { const p = await (await fetch(`https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(t)}`, { headers: UA })).json(); text += `\n\n== ${t} ==\n${(Object.values(p.query.pages)[0]?.extract || '').slice(0, 8000)}`; } catch { /* skip */ }
  }
  return text;
}

const SHORT_RULES = `Write ONE standalone YouTube Short / Reel about ancient Egypt for American viewers (45 to 55 seconds spoken, 6 to 8 lines, about 120 to 140 words).
Line 1 is a shocking question or claim that stops the scroll. Then the surprising facts, building up. The last line pays off and ends with a short teaser that makes people want more (no "subscribe", no links).
Use ONLY the facts in the text below; never invent names, dates or numbers. Plain, vivid spoken American English. Each line one or two short sentences.
For each line give 2 short picture search queries (museum objects, places, art) that would really show it.
Return JSON {"title": "the Short's title, a question or shocking claim, max 60 characters", "hook": "3 to 6 words shown big in the first second",
"badge": "1 to 3 words", "sub": "one short sentence about the subject", "thumbnailText": "2 to 4 words",
"lines": [{"en": "", "queries": ["", ""]}], "tags": ["5 tags"], "queries": ["6 picture search queries for the whole short"]}`;

// the 5th short: an ad for ZALA VIP, told like a story, never with a price or a promise the company does not make
const PROMO_FACTS = `ZALA VIP (zalavip.com) is a luxury concierge in Egypt.
Cairo Airport VIP and fast-track service: a ZALA VIP host meets you on arrival and takes you quickly through the airport.
Private limousines with chauffeurs in Cairo and Giza, and transfers between Egyptian cities.
Private trips in Egypt: the Giza pyramids, museums, old Cairo and more.
Hand-picked hotels in Cairo and Giza.
ZALA Guide: a free audio map on zalavip.com/guide with more than 300 places in Egypt, each with its story narrated.
Requests are answered on WhatsApp and through the website, in English and Arabic.`;
const PROMO_RULES = `Write ONE vertical ad (45 to 50 seconds spoken, 6 to 7 lines, about 110 words) for ZALA VIP for American travellers, told like a short story, not like a sales pitch.
Line 1 is a hook question a traveller feels (landing in Cairo for the first time, the chaos, the queues). Then show how ZALA VIP makes Egypt easy and luxurious.
The last line invites them to plan their trip on zalavip.com. Use ONLY the facts below; no prices, no discounts, no promises that are not in the text.
For each line give 2 picture search queries (Cairo airport, Giza pyramids, luxury car, Nile, hotel, Egyptian museum).
Return JSON {"title": "max 60 characters", "hook": "3 to 6 words", "badge": "ZALA VIP", "sub": "one short sentence", "thumbnailText": "2 to 4 words",
"lines": [{"en": "", "queries": ["", ""]}], "tags": ["5 tags"], "queries": ["6 picture search queries"]}`;

async function plan(count) {
  const kinds = ['mystery', 'daily', 'place'];
  // the ZALA Guide map's places (zalavip.com/guide): ancient sites first, then museums, Coptic and Islamic Cairo, nature
  const SITE = 'https://www.zalavip.com';
  const atlas = await fetch(`${SITE}/atlas-places.json`, { headers: UA }).then((r) => r.json()).catch(() => []);
  const order = ['ancient', 'museum', 'coptic', 'islamic', 'nature', 'desert', 'nile', 'historic'];
  const places = (Array.isArray(atlas) ? atlas : atlas.places || []).filter((p) => order.includes(p.category) && !state.made.some((m) => m.place === p.slug))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || (a.rank || 99) - (b.rank || 99))
    .map((p) => ({ slug: p.slug, name: p.name?.en || p.slug, lat: p.lat, lng: p.lng, summary: p.summary?.en || '' }));
  for (const p of places.slice(0, 3)) {
    const d = await fetch(`${SITE}/atlas-details/${p.slug}.json`, { headers: UA }).then((r) => r.json()).catch(() => ({}));
    p.text = [p.summary, d.history?.en, ...(d.facts || []).map((f) => f.en)].filter(Boolean).join('\n');
  }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const ids = [];
  for (let n = 0; n < count; n++) {
    // owner's order: after every 4 shorts, the 5th is an ad for ZALA VIP itself
    const sincePromo = state.made.length - 1 - state.made.map((m) => m.kind).lastIndexOf('promo');
    const kind = sincePromo >= 4 ? 'promo' : kinds[state.made.filter((m) => m.kind !== 'promo').length % kinds.length];
    const id = `ZV-S${day}${n + 1}`;
    let facts = '', topic = '', place = null;
    if (kind === 'promo') {
      topic = 'ZALA VIP, luxury travel in Egypt';
      facts = PROMO_FACTS;
    } else if (kind === 'place') {
      place = (Array.isArray(places) ? places : []).find((p) => !state.made.some((m) => m.place === p.slug));
      if (!place) continue;
      topic = place.name;
      facts = `${place.text}\n\n${await wikiText([topic])}`;
    } else {
      const done = state.made.map((m) => m.title).slice(-120);
      const idea = await askJson(`Suggest ONE ${kind === 'mystery' ? 'ancient Egypt mystery or shocking question that Americans would click (treasure, tombs, curses, lost things, strange discoveries)' : 'strange fact about daily life in ancient Egypt that feels close to people today (food, beer, work, strikes, marriage, women rights, medicine, teeth, makeup, pets, toilets, heat, children)'}.
It must be different from these Shorts we already made: ${JSON.stringify(done)}.
Return JSON {"topic": "", "queries": ["3 Wikipedia search queries"]}`, { temperature: 0.9 });
      if (!idea?.topic) continue;
      topic = idea.topic;
      facts = await wikiText(idea.queries || [topic]);
    }
    if (facts.length < 800) { log(`${id}: not enough facts for "${topic}"`); continue; }
    const s = await askJson(`${kind === 'promo' ? PROMO_RULES : SHORT_RULES}\nTopic: ${topic}\nTEXT:\n${facts.slice(0, 30000)}`, { temperature: 0.7 });
    if (!s?.lines?.length || s.lines.length < 5) { log(`${id}: no script`); continue; }
    // the editor: every line must be supported by the text
    const check = await askJson(`Check this Short against the text. List the lines (1-based) that say anything the text does not support. Return JSON {"bad": [numbers]}\nSHORT: ${JSON.stringify(s.lines.map((l) => l.en))}\nTEXT:\n${facts.slice(0, 30000)}`, { temperature: 0 });
    if (!check) { log(`${id}: the editor gave no answer`); continue; }
    // a line the facts do not support is dropped (never the whole short), as long as 5 good lines stay
    if ((check.bad || []).length) {
      const keep = s.lines.filter((_, i) => !check.bad.includes(i + 1));
      log(`${id}: the editor dropped lines ${JSON.stringify(check.bad)}`);
      if (keep.length < 5) continue;
      s.lines = keep;
    }
    const script = {
      id, series: 'ZALA VIP Shorts', verticalOnly: true, kind, title: s.title, thumbnailText: s.thumbnailText, description: s.sub, tags: s.tags || [],
      chapters: [{ title: s.title, lines: s.lines.map((l, i) => ({ en: l.en, ...(i === 0 && place ? { map: place.name } : {}) })) }],
      reels: [{ chapter: 1, from: 0, title: s.title, hook: s.hook, badge: s.badge, sub: s.sub }],
      prepared: { at: new Date().toISOString(), shots: 0, kind },
    };
    fs.writeFileSync(path.join(CONTENT, 'youtube', `${id}.json`), JSON.stringify(script, null, 2) + '\n');
    // a small picture library just for this short (library_build.py reads content/library/treasures.json)
    const specFile = path.join(CONTENT, 'library', 'treasures.json');
    const specs = readJson(specFile, {});
    specs[id] = { title: s.title, hook: s.hook, seconds: 55, match: topic.split(/\s+/).filter((w) => w.length > 3).join('|') || topic, archive: topic, queries: [...new Set([...(s.queries || []), ...s.lines.flatMap((l) => l.queries || [])])].slice(0, 10) };
    fs.writeFileSync(specFile, JSON.stringify(specs, null, 2) + '\n');
    // a place from the ZALA Guide map: the first line flies down onto it (Mapbox)
    if (place?.lat && place?.lng) {
      const pf = path.join(CONTENT, 'library', 'places.json');
      const ps = readJson(pf, []);
      if (!ps.some((p) => p.name === place.name)) ps.push({ name: place.name, match: place.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), lat: place.lat, lng: place.lng, zoom: 15 });
      fs.writeFileSync(pf, JSON.stringify(ps) + '\n');
    }
    state.made.push({ id, kind, title: s.title, topic, ...(place ? { place: place.slug } : {}), at: new Date().toISOString() });
    ids.push(id);
    log(`${id} (${kind}): "${s.title}" — ${s.lines.length} lines`);
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  console.log(`SHORT_IDS:${ids.join(' ')}`);
}

function packageOf(id) {
  const script = readJson(path.join(CONTENT, 'youtube', `${id}.json`), null);
  const dir = path.join(REPO, 'media', 'out', id, 'publish');
  if (!script || !fs.existsSync(path.join(dir, `${id}.mp4`))) throw new Error(`${id} is not rendered`);
  const pkg = { id, title: script.title, description: script.description, tags: script.tags, reels: [{ id: `${id}-R1`, file: `${id}.mp4`, title: script.title, sub: script.description }] };
  fs.writeFileSync(path.join(dir, `${id}.youtube.json`), JSON.stringify(pkg, null, 2));
  log(`package ${id}`);
}

// three daily slots for standalone shorts, between the 16:00 UTC episode slot: 13:00, 19:00 and 23:30 UTC
// (morning, afternoon and evening in the USA); each short takes the next free slot
function schedule(id) {
  const queueFile = path.join(REPO, 'content', 'meta-queue.json');
  const queue = readJson(queueFile, []);
  if (queue.some((q) => q.episode === id)) { log(`${id} scheduled already`); return; }
  const slots = ['13:00', '19:00', '23:30'];
  const taken = new Set(queue.map((q) => q.at));
  let when = null;
  for (let d = 1; d < 60 && !when; d++) {
    const date = new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
    for (const s of slots) { const t = `${date}T${s}:00Z`; if (!taken.has(t)) { when = t; break; } }
  }
  const dir = path.join(REPO, 'media', 'out', id, 'publish');
  const r = spawnSync(process.execPath, [path.join(REPO, 'media', 'tools', 'youtube-upload.mjs'), dir, id, 'R1', '--privacy', 'private', '--publish-at', when], { encoding: 'utf8' });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT:'));
  if (r.status !== 0 || !line) throw new Error(`YouTube upload of ${id} failed: ${(r.stderr || r.stdout || '').slice(-300)}`);
  queue.push({ episode: id, which: 'R1', to: ['fb', 'ig'], at: when, done: false });
  fs.writeFileSync(queueFile, JSON.stringify(queue, null, 2) + '\n');
  const url = JSON.parse(line.slice(7)).url || '';
  log(`${id} at ${when}: ${url}`);
  // a place short shows on its place on the ZALA Guide map from its publish time
  const made = state.made.find((m) => m.id === id);
  if (made?.place && url) addVideo(made.place, { url, title: made.title, kind: 'short', at: when, episode: id });
}

if (cmd === 'plan') await plan(Number(arg) || 3);
else if (cmd === 'package') packageOf(arg);
else if (cmd === 'schedule') schedule(arg);
else throw new Error('usage: plan <n> | package <id> | schedule <id>');
