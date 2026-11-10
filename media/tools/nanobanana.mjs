// Nano Banana through Gemini on the web, with the Korean account's saved sign-in (secret GOOGLE_COOKIES), in a background
// browser on the server. The subscription is already paid; nothing here can buy anything. Every picture made here is shown
// with ARTISTIC RECONSTRUCTION on screen.
//
// As a module: const files = await makePictures([{ name, prompt }], outDir)
// As a test:   node media/tools/nanobanana.mjs out_dir "a prompt" ["another prompt"]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const GEMINI = 'https://gemini.google.com/app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[nanobanana]', ...a);

export function paintingPrompt(sentence, topic) {
  return `Create one image, wide 16:9 landscape. A realistic, historically careful oil painting in the style of 19th-century travel art, showing: ${sentence} `
    + `The story is about ${topic}, in Egypt. Accurate period clothing, architecture and objects. No text, no letters, no captions, no frames, `
    + 'no modern objects, no nudity, nobody shown in an undignified way.';
}

async function openBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  if (!process.env.GOOGLE_COOKIES) throw new Error('GOOGLE_COOKIES is not set');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1400, height: 1000 },
    args: ['--lang=en-US', '--no-sandbox', '--disable-dev-shm-usage'] });
  const cookies = JSON.parse(process.env.GOOGLE_COOKIES).map(({ partitionKey, sourcePort, sourceScheme, ...c }) => c);
  await browser.setCookie(...cookies);
  return browser;
}

/** Sends one request and returns the picture as a Buffer. Throws when Gemini does not answer with a picture. */
async function one(page, prompt) {
  await page.goto(GEMINI, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const box = await page.waitForSelector('rich-textarea [contenteditable="true"], div.ql-editor[contenteditable="true"], [role="textbox"][contenteditable="true"]', { timeout: 60000 });
  if (/accounts\.google\.com/.test(page.url())) throw new Error('not signed in');
  const before = new Set(await page.$$eval('img', (imgs) => imgs.map((i) => i.src)));
  await box.click();
  await page.keyboard.type(prompt, { delay: 5 });
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const src = await page.$$eval('img', (imgs, seen) => {
      const fresh = imgs.filter((x) => !seen.includes(x.src) && x.naturalWidth >= 512 && /googleusercontent|blob:/.test(x.src));
      return fresh.length ? fresh[fresh.length - 1].src : '';
    }, [...before]);
    if (src) {
      const b64 = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        const buf = new Uint8Array(await r.arrayBuffer());
        let s = '';
        for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode(...buf.subarray(k, k + 0x8000));
        return btoa(s);
      }, src);
      return Buffer.from(b64, 'base64');
    }
    const refused = await page.evaluate(() => /can't (create|generate)|unable to (create|generate)|I can't help/i.test(document.body.innerText.slice(-3000)));
    if (refused) throw new Error('Gemini refused this picture');
  }
  throw new Error('no picture after 5 minutes');
}

/** Makes each picture once; a picture already on disk is kept. Returns { name: file } for the ones that worked. */
export async function makePictures(jobs, outDir, { max = 12 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const done = {};
  let browser;
  try {
    browser = await openBrowser();
    const page = await browser.newPage();
    let failedInARow = 0;
    for (const job of jobs.slice(0, max)) {
      const raw = path.join(outDir, `${job.name}.raw.png`);
      const file = path.join(outDir, `${job.name}.jpg`);
      if (!fs.existsSync(file)) {
        try {
          fs.writeFileSync(raw, await one(page, job.prompt));
          // trim the edges: the Gemini mark sits in a corner
          execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'crop=iw*0.9:ih*0.9:0:0,scale=1920:-2', '-q:v', '3', file]);
          failedInARow = 0;
          log(`made: ${job.name}`);
        } catch (e) {
          log(`failed: ${job.name} (${e.message})`);
          if (/not signed in/.test(e.message) || ++failedInARow >= 3) { log('stopping, the episode carries on without these'); break; }
          continue;
        }
        await sleep(15000);
      }
      done[job.name] = file;
    }
  } catch (e) {
    log(`unavailable (${e.message}), the episode carries on without it`);
  } finally {
    await browser?.close().catch(() => {});
  }
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const [out, ...prompts] = process.argv.slice(2);
  const res = await makePictures(prompts.map((p, i) => ({ name: `test-${i + 1}`, prompt: paintingPrompt(p, 'ancient Egypt') })), out);
  console.log(`RESULT: ${Object.keys(res).length} of ${prompts.length} pictures`);
}
