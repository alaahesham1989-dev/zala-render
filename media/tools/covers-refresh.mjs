#!/usr/bin/env node
// New covers for Shorts already on the channel (owner's order 2026-11-17: the old ones showed a random frame).
//   node covers-refresh.mjs plan      -> covers-plan.json: every short on the channel matched to its episode and reel
//   node covers-refresh.mjs set <dir> -> sets the cover thumbs.py made in <dir>/<EP>/ on each matched short
// Matching: the YouTube link saved in content/schedule.json or content/meta-queue.json, else the title.
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const C = path.join(REPO, 'content');
const [, , cmd, dir] = process.argv;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: YOUTUBE_CLIENT_ID, client_secret: YOUTUBE_CLIENT_SECRET, refresh_token: YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json()).access_token;
if (!tok) throw new Error('Google refused the token');
const H = { Authorization: `Bearer ${tok}` };
const api = async (u) => { const r = await fetch(`https://www.googleapis.com/youtube/v3/${u}`, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; };
const norm = (t) => String(t || '').toLowerCase().replace(/#shorts?\b/g, '').replace(/^ancient egypt(:|\s\|)\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();

if (cmd === 'plan') {
  const uploads = (await api('channels?part=contentDetails&mine=true')).items[0].contentDetails.relatedPlaylists.uploads;
  const ids = [];
  for (let page = ''; ;) {
    const pl = await api(`playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`);
    ids.push(...pl.items.map((i) => i.contentDetails.videoId));
    if (!(page = pl.nextPageToken)) break;
  }
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) videos.push(...(await api(`videos?part=snippet,contentDetails&id=${ids.slice(i, i + 50).join(',')}`)).items);
  const byLink = {};
  for (const x of [...readJson(path.join(C, 'schedule.json'), []), ...readJson(path.join(C, 'meta-queue.json'), [])]) {
    const v = String(x.youtube || '').match(/(?:youtu\.be\/|v=)([\w-]{11})/)?.[1];
    if (v && x.episode && x.which) byLink[v] = { ep: x.episode, which: x.which };
  }
  const byTitle = {};
  for (const f of fs.existsSync(path.join(C, 'youtube')) ? fs.readdirSync(path.join(C, 'youtube')) : []) {
    const s = readJson(path.join(C, 'youtube', f), null);
    if (!s?.id) continue;
    (s.reels || []).forEach((r, n) => { byTitle[norm(r.title)] ||= { ep: s.id, which: `R${n + 1}` }; });
    if (s.verticalOnly) byTitle[norm(s.title)] ||= { ep: s.id, which: 'R1' };
  }
  const plan = [];
  const missing = [];
  for (const v of videos) {
    const secs = (v.contentDetails.duration.match(/(\d+)M/)?.[1] || 0) * 60 + +(v.contentDetails.duration.match(/(\d+)S/)?.[1] || 0);
    if (secs > 180 || /\bH\b|\d+H/.test(v.contentDetails.duration)) continue;   // shorts only; long videos already have covers
    const m = byLink[v.id] || byTitle[norm(v.snippet.title)];
    if (m) plan.push({ video: v.id, ...m, title: v.snippet.title }); else missing.push(`${v.id} ${v.snippet.title}`);
  }
  fs.writeFileSync('covers-plan.json', JSON.stringify(plan, null, 2));
  console.log(`[covers] ${plan.length} shorts matched, ${missing.length} not matched`);
  missing.forEach((m) => console.log(`[covers] no episode for: ${m}`));
  console.log(`EPISODES:${[...new Set(plan.map((p) => p.ep))].join(' ')}`);
} else if (cmd === 'set') {
  let ok = 0;
  for (const p of readJson('covers-plan.json', [])) {
    const pub = path.join(dir, p.ep);
    const pkg = readJson(path.join(pub, `${p.ep}.youtube.json`), null);
    const reel = pkg?.reels?.find((r) => r.id === `${p.ep}-${p.which}`) || (pkg?.reels?.length === 1 ? pkg.reels[0] : null);
    const file = reel && path.join(pub, reel.cover || String(reel.file).replace('.mp4', '_cover.jpg'));
    if (!file || !fs.existsSync(file)) { console.log(`[covers] ${p.video} ${p.ep} ${p.which}: no cover made`); continue; }
    const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${p.video}`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(file) });
    console.log(`[covers] ${p.video} ${p.ep} ${p.which}: ${r.ok ? 'cover set' : `refused ${r.status} ${(await r.text()).slice(0, 160)}`}`);
    if (r.ok) ok++;
  }
  console.log(`COVERS: ${ok} set`);
} else throw new Error('usage: plan | set <dir>');
