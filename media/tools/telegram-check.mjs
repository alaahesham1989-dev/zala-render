// Read only: what the bot can see and do in the team's Telegram groups. The repo is public, so no token,
// no invite link and no member name is ever printed. A new group's id is printed only to save it as a variable.
const T = process.env.TELEGRAM_BOT_TOKEN;
if (!T) throw new Error('no bot token');

async function call(method, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${T}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const j = await r.json();
  return j.ok ? { ok: true, v: j.result } : { ok: false, v: j.description };
}

const me = (await call('getMe')).v;
console.log(`bot: @${me.username} | reads all group messages: ${!!me.can_read_all_group_messages}`);

const chats = { EN: process.env.TG_CHAT_EN, AR: process.env.TG_CHAT_AR, ES: process.env.TG_CHAT_ES, ADMIN: process.env.ADMIN_CHAT };
const known = new Set(Object.values(chats).filter(Boolean).map(String));

async function describe(label, id) {
  const c = await call('getChat', { chat_id: id });
  if (!c.ok) return console.log(`${label}: not reachable (${c.v})`);
  const x = c.v;
  const n = await call('getChatMemberCount', { chat_id: id });
  const m = await call('getChatMember', { chat_id: id, user_id: me.id });
  const rights = ['can_change_info', 'can_delete_messages', 'can_restrict_members', 'can_invite_users', 'can_pin_messages']
    .filter((k) => m.ok && m.v[k]);
  const open = Object.entries(x.permissions || {}).filter(([, v]) => v).map(([k]) => k.replace('can_', ''));
  console.log(`${label}: "${x.title || '(private chat)'}" type=${x.type} public=${x.username ? '@' + x.username : 'no'}` +
    ` members=${n.ok ? n.v : '?'} about=${x.description ? 'yes' : 'no'} photo=${x.photo ? 'yes' : 'no'}` +
    ` history-for-new=${x.has_visible_history ? 'visible' : 'hidden'}`);
  console.log(`   bot=${m.ok ? m.v.status : '?'} rights=[${rights}] members-may=[${open}]`);
}

for (const [label, id] of Object.entries(chats)) {
  if (id) await describe(label, id);
  else console.log(`${label}: no id saved`);
}
if (chats.ADMIN) console.log(`ADMIN is the same chat as EN: ${chats.ADMIN === chats.EN}, as AR: ${chats.ADMIN === chats.AR}`);

// A group the bot was just added to shows up here for about a day.
const up = await call('getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message', 'my_chat_member', 'channel_post'] });
if (!up.ok) console.log(`updates: ${up.v}`);
else {
  const fresh = new Map();
  for (const u of up.v) {
    const chat = (u.message || u.my_chat_member || u.channel_post || {}).chat;
    if (chat && chat.type !== 'private' && !known.has(String(chat.id))) fresh.set(chat.id, chat);
  }
  console.log(`new groups seen: ${fresh.size}`);
  for (const chat of fresh.values()) {
    console.log(`NEW id=${chat.id}`);
    await describe('NEW', chat.id);
  }
}
