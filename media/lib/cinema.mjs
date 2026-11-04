// media/lib/cinema.mjs — "cinematic documentary" renderer for the long-form ZALA VIP episodes.
//
//   script JSON (lines with en/ar/shot/callout/sfx)  +  narration audio (ElevenLabs mp3)  +  open-license stills
//   → 1920×1080 episode with: multi-motion camera moves, varied transitions, grade + grain, chapter cards,
//     animated number call-outs, English captions (+ optional Arabic review captions), brand sting, outro,
//     layered synthesized music bed, ambience and sound effects, voice-ducked mix.
//
// Everything is real open-license imagery (see assets.mjs); nothing here generates footage with AI.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import ffprobe from 'ffprobe-static';
import { FFMPEG, ff, durationOf, filterPath } from './ff.mjs';
import { alignLines } from './align.mjs';
import { TMP, FONTS, BRAND, REPO } from './paths.mjs';

export const W = 1920, H = 1080, FPS = 30;
const LEAD = 0.45;        // silence before the first word
const STING = 3.4;        // brand sting between the cold open and chapter 1
const OUTRO = 14;
const TAIL = 1.0;         // breathing room after the last word
const SW = 2880, SH = 1620; // working size of stills (1.5×) for smooth camera moves
const X264Q = ['-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS)];

const log = (...a) => console.log('[cinema]', ...a);
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12);

// ── low-level helpers ────────────────────────────────────────────────────────
function runAsync(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-900)}`))));
  });
}
async function pool(tasks, limit, fn) {
  let i = 0, done = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < tasks.length) {
      const k = i++;
      await fn(tasks[k], k);
      done++;
      if (done % 5 === 0 || done === tasks.length) log(`scenes ${done}/${tasks.length}`);
    }
  });
  await Promise.all(workers);
}
function imgSize(file) {
  const out = execFileSync(ffprobe.path, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]).toString().trim();
  const [w, h] = out.split('x').map(Number);
  return { w, h };
}
const ass_t = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor((cs % 360000) / 6000)).padStart(2, '0')}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const fexpr = (n) => Number(n).toFixed(3);

// piecewise-linear gain curve as an ffmpeg expression in t
function curve(points) {
  let e = String(points[points.length - 1][1]);
  for (let i = points.length - 2; i >= 0; i--) {
    const [t0, g0] = points[i], [t1, g1] = points[i + 1];
    const lerp = t1 === t0 ? g1 : `${fexpr(g0)}+(${fexpr(g1 - g0)})*(t-${fexpr(t0)})/${fexpr(t1 - t0)}`;
    e = `if(lt(t,${fexpr(t1)}),${lerp},${e})`;
  }
  return `if(lt(t,${fexpr(points[0][0])}),${fexpr(points[0][1])},${e})`;
}

// ── timeline ─────────────────────────────────────────────────────────────────
export function buildTimeline(script, voiceFile) {
  const flat = [];
  script.chapters.forEach((c, ci) => c.lines.forEach((l, li) => flat.push({
    ci, li, key: `${ci}.${li}`, text: l.say || l.en, en: l.en, ar: l.ar, shot: l.shot, sfx: l.sfx, callout: l.callout, last: li === c.lines.length - 1,
  })));
  const al = alignLines(voiceFile, flat.map((f) => ({ text: f.text, paragraphBreakAfter: f.last && f.ci < script.chapters.length - 1 })));
  const introLast = flat.reduce((a, f, i) => (f.ci === 0 ? i : a), 0);
  const pa = al.lines[introLast].pauseAfter;
  const b1 = (pa.s + pa.e) / 2;                                   // cut point (original audio time) for the brand sting
  const map = (t) => LEAD + t + (t >= b1 ? STING : 0);
  flat.forEach((f, i) => {
    const l = al.lines[i];
    let t1 = l.t1;
    if (i === flat.length - 1) t1 = Math.min(t1, l.t0 + l.syl / 3.4 + 0.5);
    f.o0 = l.t0; f.o1 = t1;
    f.T0 = map(l.t0); f.T1 = map(t1);
  });
  const mainEnd = flat[flat.length - 1].T1 + TAIL;
  return { flat, b1, mapAudio: map, stingAt: LEAD + b1, mainEnd, total: mainEnd + OUTRO, voiceDuration: al.duration };
}

// ── scenes ───────────────────────────────────────────────────────────────────
const MOTIONS = ['pushin', 'panright', 'pullout', 'diagin', 'tiltup', 'panleft', 'diagout', 'tiltdown'];
function motionExpr(name, FR) {
  const E = `((1-cos(PI*on/${FR}))/2)`;
  const cx = `x='iw/2-(iw/zoom/2)'`, cy = `y='ih/2-(ih/zoom/2)'`;
  switch (name) {
    case 'pushin':   return `z='1+0.24*${E}':${cx}:${cy}`;
    case 'pullout':  return `z='1.24-0.24*${E}':${cx}:${cy}`;
    case 'panright': return `z='1.15':x='(iw-iw/zoom)*${E}':${cy}`;
    case 'panleft':  return `z='1.15':x='(iw-iw/zoom)*(1-${E})':${cy}`;
    case 'tiltup':   return `z='1.15':${cx}:y='(ih-ih/zoom)*(1-${E})'`;
    case 'tiltdown': return `z='1.15':${cx}:y='(ih-ih/zoom)*${E}'`;
    case 'diagin':   return `z='1+0.3*${E}':x='(iw-iw/zoom)*(0.12+0.55*${E})':y='(ih-ih/zoom)*(0.08+0.45*${E})'`;
    case 'diagout':  return `z='1.3-0.3*${E}':x='(iw-iw/zoom)*(0.85-0.55*${E})':y='(ih-ih/zoom)*(0.7-0.45*${E})'`;
    default:         return `z='1+0.12*${E}':${cx}:${cy}`;
  }
}

/** Fit any photo onto a 16:9 working frame: fill for wide photos, blurred-backdrop "contain" for tall ones. */
function prepStill(src, out) {
  if (fs.existsSync(out) && fs.statSync(out).size > 5000) return out;
  const { w, h } = imgSize(src);
  const ar = w / h;
  if (ar >= 1.38) {
    ff(['-i', src, '-frames:v', '1', '-vf', `scale=${SW}:${SH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${SW}:${SH}`, out]);
  } else {
    ff(['-i', src, '-frames:v', '1', '-filter_complex',
      `[0:v]split[a][b];[a]scale=${SW}:${SH}:force_original_aspect_ratio=increase,crop=${SW}:${SH},gblur=sigma=50,eq=brightness=-0.14:saturation=0.85[bg];` +
      `[b]scale=${Math.round(SW * 0.8)}:${Math.round(SH * 0.93)}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`, out]);
  }
  return out;
}

function sceneArgs(task) {
  const FR = Math.max(2, Math.round(task.dur * FPS));
  task.frames = FR;
  if (task.isVideo) {
    const D = (FR / FPS).toFixed(3);
    return ['-stream_loop', '-1', '-i', task.still, '-t', D, '-vf',
      `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `scale=w='trunc(${W}*(1+0.1*t/${D})/2)*2':h='trunc(${H}*(1+0.1*t/${D})/2)*2':eval=frame,crop=${W}:${H},setsar=1,format=yuv420p`,
      '-frames:v', String(FR), '-an', ...X264Q, task.out];
  }
  return ['-i', task.still, '-vf',
    `zoompan=${motionExpr(task.motion, FR)}:d=${FR}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p`,
    '-frames:v', String(FR), ...X264Q, task.out];
}

// glowing black backdrop used by the sting and the outro
function glowStill(out, cx = 960, cy = 540, rad = 430, strength = 1) {
  if (fs.existsSync(out)) return out;
  const g = `exp(-((X-${cx})*(X-${cx})+(Y-${cy})*(Y-${cy}))/(2*${rad}*${rad}))`;
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-vf',
    `format=rgb24,geq=r='${(78 * strength).toFixed(0)}*${g}':g='${(54 * strength).toFixed(0)}*${g}':b='${(14 * strength).toFixed(0)}*${g}'`, '-frames:v', '1', out]);
  return out;
}
function compositeCrest(out, { crestW, x, y, glowAt }) {
  const glow = glowStill(path.join(path.dirname(out), `glow-${hash(JSON.stringify(glowAt))}.png`), glowAt.x, glowAt.y, glowAt.r, glowAt.s);
  const crest = path.join(REPO, 'public', 'zala-crest-transparent.png');
  ff(['-i', glow, '-i', crest, '-filter_complex',
    `[1:v]scale=${crestW}:-1:flags=lanczos,format=rgba[c];[0:v][c]overlay=${x}:${y}:format=auto,format=yuv420p`, '-frames:v', '1', out]);
  return out;
}

// ── audio synthesis ──────────────────────────────────────────────────────────
const stereo = (e1, e2) => `${e1}|${e2 || e1}`;
function synthSfx(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, `${n}.wav`);
  const lav = (expr, d) => ['-f', 'lavfi', '-i', `aevalsrc='${expr}':d=${d}:s=48000`];
  if (!fs.existsSync(f('impact'))) {
    const body = '0.95*sin(2*PI*(46+70*exp(-10*t))*t)*exp(-2.4*t)+0.32*sin(2*PI*92*t)*exp(-4*t)';
    ff([...lav(stereo(body, body.replace('92', '93')), 2.4), '-f', 'lavfi', '-i', 'anoisesrc=d=2.4:c=brown:a=0.7:r=48000,volume=\'exp(-9*t)\':eval=frame,lowpass=f=2200',
      '-filter_complex', '[0][1]amix=inputs=2:normalize=0,aecho=0.8:0.55:90|220:0.35|0.2,alimiter=limit=0.9', f('impact')]);
  }
  if (!fs.existsSync(f('hit'))) {
    const b = '0.9*sin(2*PI*(58+34*exp(-14*t))*t)*exp(-7.5*t)';
    ff([...lav(stereo(b), 1.0), '-af', 'aecho=0.8:0.5:70:0.25,alimiter=limit=0.9', f('hit')]);
  }
  if (!fs.existsSync(f('whoosh'))) {
    ff(['-f', 'lavfi', '-i', 'anoisesrc=d=1.5:c=pink:a=0.55:r=48000', '-af',
      'highpass=f=380,lowpass=f=6200,volume=\'pow(sin(PI*t/1.5),2)*1.5\':eval=frame,flanger=delay=2:depth=5:speed=0.5,stereotools=mlev=0.9:slev=1.4,aecho=0.8:0.4:60:0.2', f('whoosh')]);
  }
  if (!fs.existsSync(f('riser'))) {
    const ch = '0.5*sin(2*PI*(140*t+100*t*t))*pow(t/2.8,2.2)';
    ff([...lav(stereo(ch), 2.8), '-f', 'lavfi', '-i', 'anoisesrc=d=2.8:c=white:a=0.5:r=48000,highpass=f=1200,volume=\'pow(t/2.8,2.6)*0.7\':eval=frame',
      '-filter_complex', '[0][1]amix=inputs=2:normalize=0,afade=t=out:st=2.7:d=0.1,aecho=0.7:0.5:140:0.3,alimiter=limit=0.9', f('riser')]);
  }
  if (!fs.existsSync(f('pop'))) {
    const b = '0.5*sin(2*PI*1320*t)*exp(-26*t)+0.25*sin(2*PI*1980*t)*exp(-30*t)';
    ff([...lav(stereo(b), 0.4), '-af', 'aecho=0.8:0.4:60:0.3', f('pop')]);
  }
  if (!fs.existsSync(f('shimmer'))) {
    const b = '0.07*(sin(2*PI*1760*t)+0.8*sin(2*PI*2349*t)+0.6*sin(2*PI*3136*t)+0.5*sin(2*PI*3951*t))*exp(-1.5*t)*(1-exp(-30*t))';
    ff([...lav(stereo(b, b.replace('1760', '1762')), 3.6), '-af', 'aecho=0.85:0.6:240|480:0.4|0.3', f('shimmer')]);
  }
  return f;
}

function synthMusic(out, T, marks) {
  // marks: {introEnd, stingStart, stingEnd, ch: [t0..], end}
  const { stingStart, stingEnd, ch3, ch4, ch5, end } = marks;
  const vol = curve([[0, 0], [1.2, 0.5], [stingStart - 0.5, 0.55], [stingStart + 0.4, 1.0], [stingEnd, 0.7], [ch3 - 2, 0.75], [ch4, 1.0], [ch5, 0.8], [end - 4, 0.7], [end + 4.2, 0]]);
  const minorG = curve([[0, 1], [ch5 - 1, 1], [ch5 + 5, 0]]);
  const majorG = curve([[0, 0], [ch5 - 1, 0], [ch5 + 5, 1]]);
  const heartG = curve([[0, 0], [ch3 - 4, 0], [ch3 + 3, 0.9], [ch4 + 14, 1.0], [ch5 - 0.5, 0]]);
  const pad = (d1, d2, d3, d4) =>
    `0.12*(sin(2*PI*${110 * d1}*t)+0.8*sin(2*PI*${164.81 * d2}*t)+0.55*sin(2*PI*${220 * d3}*t)+${minorG}*0.45*sin(2*PI*${261.63 * d4}*t+0.5*sin(2*PI*0.11*t))+${majorG}*0.45*sin(2*PI*${277.18 * d4}*t))` +
    `*(0.72+0.28*sin(2*PI*0.043*t))+0.2*sin(2*PI*55*t)`;
  const padL = pad(1, 1, 1.002, 1), padR = pad(1.0015, 0.9985, 0.999, 1.002);
  const dir = path.dirname(out);
  const padF = path.join(dir, 'm-pad.wav'), heartF = path.join(dir, 'm-heart.wav'), windF = path.join(dir, 'm-wind.wav');
  ff(['-f', 'lavfi', '-i', `aevalsrc='${stereo(padL, padR)}':d=${T.toFixed(2)}:s=48000`, '-af', 'lowpass=f=1150,aecho=0.7:0.7:900|1500:0.4|0.28,tremolo=f=0.1:d=0.25', padF]);
  const hb = (k) => `0.6*sin(2*PI*52*t)*exp(-10*mod(t,0.95))+0.34*sin(2*PI*47*t)*exp(-13*mod(t+0.67,0.95))`;
  ff(['-f', 'lavfi', '-i', `aevalsrc='(${hb()})*${heartG}':d=${T.toFixed(2)}:s=48000`, '-af', 'lowpass=f=140,aformat=channel_layouts=stereo', heartF]);
  ff(['-f', 'lavfi', '-i', `anoisesrc=d=${T.toFixed(2)}:c=pink:a=0.5:r=48000`, '-af', 'bandpass=f=620:width_type=h:w=520,tremolo=f=0.2:d=0.5,volume=0.045,aformat=channel_layouts=stereo', windF]);
  ff(['-i', padF, '-i', heartF, '-i', windF, '-filter_complex', `[0][1][2]amix=inputs=3:normalize=0,volume='${vol}':eval=frame,alimiter=limit=0.9`, out]);
  return out;
}

// ── captions / graphics (ASS) ────────────────────────────────────────────────
function chunkText(s, max = 84) {
  if (s.length <= max) return [s];
  const mid = s.length / 2;
  let best = -1, bd = 1e9;
  for (const m of s.matchAll(/[,:;—] /g)) {
    const i = m.index + 1; const d = Math.abs(i - mid);
    if (i > s.length * 0.25 && i < s.length * 0.78 && d < bd) { bd = d; best = i; }
  }
  if (best < 0) { for (const m of s.matchAll(/ (and|but|so|to|with|from|where|while) /g)) { const i = m.index; const d = Math.abs(i - mid); if (d < bd) { bd = d; best = i; } } }
  if (best < 0) best = s.lastIndexOf(' ', mid);
  const a = s.slice(0, best).trim(), b = s.slice(best).trim();
  return [...chunkText(a, max), ...chunkText(b, max)];
}
const aesc = (s) => String(s).replace(/[{}]/g, '').replace(/\\/g, '').replace(/\n/g, '\\N');
const RLM = '\u200F';

export function buildAss(tl, script, { arabic }) {
  const GOLD = '&H0037AFD4&';
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: En,Anton,84,&H0037AFD4,&H00FFFFFF,&H00000000,&HA0000000,0,0,0,0,100,100,1,0,1,5,2,2,160,160,${arabic ? 176 : 132},1
Style: Ar,Segoe UI,43,${GOLD},${GOLD},&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,3,1.2,2,200,200,46,1
Style: Big,Anton,142,${GOLD},${GOLD},&H00000000,&H90000000,0,0,0,0,100,100,1,0,1,3,2,7,0,0,0,1
Style: Sub,Lato,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,3,0,1,2,1,7,0,0,0,1
Style: ChNo,Lato,30,${GOLD},${GOLD},&H00000000,&H90000000,-1,0,0,0,100,100,9,0,1,2,1,7,0,0,0,1
Style: ChTitle,DM Serif Display,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,0.5,0,1,3,2,7,0,0,0,1
Style: Out1,Anton,112,${GOLD},${GOLD},&H00000000,&H90000000,0,0,0,0,100,100,2,0,1,3,2,7,0,0,0,1
Style: Out2,Lato,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,4,0,1,2.5,1.5,7,0,0,0,1
Style: Out3,Lato,36,&H20FFFFFF,&H20FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,2,0,1,2,1,7,0,0,0,1
Style: Next1,Lato,32,${GOLD},${GOLD},&H00000000,&H90000000,-1,0,0,0,100,100,6,0,1,2,1,7,0,0,0,1
Style: Next2,Anton,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,0,0,0,0,100,100,1,0,1,3,2,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const dl = (layer, a, b, style, text) => ev.push(`Dialogue: ${layer},${ass_t(a)},${ass_t(b)},${style},,0,0,0,,${text}`);

  // captions: big, short, punchy phrases (2-4 words) that fill with gold as they are spoken
  const phrasesOf = (text) => {
    const words = text.split(/\s+/).filter(Boolean); const out = []; let cur = [];
    for (const w of words) { cur.push(w); if (cur.length >= 4 || (/[.,;:!?]$/.test(w) && cur.length >= 2)) { out.push(cur); cur = []; } }
    if (cur.length) { if (cur.length === 1 && out.length) out[out.length - 1].push(cur[0]); else out.push(cur); }
    return out;
  };
  tl.flat.forEach((f, i) => {
    const next = tl.flat[i + 1];
    const end = Math.min(f.T1 + 0.2, next ? next.T0 - 0.03 : f.T1 + 0.4);
    const start = f.T0 - 0.04;
    const phrases = phrasesOf(f.en);
    const tot = phrases.reduce((a, p) => a + p.join(' ').length, 0);
    let t = start;
    phrases.forEach((p) => {
      const share = (p.join(' ').length / tot) * (end - start);
      const wt = p.map((w) => w.length + 1.5);
      const wsum = wt.reduce((a, b) => a + b, 0);
      const cs = Math.max(10, Math.round(share * 100) - 6);
      const body = p.map((w, k) => '{\\kf' + Math.max(4, Math.round((cs * wt[k]) / wsum)) + '}' + aesc(w.toUpperCase()) + (k < p.length - 1 ? ' ' : '')).join('');
      dl(2, t, t + share, 'En', '{\\fad(30,50)\\fscx122\\fscy122\\t(0,110,\\fscx100\\fscy100)}' + body);
      t += share;
    });
    if (arabic && f.ar) dl(2, start, end, 'Ar', '{\\fad(160,160)}' + RLM + aesc(f.ar) + RLM);
  });

  // chapter cards (not the cold open)
  const firstOf = new Map();
  tl.flat.forEach((f) => { if (!firstOf.has(f.ci)) firstOf.set(f.ci, f); });
  script.chapters.forEach((c, ci) => {
    if (ci === 0) return;
    const f = firstOf.get(ci);
    const t0 = ci === 1 ? tl.stingAt + STING + 0.3 : f.T0 - 0.15;
    dl(6, t0, t0 + 4.2, 'ChNo', `{\\an7\\pos(128,92)\\fad(500,600)\\t(0,700,\\fsp9)}CHAPTER ${ci}`);
    dl(6, t0, t0 + 4.2, 'ChTitle', `{\\an7\\pos(126,128)\\fad(600,600)\\blur0.6}${aesc(c.title)}`);
    dl(6, t0, t0 + 4.2, 'ChNo', `{\\an7\\pos(100,92)\\fad(300,500)\\1c${GOLD}\\p1}m 0 0 l 4 0 4 112 0 112{\\p0}`);
  });

  // number call-outs: a compact plate in the top-left corner, clear of faces and of the logo mark
  const callouts = tl.flat.filter((f) => f.callout);
  callouts.forEach((f, k) => {
    const nextC = callouts[k + 1];
    const a = f.T0 + 0.25;
    let b = a + 3.6;
    if (nextC) b = Math.min(b, nextC.T0 + 0.1);
    const big = aesc(f.callout.big), small = aesc(f.callout.small);
    // keep clear of the chapter card (top-left, 4.2 s) when the two would overlap
    const cardWindows = script.chapters.map((c, ci) => (ci === 0 ? null : (ci === 1 ? tl.stingAt + STING + 0.3 : firstOf.get(ci).T0 - 0.15))).filter((x) => x != null).map((t0) => [t0, t0 + 4.2]);
    const dy = cardWindows.some(([x, y]) => a < y && b > x) ? 190 : 0;
    const plateW = Math.round(Math.min(1500, Math.max(420, big.length * 84 + 90, small.length * 27 + 90)));
    dl(4, a, b, 'Sub', '{\\an7\\pos(70,' + (64 + dy) + ')\\fad(220,300)\\1c&H000000&\\1a&H66&\\p1}m 0 0 l ' + plateW + ' 0 ' + plateW + ' 258 0 258{\\p0}');
    dl(4, a, b, 'Sub', '{\\an7\\pos(70,' + (64 + dy) + ')\\fad(220,300)\\1c' + GOLD + '\\p1}m 0 0 l 9 0 9 258 0 258{\\p0}');
    dl(5, a, b, 'Big', '{\\pos(104,' + (54 + dy) + ')\\fad(260,300)\\fscx88\\fscy88\\t(0,380,\\fscx100\\fscy100)}' + big);
    dl(5, a + 0.1, b, 'Sub', '{\\pos(108,' + (206 + dy) + ')\\fad(320,300)}' + small);
  });


  // end card: subscribe / like / comment / share on the left; the right half stays free for YouTube's end-screen elements
  const o = tl.mainEnd;
  const nextTxt = String(script.outroNext || 'NEXT CASE COMING SOON').replace(/^SUBSCRIBE\s*[·|-]\s*/i, '');
  dl(6, o + 1.0, o + OUTRO - 0.8, 'Out1', '{\\an7\\pos(92,640)\\fad(500,500)\\fscx110\\fscy110\\t(0,300,\\fscx100\\fscy100)}SUBSCRIBE');
  dl(6, o + 1.6, o + OUTRO - 0.8, 'Out2', '{\\an7\\pos(96,780)\\fad(500,500)}LIKE  ·  COMMENT  ·  SHARE');
  dl(6, o + 2.2, o + OUTRO - 0.8, 'Out3', '{\\an7\\pos(98,860)\\fad(500,500)}Plan your Egypt trip:  zalavip.com');
  dl(6, o + 2.6, o + OUTRO - 0.8, 'Next1', '{\\an7\\pos(1010,96)\\fad(500,500)}WATCH NEXT');
  dl(6, o + 2.6, o + OUTRO - 0.8, 'Next2', '{\\an7\\pos(1010,140)\\fad(500,500)}' + aesc(nextTxt));
  return head + ev.join('\n') + '\n';
}

// ── main entry ───────────────────────────────────────────────────────────────
export async function renderCinema(script, { voice, assetsJson, outDir, stage = 'all', only = 0, jobs = 3 }) {
  const id = script.id;
  const work = path.join(TMP, id);
  const sceneDir = path.join(work, 'scenes');
  const audioDir = path.join(work, 'audio');
  const prepDir = path.join(work, 'stills');
  for (const d of [sceneDir, audioDir, prepDir]) fs.mkdirSync(d, { recursive: true });

  const tl = buildTimeline(script, voice);
  const assets = JSON.parse(fs.readFileSync(assetsJson, 'utf8'));
  log(`timeline: voice ${tl.voiceDuration.toFixed(1)}s → main ${tl.mainEnd.toFixed(1)}s + outro = ${tl.total.toFixed(1)}s`);

  // shots
  const starts = [];
  tl.flat.forEach((f, i) => {
    if (!f.shot) return;
    let s;
    if (i === 0) s = 0;
    else if (f.ci === 1 && f.li === 0) s = tl.stingAt + STING;
    else s = f.T0 - 0.28;
    starts.push({ start: s, key: f.key, ci: f.ci, li: f.li, motion: f.shot.m, sfx: f.sfx, line: i });
  });
  const items = [
    ...starts.map((s) => ({ type: 'img', ...s })),
    { type: 'sting', start: tl.stingAt },
    { type: 'outro', start: tl.mainEnd },
  ].sort((a, b) => a.start - b.start);
  items.forEach((it, i) => { const nx = items[i + 1]; it.span = (nx ? nx.start : tl.total) - it.start; });
  const sting = items.find((x) => x.type === 'sting'); sting.span = STING;
  const outro = items.find((x) => x.type === 'outro'); outro.span = OUTRO;

  // split long still scenes into several moves on the same image
  const scenes = [];
  let moveIdx = 0;
  let lastAsset = null;
  for (const it of items) {
    if (it.type !== 'img') { scenes.push(it); continue; }
    let asset = assets[it.key];
    if (!asset) { if (!lastAsset) { log('missing asset for', it.key); continue; } log('no asset for', it.key, '- reusing the previous one'); asset = lastAsset; }
    if (asset.kind !== 'video') lastAsset = asset;
    const parts = asset.kind === 'video' ? 1 : (it.span > 4.6 ? Math.ceil(it.span / 3.6) : 1);
    let motion = it.motion || MOTIONS[moveIdx % MOTIONS.length];
    for (let p = 0; p < parts; p++) {
      const span = it.span / parts;
      scenes.push({ ...it, asset, isVideo: asset.kind === 'video', motion, start: it.start + p * span, span, part: p, firstOfShot: p === 0 });
      const alt = MOTIONS.filter((m) => m !== motion && !(motion.startsWith('pan') && m.startsWith('pan')));
      motion = alt[(moveIdx + p * 3 + 1) % alt.length];
    }
    moveIdx++;
  }

  // transitions INTO each scene
  const TR = ['fade', 'smoothleft', 'dissolve', 'smoothright', 'fade', 'zoomin', 'fade', 'wipeleft'];
  let trI = 0;
  scenes.forEach((s, i) => {
    if (i === 0) { s.tr = null; return; }
    const prev = scenes[i - 1];
    const chapterStart = s.type === 'img' && s.firstOfShot && s.li === 0 && s.ci > 0;
    if (s.type === 'sting') s.tr = { name: 'fadeblack', d: 0.55 };
    else if (s.type === 'outro') s.tr = { name: 'fadeblack', d: 0.9 };
    else if (prev.type === 'sting' || chapterStart) s.tr = { name: 'fadeblack', d: 0.7 };
    else if (s.sfx === 'hit' || s.sfx === 'impact') s.tr = { name: 'fadewhite', d: 0.22 };
    else if (s.part > 0) s.tr = { name: 'fade', d: 0.7 };
    else s.tr = { name: TR[trI++ % TR.length], d: 0.5 };
    s.tr.d = Math.min(s.tr.d, prev.span * 0.45, s.span * 0.45);
  });
  scenes.forEach((s, i) => { const nx = scenes[i + 1]; s.dur = s.span + (nx ? nx.tr.d : 0); });

  // 1) encode scene clips (parallel, cached)
  if (stage === 'scenes' || stage === 'all' || stage === 'chain' || stage === 'final') {
    const tasks = [];
    for (const s of scenes) {
      if (only && tasks.length >= only) break;
      if (s.type === 'img') {
        s.still = s.isVideo ? s.asset.file : prepStill(s.asset.file, path.join(prepDir, `${hash(s.asset.file)}.png`));
        s.out = path.join(sceneDir, `${s.isVideo ? 'v' : 'i'}-${hash(`${s.asset.file}|${s.motion}|${s.dur.toFixed(2)}`)}.mp4`);
      } else if (s.type === 'sting') {
        s.still = compositeCrest(path.join(prepDir, 'sting.png'), { crestW: 1180, x: 370, y: -30, glowAt: { x: 960, y: 520, r: 460, s: 1.0 } });
        s.motion = 'pushin';
        s.out = path.join(sceneDir, `sting-${hash(s.dur.toFixed(2))}.mp4`);
      } else {
        s.still = compositeCrest(path.join(prepDir, 'outro.png'), { crestW: 560, x: 70, y: 40, glowAt: { x: 360, y: 320, r: 520, s: 0.9 } });
        s.motion = 'pushin';
        s.out = path.join(sceneDir, `outro-${hash(s.dur.toFixed(2))}.mp4`);
      }
      tasks.push(s);
    }
    const okClip = (p) => { try { return fs.existsSync(p) && durationOf(p) > 0.3; } catch { return false; } };
    const seen = new Set();
    const todo = tasks.filter((t) => !okClip(t.out) && !seen.has(t.out) && seen.add(t.out));
    log(`encoding ${todo.length} scene clips (${tasks.length - todo.length} cached)…`);
    await pool(todo, jobs, async (t) => {
      const final = t.out; t.out = final + '.part.mp4'; const args = sceneArgs(t); t.out = final;
      if (t.type === 'sting') args.splice(args.indexOf('-vf') + 1, 1, `zoompan=${motionExpr('pushin', t.frames)}:d=${t.frames}:s=${W}x${H}:fps=${FPS},fade=t=in:st=0:d=0.9,fade=t=out:st=${(t.dur - 0.7).toFixed(2)}:d=0.7,setsar=1,format=yuv420p`);
      const part = final + '.part.mp4';
      try { await runAsync(args); } catch { await new Promise(r=>setTimeout(r,1500)); await runAsync(args); }
      for (let tries = 0; ; tries++) {
        try { fs.renameSync(part, final); break; } catch (e) {
          if (tries >= 20 || !/EBUSY|EPERM|EACCES/.test(e.code || '')) throw e;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    });
    if (only) return { tl, scenes: tasks };
  }

  // 2) crossfade chain
  const chainFile = path.join(work, 'chain.mp4');
  if (stage === 'chain' || stage === 'final' || stage === 'all') {
    if (!fs.existsSync(chainFile) || process.env.REBUILD_CHAIN) {
      // segments of N scenes keep ffmpeg's memory use sane; each later segment starts with the previous scene's tail
      const N = 9, segFiles = [];
      for (let a0 = 0, si = 0; a0 < scenes.length; a0 += N, si++) {
        const b0 = Math.min(scenes.length, a0 + N);
        const list = scenes.slice(a0, b0);
        const segF = path.join(work, `seg${si}.mp4`);
        segFiles.push(segF);
        if (fs.existsSync(segF) && !process.env.REBUILD_CHAIN) continue;
        const head = a0 > 0 ? scenes[a0 - 1] : null;
        const ins = [...(head ? [head] : []), ...list];
        const inputs = ins.flatMap((x) => ['-i', x.out]);
        let g = '', last = '[0:v]', cum = 0;
        if (head) { g += `[0:v]trim=start=${head.span.toFixed(3)},setpts=PTS-STARTPTS[h0];`; last = '[h0]'; }
        const off = head ? 1 : 0;
        for (let k = off ? 1 : 1; k < ins.length; k++) {
          const sc = ins[k];
          const prevSpan = k === 1 && head ? 0 : ins[k - 1].span;
          cum += prevSpan;
          const o = '[x' + k + ']';
          g += last + '[' + k + ':v]xfade=transition=' + sc.tr.name + ':duration=' + sc.tr.d.toFixed(3) + ':offset=' + cum.toFixed(3) + o + ';';
          last = o;
        }
        g = g.replace(/;$/, '');
        const gf = path.join(work, 'chain' + si + '.filter');
        fs.writeFileSync(gf, g);
        const segLen = list.reduce((x, y) => x + y.span, 0);
        log('segment', si, 'scenes', a0, '-', b0 - 1, 'len', segLen.toFixed(1));
        await runAsync([...inputs, '-filter_complex_script', gf, '-map', last, '-t', segLen.toFixed(3), ...X264Q, '-preset', 'veryfast', segF]);
      }
      const lst = path.join(work, 'segs.txt');
      fs.writeFileSync(lst, segFiles.map((f) => "file '" + f.replace(/\\/g, '/') + "'").join('\n'));
      await runAsync(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', chainFile]);
    }
  }

  // 3) audio
  const mixFile = path.join(work, 'mix.m4a');
  if (stage === 'audio' || stage === 'final' || stage === 'all') {
    await buildAudio({ tl, voice, script, work: audioDir, mixFile, scenes });
  }

  // 4) final renders
  if (stage === 'final' || stage === 'all') {
    fs.mkdirSync(outDir, { recursive: true });
    const outputs = {};
    const hasAr = script.chapters.some((c) => c.lines.some((l) => l.ar));
    for (const arabic of hasAr ? [false, true] : [false]) {
      const ass = path.join(work, arabic ? 'cap-ar.ass' : 'cap-en.ass');
      fs.writeFileSync(ass, buildAss(tl, script, { arabic }), 'utf8');
      const out = path.join(outDir, arabic ? `${id}_arabic-review.mp4` : `${id}.mp4`);
      await finalPass({ chainFile, mixFile, ass, out, tl });
      outputs[arabic ? 'review' : 'main'] = out;
      log('wrote', out);
    }
    return { tl, outputs };
  }
  return { tl, scenes };
}

async function finalPass({ chainFile, mixFile, ass, out, tl }) {
  const fontsRun = path.join(TMP, 'fonts-run');
  fs.mkdirSync(fontsRun, { recursive: true });
  for (const f of fs.readdirSync(FONTS)) fs.copyFileSync(path.join(FONTS, f), path.join(fontsRun, f));
  for (const f of ['segoeui.ttf', 'segoeuib.ttf']) { const p = path.join('C:\\Windows\\Fonts', f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(fontsRun, f)); }
  const mark = path.join(BRAND, 'mark.png');
  const wmA = tl.stingAt + STING + 0.8, wmB = tl.mainEnd - 0.3;
  const hasMark = fs.existsSync(mark);
  const grade = `eq=contrast=1.05:saturation=1.07:gamma=0.98,colorbalance=rs=0.02:bs=-0.025:rm=0.02:bm=-0.02,vignette=angle=PI/6,noise=alls=2:allf=t`;
  const subs = `subtitles='${filterPath(ass)}':fontsdir='${filterPath(fontsRun)}'`;
  const args = ['-i', chainFile, '-i', mixFile];
  let fc;
  if (hasMark) {
    args.push('-loop', '1', '-i', mark);
    fc = `[0:v]${grade}[g];[2:v]scale=-2:104,format=rgba,colorchannelmixer=aa=0.82,fade=t=in:st=${wmA.toFixed(2)}:d=1.2:alpha=1,fade=t=out:st=${(wmB - 0.6).toFixed(2)}:d=0.6:alpha=1[wm];` +
      `[g][wm]overlay=W-w-56:34:enable='between(t,${wmA.toFixed(2)},${wmB.toFixed(2)})':shortest=0[o];[o]${subs}[v]`;
  } else {
    fc = `[0:v]${grade},${subs}[v]`;
  }
  await runAsync([...args, '-filter_complex', fc, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '9M', '-bufsize', '18M', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', '-shortest', '-t', tl.total.toFixed(2), out]);
}

// ── audio mix ────────────────────────────────────────────────────────────────
async function buildAudio({ tl, voice, script, work, mixFile, scenes }) {
  const sfx = synthSfx(path.join(work, 'sfx'));
  const total = tl.total + 0.5;
  const chStart = (ci) => { const f = tl.flat.find((x) => x.ci === ci && x.li === 0); return ci === 1 ? tl.stingAt + STING : (f ? f.T0 : tl.mainEnd); };

  // voice: normalize, then splice a silent gap for the sting at the cut point
  const voiceF = path.join(work, 'voice.wav');
  const b1 = tl.b1;
  ff(['-i', voice, '-filter_complex',
    `[0:a]highpass=f=70,acompressor=threshold=-21dB:ratio=2.6:attack=12:release=260:makeup=2,loudnorm=I=-16:LRA=7:TP=-1.5,aresample=48000,aformat=channel_layouts=stereo,asplit[a][b];` +
    `[a]atrim=0:${b1.toFixed(3)},asetpts=PTS-STARTPTS[v0];[b]atrim=${b1.toFixed(3)},asetpts=PTS-STARTPTS[v1];` +
    `anullsrc=r=48000:cl=stereo,atrim=0:${STING}[s];[v0][s][v1]concat=n=3:v=0:a=1,adelay=${Math.round(LEAD * 1000)}|${Math.round(LEAD * 1000)},apad=whole_dur=${total.toFixed(2)}[out]`,
    '-map', '[out]', voiceF]);

  // music
  const musicF = path.join(work, 'music.wav');
  synthMusic(musicF, total + 1, { stingStart: tl.stingAt, stingEnd: tl.stingAt + STING, ch3: chStart(3), ch4: chStart(4), ch5: chStart(5), end: tl.mainEnd });

  // sfx events
  const ev = [];
  const add = (name, t, g = 1) => ev.push({ name, t: Math.max(0, t), g });
  add('impact', tl.stingAt + 0.05, 0.95); add('shimmer', tl.stingAt + 0.25, 0.9);
  add('shimmer', tl.mainEnd + 0.9, 0.7);
  tl.flat.forEach((f) => {
    if (f.sfx === 'impact') add('impact', f.T0 + 0.35, 0.8);
    if (f.sfx === 'hit') add('hit', f.T0 + 0.02, 0.85);
    if (f.sfx === 'whoosh') add('whoosh', f.T0 - 0.3, 0.7);
    if (f.sfx === 'riser') add('riser', f.T1 - 2.6, 0.7);
    if (f.callout) add('pop', f.T0 + 0.3, 0.55);
  });
  script.chapters.forEach((c, ci) => { if (ci > 0) add('whoosh', chStart(ci) - 0.2, 0.55); });
  // gentle movement whooshes on a few cuts
  scenes.filter((s) => s.type === 'img' && s.tr && /smooth|wipe|zoomin/.test(s.tr.name)).forEach((s) => add('whoosh', s.start - 0.12, 0.32));

  const args = ['-i', voiceF, '-i', musicF];
  ev.forEach((e) => args.push('-i', sfx(e.name)));
  let fc = `[0:a]asplit[vo][vsc];[1:a][vsc]sidechaincompress=threshold=0.018:ratio=9:attack=18:release=520:makeup=1[md];`;
  const labels = [];
  ev.forEach((e, i) => { const ms = Math.round(e.t * 1000); fc += `[${i + 2}:a]aformat=channel_layouts=stereo,volume=${e.g},adelay=${ms}|${ms}[s${i}];`; labels.push(`[s${i}]`); });
  fc += `${labels.join('')}amix=inputs=${labels.length}:normalize=0,volume=0.9[sfxbus];`;
  fc += `[vo][md][sfxbus]amix=inputs=3:normalize=0:weights='1 0.55 0.75',loudnorm=I=-15:LRA=9:TP=-1.5,alimiter=limit=0.80:level=disabled[out]`;
  const gf = path.join(work, 'mix.filter');
  fs.writeFileSync(gf, fc);
  log(`audio mix: ${ev.length} sound effects`);
  try {
    await runAsync([...args, '-filter_complex_script', gf, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(2), mixFile]);
  } catch {
    await runAsync([...args, '-filter_complex_script', gf, '-map', '[out]', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(2), mixFile]);
  }
}
