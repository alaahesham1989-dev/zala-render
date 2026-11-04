#!/usr/bin/env node
// media/tools/sync-render-state.mjs — sends the small text files the cloud render needs to R2 (render-state/content/...).
// Scripts, the picture index and the fact bank stay out of the public zala-render repository. Text only, about 1.5 MB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONTENT } from '../lib/paths.mjs';

const { R2_ACCOUNT_ID: acct, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk, R2_BUCKET: bucket } = process.env;
if (!acct || !ak || !sk || !bucket) throw new Error('R2 settings missing from .env.local');
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

async function put(key, body) {
  const host = `${acct}.r2.cloudflarestorage.com`;
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const uri = `/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const payload = sha(body);
  const headers = { 'content-type': 'application/json', host, 'x-amz-content-sha256': payload, 'x-amz-date': amz };
  const names = Object.keys(headers).sort();
  const canon = ['PUT', uri, '', names.map((n) => `${n}:${headers[n]}\n`).join(''), names.join(';'), payload].join('\n');
  const scope = `${date}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canon)].join('\n');
  const kSig = hmac(hmac(hmac(hmac(`AWS4${sk}`, date), 'auto'), 's3'), 'aws4_request');
  const auth = `AWS4-HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${names.join(';')}, Signature=${crypto.createHmac('sha256', kSig).update(toSign).digest('hex')}`;
  const { host: _h, ...send } = headers;
  const res = await fetch(`https://${host}${uri}`, { method: 'PUT', headers: { ...send, authorization: auth }, body, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`R2 said ${res.status} for ${key}`);
}

const files = [];
for (const dir of ['library', 'factbank', 'youtube']) {
  for (const f of fs.readdirSync(path.join(CONTENT, dir))) {
    if (/\.(json|jsonl)$/.test(f)) files.push(`${dir}/${f}`);
  }
}
let bytes = 0;
for (const f of files) {
  const body = fs.readFileSync(path.join(CONTENT, f));
  bytes += body.length;
  await put(`render-state/content/${f}`, body);
}
console.log(`Sent ${files.length} text files, ${(bytes / 1048576).toFixed(1)} MB`);
