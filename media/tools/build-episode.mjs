#!/usr/bin/env node
// Turns a voiced narration (content/youtube/narration/<id>.txt) and its hooks into the episode plan the renderer reads.
// Never overwrites a plan already written. Usage: node media/tools/build-episode.mjs <id>
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT } from '../lib/paths.mjs';

const id = process.argv[2];
const dir = path.join(CONTENT, 'youtube');
const out = path.join(dir, `${id}.json`);
try { if (JSON.parse(fs.readFileSync(out, 'utf8')).handWritten) { console.log(`${id}: plan already there`); process.exit(0); } } catch {}
const raw = fs.readFileSync(path.join(dir, 'narration', `${id}.txt`), 'utf8');
const hooks = JSON.parse(fs.readFileSync(path.join(dir, 'narration', 'hooks.json'), 'utf8'));
const h = hooks[id];
if (!h) throw new Error(`${id}: no hooks`);

const REEL_CHAPTERS = {
  'ZV-L02': ['Ten Years in the Tomb', 'How Did He Die?'], 'ZV-L05': ['The Particles From Space', 'The Diary of Merer'],
  'ZV-L06': ['The Man Who Was Blamed', 'The Prince and the Dream'], 'ZV-L08': ['The Impossible Rescue', 'The Sun Inside the Mountain'],
  'ZV-L09': ['The Hammer and the Chisel', 'The Tooth in the Box'], 'ZV-L11': ['The Trap', "The World's First Peace"],
};
const chapters = [];
let part = 0;
for (const row of raw.split(/\r?\n/)) {
  const l = row.trim();
  if (!l || /^(TITLE|SOURCES):/.test(l)) continue;
  const p = l.match(/^=== PART (\d+)/);
  if (p) { part = Number(p[1]); continue; }
  if (l.startsWith('## ')) { chapters.push({ title: l.slice(3), lines: [] }); continue; }
  chapters[chapters.length - 1].lines.push({ en: l, part, pictures: [] });
}
// the voiced opener comes first, in the first chapter
chapters[0].lines.unshift(...h.opener.map((en) => ({ en, extra: true, pictures: [] })));
const all = chapters.flatMap((c) => c.lines);
const hard = /\b(died|killed|murder|destroyed|burned|executed|collapsed|attacked|nobody knows|no one knows)\b/i;
let since = 9;
for (const l of all) { since++; if (since > 12 && hard.test(l.en)) { l.sfx = 'impact'; since = 0; } else if (/\?$/.test(l.en) && since > 4) { l.sfx = 'riser'; } }
const title = raw.match(/^TITLE:\s*(.+)$/m)?.[1]?.trim() || id;
const short = title.split(':')[0].trim();
const number = (t) => chapters.findIndex((c) => c.title === t) + 1;
const TRACKS = ['Curse of the Scarab', 'Lightless Dawn', 'Crypto', 'Desert City', 'Five Armies'];
const music = chapters.map((_, i) => i).filter((i) => i % 2 === 0).map((chapter, n) => ({ chapter, track: TRACKS[n % TRACKS.length] }));
const [a, b] = REEL_CHAPTERS[id];
const plan = {
  id, handWritten: true, title, series: 'ZALA VIP Stories', voiceNote: `Lahajati, ${h.voice}`,
  description: `${h.opener[0]} This is the true story of ${short}.`,
  tags: [short, 'Ancient Egypt', 'Egypt history', 'Egypt travel', 'true history'],
  sources: (raw.match(/^SOURCES:\s*(.+)$/m)?.[1] || '').split('|').map((x) => x.trim()).filter(Boolean),
  nextPublished: 'THE NEXT CASE IS COMING', chapters, music,
  thumbnails: [{ text: short }, { text: 'THE REAL STORY' }, { text: 'WATCH THIS' }],
  reelLines: [...h.opener, ...h.reels, hooks.cta], reelCta: hooks.cta,
  reels: [
    { chapter: 1, title: short, hook: short },
    { chapter: number(a) || 2, title: a, hook: a, say: h.reels[0] },
    { chapter: number(b) || 3, title: b, hook: b, say: h.reels[1] },
  ],
};
fs.writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');
fs.rmSync(path.join(dir, `${id}.shots.json`), { force: true });
console.log(`${id}: ${chapters.length} chapters, ${all.length} lines`);
