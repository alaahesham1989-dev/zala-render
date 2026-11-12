// Preparation before the render: everything an episode needs is made and checked first, so the factory finds it ready.
//   1. a fact bank from Wikipedia (the story may only use these facts)
//   2. the picture library is cleaned: stock photos that have nothing to do with the subject are taken out
//   3. the story is written from the facts, with real pictures where they truly show the line, and a list of
//      generated shots (Google Flow) for the moments no picture shows: the opening hook and reconstructions
//   4. a strict editor checks the story line by line; a story that fails is written again (up to 3 times)
//   5. the shot list goes to content/prep/<id>.json; flow-runner.mjs on the owner's computer makes the shots
// Usage: node media/tools/prep.mjs <episode id> [--force]   (runs on the server in prep.yml)
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const id = process.argv[2];
const force = process.argv.includes('--force');
if (!id) throw new Error('usage: node media/tools/prep.mjs <episode id>');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const CONTENT = path.join(REPO, 'content');
const log = (...a) => console.log('[prep]', ...a);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const spec = readJson(path.join(REPO, 'media', 'tools', 'treasures.json'), {})[id];
if (!spec) throw new Error(`${id} is not in media/tools/treasures.json`);
const scriptFile = path.join(CONTENT, 'youtube', `${id}.json`);
const prepFile = path.join(CONTENT, 'prep', `${id}.json`);
const factFile = path.join(CONTENT, 'factbank', `${id.toLowerCase()}-facts.json`);
const ITEMS = path.join(CONTENT, 'library', 'items.jsonl');
const UA = { 'User-Agent': 'ZALA-VIP-prep/1.0 (https://www.zalavip.com)' };

// ── 1. facts from Wikipedia ──────────────────────────────────────────
async function wiki(params) {
  const res = await fetch(`https://en.wikipedia.org/w/api.php?format=json&origin=*&${new URLSearchParams(params)}`, { headers: UA, signal: AbortSignal.timeout(30000) });
  return res.json();
}
async function factBank() {
  const old = readJson(factFile, null);
  if (old?.facts?.length >= 25 && !force) { log(`facts: ${old.facts.length} already`); await addPlaces((old.sources || []).map((x) => decodeURIComponent(String(x.url || '').split('/wiki/')[1] || '').replace(/_/g, ' ')).filter(Boolean)); return old; }
  const titles = [];
  for (const q of spec.queries.slice(0, 8)) {
    try { for (const r of (await wiki({ action: 'query', list: 'search', srsearch: q, srlimit: 2 })).query.search) if (!titles.includes(r.title)) titles.push(r.title); } catch { /* next search */ }
  }
  let text = '';
  for (const t of titles.slice(0, 8)) {
    try {
      const pages = (await wiki({ action: 'query', prop: 'extracts', explaintext: 1, titles: t })).query.pages;
      const body = Object.values(pages)[0]?.extract || '';
      text += `\n\n=== ${t} (https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}) ===\n${body.slice(0, 14000)}`;
    } catch { /* skip page */ }
  }
  log(`facts: ${titles.length} Wikipedia pages: ${titles.join(' | ')}`);
  await addPlaces(titles);
  const bank = await askJson(`Build a fact bank for a history video titled "${spec.title}". Use ONLY the Wikipedia text below; never add anything from memory.
Return JSON {"topic": "${spec.title}", "summary": "4 sentences", "facts": ["40 to 70 short facts, each one sentence with its names, dates, numbers and places exactly as in the text, focused on the treasure, the people, the discovery and why it matters"],
"common_myths": ["claims the text says are wrong or disputed"], "sources": [{"title": "", "url": ""}]}
TEXT:${text.slice(0, 90000)}`, { temperature: 0.1 });
  if (!bank?.facts?.length) throw new Error('Gemini gave no fact bank');
  fs.mkdirSync(path.dirname(factFile), { recursive: true });
  fs.writeFileSync(factFile, JSON.stringify(bank, null, 2) + '\n');
  log(`facts: ${bank.facts.length} facts saved`);
  return bank;
}

// Mapbox aerial shots: every place of the story with Wikipedia coordinates in Egypt joins content/library/places.json,
// so the director gives its first mention a satellite fly-in (wide view, then a zoom down onto the site).
async function addPlaces(titles) {
  const file = path.join(CONTENT, 'library', 'places.json');
  const places = readJson(file, []);
  let added = 0;
  try {
    const pages = (await wiki({ action: 'query', prop: 'coordinates', titles: titles.join('|') })).query.pages;
    for (const pg of Object.values(pages)) {
      const c = pg.coordinates?.[0];
      if (!c || c.lat < 21.5 || c.lat > 32 || c.lon < 24.5 || c.lon > 37) continue;   // Egypt only (a statue's page points at its museum abroad)
      const name = pg.title.replace(/\s*\(.*\)$/, '');
      if (places.some((p) => p.name.toLowerCase() === name.toLowerCase())) continue;
      places.push({ name, match: `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, lat: Math.round(c.lat * 1e4) / 1e4, lng: Math.round(c.lon * 1e4) / 1e4, zoom: 14 });
      added++;
    }
  } catch (e) { log(`places: ${e.message}`); }
  if (added) fs.writeFileSync(file, JSON.stringify(places) + '\n');
  log(`places: ${added} new aerial places (${places.length} in all)`);
}

// ── 2. clean the picture library ─────────────────────────────────────
async function cleanLibrary() {
  const all = fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const mine = all.filter((i) => i.kind === 'image' && i.seen?.usable && (i.topics || []).includes(id) && !i.seen.onTopic);
  let out = 0;
  for (let k = 0; k < mine.length; k += 80) {
    const batch = mine.slice(k, k + 80);
    const ans = await askJson(`A history video about: "${spec.title}" (ancient Egypt). Below are pictures from a stock search, as id | title or tags | what is visible.
Keep a picture only if it really shows something that belongs in this story: ancient Egyptian objects, jewellery, masks, coffins, statues, tombs, temples, ruins, hieroglyphs, the Egyptian landscape, the excavation or its archaeologists, or Egyptian art in a museum.
Drop everything else: animals, fish, cars, planes, money, suitcases, Halloween or fantasy art, European churches or cities, modern people, food, wallpapers.
Return JSON {"drop": ["ids to drop"]}
${batch.map((i) => [i.id, String(i.title).slice(0, 100), String(i.seen.what).slice(0, 120)].join(' | ')).join('\n')}`, { temperature: 0 });
    if (!ans || !Array.isArray(ans.drop)) throw new Error('Gemini did not check the pictures');
    const drop = new Set(ans.drop);
    for (const i of batch) {
      if (drop.has(i.id)) { i.seen.usable = false; i.seen.offTopic = id; out++; } else i.seen.onTopic = true;
    }
  }
  fs.writeFileSync(ITEMS, all.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  const left = all.filter((i) => i.kind === 'image' && i.seen?.usable && (i.topics || []).includes(id));
  log(`library: ${out} unrelated pictures taken out, ${left.length} left`);
  return left;
}

// ── 3 + 4. the story and its editor ──────────────────────────────────
const SHOT_RULES = `How to write a Flow prompt (a video model that draws whatever nouns it reads):
- Describe only what is in the frame and how the view moves. Never name filming equipment (no drone, crane, dolly, tripod, rig, camera operator), not even to say "no drone": describe the path instead (a slow rise while gliding forward, a smooth arc around the object at a fixed distance).
- The movement is already under way before the clip starts; the first frame is the middle of the move, never a pause. The fastest part of the move is in the first third.
- One fixed lens, no zoom: things get bigger because the view travels closer.
- Every shot reveals something by its end (the mask comes out of the dark, the burial chamber opens up behind a doorway).
- Light: torches, oil lamps, sunlight through dust; warm gold against deep shadow. Ancient Egyptian look of the right period, real materials (gold, silver, lapis, carnelian, limestone).
- End with one sentence of failures: "It fails if any text, logo, modern object or modern person appears, if faces or hieroglyphs melt or change, or if the view stops moving."
- 8 seconds, one continuous shot, no cuts.`;

const STORY_RULES = `You write for a YouTube channel that tells gripping true stories about ancient Egypt to American viewers. Storytelling, not a lecture: open with a hook, build suspense, follow people and what they wanted, end each chapter on a question. Plain, vivid spoken American English.
HARD RULES:
1. Every fact comes from the FACT BANK. Never invent names, dates, numbers, quotes or events. Disputed claims are said as disputed. Never repeat a myth as fact.
2. Every line is about this subject. Never describe a picture that does not belong to the story, never use a picture as a metaphor (no "like a Halloween night", "like fish swimming").
3. Pictures: give a line 1 to 3 picture ids from the PICTURE CATALOG only when those pictures really show what the line says. A picture at most twice in the episode.
4. When no picture shows an important moment, give the line "gen" instead of pictures: {"kind": "hook" | "reconstruction", "prompt": "a Flow prompt"}. The FIRST line of the episode always has a gen hook. Use gen on 4 to 6 lines in total, for the strongest moments (the discovery, the sealed chamber, the mask in torchlight, the burial). Lines with neither pictures nor gen are allowed but rare.
5. Each line is one or two spoken sentences, at most 34 words. Write "ar", a natural Arabic translation, for internal review only.
${SHOT_RULES}
Return only JSON:
{"title":"","thumbnailText":"max 3 words","description":"2-3 hook sentences","tags":[""],"outroNext":"","thumbnailShot":"1.1","sources":[{"url":""}],
"chapters":[{"title":"","lines":[{"en":"","ar":"","pictures":["id"],"gen":{"kind":"","prompt":""},"callout":{"big":"short","small":"short"},"sfx":"impact|hit|whoosh|riser|shimmer"}]}],
"reels":[{"chapter":1,"title":"","badge":"","hook":"max 5 words","sub":"one short sentence about the subject"}]}
callout and sfx are optional and rare. Exactly 3 reels, each from a chapter that stands alone. 5 to 7 chapters.`;

const spoken = (s) => (s.chapters || []).flatMap((c) => c.lines || []).reduce((n, l) => n + String(l.en || '').split(/\s+/).filter(Boolean).length, 0);

async function editor(story, bank, pics) {
  const byId = new Map(pics.map((p) => [p.id, p]));
  const lines = story.chapters.flatMap((c) => c.lines);
  const ans = await askJson(`You are a strict editor for a history channel. Check this story about "${spec.title}" line by line against the FACT BANK.
A line is bad if: it says something the fact bank does not support (an invented name, date, number, object or event); it talks about something that is not part of this story (cars, planes, fish, Halloween, European cities, modern people); it uses an unrelated picture as a metaphor; or its pictures (described after it) do not show what it says.
Return JSON {"bad": [{"n": line number, "why": "short reason"}]} (empty when all lines are good).
FACT BANK: ${JSON.stringify(bank.facts)}
STORY:
${lines.map((l, i) => `${i + 1}. ${l.en}${(l.pictures || []).length ? `  [pictures: ${l.pictures.map((p) => byId.get(p)?.seen?.what || p).join(' / ')}]` : l.gen ? '  [generated shot]' : ''}`).join('\n')}`, { temperature: 0 });
  return ans && Array.isArray(ans.bad) ? ans.bad : null;
}

async function writeStory(bank, pics) {
  const words = Math.round(((spec.seconds || 480) / 60) * 150);
  const known = new Set(pics.map((p) => p.id));
  const catalog = pics.slice(0, 220).map((p) => [p.id, p.seen.type, String(p.title).slice(0, 80), p.seen.what].join(' | ')).join('\n');
  let feedback = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const s = await askJson(`${STORY_RULES}

Episode: ${spec.title}
Opening hook idea: ${spec.hook || ''}
Length: ${words} spoken words in total, never under ${Math.round(words * 0.85)}, about ${Math.round(words / 24)} lines.${feedback}

FACT BANK:
${JSON.stringify(bank).slice(0, 40000)}

PICTURE CATALOG (id | type | title | what is visible):
${catalog}`, { temperature: 0.7 });
    const lines = s?.chapters?.flatMap((c) => c.lines || []) || [];
    if (!lines.length) { log(`story ${attempt}: no answer`); continue; }
    for (const l of lines) {
      l.pictures = (l.pictures || []).filter((p) => known.has(p));
      if (!l.gen?.prompt || l.pictures.length) delete l.gen;
    }
    if (!lines[0].gen) log(`story ${attempt}: first line has no hook shot`);
    // a busy Gemini often answers with a short story: grow the same story chapter by chapter instead of starting over
    for (let grow = 1; grow <= 3 && spoken(s) < words * 0.8; grow++) {
      const have = spoken(s);
      const g = await askJson(`${STORY_RULES}

This story is too short: ${have} spoken words, it needs ${words}. Rewrite it LONGER and return the whole story in the same JSON shape.
Keep every chapter, its order, the title, the reels and every existing line (you may polish wording). Add new lines inside each chapter
(about ${Math.round(words / 24 / Math.max(1, s.chapters.length))} lines per chapter) using facts from the FACT BANK that the story does not use yet.
Never invent anything. New lines may use pictures from the catalog only when they truly fit; otherwise leave pictures empty.

STORY: ${JSON.stringify(s)}

FACT BANK:
${JSON.stringify(bank).slice(0, 40000)}

PICTURE CATALOG (id | type | title | what is visible):
${catalog}`, { temperature: 0.5 });
      if (!g?.chapters?.length || spoken(g) <= have) { log(`story ${attempt}: growing did not help (${g ? spoken(g) : 0} words)`); break; }
      for (const l of g.chapters.flatMap((c) => c.lines || [])) {
        l.pictures = (l.pictures || []).filter((p) => known.has(p));
        if (!l.gen?.prompt || l.pictures.length) delete l.gen;
      }
      log(`story ${attempt}: grown from ${have} to ${spoken(g)} words`);
      Object.assign(s, g);
    }
    const n = spoken(s);
    if (n < words * 0.8) { feedback = `\nYour last attempt had only ${n} words; write more by using more facts, never by inventing.`; log(`story ${attempt}: ${n} words, too short`); continue; }
    const bad = await editor(s, bank, pics);
    if (!bad) { log(`story ${attempt}: the editor gave no answer`); continue; }
    log(`story ${attempt}: ${lines.length} lines, ${n} words, ${lines.filter((l) => l.gen).length} generated shots, ${bad.length} bad lines`);
    bad.forEach((b) => log(`   line ${b.n}: ${b.why}`));
    if (!bad.length) return s;
    feedback = `\nAn editor rejected your last attempt for these lines, so avoid these mistakes:\n${bad.map((b) => `- "${lines[b.n - 1]?.en || ''}": ${b.why}`).join('\n')}`;
  }
  return null;
}

// ── 6. Nano Banana stills for lines nothing shows ────────────────────
// Lines with no picture and no Flow shot would fall back to crops or title cards. For up to 8 of them where a still
// reconstruction truly helps (a place as it looked, an object, a scene), Gemini writes a Nano Banana prompt.
async function stills(script) {
  const prep = readJson(prepFile, { id, shots: [] });
  if (prep.shots.some((s) => s.kind === 'still') && !force) return;
  const lines = script.chapters.flatMap((c) => c.lines);
  const empty = lines.map((l, i) => ({ n: i + 1, l })).filter(({ l }) => !(l.pictures || []).length && !l.gen);
  if (!empty.length) return;
  const ans = await askJson(`A history video about "${spec.title}". These narration lines have no picture yet:
${empty.map(({ n, l }) => `${n}. ${l.en}`).join('\n')}
Pick at most 8 lines where one still image would really help the viewer (a place as it looked then, an object, a scene); skip lines about modern events, dates alone, or that only ask a question.
For each, write a prompt for an image model: a photorealistic 16:9 still, accurate to the period (materials, clothing, architecture of that dynasty), warm torch or sun light, cinematic, no text, no logos, no modern objects, faces natural and calm.
Return JSON {"stills": [{"n": line number, "prompt": "..."}]}`, { temperature: 0.4 });
  const picked = (ans?.stills || []).filter((s) => empty.some((e) => e.n === s.n) && s.prompt).slice(0, 8);
  prep.shots = prep.shots.filter((s) => s.kind !== 'still').concat(picked.map((s) => ({ n: s.n, line: lines[s.n - 1].en, kind: 'still', prompt: s.prompt, status: 'todo' })));
  fs.mkdirSync(path.dirname(prepFile), { recursive: true });
  fs.writeFileSync(prepFile, JSON.stringify(prep, null, 2) + '\n');
  log(`stills: ${picked.length} Nano Banana stills planned`);
}

// ── run ──────────────────────────────────────────────────────────────
const old = readJson(scriptFile, null);
if (old?.prepared && !force) { log(`${id} is prepared already (${old.prepared.at})`); await factBank(); await stills(old); process.exit(0); }
const bank = await factBank();
const pics = await cleanLibrary();
const story = await writeStory(bank, pics);
if (!story) throw new Error('No story passed the editor in 3 tries');
if (old) fs.writeFileSync(scriptFile.replace(/\.json$/, '.before-prep.json'), JSON.stringify(old, null, 2));
const shots = [];
story.chapters.flatMap((c) => c.lines).forEach((l, i) => { if (l.gen) shots.push({ n: i + 1, line: l.en, kind: l.gen.kind, prompt: l.gen.prompt, status: 'todo' }); });
const sources = [...(story.sources || []), ...(bank.sources || []).map((s) => ({ url: s.url }))].filter((s, i, a) => s.url && a.findIndex((x) => x.url === s.url) === i);
fs.writeFileSync(scriptFile, JSON.stringify({ id, series: old?.series || 'ZALA VIP Stories', fromLibrary: true, ...story, sources, id, prepared: { at: new Date().toISOString(), shots: shots.length } }, null, 2) + '\n', 'utf8');
fs.mkdirSync(path.dirname(prepFile), { recursive: true });
fs.writeFileSync(prepFile, JSON.stringify({ id, title: story.title, at: new Date().toISOString(), shots }, null, 2) + '\n');
log(`${id} prepared: "${story.title}", ${shots.length} Flow shots waiting in content/prep/${id}.json`);
await stills(readJson(scriptFile, null));
