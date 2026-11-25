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
const { data = [] } = await get('me/accounts?limit=50&fields=id,name,tasks,category,username,about,website,picture{is_silhouette},cover{id},instagram_business_account{id,username,biography,website,profile_picture_url}');
console.log(`PAGES ${data.length}`);
for (const p of data) {
  console.log(`PAGE ${p.id} | ${p.name} | can post: ${(p.tasks || []).includes('CREATE_CONTENT') ? 'yes' : 'no'} | instagram: ${p.instagram_business_account ? '@' + p.instagram_business_account.username : 'none'}`);
  const yn = (v) => (v ? 'yes' : 'NO');
  console.log(`IDENTITY facebook | username=${p.username || 'NO'} category=${p.category} picture=${yn(p.picture?.data && !p.picture.data.is_silhouette)} cover=${yn(p.cover)} about=${yn(p.about)} website=${p.website || 'NO'}`);
  const g = p.instagram_business_account;
  if (g) console.log(`IDENTITY instagram | picture=${yn(g.profile_picture_url)} bio=${yn(g.biography)} website=${g.website || 'NO'}`);
}
