// Makes the prepared Google Flow shots on the owner's computer, then puts them on R2 for the factory.
// Runs in its own Chrome window (own profile, the Korean account signed in once by the owner), so the owner's
// normal Chrome is never touched. Nothing to install: Chrome's own remote protocol over Node's WebSocket.
//   node media/tools/flow-runner.mjs ZV-T02 [ZV-T03 ...]   make every shot not made yet
//   node media/tools/flow-runner.mjs --login               open the window so the owner can sign in once
// Results: R2 vault/flow/<episode>/<n>.mp4 and render-state/content/prep/<episode>.flow.json (read by gapfill.mjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const env = {};
try { for (const l of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } } catch { /* keys from the environment */ }
const K = (n) => process.env[n] || env[n];
const BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';
const PORT = 9333;
const PROFILE = path.join(os.homedir(), 'zala-flow-chrome');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FLOW = 'https://labs.google/fx/tools/flow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── R2 upload (S3 signature v4, no library) ──
function r2Put(key, body, type) {
  const host = `${K('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const uri = `/${K('R2_BUCKET')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { host, 'x-amz-content-sha256': hash, 'x-amz-date': amz, 'content-type': type };
  const names = Object.keys(headers).sort();
  const canon = ['PUT', uri, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), hash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, crypto.createHash('sha256').update(canon).digest('hex')].join('\n');
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const sk = hmac(hmac(hmac(hmac(`AWS4${K('R2_SECRET_ACCESS_KEY')}`, day), 'auto'), 's3'), 'aws4_request');
  const sig = crypto.createHmac('sha256', sk).update(toSign).digest('hex');
  return fetch(`https://${host}${uri}`, { method: 'PUT', body, headers: { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${K('R2_ACCESS_KEY_ID')}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` } })
    .then(async (r) => { if (!r.ok) throw new Error(`R2 refused ${key}: ${r.status} ${await r.text()}`); });
}

// ── Chrome ──
async function chromeUp() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { return null; }
}
async function startChrome() {
  if (await chromeUp()) return;
  spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000', FLOW], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 30 && !(await chromeUp()); i++) await sleep(1000);
  if (!(await chromeUp())) throw new Error('Chrome did not start');
}
async function page() {
  const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let t = tabs.find((x) => x.type === 'page' && x.url.includes('flow')) || tabs.find((x) => x.type === 'page');
  if (!t) t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${FLOW}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0; const wait = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page script failed'); return r.result?.result?.value; };
  return { send, js, close: () => ws.close() };
}
// clicks the visible element whose own text (or aria-label) matches; returns true when found
const clickText = (p, re) => p.js(`(() => { const re = ${re}; const els = [...document.querySelectorAll('button,[role=button],[role=option],[role=menuitem],[role=radio],div,span')]
  .filter((e) => e.offsetParent && re.test((e.getAttribute('aria-label') || e.innerText || '').trim()) && e.innerText.length < 60);
  const e = els.sort((a, b) => a.innerText.length - b.innerText.length)[0]; if (!e) return false; e.click(); return true; })()`);
const videos = (p) => p.js(`[...document.querySelectorAll('video')].map((v) => v.currentSrc || v.src || v.querySelector('source')?.src).filter(Boolean)`);

async function makeShot(p, prompt) {
  // a fresh project for each episode keeps the gallery small; the prompt box is the page's only textarea
  const before = new Set(await videos(p));
  const ok = await p.js(`(() => { const t = document.querySelector('textarea'); if (!t) return false; t.focus(); t.select?.(); return true; })()`);
  if (!ok) throw new Error('no prompt box on the page');
  await p.send('Input.insertText', { text: prompt });
  await sleep(800);
  const sent = await p.js(`(() => { const b = document.querySelector('button[type=submit]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
  if (!sent) throw new Error('the create button did not take the prompt');
  log('   sent, waiting for Flow');
  for (let i = 0; i < 90; i++) {   // up to 15 minutes
    await sleep(10000);
    const fresh = (await videos(p)).filter((v) => !before.has(v));
    if (fresh.length) return fresh[0];
    const fail = await p.js(`/(failed|couldn.t|could not|try again|policy|تعذّر|فشل|سياس)/i.test(document.body.innerText.slice(-4000)) ? document.body.innerText.slice(-300) : ''`);
    if (fail && i > 3) throw new Error(`Flow refused: ${fail.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  throw new Error('Flow took more than 15 minutes');
}

async function settings(p) {
  // video, 16:9, newest model, 720p, one result, 8 seconds: about 24 credits a shot
  if (!(await clickText(p, /720p|360p/))) { log('   (settings button not found, keeping Flow defaults)'); return; }
  await sleep(700);
  for (const re of [/^(videocam\s*)?(فيديو|video)$/i, /^(crop_landscape\s*)?16:9$/, /^720p$/, /^x1$/]) { await clickText(p, re); await sleep(400); }
  if (await clickText(p, /^Omni 1\.\d Flash$/)) { await sleep(500); await clickText(p, /^Omni 1\.2 Flash$/); await sleep(400); }
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
}

// ── run ──
const args = process.argv.slice(2);
await startChrome();
if (args.includes('--login')) { log(`Chrome is open (profile ${PROFILE}). Sign in to Flow with the Korean account in that window, then close it.`); process.exit(0); }
const p = await page();
for (const ep of args.filter((a) => /^ZV-/.test(a))) {
  const prep = await (await fetch(`${BASE}/render-state/content/prep/${ep}.json?t=${Date.now()}`)).json();
  let done = { id: ep, shots: [] };
  try { done = await (await fetch(`${BASE}/render-state/content/prep/${ep}.flow.json?t=${Date.now()}`)).json(); } catch { /* first run */ }
  const todo = prep.shots.filter((s) => !done.shots.some((d) => d.line === s.line && d.url));
  log(`${ep}: ${todo.length} of ${prep.shots.length} shots to make`);
  if (!todo.length) continue;
  // a new project per episode
  await p.send('Page.navigate', { url: FLOW });
  await sleep(6000);
  const signedIn = await p.js(`!/sign in|تسجيل الدخول/i.test(document.body.innerText.slice(0, 2000))`);
  if (!signedIn) throw new Error('Flow is not signed in: run with --login and sign in with the Korean account');
  await clickText(p, /^(add_2\s*)?(مشروع جديد|New project)$/i);
  await sleep(6000);
  await settings(p);
  for (const s of todo) {
    log(` shot ${s.n} (${s.kind})`);
    try {
      const src = await makeShot(p, s.prompt);
      const data = Buffer.from(await p.js(`fetch(${JSON.stringify(src)}).then((r) => r.arrayBuffer()).then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); })`), 'base64');
      if (data.length < 100000) throw new Error(`the video is only ${data.length} bytes`);
      const key = `vault/flow/${ep}/${s.n}-${crypto.createHash('sha1').update(s.prompt).digest('hex').slice(0, 8)}.mp4`;
      await r2Put(key, data, 'video/mp4');
      done.shots = done.shots.filter((d) => d.line !== s.line).concat({ n: s.n, line: s.line, url: `${BASE}/${key}`, bytes: data.length, at: new Date().toISOString() });
      await r2Put(`render-state/content/prep/${ep}.flow.json`, Buffer.from(JSON.stringify(done, null, 2)), 'application/json');
      log(`   ready: ${key} (${Math.round(data.length / 1e5) / 10} MB)`);
    } catch (e) { log(`   failed: ${e.message}`); }
  }
}
p.close();
log('done');
