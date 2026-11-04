// media/lib/render.mjs — script JSON → finished MP4 (+ thumbnail + upload metadata).
//
// Short (1080×1920):  hook+narration voice, 6–10 b-roll scenes, gold word-by-word captions, logo, optional end card.
// Long  (1920×1080):  hook + chapters (each its own voice clip), b-roll per chapter, subtitles, chapter timestamps.
// No AI-generated footage: real open-license photos/videos (see assets.mjs) with Ken Burns motion.
import fs from 'node:fs';
import path from 'node:path';
import { ff, durationOf, dimensionsOf, filterPath, X264 } from './ff.mjs';
import { speak, DEFAULT_VOICE } from './tts.mjs';
import { findAsset } from './assets.mjs';
import { buildAss } from './captions.mjs';
import { OUT, TMP, FONTS, BRAND } from './paths.mjs';

export const FORMATS = {
  short: { W: 1080, H: 1920, orientation: 'portrait', mode: 'short' },
  long: { W: 1920, H: 1080, orientation: 'landscape', mode: 'long' },
};
const FPS = 30;
const LEAD = 0.35;        // silence before the first word
const GAP = 0.6;          // pause between long-video chapters
const OUTRO = 2.8;        // end card length
const FADE = 0.3;

const SITE = (id, medium) => `https://www.zalavip.com/?utm_source=youtube&utm_medium=${medium}&utm_campaign=${id}`;
const FLIGHTS = (id) => `https://go.zalavip.com/?utm_source=youtube&utm_campaign=${id}`;
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const font = (f) => filterPath(path.join(FONTS, f));
const drawEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/%/g, '\\%');

// ── Narration ─────────────────────────────────────────────────────────────────
async function narrate(script, kind, work, voice) {
  const parts = [];
  if (kind === 'short') {
    const body = String(script.narration || '').trim();
    const hook = String(script.hook || '').trim();
    const startsWithHook = hook && body.toLowerCase().startsWith(hook.toLowerCase().slice(0, 18));
    parts.push({ label: 'main', text: startsWithHook || !hook ? body : `${hook} ${body}` });
  } else {
    if (script.hook) parts.push({ label: 'Intro', text: script.hook });
    for (const ch of script.chapters || []) parts.push({ label: ch.title, text: ch.narration });
  }

  const clips = [];
  for (const p of parts) clips.push({ ...p, ...(await speak(p.text, voice)) });

  // Concatenate with gaps, collecting word timings on the final timeline.
  const words = [], chapters = [];
  let t = LEAD;
  clips.forEach((c, i) => {
    chapters.push({ title: c.label, start: t });
    for (const w of c.words) words.push({ w: w.w, t0: w.t0 + t, t1: w.t1 + t });
    t += c.duration + (i < clips.length - 1 ? GAP : 0);
  });
  const audio = path.join(work, 'voice.m4a');
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  const pads = clips.map((c, i) => `[${i}:a]aresample=48000,apad=pad_dur=${i < clips.length - 1 ? GAP : 0}[a${i}]`).join(';');
  const cat = clips.map((_, i) => `[a${i}]`).join('') + `concat=n=${clips.length}:v=0:a=1,adelay=${Math.round(LEAD * 1000)}:all=1[out]`;
  ff([...inputs, '-filter_complex', `${pads};${cat}`, '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', audio]);
  return { audio, words, chapters, voiceEnd: t };
}

// ── Scenes ────────────────────────────────────────────────────────────────────
function sceneClip(asset, dur, fmt, idx, file) {
  const { W, H } = fmt;
  const tail = `,fps=${FPS},format=yuv420p,fade=t=in:st=0:d=${FADE},fade=t=out:st=${Math.max(0, dur - FADE).toFixed(2)}:d=${FADE}`;
  if (!asset) {
    ff(['-f', 'lavfi', '-i', `color=c=0x0a0a0a:s=${W}x${H}:d=${dur}:r=${FPS}`, '-vf', `format=yuv420p${tail}`, ...X264, file]);
  } else if (asset.kind === 'video') {
    const start = asset.duration > dur + 1.5 ? 1 : 0;
    ff(['-stream_loop', '-1', '-ss', String(start), '-i', asset.file, '-an', '-t', dur.toFixed(2),
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1${tail}`, ...X264, file]);
  } else {
    const frames = Math.max(2, Math.round(dur * FPS));
    const dims = dimensionsOf(asset.file);
    const isLandscapeInPortrait = (H > W) && (dims.width > 0 && dims.height > 0) && (dims.width / dims.height > 1.15);

    if (isLandscapeInPortrait) {
      // Elegant blurred background + full centered artwork (never crop historic masterpieces)
      ff(['-loop', '1', '-i', asset.file, '-t', dur.toFixed(2),
        '-filter_complex',
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:18[bg];` +
        `[0:v]scale=${W}:-2:force_original_aspect_ratio=decrease[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1${tail}[v]`,
        '-map', '[v]', ...X264, file]);
    } else {
      const zoomIn = idx % 2 === 0;
      const z = zoomIn ? `1+0.12*on/${frames}` : `1.12-0.12*on/${frames}`;
      const pan = ['iw/2-(iw/zoom/2)', `(iw-iw/zoom)*on/${frames}`, `(iw-iw/zoom)*(1-on/${frames})`][idx % 3];
      ff(['-i', asset.file, '-frames:v', String(frames),
        '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
          `zoompan=z='${z}':x='${pan}':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1${tail}`,
        ...X264, file]);
    }
  }
}

function endCard(fmt, file, lines) {
  const { W, H } = fmt;
  const logo = path.join(BRAND, 'logo.png');
  const L = Math.round(Math.min(W, H) * 0.32);
  const big = Math.round(Math.min(W, H) * 0.075), small = Math.round(Math.min(W, H) * 0.045);
  const y0 = Math.round(H / 2 + L * 0.55);
  const vf = `[0:v][1:v]overlay=(W-w)/2:(H-h)/2-${Math.round(L * 0.25)}[b];` +
    `[b]drawtext=fontfile='${font('DMSerifDisplay-Regular.ttf')}':text='${drawEsc(lines[0])}':fontcolor=0xD4AF37:fontsize=${big}:x=(w-text_w)/2:y=${y0},` +
    `drawtext=fontfile='${font('Lato-Bold.ttf')}':text='${drawEsc(lines[1])}':fontcolor=white:fontsize=${small}:x=(w-text_w)/2:y=${y0 + big + 24},` +
    `fade=t=in:st=0:d=${FADE},format=yuv420p[v]`;
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:d=${OUTRO}:r=${FPS}`, '-i', logo,
    '-filter_complex', `[1:v]scale=${L}:-1[lg];${vf.replace('[1:v]overlay', '[lg]overlay')}`, '-map', '[v]', '-t', String(OUTRO), ...X264, file]);
}

function thumbnail(sourceImage, text, file) {
  const W = 1280, H = 720;
  const size = 118;
  ff(['-i', sourceImage, '-frames:v', '1', '-vf',
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `drawbox=x=0:y=${Math.round(H * 0.55)}:w=${W}:h=${Math.round(H * 0.45)}:color=black@0.55:t=fill,` +
    `drawtext=fontfile='${font('DMSerifDisplay-Regular.ttf')}':text='${drawEsc(text.toUpperCase())}':fontcolor=0xD4AF37:` +
    `fontsize=${size}:borderw=4:bordercolor=black:x=(w-text_w)/2:y=${Math.round(H * 0.63)}`,
    '-q:v', '3', file]);
}

/**
 * @param {object} script  one item from content/youtube/shorts-*.json or long-*.json
 * @param {'short'|'long'} kind
 */
export async function renderScript(script, kind, { voice = DEFAULT_VOICE, log = console.log } = {}) {
  const fmt = FORMATS[kind];
  const work = path.join(TMP, script.id);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  log(`[${script.id}] narration…`);
  const { audio, words, chapters, voiceEnd } = await narrate(script, kind, work, voice);
  const hasOutro = kind === 'long' || !!script.cta;
  const mainLen = voiceEnd + 0.7;

  // Scene list: shorts share one timeline; long videos give each chapter its own b-roll.
  const groups = kind === 'short'
    ? [{ start: 0, end: mainLen, broll: script.broll || [] }]
    : (script.chapters || []).map((ch, i) => ({
        start: i === 0 ? 0 : chapters[i + (script.hook ? 1 : 0)]?.start ?? 0,
        end: chapters[i + 1 + (script.hook ? 1 : 0)]?.start ?? mainLen,
        broll: ch.broll || [],
      }));

  log(`[${script.id}] b-roll…`);
  const used = new Set(), credits = [], clipFiles = [];
  let idx = 0, firstImage = null;
  for (const g of groups) {
    const items = g.broll.length ? g.broll : [{ query: script.title }];
    const span = g.end - g.start;
    const n = Math.max(1, Math.min(items.length, Math.floor(span / 2.5)));
    for (let k = 0; k < n; k++) {
      const dur = span / n;
      const asset = await findAsset(items[k], { orientation: fmt.orientation, used, preferVideo: kind === 'short' || k % 2 === 0 });
      if (asset) {
        credits.push(asset.attribution);
        if (!firstImage && asset.kind === 'image') firstImage = asset.file;
      }
      const f = path.join(work, `scene-${String(idx).padStart(3, '0')}.mp4`);
      sceneClip(asset, dur, fmt, idx, f);
      clipFiles.push(f);
      idx++;
    }
  }
  if (hasOutro) {
    const f = path.join(work, 'outro.mp4');
    endCard(fmt, f, ['Plan your Egypt trip', kind === 'short' ? 'ZALA VIP  ·  link in bio' : 'zalavip.com']);
    clipFiles.push(f);
  }

  log(`[${script.id}] assembling…`);
  const list = path.join(work, 'scenes.txt');
  fs.writeFileSync(list, clipFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  const visual = path.join(work, 'visual.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', visual]);
  const total = durationOf(visual);

  const ass = path.join(work, 'captions.ass');
  fs.writeFileSync(ass, buildAss(words, fmt), 'utf8');
  const logoW = Math.round(fmt.W * (kind === 'short' ? 0.16 : 0.08));
  const out = path.join(OUT, `${script.id}.mp4`);
  ff(['-i', visual, '-i', audio, '-i', path.join(BRAND, 'logo.png'),
    '-filter_complex',
    `[0:v]subtitles='${filterPath(ass)}':fontsdir='${filterPath(FONTS)}'[s];` +
    `[2:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa=0.85[lg];` +
    `[s][lg]overlay=W-w-${Math.round(fmt.W * 0.04)}:${Math.round(fmt.H * (kind === 'short' ? 0.05 : 0.04))}:enable='lt(t,${(total - (hasOutro ? OUTRO : 0)).toFixed(2)})'[v];` +
    `[1:a]apad,atrim=0:${total.toFixed(2)}[a]`,
    '-map', '[v]', '-map', '[a]', ...X264, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', total.toFixed(2), out]);

  let thumb = null;
  if (kind === 'long') {
    thumb = path.join(OUT, `${script.id}.jpg`);
    thumbnail(firstImage || visual, script.thumbnailText || script.title, thumb);
  }

  // Upload metadata (title/description/tags + chapter timestamps + credits + sources).
  const medium = kind === 'short' ? 'short' : 'video';
  let description = String(script.description || '')
    .replace(/\{SITE_LINK\}/g, SITE(script.id, medium)).replace(/\{FLIGHTS_LINK\}/g, FLIGHTS(script.id));
  if (!description.includes('zalavip.com')) description += `\n\nPlan your Egypt trip: ${SITE(script.id, medium)}`;
  if (kind === 'long') {
    const marks = chapters.map((c, i) => `${fmtTime(i === 0 ? 0 : c.start)} ${c.title}`);
    description = description.replace(/\n*Chapters?:[\s\S]*?(\n\n|$)/i, '\n\n') + `\n\nChapters:\n${marks.join('\n')}`;
  }
  const sources = (script.sources || []).map((s) => `• ${s.url}`);
  if (sources.length) description += `\n\nSources:\n${[...new Set(sources)].join('\n')}`;
  if (credits.length) description += `\n\nMedia credits:\n${[...new Set(credits)].map((c) => `• ${c}`).join('\n')}`;

  const meta = {
    id: script.id, kind, title: script.title, description: description.slice(0, 4900), tags: script.tags || [],
    file: path.basename(out), thumbnail: thumb && path.basename(thumb), duration: Math.round(total * 10) / 10,
    voice: `${voice.provider}:${voice[voice.provider]}`, renderedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT, `${script.id}.json`), JSON.stringify(meta, null, 2));
  fs.rmSync(work, { recursive: true, force: true });
  log(`[${script.id}] done → out/${meta.file} (${meta.duration}s)`);
  return meta;
}
