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
import { spawn, execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..', '..');   // import.meta.dirname keeps the Arabic folder name readable
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
  // curl, not fetch: Node's own TLS is refused by R2 on this network, curl is not
  const tmp = path.join(os.tmpdir(), `zala-put-${process.pid}`);
  fs.writeFileSync(tmp, body);
  const auth = `AWS4-HMAC-SHA256 Credential=${K('R2_ACCESS_KEY_ID')}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
  const hdrs = Object.entries({ ...headers, authorization: auth }).filter(([k]) => k !== 'host').flatMap(([k, v]) => ['-H', `${k}: ${v}`]);
  const out = execFileSync('curl', ['-sS', '-X', 'PUT', '-w', '%{http_code}', '-o', '-', '--data-binary', `@${tmp}`, ...hdrs, `https://${host}${uri}`], { encoding: 'utf8' });
  fs.rmSync(tmp, { force: true });
  if (!out.endsWith('200')) throw new Error(`R2 refused ${key}: ${out.slice(-300)}`);
  return Promise.resolve();
}

// ── Chrome ──
async function chromeUp() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { return null; }
}
async function startChrome() {
  if (await chromeUp()) return;
  spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
    // the window works behind others: without these Chrome pauses its animations and Flow's page never finishes opening
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1400,1000', FLOW], { detached: true, stdio: 'ignore' }).unref();
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
  // Flow's own answers (batchexecute) carry each finished file as a signed link: flow-content.google/<video|image>/<id>?...
  const media = new Map();   // id -> { video, image }
  const pending = new Set();
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const scan = (body) => {
    const s = body.split('\\\\u003d').join('=').split('\\\\u0026').join('&').split('\\u003d').join('=').split('\\u0026').join('&');
    for (const m of s.matchAll(/https:\/\/(?:flow-content\.google|storage\.googleapis\.com\/ai-sandbox-videofx)\/(video|image)\/([\w-]{36})\?[^"\\\s]+/g)) {
      const e = media.get(m[2]) || {};
      e[m[1]] = m[0];
      media.set(m[2], e);
    }
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); return; }
    if (m.method === 'Network.responseReceived' && /batchexecute/.test(m.params.response.url)) pending.add(m.params.requestId);
    if (m.method === 'Network.loadingFinished' && pending.has(m.params.requestId)) {
      pending.delete(m.params.requestId);
      send('Network.getResponseBody', { requestId: m.params.requestId }).then((r) => { const b = r.result; if (b?.body) scan(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); });
    }
  };
  await send('Network.enable', { maxResourceBufferSize: 50e6, maxTotalBufferSize: 200e6 });
  const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page script failed'); return r.result?.result?.value; };
  return { send, js, media, close: () => ws.close() };
}
// clicks the visible element whose own text (or aria-label) matches; returns true when found
const clickText = (p, re) => p.js(`(() => { const re = ${re}; const els = [...document.querySelectorAll('button,[role=button],[role=option],[role=menuitem],[role=radio],div,span')]
  .filter((e) => e.offsetParent && re.test((e.getAttribute('aria-label') || e.innerText || '').trim()) && e.innerText.length < 60);
  const e = els.sort((a, b) => a.innerText.length - b.innerText.length)[0]; if (!e) return false; e.click(); return true; })()`);
// a finished shot shows as a picture whose alt text is its prompt and whose link holds its id (flow-content.google/image/<id>)
const idsFor = (p, prompt) => p.js(`[...new Set([...document.querySelectorAll('img')].filter((i) => (i.alt || '').startsWith(${JSON.stringify(String(prompt).slice(0, 40))})).map((i) => ((i.currentSrc || i.src).match(/\\/image\\/([\\w-]{36})/) || [])[1]).filter(Boolean))]`);
const stillSrcs = (p, prompt) => p.js(`[...new Set([...document.querySelectorAll('img')].filter((i) => (i.alt || '').startsWith(${JSON.stringify(String(prompt).slice(0, 40))}) && (i.currentSrc || i.src).includes('/asb/')).map((i) => i.currentSrc || i.src))]`);
const projectUrl = () => { const f = path.join(PROFILE, 'zala-project.txt'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : ''; };
const openProject = async (p) => { await p.send('Page.navigate', { url: projectUrl() }); await sleep(9000); };

/** Sends one prompt to Flow's agent and returns the signed link of the finished video (or picture). */
async function makeShot(p, prompt, still = false) {
  // always from the project page (a click elsewhere can leave the window in a video's edit page)
  if (!(await p.js('location.href')).startsWith(projectUrl()) || /\/edit\//.test(await p.js('location.href'))) await openProject(p);
  // a Nano Banana picture shows as an image whose alt is its prompt; its own /asb/ link serves the full picture
  if (still) {
    const old = await stillSrcs(p, prompt);
    if (old.length) { log('   already made in Flow, taking it'); return old[0]; }
  }
  const before = new Set(await idsFor(p, prompt));
  // already made on an earlier run (the window closed, a step failed): take it, no credits spent again
  // (Flow's media list arrives a few seconds after the page opens, so wait for it before deciding)
  for (let k = 0; !still && before.size && k < 10; k++) {
    for (const id of before) { const link = p.media.get(id)?.[still ? 'image' : 'video']; if (link) { log('   already made in Flow, taking it'); return link; } }
    await sleep(3000);
  }
  if (process.env.NO_SEND) throw new Error('not made yet (NO_SEND: nothing sent)');
  const text = still ? `Create exactly one 16:9 image (an image, not a video) with Nano Banana from this prompt, word for word, with no changes:\n${prompt}` : `Create exactly one 8-second 16:9 video (a video, not an image) from this prompt, word for word, with no changes:\n${prompt}`;
  const box = `document.querySelector('.ProseMirror, [contenteditable=true][role=textbox], div[contenteditable=true], textarea')`;
  const marker = JSON.stringify(prompt.slice(0, 30));
  // type, press the arrow, then make sure it really left: the box is empty and the prompt shows in the agent's chat
  let sent = false;
  for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
    await sleep(3000);
    const ok = await p.js(`(() => { const t = ${box}; if (!t) return false; t.focus(); t.click(); return true; })()`);
    if (!ok) { await openProject(p); continue; }
    if (!(await p.js(`(${box}.innerText || ${box}.value || '').includes(${marker})`))) await p.send('Input.insertText', { text });
    await sleep(1500);
    // the send arrow only answers a real mouse click (a script click is ignored by the page)
    const pt = await p.js(`(() => { const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent && /بدء الإنشاء|^Create|Send|إرسال/.test(e.getAttribute('aria-label') || '')); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (pt) for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: pt[0], y: pt[1], button: 'left', clickCount: 1 });
    await sleep(6000);
    sent = await p.js(`!(${box}?.innerText || '').includes(${marker}) && document.body.innerText.includes(${marker})`);
    if (!sent) log(`   not sent yet (try ${attempt})`);
  }
  if (!sent) throw new Error('the prompt could not be sent to Flow');
  log('   sent, waiting for Flow');
  for (let i = 1; i <= 60; i++) {   // up to 20 minutes
    await sleep(still ? 10000 : 20000);
    if (still) { const made = await stillSrcs(p, prompt); if (made.length) return made[0]; continue; }
    if (i % 3 === 0) await openProject(p);   // a fresh page makes Flow send its media list again
    const fresh = (await idsFor(p, prompt)).filter((id) => !before.has(id));
    for (const id of fresh) {
      const link = p.media.get(id)?.[still ? 'image' : 'video'];
      if (link) return link;
    }
    const fail = await p.js(`/(couldn.t generate|could not generate|violat|policy|تعذّر إنشاء|فشل الإنشاء)/i.test(document.body.innerText.slice(-3000)) ? document.body.innerText.slice(-300) : ''`);
    if (fail) throw new Error(`Flow refused: ${fail.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  throw new Error('Flow took more than 20 minutes');
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
// --put <episode> <shot number> <file.mp4>: puts a shot already made (for example downloaded by hand) in its place
if (args[0] === '--put') {
  const [, ep, n, file] = args;
  const prep = await (await fetch(`${BASE}/render-state/content/prep/${ep}.json?t=${Date.now()}`)).json();
  const s = prep.shots.find((x) => String(x.n) === String(n));
  let done = { id: ep, shots: [] };
  try { done = await (await fetch(`${BASE}/render-state/content/prep/${ep}.flow.json?t=${Date.now()}`)).json(); } catch { /* first */ }
  const data = fs.readFileSync(file);
  const key = `vault/flow/${ep}/${s.n}-${crypto.createHash('sha1').update(s.prompt).digest('hex').slice(0, 8)}.mp4`;
  await r2Put(key, data, 'video/mp4');
  done.shots = done.shots.filter((d) => d.line !== s.line).concat({ n: s.n, line: s.line, url: `${BASE}/${key}`, bytes: data.length, at: new Date().toISOString() });
  await r2Put(`render-state/content/prep/${ep}.flow.json`, Buffer.from(JSON.stringify(done, null, 2)), 'application/json');
  log(`put ${key}`); process.exit(0);
}
const p = await page();
for (const ep of args.filter((a) => /^ZV-/.test(a))) {
  const prep = await (await fetch(`${BASE}/render-state/content/prep/${ep}.json?t=${Date.now()}`)).json();
  let done = { id: ep, shots: [] };
  try { done = await (await fetch(`${BASE}/render-state/content/prep/${ep}.flow.json?t=${Date.now()}`)).json(); } catch { /* first run */ }
  const todo = prep.shots.filter((s) => !done.shots.some((d) => d.line === s.line && d.url)).slice(0, Number(process.env.LIMIT || 99));   // LIMIT=1 for a test
  log(`${ep}: ${todo.length} of ${prep.shots.length} shots to make`);
  if (!todo.length) continue;
  // a new project per episode
  const projectFile = path.join(PROFILE, 'zala-project.txt');
  const here = await p.js('location.href');
  if (!/\/project\//.test(here)) {
    await p.send('Page.navigate', { url: fs.existsSync(projectFile) ? fs.readFileSync(projectFile, 'utf8').trim() : FLOW });
    await sleep(8000);
  }
  const signedIn = await p.js(`!location.href.includes('accounts.google') && !location.pathname.startsWith('/about')`);
  if (!signedIn) throw new Error('Flow is not signed in: run with --login and sign in with the Korean account');
  const url = await p.js('location.href');
  if (/\/project\//.test(url)) fs.writeFileSync(projectFile, url);
  else throw new Error('no Flow project open: open one project in the Flow window and run again');
  await openProject(p);   // a fresh load, so Flow sends its media list with the signed links
  for (const s of todo) {
    log(` shot ${s.n} (${s.kind})`);
    try {
      const still = s.kind === 'still';
      const src = await makeShot(p, s.prompt, still);
      // the page cannot read its own video (it redirects to Google's video servers), so Node downloads it with the window's cookies
      const { cookies } = await p.send('Network.getCookies', { urls: [src] }).then((m) => m.result);
      const res = await fetch(src, { headers: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '), 'user-agent': 'Mozilla/5.0' }, redirect: 'follow' });
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length < (still ? 20000 : 100000)) throw new Error(`the file is only ${data.length} bytes`);
      const type = (res.headers.get('content-type') || (still ? 'image/jpeg' : 'video/mp4')).split(';')[0];
      if (still ? !type.startsWith('image/') : !type.startsWith('video/')) throw new Error(`Flow sent ${type}, not the file`);
      const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'video/mp4': 'mp4' }[type] || (still ? 'jpg' : 'mp4');
      const key = `vault/flow/${ep}/${s.n}-${crypto.createHash('sha1').update(s.prompt).digest('hex').slice(0, 8)}.${ext}`;
      await r2Put(key, data, type);
      done.shots = done.shots.filter((d) => d.line !== s.line).concat({ n: s.n, line: s.line, kind: s.kind, url: `${BASE}/${key}`, bytes: data.length, at: new Date().toISOString() });
      await r2Put(`render-state/content/prep/${ep}.flow.json`, Buffer.from(JSON.stringify(done, null, 2)), 'application/json');
      log(`   ready: ${key} (${Math.round(data.length / 1e5) / 10} MB)`);
    } catch (e) { log(`   failed: ${e.message}`); }
  }
}
p.close();
log('done');
