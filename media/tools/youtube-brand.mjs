#!/usr/bin/env node
// One pass over every video on the channel (public, private, scheduled): a title without the channel identity
// gets it (brand.mjs), and a description that opens with the old title opens with the new one.
// Usage: node media/tools/youtube-brand.mjs [--dry]
import { brandTitle } from './brand.mjs';

const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
if (!clientId || !clientSecret || !refresh) throw new Error('The YouTube secrets are missing');
const dry = process.argv.includes('--dry');
const t = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
});
const token = (await t.json()).access_token;
if (!token) throw new Error('Google refused the token');
const H = { Authorization: `Bearer ${token}` };
const get = async (u) => { const r = await fetch(`https://www.googleapis.com/youtube/v3/${u}`, { headers: H }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; };

const uploads = (await get('channels?part=contentDetails&mine=true')).items[0].contentDetails.relatedPlaylists.uploads;
const ids = [];
for (let page = ''; ;) {
  const pl = await get(`playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`);
  ids.push(...pl.items.map((i) => i.contentDetails.videoId));
  if (!(page = pl.nextPageToken)) break;
}
let changed = 0;
for (let i = 0; i < ids.length; i += 50) {
  const vids = (await get(`videos?part=snippet&id=${ids.slice(i, i + 50).join(',')}`)).items;
  for (const v of vids) {
    const old = v.snippet.title;
    const short = /#shorts\b/i.test(old);
    const title = short ? `${brandTitle(old, 91)} #shorts` : brandTitle(old);
    if (title === old) continue;
    const bare = old.replace(/\s+#shorts\b/i, '').trim();
    const desc = String(v.snippet.description || '');
    const description = desc.startsWith(bare) ? brandTitle(bare) + desc.slice(bare.length) : desc;
    console.log(`${v.id}: "${old}" -> "${title}"`);
    if (dry) continue;
    const snippet = { title, description, categoryId: v.snippet.categoryId, tags: v.snippet.tags, defaultLanguage: v.snippet.defaultLanguage, defaultAudioLanguage: v.snippet.defaultAudioLanguage };
    const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id, snippet }) });
    if (!r.ok) console.log(`  refused ${r.status} ${(await r.text()).slice(0, 200)}`); else changed++;
  }
}
console.log(`BRAND: ${changed} videos updated${dry ? ' (dry run)' : ''}`);
