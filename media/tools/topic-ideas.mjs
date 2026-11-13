#!/usr/bin/env node
// Keeps media/tools/treasures.json (the long-episode topic queue) from ever running dry, the same way shorts.mjs
// invents its own short topics: when few un-prepared topics are left, Gemini is asked for more, alternating the
// owner's two series — "T" mystery/treasure episodes and "D" strange-daily-life episodes — never repeating a subject
// already in the list. prep.yml calls this before picking what to prepare next, so the owner never has to refill it.
//   node media/tools/topic-ideas.mjs <how many to add> [T|D|alternate]
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const FILE = path.join(REPO, 'media', 'tools', 'treasures.json');
const log = (...a) => console.log('[topics]', ...a);

const RULES = {
  T: { seconds: 480, ask: 'a gripping TRUE mystery or treasure story about Ancient Egypt: a discovery, a tomb, a lost artifact, a royal secret, a forgotten disaster, a strange find — the kind of hook a viewer cannot scroll past ("Why did they hide...", "What was really inside...")' },
  D: { seconds: 780, ask: 'a strange, surprising true fact about daily life in Ancient Egypt that feels close to people today (food, beer, work, strikes, marriage, women\'s rights, medicine, teeth, makeup, pets, toilets, heat, children, crime, punishment, games, school, love letters, dreams, magic, death, the afterlife)' },
};

function nextId(prefix, used) {
  let n = 1;
  while (used.has(`ZV-${prefix}${String(n).padStart(2, '0')}`)) n++;
  return `ZV-${prefix}${String(n).padStart(2, '0')}`;
}

async function oneIdea(kind, avoid) {
  const r = RULES[kind];
  const a = await askJson(`Suggest ONE ${r.ask}.
It must be a real, verifiable event or fact (nothing invented), different in subject from all of these already used: ${JSON.stringify(avoid)}.
Return JSON {"title": "a title people click, max 70 characters, true to the story, no clickbait lies",
"hook": "one vivid opening sentence that sets the scene (what someone saw, found or did)",
"match": "4 to 8 search terms separated by | that would match this subject in a fact bank (lowercase, e.g. names, places, events)",
"archive": "2 to 4 words for a stock-photo search of this subject",
"queries": ["8 to 12 short English picture search queries for this subject, most specific first"]}`, { temperature: 0.9 });
  if (!a?.title || !a?.match) return null;
  return { title: a.title, hook: a.hook || '', seconds: r.seconds, match: a.match, archive: a.archive || a.title, queries: (a.queries || []).slice(0, 12) };
}

async function topUp(count, which) {
  const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const used = new Set(Object.keys(list));
  const titles = Object.values(list).map((v) => v.title);
  const kinds = which === 'T' || which === 'D' ? [which] : ['T', 'D'];
  let added = 0;
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    let idea = null;
    for (let t = 0; t < 3 && !idea; t++) idea = await oneIdea(kind, titles.slice(-60));
    if (!idea) { log(`${kind}: no idea this round, trying the next slot`); continue; }
    if (titles.some((t) => t.toLowerCase() === idea.title.toLowerCase())) { log(`duplicate title skipped: ${idea.title}`); continue; }
    const id = nextId(kind, used);
    used.add(id); titles.push(idea.title);
    list[id] = idea;
    added++;
    log(`${id}: ${idea.title}`);
  }
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
  log(`added ${added} new topic(s), ${Object.keys(list).length} in the queue now`);
  return added;
}

const [count, which] = process.argv.slice(2);
await topUp(Number(count) || 10, which);
