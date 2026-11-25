#!/usr/bin/env node
// Read only: which Facebook pages the server's system user can reach, whether it may post on them,
// and which Instagram account is linked to each. Asks for names and ids only, never page tokens.
const token = process.env.META_SYSTEM_USER_TOKEN;
if (!token) throw new Error('META_SYSTEM_USER_TOKEN is missing');
const G = 'https://graph.facebook.com/v21.0';
const get = async (path) => {
  const r = await fetch(`${G}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Meta refused: ${r.status} ${j.error?.message || ''}`.slice(0, 200));
  return j;
};
const { data = [] } = await get('me/accounts?limit=50&fields=id,name,tasks,instagram_business_account{id,username}');
console.log(`PAGES ${data.length}`);
for (const p of data) {
  console.log(`PAGE ${p.id} | ${p.name} | can post: ${(p.tasks || []).includes('CREATE_CONTENT') ? 'yes' : 'no'} | instagram: ${p.instagram_business_account ? '@' + p.instagram_business_account.username : 'none'}`);
}
