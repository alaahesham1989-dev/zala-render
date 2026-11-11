// Replaces the description of a YouTube video that is already up with the short text about its subject
// (owner's order 2026-11-11), keeping its title, tags and category.
// Usage: node media/tools/yt-retext.mjs <publish dir> <episode id> <main|R1|R2|R3> <video id>
import fs from 'node:fs';
import path from 'node:path';
import { postText } from './captions.mjs';

const [dir, id, which, videoId] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(dir, `${id}.youtube.json`), 'utf8'));
const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: YOUTUBE_CLIENT_ID, client_secret: YOUTUBE_CLIENT_SECRET, refresh_token: YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }) })).json();
if (!t.access_token) throw new Error(`Google refused the token: ${t.error}`);
const auth = { Authorization: `Bearer ${t.access_token}` };
const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${t.access_token}`)).json();
console.log('scopes:', info.scope);
const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}`, { headers: auth })).json();
const sn = v.items?.[0]?.snippet;
if (!sn) throw new Error(`video ${videoId} not found`);
const body = { id: videoId, snippet: { title: sn.title, categoryId: sn.categoryId, tags: sn.tags, defaultLanguage: sn.defaultLanguage, defaultAudioLanguage: sn.defaultAudioLanguage, description: postText(pkg, which) } };
const res = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const d = await res.json();
if (!res.ok) throw new Error(`YouTube refused: ${d.error?.message || res.status}`);
console.log(`RETEXT ${id} ${which} ${videoId} ok`);
