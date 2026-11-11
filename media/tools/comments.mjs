// Replies to new comments on the Facebook page and Instagram by itself, then tells the owner in Arabic on Telegram
// (he does not read English). Spam, insults and anything sensitive get no reply. Runs on the server (comments.yml).
// State: content/replied.json (in git), so no comment is answered twice.
// Usage: node media/tools/comments.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { askJson } from './gemini-lite.mjs';

const dry = process.argv.includes('--dry');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const stateFile = path.join(REPO, 'content', 'replied.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { ids: [] };
const seen = new Set(state.ids);
const G = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const PAGE = process.env.FB_PAGE_ID || '108172631323930';
const IG = process.env.IG_ACCOUNT_ID || '17841480123002919';
const WEEK = Date.now() - 7 * 86400e3;

async function call(url, { method = 'GET', params = {}, token = TOKEN } = {}) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET' ? await fetch(`${url}${url.includes('?') ? '&' : '?'}${body}`) : await fetch(url, { method, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Meta refused ${url.replace(G, '')}: ${data.error?.message || res.status}`);
  return data;
}

const { access_token: pageToken } = await call(`${G}/${PAGE}?fields=access_token`);
const fresh = [];
// Facebook: comments under the page's recent posts, videos and reels
const posts = await call(`${G}/${PAGE}/posts?fields=id,message,comments.limit(50){id,message,from,created_time}&limit=25`, { token: pageToken });
for (const p of posts.data || []) {
  for (const c of p.comments?.data || []) {
    if (seen.has(c.id) || c.from?.id === PAGE || Date.parse(c.created_time) < WEEK || !String(c.message || '').trim()) continue;
    fresh.push({ id: c.id, where: 'fb', text: c.message, post: String(p.message || '').split('\n')[0].slice(0, 120) });
  }
}
// Instagram
const me = await call(`${G}/${IG}?fields=username`);
const media = await call(`${G}/${IG}/media?fields=id,caption,comments.limit(50){id,text,username,timestamp}&limit=25`);
for (const m of media.data || []) {
  for (const c of m.comments?.data || []) {
    if (seen.has(c.id) || c.username === me.username || Date.parse(c.timestamp) < WEEK || !String(c.text || '').trim()) continue;
    fresh.push({ id: c.id, where: 'ig', text: c.text, post: String(m.caption || '').split('\n')[0].slice(0, 120) });
  }
}
console.log(`[comments] ${fresh.length} new`);
if (!fresh.length) process.exit(0);

const batch = fresh.slice(0, 40);
const ans = await askJson(`You answer comments for "ZALA VIP", an Ancient Egypt history page run by a luxury travel concierge in Cairo.
For each comment write a short, warm, human reply (max 25 words) in the comment's own language. Thank people, answer simple history questions only if you are sure,
otherwise say we will cover it in a coming episode. If someone asks about visiting Egypt or prices, invite them to send the page a message. No links, no prices, no promises.
Return null as the reply for spam, insults, sexual, political or religious arguments, or anything you are not sure about.
Also give "ar": a short Egyptian Arabic summary of what the person said (for the owner, who does not read English).
Comments (JSON): ${JSON.stringify(batch.map(({ id, text, post }) => ({ id, text, post })))}
Return JSON: {"items":[{"id":"...","reply":"... or null","ar":"..."}]}`, { temperature: 0.5 });
const byId = new Map((ans?.items || []).map((x) => [x.id, x]));

const lines = [];
let replied = 0;
for (const c of batch) {
  const a = byId.get(c.id);
  if (!a) continue;   // Gemini gave nothing for it: try again on the next run
  let note = 'ماتردّش عليه (سبام أو حساس)';
  if (a.reply && !dry) {
    try {
      if (c.where === 'fb') await call(`${G}/${c.id}/comments`, { method: 'POST', token: pageToken, params: { message: a.reply } });
      else await call(`${G}/${c.id}/replies`, { method: 'POST', params: { message: a.reply } });
      replied++; note = 'اتردّ عليه';
    } catch (e) { note = 'الرد وقع'; console.log(`[comments] ${c.id}: ${e.message}`); }
  } else if (a.reply) note = `هيترد: ${a.reply}`;
  console.log(`[comments] ${c.where} ${c.id}: ${c.text} -> ${a.reply || '(no reply)'}`);
  lines.push(`• ${c.where === 'fb' ? 'فيسبوك' : 'إنستجرام'}: ${a.ar || ''} ← ${note}`);
  state.ids.push(c.id);
}
state.ids = state.ids.slice(-5000);
if (!dry) fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

const msg = `ZALA التعليقات: ${lines.length} تعليق جديد، اتردّ أوتوماتيك على ${replied}.\n${lines.slice(0, 12).join('\n')}`;
console.log(msg);
const { TELEGRAM_BOT_TOKEN: bot, TELEGRAM_CHAT_ID: chat } = process.env;
if (!dry && bot && chat && lines.length) await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, { method: 'POST', body: new URLSearchParams({ chat_id: chat, text: msg }) });
