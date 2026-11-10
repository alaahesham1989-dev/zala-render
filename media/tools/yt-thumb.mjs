// Replaces the thumbnail of a video already on the channel. Usage: node media/tools/yt-thumb.mjs <video id> <jpg file>
import fs from 'node:fs';

const [videoId, file] = process.argv.slice(2);
const { YOUTUBE_CLIENT_ID: client_id, YOUTUBE_CLIENT_SECRET: client_secret, YOUTUBE_REFRESH_TOKEN: refresh_token } = process.env;
const t = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
})).json();
if (!t.access_token) throw new Error(`Google refused the token: ${t.error}`);
const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
  method: 'POST', headers: { Authorization: `Bearer ${t.access_token}`, 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(file),
});
console.log(`RESULT: ${videoId} ${r.ok ? 'thumbnail set' : `refused ${r.status} ${(await r.text()).slice(0, 200)}`}`);
if (!r.ok) process.exitCode = 1;
