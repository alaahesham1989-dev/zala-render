// Puts the older episodes (made before the factory, already public on YouTube) on R2 with a publish package,
// so meta-publish.mjs can post them to Facebook and Instagram from the queue like any factory episode.
// Runs on the owner's computer (the files only exist here). Upload through curl (Node's TLS is refused by R2 here).
// Usage: node media/tools/old-to-meta.mjs <youtube list json>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(REPO, 'media', 'out');
const env = {};
for (const l of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** PUT a file to R2 with an unsigned payload (big files stream from disk through curl). */
function r2Put(key, file, type) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const uri = `/${env.R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amz, 'content-type': type };
  const names = Object.keys(headers).sort();
  const canon = ['PUT', uri, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, crypto.createHash('sha256').update(canon).digest('hex')].join('\n');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const sk = hmac(hmac(hmac(hmac(`AWS4${env.R2_SECRET_ACCESS_KEY}`, day), 'auto'), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', sk).update(toSign).digest('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
  const hdrs = Object.entries({ ...headers, authorization: auth }).filter(([k]) => k !== 'host').flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
  const out = execFileSync('curl', ['-sS', '--retry', '3', '-X', 'PUT', '-w', '%{http_code}', '-o', '-', '--data-binary', `@${file}`, ...hdrs, `https://${host}${uri}`], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (!out.endsWith('200')) throw new Error(`R2 refused ${key}: ${out.slice(-300)}`);
}

// YouTube video -> local file, package id, which part
const PLAN = [
  { yt: 'nBzykla2xZY', file: 'S002.mp4', pkg: 'ZV-OLD-S002', which: 'R1' },
  { yt: 'hGcQqtKDOeo', file: 'ZV-L03_The_Search_for_Imhotep.mp4', pkg: 'ZV-L03', which: 'main' },
  { yt: 'ovL-0R0530U', file: 'ZV-L03-R1.mp4', pkg: 'ZV-L03', which: 'R1' },
  { yt: '7t34nj5bt_c', file: 'ZV-L04_The_Pharaohs_Midnight_Escape.mp4', pkg: 'ZV-L04', which: 'main' },
  { yt: 'l_2WxaxVGAc', file: 'ZV-L04-R1.mp4', pkg: 'ZV-L04', which: 'R1' },
  { yt: '8GPfKbyIAzE', file: 'ZV004.mp4', pkg: 'ZV-OLD-ALEX', which: 'main' },
  { yt: 'EGuGMlpBC4Y', file: 'S001.mp4', pkg: 'ZV-OLD-S001', which: 'R1' },
];

const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const firstPara = (d) => String(d || '').split(/\n\s*\n/)[0].trim();
const cleanTitle = (t) => String(t).replace(/\s*#shorts?\b/ig, '').replace(/\s*\((?:4K|Secret Cache TT320)\)/g, '').replace(/\s*\|.*$/, '').trim();
// credit lines from the old descriptions (licences, authors), without links to the site or subscribe lines
const creditLines = (d) => String(d || '').split('\n').filter((l) => /CC[- ]?BY|CC0|public domain|pixabay|wikimedia|licen[sc]|kevin macleod|incompetech|courtesy|photo|image|footage/i.test(l) && !/zalavip|subscribe|book now|whatsapp/i.test(l)).map((l) => l.trim()).filter(Boolean);

const pkgs = {};
for (const p of PLAN) {
  const v = list.find((x) => x.id === p.yt);
  if (!v) throw new Error(`${p.yt} is not in the YouTube list`);
  const k = pkgs[p.pkg] ||= { id: p.pkg, title: '', description: '', tags: [], reels: [], youtube: {} };
  const ext = path.extname(p.file);
  const target = p.which === 'main' ? `${p.pkg}${ext}` : `${p.pkg}-${p.which}${ext}`;
  const credits = creditLines(v.description);
  if (p.which === 'main' || !k.title) {
    k.title = cleanTitle(v.title);
    k.description = firstPara(v.description) + (credits.length ? `\n\nImage and video credits:\n${credits.join('\n')}` : '');
    k.tags = [...new Set([...(k.tags || []), ...(v.tags || [])])];
  }
  if (p.which === 'main') k.file = target;
  else k.reels.push({ id: `${p.pkg}-${p.which}`, file: target, title: cleanTitle(v.title), sub: firstPara(v.description).split(/(?<=[.!?])\s/)[0] });
  k.youtube[p.which] = p.yt;
  p.target = target;
}

if (process.argv.includes('--dry')) {
  for (const k of Object.values(pkgs)) console.log(JSON.stringify({ id: k.id, title: k.title, file: k.file, story: k.description.split('\n\n')[0].slice(0, 160), credits: (k.description.split('credits:\n')[1] || '').split('\n').length, reels: k.reels.map((r) => `${r.title} | ${r.sub}`) }, null, 1));
  process.exit(0);
}
for (const p of PLAN) {
  const src = path.join(OUT, p.file);
  const mb = (fs.statSync(src).size / 1e6).toFixed(0);
  log(`uploading ${p.file} (${mb} MB) -> renders/${p.pkg}/publish/${p.target}`);
  // curl on Windows cannot open the Arabic folder name, so it reads a copy from the temp folder
  const tmp = path.join(os.tmpdir(), `zala-up-${p.target}`);
  fs.copyFileSync(src, tmp);
  try { r2Put(`renders/${p.pkg}/publish/${p.target}`, tmp, 'video/mp4'); } finally { fs.rmSync(tmp, { force: true }); }
}
for (const k of Object.values(pkgs)) {
  const tmp = path.join(os.tmpdir(), `${k.id}.youtube.json`);
  fs.writeFileSync(tmp, JSON.stringify(k, null, 2));
  r2Put(`renders/${k.id}/publish/${k.id}.youtube.json`, tmp, 'application/json');
  log(`package ${k.id}: ${k.title} (${k.reels.length} reels, main: ${k.file ? 'yes' : 'no'})`);
}
log('done');
