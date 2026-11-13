#!/usr/bin/env node
// STAGE 1 — PREP for a ZALA VIRTUAL TOUR of one place on the ZALA Guide map (zalavip.com/atlas).
// A tour is a video that travels on the map from the airport to the place, lands on it, then walks the viewer through
// 3 to 4 stops, each with a small story or secret, a "how it looked" moment (labelled as a reconstruction) and visit tips.
// Two videos per place: the long tour (6 to 8 minutes, Saturday) and a short tour (45 to 55 s, a daily short slot).
//   - facts: the place's own page on the map (history, facts, visit tips) + Wikipedia; an editor drops any line they do not support
//   - the route: Mapbox Directions from the nearest airport (driving), or a flight line when it is far
//   - writes content/youtube/<id>.json (long, kind tour) and <id>S.json (short, kind tour-short), the picture library
//     entries (content/tour-specs.json, merged into treasures.json by the workflow) and the map place (places.json)
// The map flight itself is made by tour-flight.mjs; MAKE and QUALITY are the same files as every video (line/).
//   node media/tools/tour-prep.mjs next         the next place in line, prints TOUR_IDS:<long> <short>
//   node media/tools/tour-prep.mjs <slug>       a chosen place
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const CONTENT = path.join(REPO, 'content');
const SITE = 'https://www.zalavip.com';
const UA = { 'User-Agent': 'ZALA-VIP-tours/1.0 (https://www.zalavip.com)' };
const log = (...a) => console.log('[tour]', ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n'); };
const STATE = path.join(CONTENT, 'tours-state.json');
const state = readJson(STATE, { done: [], n: 0 });

// the best-known places first (Cairo and Giza, where ZALA VIP drives), then the rest of the map
const FIRST = ['giza-pyramids', 'grand-egyptian-museum', 'great-sphinx', 'egyptian-museum', 'step-pyramid-of-djoser', 'national-museum-of-egyptian-civilization',
  'cairo-citadel', 'khan-el-khalili', 'saqqara', 'red-pyramid', 'bent-pyramid', 'memphis-mit-rahina', 'hanging-church', 'sultan-hassan-mosque', 'al-azhar-mosque',
  'serapeum-of-saqqara', 'coptic-museum', 'karnak', 'luxor-temple', 'valley-of-the-kings', 'hatshepsut-temple', 'abu-simbel', 'philae', 'edfu-temple', 'kom-ombo',
  'dendera', 'abydos', 'qaitbay-citadel', 'bibliotheca-alexandrina', 'catacombs-of-kom-el-shoqafa', 'pompeys-pillar'];
const AIRPORTS = [
  { name: 'Cairo International Airport', lat: 30.1219, lng: 31.4056 },
  { name: 'Luxor International Airport', lat: 25.6710, lng: 32.7066 },
  { name: 'Aswan International Airport', lat: 23.9644, lng: 32.8200 },
  { name: 'Abu Simbel Airport', lat: 22.3760, lng: 31.6117 },
  { name: 'Borg El Arab Airport', lat: 30.9177, lng: 29.6964 },
  { name: 'Hurghada International Airport', lat: 27.1783, lng: 33.7994 },
  { name: 'Marsa Alam International Airport', lat: 25.5571, lng: 34.5837 },
  { name: 'Sharm El Sheikh International Airport', lat: 27.9773, lng: 34.3950 },
];
const CAIRO_CITY = { name: 'your hotel in Cairo', lat: 30.0444, lng: 31.2357 };
const km = (a, b) => { const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371; };

async function wikiText(q) {
  try {
    const sr = await (await fetch(`https://en.wikipedia.org/w/api.php?format=json&action=query&list=search&srlimit=2&srsearch=${encodeURIComponent(q)}`, { headers: UA })).json();
    let text = '';
    for (const s of sr.query.search.slice(0, 2)) {
      const p = await (await fetch(`https://en.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(s.title)}`, { headers: UA })).json();
      text += `\n\n== ${s.title} ==\n${(Object.values(p.query.pages)[0]?.extract || '').slice(0, 12000)}`;
    }
    return text;
  } catch { return ''; }
}

async function drive(a, b) {
  const token = process.env.MAPBOX_TOKEN;
  try {
    const r = await (await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${a.lng},${a.lat};${b.lng},${b.lat}?geometries=geojson&overview=full&access_token=${token}`)).json();
    const g = r.routes?.[0];
    if (g) return { km: Math.round(g.distance / 1000), minutes: Math.round(g.duration / 60), line: g.geometry.coordinates };
  } catch { /* straight line below */ }
  return { km: Math.round(km(a, b) * 1.3), minutes: Math.round(km(a, b) * 1.3), line: [[a.lng, a.lat], [b.lng, b.lat]] };
}

/** The way a real visitor gets there, as legs the map flight follows and the script describes:
 *  - Cairo and Giza: ZALA VIP's limousine straight from Cairo airport
 *  - within about 300 km by road and no closer airport (Alexandria, Faiyum, Minya): ZALA VIP's intercity limousine from Cairo
 *  - far (Luxor, Aswan, Abu Simbel, the Red Sea): a domestic flight from Cairo to the nearest airport, then a short drive */
async function route(place) {
  const cairo = AIRPORTS[0];
  const near = AIRPORTS.map((a) => ({ ...a, d: km(a, place) })).sort((a, b) => a.d - b.d)[0];
  const dCairo = km(cairo, place);
  if (dCairo < 70) {
    const d = await drive(cairo, place);
    return { mode: 'drive', summary: `ZALA VIP's limousine from ${cairo.name}: ${d.km} km, about ${d.minutes} minutes by car`, legs: [{ mode: 'drive', from: cairo.name, ...d }] };
  }
  if (dCairo < 300 && (near.name === cairo.name || near.d > 60)) {
    const d = await drive(CAIRO_CITY, place);
    return { mode: 'drive', summary: `ZALA VIP's intercity limousine from ${CAIRO_CITY.name}: ${d.km} km, about ${Math.round(d.minutes / 6) / 10} hours on the road`, legs: [{ mode: 'drive', from: 'Cairo', ...d }] };
  }
  const flyKm = Math.round(km(cairo, near));
  const flyMin = Math.round((flyKm / 650) * 60 + 25);   // a domestic jet with climb and landing, rounded in the script
  const d = await drive(near, place);
  return {
    mode: 'fly-drive',
    summary: `a domestic flight from ${cairo.name} to ${near.name} (about ${Math.max(1, Math.round(flyMin / 30) / 2)} hour${flyMin > 75 ? 's' : ''} in the air), then ${d.km} km, about ${d.minutes} minutes by car from the airport to the place`,
    legs: [{ mode: 'fly', from: cairo.name, to: near.name, km: flyKm, minutes: flyMin, line: [[cairo.lng, cairo.lat], [near.lng, near.lat]] }, { mode: 'drive', from: near.name, ...d }],
  };
}

const TOUR_RULES = `You write a VIRTUAL TOUR for a YouTube channel about Egypt for American viewers. It is a guided walk with stories,
NOT a lecture: plain, vivid, spoken American English, second person ("you step through the gate..."), short sentences.
Shape:
- Chapter 1 "The journey": exactly 3 lines spoken while the camera follows the way on the map. Describe the trip EXACTLY as ROUTE says,
  the way a real traveller does it: you land at Cairo airport; for a far place you take the domestic flight, then the short drive; never
  suggest driving or walking hundreds of kilometers, never skip a leg. One of the 3 lines is a hook question about the place.
  Mark these lines "flight": true.
- Chapters 2 to 5: one STOP each (an entrance, a hall, a hidden detail, a view). Each stop opens with where you are standing,
  then ONE story, secret or surprising fact about it, and ends with a short question that pulls the viewer to the next stop.
- One line in the tour may describe how a place looked when it was new; mark it "recon": true (it will be shown as an artistic reconstruction).
- Last chapter "Plan your visit": the best time to go and one practical tip from VISIT TIPS (no prices, no opening hours),
  then one line about ZALA VIP that matches ROUTE and is true: in Cairo and Giza its limousine drives you from the airport or your hotel;
  for Alexandria and other places on the road its intercity limousine takes you from Cairo; for far places ZALA VIP meets you at Cairo
  airport (VIP fast track) and plans the trip with you. Ask ZALA VIP on zalavip.com or WhatsApp. Never promise a car in a city far from Cairo.
HARD RULES: use ONLY facts in the TEXT. Never invent names, dates, numbers or quotes. Never say we filmed inside. Each line one or two
sentences, at most 30 words. Give each line 2 to 4 short English picture search "queries" for what it shows.`;

async function write(place, facts, way, kind) {
  const short = kind === 'tour-short';
  const len = short ? 'The SHORT tour: 7 lines in ONE chapter (45 to 55 seconds). Line 1 is a shocking question over the flight ("flight": true); then 2 stops in 4 lines, 1 line how it looked ("recon": true), last line: the full tour is on our channel.'
    : 'The LONG tour: about 950 spoken words, 40 to 46 lines in 5 to 6 chapters.';
  const s = await askJson(`${TOUR_RULES}\n${len}\nPLACE: ${place.name.en} (${place.governorate?.en || ''})\nROUTE: ${way.summary}
Return JSON {"title": "a tour title people click, max 60 characters, e.g. Inside the ... | Virtual Tour", "thumbnailText": "2 to 4 words",
"description": "two sentences", "tags": ["5 tags"], "hook": "3 to 6 words shown big at the start", "badge": "VIRTUAL TOUR",
"chapters": [{"title": "", "lines": [{"en": "", "flight": false, "recon": false, "queries": [""]}]}]}
TEXT:\n${facts.slice(0, 32000)}`, { temperature: 0.7 });
  const lines = s?.chapters?.flatMap((c) => c.lines || []) || [];
  if (lines.length < (short ? 5 : 20)) { log(`${kind}: no usable script (${lines.length} lines)`); return null; }
  // the editor: lines the text does not support are dropped, never the whole tour
  const check = await askJson(`Check this tour against the TEXT. List the line numbers (1-based) that say anything the TEXT does not support
(lines about the drive, the camera, "you step in", visit tips and the ZALA VIP line are fine). Return JSON {"bad": [numbers]}
LINES: ${JSON.stringify(lines.map((l) => l.en))}\nTEXT:\n${facts.slice(0, 32000)}`, { temperature: 0 });
  const bad = new Set(check?.bad || []);
  let n = 0;
  for (const c of s.chapters) c.lines = c.lines.filter(() => !bad.has(++n));
  s.chapters = s.chapters.filter((c) => c.lines.length);
  log(`${kind}: ${lines.length} lines, the editor dropped ${bad.size}`);
  return s;
}

async function prep(slug) {
  const atlas = await fetch(`${SITE}/atlas-places.json`, { headers: UA }).then((r) => r.json());
  const place = (Array.isArray(atlas) ? atlas : atlas.places).find((p) => p.slug === slug);
  if (!place) throw new Error(`${slug} is not on the map`);
  const d = await fetch(`${SITE}/atlas-details/${slug}.json`, { headers: UA }).then((r) => r.json()).catch(() => ({}));
  const facts = [`${place.name.en}: ${place.summary?.en || ''}`, d.history?.en, ...(d.facts || []).map((f) => f.en), d.visitTips?.en ? `VISIT TIPS: ${d.visitTips.en}` : '', await wikiText(`${place.name.en} Egypt`)].filter(Boolean).join('\n');
  if (facts.length < 1500) throw new Error(`${slug}: not enough facts for a tour`);
  const way = await route(place);
  log(`${place.name.en}: ${way.summary}`);
  const num = String(++state.n).padStart(2, '0');
  const ids = { long: `ZV-V${num}`, short: `ZV-V${num}S` };
  const specs = readJson(path.join(CONTENT, 'tour-specs.json'), {});
  for (const [k, id] of Object.entries(ids)) {
    const kind = k === 'long' ? 'tour' : 'tour-short';
    let s = null;
    for (let i = 0; i < 3 && !s; i++) s = await write(place, facts, way, kind);
    if (!s) throw new Error(`${id}: no tour script`);
    const flat = s.chapters.flatMap((c) => c.lines);
    flat.forEach((l, i) => { if (i === 0) l.map = place.name.en; if (!l.flight) delete l.flight; if (!l.recon) delete l.recon; });
    const script = {
      id, series: 'ZALA Virtual Tour', kind, place: slug, title: s.title, thumbnailText: s.thumbnailText, description: s.description, tags: s.tags || [],
      chapters: s.chapters.map((c) => ({ title: c.title, lines: c.lines.map(({ queries, ...l }) => l) })),
      route: { mode: way.mode, summary: way.summary, legs: way.legs, to: { lat: place.lat, lng: place.lng, name: place.name.en } },
      prepared: { at: new Date().toISOString(), kind },
      ...(k === 'short' ? { verticalOnly: true, reels: [{ chapter: 1, from: 0, title: s.title, hook: s.hook, badge: 'VIRTUAL TOUR', sub: s.description }] } : { noReels: true }),
    };
    writeJson(path.join(CONTENT, 'youtube', `${id}.json`), script);
    specs[id] = { title: s.title, hook: s.hook, seconds: k === 'long' ? 420 : 55, match: place.name.en.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3).join('|') || place.name.en,
      archive: place.name.en, queries: [...new Set(s.chapters.flatMap((c) => c.lines.flatMap((l) => l.queries || [])))].slice(0, 14) };
    log(`${id} (${kind}): "${s.title}", ${flat.length} lines`);
  }
  writeJson(path.join(CONTENT, 'tour-specs.json'), specs);
  // the map place for the Mapbox stills (the director flies down onto it)
  const pf = path.join(CONTENT, 'library', 'places.json');
  const ps = readJson(pf, []);
  if (!ps.some((p) => p.name === place.name.en)) { ps.push({ name: place.name.en, match: place.name.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), lat: place.lat, lng: place.lng, zoom: 16 }); writeJson(pf, ps); }
  state.done.push(slug);
  writeJson(STATE, state);
  console.log(`TOUR_IDS:${ids.long} ${ids.short}`);
}

const arg = process.argv[2];
if (!arg) throw new Error('usage: next | <place slug>');
let slug = arg;
if (arg === 'next') {
  const atlas = await fetch(`${SITE}/atlas-places.json`, { headers: UA }).then((r) => r.json());
  const all = (Array.isArray(atlas) ? atlas : atlas.places);
  const rest = all.filter((p) => ['ancient', 'museum', 'islamic', 'coptic', 'historic'].includes(p.category)).map((p) => p.slug);
  slug = [...FIRST, ...rest].find((s) => !state.done.includes(s) && all.some((p) => p.slug === s));
  if (!slug) { log('every place has its tour'); process.exit(0); }
}
await prep(slug);
