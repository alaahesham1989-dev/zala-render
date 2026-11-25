// Sets the Spanish channel's description, keywords, country, language and banner (texts approved by the owner,
// 2026-11-26). Refuses to write if the token opens any other channel. The profile picture has no API.
import fs from 'node:fs';

const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
if (!id || !secret || !refresh || refresh === 'missing') throw new Error('The YouTube secrets are missing');
const HANDLE = '@zalavip_es';
const BANNER = 'media/brand/youtube-banner-es.jpg';
const WANT = {
  description: 'Historias del Antiguo Egipto contadas con calma y con fuentes. ZALA VIP es su conserjería de lujo en Egipto: VIP en el aeropuerto de El Cairo, limusina, viajes privados y hoteles en El Cairo y Guiza. Planifique su viaje en https://zalavip.com',
  keywords: '"Antiguo Egipto" Egipto pirámides faraones Guiza "lujo en Egipto" "ZALA VIP"',
  country: 'EG',
  defaultLanguage: 'es',
};

const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
})).json();
if (!tok.access_token) throw new Error(`Google refused the token: ${tok.error}`);
const auth = { Authorization: `Bearer ${tok.access_token}` };
const api = async (url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { ...auth, ...init.headers } });
  const j = await r.json();
  if (!r.ok) throw new Error(`YouTube refused: ${r.status} ${j.error?.message || ''}`.slice(0, 300));
  return j;
};

const { items } = await api('https://www.googleapis.com/youtube/v3/channels?part=snippet,brandingSettings&mine=true');
const ch = items[0];
if (String(ch.snippet.customUrl).toLowerCase() !== HANDLE) throw new Error(`wrong channel: ${ch.snippet.customUrl}`);
const { channel = {}, image = {} } = ch.brandingSettings || {};

let banner = image.bannerExternalUrl;
if (!banner) {
  const up = await api('https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media', {
    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: fs.readFileSync(BANNER),
  });
  banner = up.url;
  console.log('banner: uploaded');
}
await api('https://www.googleapis.com/youtube/v3/channels?part=brandingSettings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: ch.id, brandingSettings: { channel: { ...channel, ...WANT }, image: { bannerExternalUrl: banner } } }),
});
console.log('description, keywords, country, language and banner: saved');
