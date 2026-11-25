// Gives the three public audience channels their description and photo (owner approved the texts, 2026-11-26).
// Safe to run again: only what is missing or different is changed. Nothing is posted and nothing is removed.
import fs from 'node:fs';

const T = process.env.TELEGRAM_BOT_TOKEN;
if (!T) throw new Error('no bot token');
const PHOTO = 'media/brand/social-avatar.png';
const CHANNELS = [
  ['@zalavip_en', 'Stories of Ancient Egypt, and your private concierge: Cairo Airport VIP, limousine, private trips, hotels. zalavip.com'],
  ['@zalavip_ar', 'حكايات من الحضارة المصرية، وكونسيرج خاص ليك في مصر: VIP مطار القاهرة، ليموزين، رحلات خاصة، فنادق. zalavip.com'],
  ['@zalavip_es', 'Historias del Antiguo Egipto y su conserjería privada en Egipto: aeropuerto VIP, limusina, viajes y hoteles. zalavip.com'],
];

async function call(method, body) {
  const form = body instanceof FormData;
  const r = await fetch(`https://api.telegram.org/bot${T}/${method}`, {
    method: 'POST', headers: form ? undefined : { 'Content-Type': 'application/json' }, body: form ? body : JSON.stringify(body || {}),
  });
  const j = await r.json();
  return j.ok ? { ok: true, v: j.result } : { ok: false, v: j.description };
}

const me = (await call('getMe')).v;
for (const [chat_id, description] of CHANNELS) {
  const c = await call('getChat', { chat_id });
  if (!c.ok) { console.log(`${chat_id}: not found (${c.v})`); continue; }
  const m = await call('getChatMember', { chat_id, user_id: me.id });
  const admin = m.ok && m.v.status === 'administrator';
  const n = await call('getChatMemberCount', { chat_id });
  console.log(`${chat_id}: "${c.v.title}" type=${c.v.type} members=${n.ok ? n.v : '?'} bot=${m.ok ? m.v.status : 'not in it'}` +
    ` can-post=${!!(admin && m.v.can_post_messages)} can-change-info=${!!(admin && m.v.can_change_info)}`);
  if (c.v.type !== 'channel' || !admin || !m.v.can_change_info) { console.log(`${chat_id}: left as it is`); continue; }
  if (c.v.description === description) console.log(`${chat_id}: description already set`);
  else {
    const d = await call('setChatDescription', { chat_id, description });
    console.log(`${chat_id}: description ${d.ok ? 'set' : 'refused: ' + d.v}`);
  }
  if (c.v.photo) console.log(`${chat_id}: photo already there`);
  else {
    const f = new FormData();
    f.set('chat_id', chat_id);
    f.set('photo', new Blob([fs.readFileSync(PHOTO)], { type: 'image/png' }), 'avatar.png');
    const p = await call('setChatPhoto', f);
    console.log(`${chat_id}: photo ${p.ok ? 'set' : 'refused: ' + p.v}`);
  }
}
