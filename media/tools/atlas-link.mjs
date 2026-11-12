#!/usr/bin/env node
// Links our videos to the places on the ZALA Guide map (zalavip.com/atlas): a visitor who opens a place sees our
// episode or short about it. The list is content/atlas-videos.json ({slug: [{url, title, kind, at, episode}]}),
// saved to R2 with the rest of content/ and read by the site's /api/atlas-videos. A video shows from its publish time.
//   node atlas-link.mjs all            every episode already on YouTube (run by the factory after scheduling)
//   node atlas-link.mjs episode <EP>   after the factory schedules an episode: every map place the story flies to
//                                      or names twice (by its full name) gets the main video
// shorts.mjs calls addVideo() for a place short.
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const CONTENT = path.join(REPO, 'content');
const FILE = path.join(CONTENT, 'atlas-videos.json');
const SITE = 'https://www.zalavip.com';
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

/** Adds one video to a map place (the same video is never added twice). */
export function addVideo(slug, v) {
  if (!slug || !v?.url) return;
  const all = readJson(FILE, {});
  const list = all[slug] ||= [];
  if (list.some((x) => x.url === v.url)) return;
  list.push({ url: v.url, title: v.title, kind: v.kind, at: v.at || new Date().toISOString(), episode: v.episode });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n');
  console.log(`[atlas] ${slug} <- ${v.kind} ${v.url}`);
}

const norm = (s) => String(s || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function episode(id) {
  const script = readJson(path.join(CONTENT, 'youtube', `${id}.json`), null);
  if (!script) throw new Error(`${id}: no script`);
  const plan = readJson(path.join(CONTENT, 'schedule.json'), []);
  const main = plan.find((p) => p.episode === id && p.which === 'main' && p.youtube);
  if (!main) { console.log(`[atlas] ${id}: no YouTube link yet`); return; }
  const atlas = await fetch(`${SITE}/atlas-places.json`).then((r) => r.json()).catch(() => []);
  const places = (Array.isArray(atlas) ? atlas : atlas.places || []).filter((p) => p.slug && p.name?.en);
  const lines = (script.chapters || []).flatMap((c) => c.lines || []);
  const flown = new Set(lines.map((l) => norm(l.map)).filter(Boolean));
  const text = ` ${norm([script.title, ...lines.map((l) => l.en)].join(' '))} `;
  let n = 0;
  for (const p of places) {
    const name = norm(p.name.en);
    if (name.length < 6) continue;   // short names ("Giza") match too much; full names only
    // the story flies to it on the map, or names it at least twice (a passing mention is not about the place)
    if (flown.has(name) || text.split(` ${name} `).length - 1 >= 2) {
      addVideo(p.slug, { url: main.youtube, title: script.title, kind: 'episode', at: main.at, episode: id });
      n++;
    }
  }
  console.log(`[atlas] ${id}: linked to ${n} map place(s)`);
}

if (process.argv[1]?.endsWith('atlas-link.mjs')) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'episode') await episode(arg);
  // every episode already on YouTube (safe to repeat: a video is never added twice)
  else if (cmd === 'all') { for (const ep of new Set(readJson(path.join(CONTENT, 'schedule.json'), []).filter((p) => p.which === 'main' && p.youtube).map((p) => p.episode))) await episode(ep).catch((e) => console.log(`[atlas] ${ep}: ${e.message}`)); }
  else if (cmd) throw new Error('usage: episode <EP> | all');
}
