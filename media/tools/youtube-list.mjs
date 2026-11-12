#!/usr/bin/env node
// Lists every video on the channel with its state: public, private, or scheduled (publish time).
// Usage: node media/tools/youtube-list.mjs   (prints one JSON line per video, newest first, and YT_LIST:<json>)
const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
if (!clientId || !clientSecret || !refresh) throw new Error('The YouTube secrets are missing');
const t = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
});
const token = (await t.json()).access_token;
if (!token) throw new Error('Google refused the token');
const get = async (u) => { const r = await fetch(`https://www.googleapis.com/youtube/v3/${u}`, { headers: { Authorization: `Bearer ${token}` } }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; };
const ch = await get('channels?part=contentDetails,snippet&mine=true');
const uploads = ch.items[0].contentDetails.relatedPlaylists.uploads;
console.log(`channel: ${ch.items[0].snippet.title}`);
const ids = [];
let page = '';
do {
  const pl = await get(`playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`);
  ids.push(...pl.items.map((i) => i.contentDetails.videoId));
  page = pl.nextPageToken || '';
} while (page);
const out = [];
for (let k = 0; k < ids.length; k += 50) {
  const v = await get(`videos?part=status,snippet,contentDetails&id=${ids.slice(k, k + 50).join(',')}`);
  for (const x of v.items) out.push({ id: x.id, title: x.snippet.title, privacy: x.status.privacyStatus, publishAt: x.status.publishAt || '', published: x.snippet.publishedAt, duration: x.contentDetails.duration });
}
for (const o of out) console.log(JSON.stringify(o));
console.log(`YT_LIST:${JSON.stringify(out)}`);
