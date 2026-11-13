#!/usr/bin/env node
// media/library-harvest.mjs — grows the channel's own open-license library on R2. Stories and renders use only this library.
//
//   node media/library-harvest.mjs import                     bring the existing vault pictures into content/library/items.jsonl
//   node media/library-harvest.mjs harvest ZV-L01 [--limit 60] [--dry-run]   collect for one topic in content/library/topics.json ("all" = every topic)
//   node media/library-harvest.mjs describe [ZV-L01] [--limit 200]           Gemini looks at each picture and writes what is really in it
//   node media/library-harvest.mjs coverage                   how many usable pictures each topic has
//   node media/library-harvest.mjs upload                     sends pictures kept on this computer to R2 (harvest never waits for this)
//
// Sources, each only with a license that allows commercial use: Wikimedia Commons, Art Institute of Chicago, Cleveland Museum of Art,
// The Met, Smithsonian Open Access, Europeana (pictures); Internet Archive (public-domain books as PDF, films).
// Every step keeps its work, so it can be stopped and run again at any time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ff } from './lib/ff.mjs';
import { CACHE, CONTENT } from './lib/paths.mjs';
import { keyFor, markSpent, keyRefused } from './lib/gemini-keys.mjs';

const LIB = path.join(CONTENT, 'library');
const ITEMS = path.join(LIB, 'items.jsonl');
const TOPICS = path.join(LIB, 'topics.json');
const FILES = path.join(CACHE, 'library');
const UA = 'ZALA-VIP-media/1.0 (https://www.zalavip.com)';
const MIN_SIDE = 1000, MAX_IMAGE_MB = 25, MAX_DOC_MB = 60, MAX_VIDEO_MB = 90;
const R2_CAP_GB = 8;       // stays inside R2's free 10 GB
// Lite models have 500 free requests a day, and describing pictures never touches the 20 a day the story needs
const TEXT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const LICENSE_OK = /^(public domain|pd|cc0|cc by(-sa)? ?\d(\.\d)?|cc-by(-sa)?-\d(\.\d)?)/i;
const JUNK = /replica|souvenir|\btoy\b|cartoon|logo|icon\b|flag of|\bmap of\b|coat of arms|poster|stamp|wikipedia|screenshot|\bmodel\b|miniature/i;

const EGYPT = /egypt|pharaoh|ptolem|nile|luxor|thebes|theban|karnak|giza|saqqara|memphis|nubia|alexandria/i;
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const sha1 = (d) => crypto.createHash('sha1').update(d).digest('hex');
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function loadItems() {
  if (!fs.existsSync(ITEMS)) return [];
  return fs.readFileSync(ITEMS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function saveItems(items) {
  fs.mkdirSync(LIB, { recursive: true });
  fs.writeFileSync(`${ITEMS}.tmp`, items.map((i) => JSON.stringify(i)).join('\n') + '\n', 'utf8');
  fs.renameSync(`${ITEMS}.tmp`, ITEMS);
}

async function getJson(url, headers = {}) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(40000) });
      const text = await res.text();
      if (res.ok && /^\s*[{[]/.test(text)) return JSON.parse(text);
      if (res.status !== 429 && res.status < 500) return null;
    } catch {}
    await sleep(8000 * attempt);
  }
  return null;
}

// ── sources: each returns [{ kind, title, url, source, source_url, license, author, w, h }] ──
async function commons(q, n) {
  const j = await getJson('https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6' +
    `&gsrlimit=${n}&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=2400`);
  await sleep(1500);
  return Object.values(j?.query?.pages || {}).map((p) => {
    const ii = p.imageinfo?.[0];
    const license = strip(ii?.extmetadata?.LicenseShortName?.value);
    if (!ii || !LICENSE_OK.test(license) || !/\.(jpe?g|png)$/i.test(p.title)) return null;
    if (Math.max(ii.width, ii.height) < MIN_SIDE) return null;
    return { kind: 'image', title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''), url: (ii.thumburl || ii.url).split('?')[0], source: 'Wikimedia Commons', source_url: ii.descriptionurl,
      license, author: strip(ii.extmetadata?.Artist?.value).slice(0, 80) || 'Unknown', note: strip(ii.extmetadata?.ImageDescription?.value).slice(0, 300) };
  }).filter(Boolean);
}
async function artic(q, n) {
  const j = await getJson(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=${n}&query[term][is_public_domain]=true&fields=id,title,image_id,artist_display,date_display,is_public_domain`);
  return (j?.data || []).filter((a) => a.image_id && a.is_public_domain).map((a) => ({
    kind: 'image', title: `${a.title} (${a.date_display || ''})`, url: `https://www.artic.edu/iiif/2/${a.image_id}/full/1686,/0/default.jpg`, source: 'Art Institute of Chicago',
    source_url: `https://www.artic.edu/artworks/${a.id}`, license: 'CC0', author: strip(a.artist_display).slice(0, 80) || 'Unknown',
  }));
}
async function cleveland(q, n) {
  const j = await getJson(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&cc0=1&has_image=1&limit=${n}`);
  return (j?.data || []).map((a) => {
    const url = a.images?.print?.url || a.images?.web?.url;
    return url && { kind: 'image', title: `${a.title} (${a.creation_date || ''})`, url, source: 'Cleveland Museum of Art', source_url: a.url, license: 'CC0', author: a.creators?.[0]?.description?.slice(0, 80) || 'Unknown', note: strip(a.tombstone).slice(0, 300) };
  }).filter(Boolean);
}
async function met(q, n) {
  const s = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&isPublicDomain=true&q=${encodeURIComponent(q)}`);
  const ids = (s?.objectIDs || s?.results?.map?.((r) => r.objectID) || []).slice(0, n);
  const out = [];
  for (const id of ids) {
    const o = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    await sleep(300);
    if (o?.isPublicDomain && o.primaryImage) out.push({ kind: 'image', title: `${o.title} (${o.objectDate || ''})`, url: o.primaryImage, source: 'The Metropolitan Museum of Art', source_url: o.objectURL, license: 'CC0', author: o.artistDisplayName || 'Unknown', note: `${o.culture || ''} ${o.period || ''} ${o.medium || ''}`.trim() });
  }
  return out;
}
async function smithsonian(q, n) {
  const key = process.env.SMITHSONIAN_API_KEY;
  if (!key) return [];
  const j = await getJson(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(`${q} AND online_media_type:"Images"`)}&rows=${n}&api_key=${key}`);
  const out = [];
  for (const r of j?.response?.rows || []) {
    const media = r.content?.descriptiveNonRepeating?.online_media?.media?.find((m) => m.usage?.access === 'CC0' && m.type === 'Images');
    if (media?.content) out.push({ kind: 'image', title: r.title || 'Untitled', url: media.content, source: 'Smithsonian Open Access', source_url: r.content?.descriptiveNonRepeating?.record_link || '', license: 'CC0', author: 'Smithsonian Institution' });
  }
  return out;
}
async function europeana(q, n) {
  const key = process.env.EUROPEANA_API_KEY;
  if (!key) return [];
  const j = await getJson(`https://api.europeana.eu/record/v2/search.json?wskey=${key}&query=${encodeURIComponent(q)}&reusability=open&media=true&qf=TYPE:IMAGE&rows=${n}`);
  return (j?.items || []).map((i) => {
    const url = i.edmIsShownBy?.[0];
    const rights = String(i.rights?.[0] || '');
    const license = /publicdomain/.test(rights) ? 'Public domain' : /by-sa\/(\d\.\d)/.test(rights) ? `CC BY-SA ${rights.match(/by-sa\/(\d\.\d)/)[1]}` : /\/by\/(\d\.\d)/.test(rights) ? `CC BY ${rights.match(/\/by\/(\d\.\d)/)[1]}` : '';
    return url && license && { kind: 'image', title: strip(i.title?.[0]).slice(0, 120), url, source: 'Europeana', source_url: i.guid || '', license, author: strip(i.dcCreator?.[0]).slice(0, 80) || 'Unknown' };
  }).filter(Boolean);
}
/** Only items the Archive marks public domain / CC, or printed before 1930. */
async function internetArchive(q, n, mediatype) {
  const j = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:${mediatype}`)}&fl[]=identifier&fl[]=title&fl[]=licenseurl&fl[]=date&fl[]=creator&rows=${n}&sort[]=downloads+desc&output=json`);
  const out = [];
  for (const d of j?.response?.docs || []) {
    const year = Number(String(d.date || '').slice(0, 4));
    const lic = String(d.licenseurl || '');
    const license = /publicdomain|\/zero\//.test(lic) ? 'Public domain' : /by-sa/.test(lic) ? 'CC BY-SA 4.0' : /\/by\//.test(lic) ? 'CC BY 4.0' : year && year < 1930 ? 'Public domain' : '';
    if (!license) continue;
    const meta = await getJson(`https://archive.org/metadata/${d.identifier}/files`);
    const want = mediatype === 'texts' ? /\.pdf$/i : /\.mp4$/i;
    const file = (meta?.result || []).filter((f) => want.test(f.name) && !/_text|_bw/i.test(f.name)).sort((a, b) => Number(a.size) - Number(b.size))[0];
    if (!file) continue;
    out.push({ kind: mediatype === 'texts' ? 'text' : 'video', title: strip(d.title).slice(0, 120), url: `https://archive.org/download/${d.identifier}/${encodeURI(file.name)}`, source: 'Internet Archive', source_url: `https://archive.org/details/${d.identifier}`, license, author: strip(Array.isArray(d.creator) ? d.creator[0] : d.creator).slice(0, 80) || 'Unknown' });
    await sleep(500);
  }
  return out;
}

// ── R2 ───────────────────────────────────────────────────────────────────────
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
async function r2Put(key, body, type) {
  const { R2_ACCOUNT_ID: acct, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk, R2_BUCKET: bucket } = process.env;
  if (!acct || !ak || !sk || !bucket) throw new Error('R2 settings missing from .env.local');
  const host = `${acct}.r2.cloudflarestorage.com`;
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const uri = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const payload = sha(body);
  const headers = { 'cache-control': 'public, max-age=31536000, immutable', 'content-type': type, host, 'x-amz-content-sha256': payload, 'x-amz-date': amz };
  const names = Object.keys(headers).sort();
  const canon = ['PUT', uri, '', names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payload].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const kSig = hmac(hmac(hmac(hmac(`AWS4${sk}`, date), 'auto'), 's3'), 'aws4_request');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', kSig).update(sts).digest('hex')}`;
  const { host: _h, ...send } = headers;
  for (let attempt = 1; attempt <= 3; attempt++) {
    // a stuck upload must never hold the whole run: slow connections get more time on big files, but never forever
    const timeout = Math.max(180000, Math.ceil(body.length / 1048576) * 120000);
    const res = await fetch(`https://${host}${uri}`, { method: 'PUT', headers: send, body, signal: AbortSignal.timeout(timeout) }).catch(() => null);
    if (res?.ok) return;
    log(`  upload retry ${attempt}/3 (${res ? `status ${res.status}` : 'no answer'}): ${key}`);
    await sleep(4000 * attempt);
  }
  throw new Error(`R2 upload failed: ${key}`);
}
const publicBase = () => String(process.env.VITE_MEDIA_BASE_URL || '').replace(/\/$/, '');

// ── import the existing vault ────────────────────────────────────────────────
function cmdImport() {
  const items = loadItems();
  const known = new Set(items.map((i) => i.url));
  const vault = path.join(CONTENT, 'vault');
  const skip = new Set(['taxonomy.json', 'master-index.json', 'galleries.json']);
  let added = 0;
  const add = (it) => { if (!it.url || known.has(it.url)) return; known.add(it.url); items.push(it); added++; };
  for (const f of fs.readdirSync(vault).filter((x) => x.endsWith('.json') && !skip.has(x))) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(vault, f), 'utf8')); } catch {}
    for (const it of Array.isArray(list) ? list : []) {
      const url = it.image?.r2_url || (it.image?.r2_key && `${publicBase()}/${it.image.r2_key}`);
      if (!url || !it.image?.license) continue;
      add({ id: sha1(url).slice(0, 14), kind: 'image', title: it.title?.en || it.id, url, source: 'ZALA vault', source_url: it.image.source_url || '', license: it.image.license, author: it.image.author || 'Unknown', note: `${it.era || ''} ${it.period || ''} ${String(it.description?.en || '').slice(0, 300)}`.trim(), topics: [] });
    }
  }
  const g = JSON.parse(fs.readFileSync(path.join(vault, 'galleries.json'), 'utf8'));
  for (const [id, x] of Object.entries(g)) {
    for (const s of x.shots || []) {
      if (!s.r2_url || !s.license) continue;
      add({ id: sha1(s.r2_url).slice(0, 14), kind: 'image', title: `${x.title?.en || id}: ${s.note || ''}`, url: s.r2_url, source: 'ZALA vault', source_url: s.source_url || '', license: s.license, author: s.author || 'Unknown', note: x.era || '', topics: [] });
    }
  }
  saveItems(items);
  log(`Imported ${added}. Library now has ${items.length} items.`);
}

// ── harvest ──────────────────────────────────────────────────────────────────
function tagExisting(items, topicId, topic) {
  const re = new RegExp(topic.match, 'i');
  let n = 0;
  for (const it of items) {
    if (re.test(`${it.title} ${it.note || ''}`) && !it.topics?.includes(topicId)) { (it.topics = it.topics || []).push(topicId); n++; }
  }
  return n;
}

async function storeItem(c, topicId, items, seen) {
  const res = await fetch(c.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) }).catch(() => null);
  if (!res?.ok) return false;
  const body = Buffer.from(await res.arrayBuffer());
  const mb = body.length / 1048576;
  if (mb > (c.kind === 'image' ? MAX_IMAGE_MB : c.kind === 'text' ? MAX_DOC_MB : MAX_VIDEO_MB) || body.length < 5000) return false;
  const digest = sha1(body);
  if (seen.has(digest)) return false;
  seen.add(digest);
  const ext = c.kind === 'text' ? 'pdf' : c.kind === 'video' ? 'mp4' : /png/i.test(res.headers.get('content-type') || '') ? 'png' : 'jpg';
  const type = { pdf: 'application/pdf', mp4: 'video/mp4', png: 'image/png', jpg: 'image/jpeg' }[ext];
  const id = digest.slice(0, 14);
  const key = `library/${c.kind}s/${id}.${ext}`;
  // runs on the cloud server only: the source goes straight to R2, and nothing passes through the owner's computer
  await r2Put(key, body, type);
  fs.mkdirSync(FILES, { recursive: true });
  fs.writeFileSync(path.join(FILES, `${id}.${ext}`), body);
  items.push({ id, kind: c.kind, title: c.title, url: `${publicBase()}/${key}`, r2_key: key, bytes: body.length, sha1: digest, source: c.source, source_url: c.source_url, license: c.license, author: c.author, note: c.note || '', topics: [topicId] });
  return true;
}

async function cmdHarvest(target, { limit, dry }) {
  const topics = JSON.parse(fs.readFileSync(TOPICS, 'utf8'));
  const items = loadItems();
  const seenUrl = new Set(items.map((i) => i.source_url).filter(Boolean));
  const seen = new Set(items.map((i) => i.sha1).filter(Boolean));
  let used = items.reduce((n, i) => n + (i.bytes || 0), 0);
  for (const id of target === 'all' ? Object.keys(topics) : [target]) {
    const topic = topics[id];
    if (!topic) throw new Error(`Unknown topic ${id}`);
    const tagged = tagExisting(items, id, topic);
    log(`\n${id}: ${topic.title} (${tagged} existing items matched)`);
    let added = 0;
    outer:
    // the episode's scenes search first, so what comes back is what the story needs
    for (const q of [...(topic.scenes || []).flatMap((s) => s.queries || []), ...topic.queries]) {
      const found = (await Promise.all([
        commons(q, 12), artic(q, 6), cleveland(q, 6), met(q, 5), smithsonian(q, 5), europeana(q, 6),
      ].map((p) => p.catch(() => [])))).flat();
      for (const c of found) {
        if (added >= limit) break outer;
        if (JUNK.test(c.title) || seenUrl.has(c.source_url)) continue;
        // saves download and upload: nothing leaves the source unless its label ties it to this story
        if (!new RegExp(topic.match, 'i').test(`${c.title} ${c.note || ''}`) && !EGYPT.test(`${c.title} ${c.note || ''}`)) continue;
        seenUrl.add(c.source_url);
        if (dry) { log(`  would add [${c.source}] ${c.title.slice(0, 90)}`); added++; continue; }
        if (used > R2_CAP_GB * 1e9) { log(`Stopped at the ${R2_CAP_GB} GB limit.`); saveItems(items); return; }
        if (await storeItem(c, id, items, seen).catch((e) => { log(`  skipped: ${e.message}`); return false; })) {
          added++;
          used += items[items.length - 1].bytes;
          log(`  + [${c.source}] ${c.title.slice(0, 90)}`);
          saveItems(items);
        }
        await sleep(700);
      }
    }
    for (const mediatype of ['texts', 'movies']) {
      const found = await internetArchive(topic.archive || topic.title, 3, mediatype).catch(() => []);
      for (const c of found) {
        if (seenUrl.has(c.source_url)) continue;
        seenUrl.add(c.source_url);
        if (dry) { log(`  would add [${c.kind}] ${c.title.slice(0, 90)}`); continue; }
        if (await storeItem(c, id, items, seen).catch(() => false)) log(`  + [${c.kind}] ${c.title.slice(0, 90)}`);
      }
    }
    saveItems(items);
    log(`${id}: ${added} new pictures.`);
  }
}

// ── describe: what is really in each picture ─────────────────────────────────
let callsLeft = Infinity;   // every call to Gemini counts, busy answers too: part of the day's free requests stays for the story and the motion checks
async function askVision(parts) {
  for (let round = 1; round <= 5; round++) {
    for (const model of TEXT_MODELS) {
      const key = keyFor(model);   // models that used up today's free requests on every key: no point waiting on them
      if (!key) continue;
      if (callsLeft <= 0) return null;
      callsLeft--;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }), signal: AbortSignal.timeout(180000),
        });
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
        if (res.ok && text) return JSON.parse(text);
        if (JSON.stringify(data.error || '').includes('PerDay')) log(`  ${model}: today's free Gemini requests are used up on key ${markSpent(model, key)}`);
        else if (keyRefused(res.status, data.error)) log(`  ${model}: Google refused key ${markSpent(model, key)}`);
        else log(`  ${model}: answered ${res.status} ${String(data.error?.status || '')}`);
      } catch (e) { log(`  ${model}: ${e.name}`); }
    }
    if (TEXT_MODELS.every((m) => !keyFor(m))) return null;
    await sleep(20000 * round);
  }
  return null;
}

async function localFile(it) {
  fs.mkdirSync(FILES, { recursive: true });
  const ext = /\.png$/i.test(it.url) ? 'png' : 'jpg';
  const file = path.join(FILES, `${it.id}.${ext}`);
  if (fs.existsSync(file) && fs.statSync(file).size > 3000) return file;
  const res = await fetch(it.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) }).catch(() => null);
  if (!res?.ok) return null;
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function cmdDescribe(target, { limit, requests }) {
  const items = loadItems();
  // pictures this episode already bans by name use up no free requests
  let banned = null;
  try { const r = target && JSON.parse(fs.readFileSync(TOPICS, 'utf8'))[target]?.forbid; if (r) banned = new RegExp(r, 'i'); } catch {}
  const todo = items.filter((i) => i.kind === 'image' && (!i.seen || (i.seen.usable !== false && !i.seen.symbols)) && (!target || i.topics?.includes(target)) && !(banned && banned.test(`${i.title} ${i.note || ''}`))).slice(0, limit);
  log(`Describing ${todo.length} pictures`);
  const BATCH = 16;   // the free plan counts requests, not pictures, so each request carries more
  if (requests) callsLeft = requests;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (callsLeft <= 0) { log(`Stopped after ${requests} calls to Gemini, the rest of today's free requests stay for the story.`); break; }
    const group = todo.slice(i, i + BATCH);
    const parts = [{
      text: `You catalog pictures for a YouTube channel telling true stories about ancient Egypt to Americans. For each picture numbered below, using what you SEE plus its label, return JSON {"items":[{"n":0,"what":"one factual sentence of what is visible","subject":"named person, object or place if certain, else empty","period":"historical period shown or made, e.g. 30 BC, New Kingdom, 18th century painting, modern photo","place":"","type":"statue|relief|coin|artifact|painting|engraving|archaeological site|landscape|modern photo|manuscript|other","mood":"one or two words","symbols":["every religious sign, script or modern object you can see, named plainly, such as christian cross, church, crescent, mosque, arabic writing, latin writing, car, power line; empty if none"],"wide":true if there is a real scene or landscape that gentle motion would suit,"usable":false if it is a modern replica, cartoon, unrelated to Egypt or its ancient neighbours, has a large watermark or text, or is too poor to show full screen,"reason":"only if unusable"}]}. Never guess a name you cannot support from the label or the picture.`,
    }];
    const ok = [];
    for (const it of group) {
      const file = await localFile(it);
      if (!file) { it.seen = { usable: false, reason: 'download failed' }; continue; }
      try {
        const data = ff(['-i', file, '-frames:v', '1', '-vf', 'scale=512:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '7', 'pipe:1']).toString('base64');
        parts.push({ text: `Picture ${ok.length}. Label: ${String(it.title).slice(0, 150)}. ${String(it.note || '').slice(0, 200)}` });
        parts.push({ inlineData: { mimeType: 'image/jpeg', data } });
        ok.push(it);
      } catch { it.seen = { usable: false, reason: 'unreadable file' }; }
    }
    if (ok.length) {
      const a = await askVision(parts);
      if (!a?.items) {
        log(callsLeft <= 0 ? `Stopped after ${requests} calls to Gemini, the rest of today's free requests stay for the story.` : 'Gemini is not answering right now; finished pictures are saved. Run describe again later.');
        break;
      }
      for (const r of a.items) { const it = ok[r.n]; if (it) { const { n, ...seen } = r; it.seen = seen; } }
    }
    saveItems(items);
    log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    await sleep(4000);
  }
  saveItems(items);
}

// ── upload: moves pictures still waiting from their source straight to R2, on the cloud server ──
async function cmdUpload() {
  const items = loadItems();
  const todo = items.filter((i) => i.r2_pending);
  log(`Moving ${todo.length} files from their sources to R2`);
  let done = 0, failed = 0;
  for (const it of todo) {
    const { key, type } = it.r2_pending;
    try {
      const res = await fetch(it.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
      if (!res.ok) throw new Error(`source answered ${res.status}`);
      await r2Put(key, Buffer.from(await res.arrayBuffer()), type);
      it.url = `${publicBase()}/${key}`;
      it.r2_key = key;
      delete it.r2_pending;
      saveItems(items);
      done++;
      log(`  uploaded ${done}/${todo.length}`);
    } catch (e) { log(`  upload failed, it stays waiting for the next run: ${e.message}`); failed++; }
  }
  log(`Upload finished: ${done} uploaded, ${failed} still waiting.`);
}

function cmdCoverage() {
  const topics = JSON.parse(fs.readFileSync(TOPICS, 'utf8'));
  const items = loadItems();
  for (const [id, t] of Object.entries(topics)) tagExisting(items, id, t);
  saveItems(items);
  log(`Library: ${items.length} items, ${(items.reduce((n, i) => n + (i.bytes || 0), 0) / 1e9).toFixed(2)} GB harvested so far`);
  for (const [id, t] of Object.entries(topics)) {
    const mine = items.filter((i) => i.topics?.includes(id));
    const images = mine.filter((i) => i.kind === 'image');
    log(`${id}  pictures ${String(images.length).padStart(4)}  checked good ${String(images.filter((i) => i.seen?.usable).length).padStart(4)}  books ${mine.filter((i) => i.kind === 'text').length}  films ${mine.filter((i) => i.kind === 'video').length}  ${t.title}`);
  }
}

/** Real open-license photos for one search phrase, pooled from every source above (for a single picture, not a whole harvest). */
export async function findOpenPhoto(q, n = 8) {
  const found = (await Promise.all([
    commons(q, n), artic(q, Math.ceil(n / 2)), cleveland(q, Math.ceil(n / 2)), met(q, Math.ceil(n / 2)), smithsonian(q, Math.ceil(n / 2)), europeana(q, Math.ceil(n / 2)),
  ].map((p) => p.catch(() => [])))).flat();
  return found.filter((c) => !JUNK.test(c.title));
}

// ── command line (skipped when this file is imported for its functions instead of run directly) ──────────────
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('library-harvest.mjs');
if (isMain) {
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (n) => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
const limit = Number(opt('--limit', 0));
const requestsArg = opt('--requests', 0);
const dry = flag('--dry-run');
const [cmd, target] = argv;
// the owner's data plan is never used for pictures: anything that moves files runs only on the cloud server
if (['harvest', 'describe', 'upload'].includes(cmd) && !dry && !process.env.CI) {
  log(`"${cmd}" runs on the cloud server only, not on this computer. Start it from GitHub Actions in zala-render.`);
  process.exit(1);
}
if (cmd === 'import') cmdImport();
else if (cmd === 'harvest' && target) await cmdHarvest(target, { limit: limit || 60, dry });
else if (cmd === 'describe') await cmdDescribe(target, { limit: limit || 200, requests: Number(requestsArg) || 0 });
else if (cmd === 'coverage') cmdCoverage();
else if (cmd === 'upload') await cmdUpload();
else { log('usage: node media/library-harvest.mjs import | harvest <topic|all> [--limit n] [--dry-run] | describe [topic] [--limit n] | coverage | upload'); process.exit(1); }
}
