#!/usr/bin/env node
// Runs on the owner's computer once. The owner approves access in the browser, the server swaps the code for a token,
// and the token goes straight into a GitHub secret. Nobody sees it and it is never written to a file.
// Usage: node media/tools/youtube-login.mjs <client id>
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = 'alaahesham1989-dev/zala-render';
const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}/`;
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const clientId = process.argv[2];
if (!clientId) throw new Error('client id required');

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = crypto.randomBytes(16).toString('hex');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent select_account', scope: SCOPES.join(' '), state })}`;
console.log(`OPEN:${url}`);

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const q = new URL(req.url, REDIRECT).searchParams;
    if (!q.get('code') && !q.get('error')) { res.writeHead(404); res.end(); return; }
    const ok = q.get('state') === state && q.get('code');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2 dir="rtl" style="font-family:sans-serif;text-align:center;margin-top:80px">${ok ? 'تمام، الموافقة وصلت. تقدر تقفل الصفحة دي.' : 'الموافقة ما كملتش.'}</h2>`);
    server.close();
    if (ok) resolve(q.get('code')); else reject(new Error(`consent failed: ${q.get('error') || 'state mismatch'}`));
  });
  server.listen(PORT, '127.0.0.1');
  setTimeout(() => { server.close(); reject(new Error('no consent within 15 minutes')); }, 15 * 60 * 1000).unref();
});
console.log('Consent received, asking the server for the token');

const before = gh('run', 'list', '--repo', REPO, '--workflow', 'youtube.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // 0').trim();
gh('workflow', 'run', 'youtube.yml', '--repo', REPO, '-f', 'action=token', '-f', `code=${code}`, '-f', `redirect=${REDIRECT}`, '-f', `key=${Buffer.from(publicKey).toString('base64')}`);
let run = '';
for (let i = 0; i < 40 && !run; i++) {
  await sleep(5000);
  const latest = gh('run', 'list', '--repo', REPO, '--workflow', 'youtube.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId // 0').trim();
  if (latest !== before) run = latest;
}
if (!run) throw new Error('the server run did not start');
let done = false;
for (let i = 0; i < 60 && !done; i++) {
  await sleep(5000);
  done = gh('run', 'view', run, '--repo', REPO, '--json', 'status', '--jq', '.status').trim() === 'completed';
}
const log = gh('run', 'view', run, '--repo', REPO, '--log');
const sealed = log.match(/SEALED_TOKEN:([A-Za-z0-9+/=]+)/)?.[1];
if (!sealed) {
  const refused = log.match(/Google refused[^\n]*/)?.[0];
  throw new Error(refused || `no token in run ${run}`);
}
const token = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(sealed, 'base64')).toString('utf8');
const r = spawnSync('gh', ['secret', 'set', 'YOUTUBE_REFRESH_TOKEN', '--repo', REPO], { input: token, encoding: 'utf8' });
if (r.status !== 0) throw new Error('could not save the secret');
console.log('SAVED: YOUTUBE_REFRESH_TOKEN');
console.log(log.match(/Scopes granted:[^\n]*/)?.[0] || '');
