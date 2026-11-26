#!/usr/bin/env node
// One on-demand audio guide: node media/tools/atlas-audio.mjs <cc> <slug> <ar|en>
// Started by the site (/api/atlas-audio) through the atlas-audio.yml workflow when a visitor asks for a guide voice that does not exist yet.
// Reads the guide text, makes the voice with Gemini TTS (the map-audio project key GEMINI_API_KEY_ATLAS_AUDIO, never a render line's key),
// turns it into mp3 and saves it on R2 at the key the site looks for. Everything runs here, on the runner.
// Env: MEDIA_BASE (public R2 base), R2_BUCKET, E (R2 S3 endpoint), AWS_* (R2 keys), GEMINI_API_KEY_ATLAS_AUDIO, ATLAS_TTS_MODEL, ATLAS_VOICE_AR / ATLAS_VOICE_EN.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [cc, slug, lang] = process.argv.slice(2);
if (!/^[a-z]{2}$/.test(cc || '') || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug || '') || !['ar', 'en'].includes(lang)) {
  console.error('usage: atlas-audio.mjs <cc> <slug> <ar|en>');
  process.exit(2);
}
const log = (...a) => console.log('[atlas-audio]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.env.MEDIA_BASE || '').replace(/\/$/, '');
if (!BASE || !process.env.R2_BUCKET || !process.env.E) throw new Error('MEDIA_BASE, R2_BUCKET and E must be set');
const key = cc === 'eg' ? `atlas/places/${slug}/audio/${lang}.mp3` : `atlas/world/${cc}/audio/${slug}.${lang}.mp3`;
const metaKey = `atlas/audio-meta/${cc}__${slug}__${lang}.json`;

if (!process.env.ATLAS_FORCE && (await fetch(`${BASE}/${key}`, { method: 'HEAD' }).catch(() => null))?.ok) { log('already there:', key); process.exit(0); }
const apiKey = process.env.GEMINI_API_KEY_ATLAS_AUDIO;
if (!apiKey) throw new Error('GEMINI_API_KEY_ATLAS_AUDIO is not set (the map-audio Gemini project key)');

const textUrl = cc === 'eg' ? `https://www.zalavip.com/atlas-details/${slug}.json` : `${BASE}/atlas/world/${cc}/details/${slug}.json`;
const details = await (await fetch(textUrl)).json().catch(() => null);
const text = String((cc === 'eg' ? details?.script?.[lang] : details?.narration?.[lang]) || '').replace(/\s+/g, ' ').trim();
if (!text || text.length > 2500) throw new Error(`no usable guide text for ${cc}/${slug}/${lang}`);

// The free voice quota is per model and per day: when one is used up the next one speaks.
const MODELS = [...new Set([process.env.ATLAS_TTS_MODEL || 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'])];
let model = MODELS[0];
const voice = (lang === 'ar' ? process.env.ATLAS_VOICE_AR : process.env.ATLAS_VOICE_EN) || 'Orus';

async function tts() {
  for (const candidate of MODELS) {
    model = candidate;
    for (let i = 0; i < 2; i += 1) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }], // only the words: an instruction in front gets read aloud
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
        }),
      });
      const data = await res.json().catch(() => ({}));
      const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (b64) return Buffer.from(b64, 'base64');
      if (![200, 404, 429, 500, 503].includes(res.status)) throw new Error(`Gemini TTS failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
      log(`${model} answered ${res.status}`);
      if (res.status === 429 || res.status === 404) break; // used up or gone: waiting will not help
      await sleep(10000);
    }
  }
  throw new Error('every voice model is used up or failing');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-audio-'));
try {
  const pcm = await tts();
  const seconds = pcm.length / (24000 * 2);
  if (seconds < 3) throw new Error(`audio too short (${seconds.toFixed(1)} s)`);
  const pcmFile = path.join(dir, 'a.pcm');
  const mp3 = path.join(dir, 'a.mp3');
  fs.writeFileSync(pcmFile, pcm);
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmFile, '-b:a', '96k', mp3]);
  const up = (file, k, type, cache) => execFileSync('aws', ['s3', 'cp', file, `s3://${process.env.R2_BUCKET}/${k}`, '--endpoint-url', process.env.E, '--content-type', type, '--cache-control', cache, '--no-progress']);
  up(mp3, key, 'audio/mpeg', 'public, max-age=31536000, immutable');
  const meta = path.join(dir, 'meta.json');
  fs.writeFileSync(meta, JSON.stringify({ status: 'ready', key, bytes: fs.statSync(mp3).size, durationSec: Math.round(seconds), voice, model, chars: text.length, generatedAt: new Date().toISOString() }));
  up(meta, metaKey, 'application/json', 'no-cache');
  log(`saved ${key} (${Math.round(seconds)} s, ${voice}, ${model})`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
