#!/usr/bin/env node
// Changes the visibility or schedule of a video already on YouTube.
// Usage: node media/tools/youtube-status.mjs <video id> [--privacy private|unlisted|public] [--publish-at ISO]
const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
if (!clientId || !clientSecret || !refresh) throw new Error('The YouTube secrets are missing');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const privacy = opt('--privacy', 'private');
const publishAt = opt('--publish-at', '');
const [id] = argv;
if (!id) throw new Error('video id required');

const t = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
});
const token = (await t.json()).access_token;
if (!token) throw new Error('Google refused the token');
const res = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
  method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, status: { privacyStatus: publishAt ? 'private' : privacy, selfDeclaredMadeForKids: false, embeddable: true, containsSyntheticMedia: true, ...(publishAt ? { publishAt } : {}) } }),
});
const d = await res.json();
if (!res.ok) throw new Error(`YouTube refused: ${res.status} ${JSON.stringify(d.error?.errors || d.error).slice(0, 500)}`);
console.log(`RESULT:${JSON.stringify({ id, privacy: d.status?.privacyStatus, publishAt: d.status?.publishAt || null, uploadStatus: d.status?.uploadStatus, rejection: d.status?.rejectionReason || null })}`);
