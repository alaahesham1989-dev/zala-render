#!/usr/bin/env node
// The map flight of a ZALA Virtual Tour (part of its PREP stage): a real Mapbox map (satellite, 3D terrain) filmed frame by
// frame in a headless browser on the server, so it never stutters: each frame waits until every map tile has loaded.
// The camera starts over the airport, follows the real road (or flies when the place is far) while the gold route line
// draws itself, slows down, and lands on the place with a slow turn. Mapbox logo and attribution stay on screen.
// The flight is cut into one clip per "flight" line of the script and put on those lines (l.clip), so the voice talks
// over the journey. Clips go to R2 vault/tour/<id>/.
//   node media/tools/tour-flight.mjs <id>        (MAPBOX_TOKEN, CHROME_PATH, R2 settings in the environment)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const id = process.argv[2];
const file = path.join(REPO, 'content', 'youtube', `${id}.json`);
const script = JSON.parse(fs.readFileSync(file, 'utf8'));
const r = script.route;
if (!r?.line?.length) throw new Error(`${id}: no route in the script (tour-prep.mjs first)`);
const log = (...a) => console.log('[flight]', ...a);
const vertical = !!script.verticalOnly;
const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080, FPS = 30, SEG = 8;
const lines = script.chapters.flatMap((c) => c.lines);
let flightLines = lines.map((l, i) => (l.flight ? i : -1)).filter((i) => i >= 0);
if (!flightLines.length) flightLines = [0];
const total = flightLines.length * SEG * FPS;
const FF = process.env.FFMPEG_PATH || 'ffmpeg';

// ── the path: evenly spaced points along the road, smoothed, so the camera glides ──
const dist = (a, b) => { const k = Math.PI / 180, x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k), y = (b[1] - a[1]) * k; return Math.sqrt(x * x + y * y) * 6371; };
function resample(coords, n) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const L = cum[cum.length - 1] || 1, out = [];
  for (let k = 0, j = 0; k < n; k++) {
    const t = (k / (n - 1)) * L;
    while (j < cum.length - 2 && cum[j + 1] < t) j++;
    const f = (t - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    out.push([coords[j][0] + (coords[j + 1][0] - coords[j][0]) * f, coords[j][1] + (coords[j + 1][1] - coords[j][1]) * f]);
  }
  return out;
}
const coords = r.line.length > 1 ? r.line : [r.line[0], [r.to.lng, r.to.lat]];
let P = resample(coords, 600);
for (let pass = 0; pass < 3; pass++) P = P.map((p, i) => { const w = P.slice(Math.max(0, i - 6), i + 7); return [w.reduce((a, q) => a + q[0], 0) / w.length, w.reduce((a, q) => a + q[1], 0) / w.length]; });
P[0] = coords[0]; P[P.length - 1] = [r.to.lng, r.to.lat];
const at = (u) => P[Math.min(P.length - 1, Math.max(0, Math.round(u * (P.length - 1))))];
const heading = (a, b) => { const k = Math.PI / 180, y = Math.sin((b[0] - a[0]) * k) * Math.cos(b[1] * k), x = Math.cos(a[1] * k) * Math.sin(b[1] * k) - Math.sin(a[1] * k) * Math.cos(b[1] * k) * Math.cos((b[0] - a[0]) * k); return (Math.atan2(y, x) / k + 360) % 360; };
const ease = (t) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const angLerp = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;
const far = r.mode === 'fly' || r.km > 60;
const cruise = far ? 6.4 : r.km > 25 ? 11.4 : 12.4;

// ── one camera per frame: rise over the airport, follow the way, then land and turn slowly over the place ──
const cams = [];
let bearing = heading(at(0), at(0.05));
for (let f = 0; f < total; f++) {
  const u = f / (total - 1);
  let p, zoom, pitch, b;
  if (u < 0.12) { const t = ease(u / 0.12); p = 0; zoom = lerp(cruise - 1.5, cruise, t); pitch = lerp(20, 50, t); b = heading(at(0), at(0.05)); }
  else if (u < 0.78) { const t = ease((u - 0.12) / 0.66); p = t; zoom = far ? cruise - Math.sin(Math.PI * t) * 0.8 : cruise; pitch = 52; b = heading(at(Math.max(0, t - 0.02)), at(Math.min(1, t + 0.05))); }
  else { const t = ease((u - 0.78) / 0.22); p = 1; zoom = lerp(cruise, 16.4, t); pitch = lerp(52, 64, t); b = heading(at(0.9), at(1)) + 35 * t; }
  bearing = angLerp(bearing, b, 0.08);
  const c = p >= 1 ? [r.to.lng, r.to.lat] : at(p);
  cams.push({ center: c, zoom, pitch, bearing, upto: Math.max(2, Math.round(Math.min(1, u < 0.12 ? 0 : u < 0.78 ? p : 1) * (P.length - 1)) + 1) });
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.js"></script>
<style>html,body,#m{margin:0;width:${W}px;height:${H}px;background:#000}
.pin{width:26px;height:26px;border-radius:50%;background:#D4AF37;border:4px solid #fff;box-shadow:0 0 0 10px rgba(212,175,55,.35),0 4px 14px rgba(0,0,0,.6)}
.lab{font:700 ${vertical ? 40 : 34}px Inter,Arial,sans-serif;color:#fff;text-shadow:0 2px 10px #000,0 0 3px #000;white-space:nowrap;transform:translateY(-58px)}
.air{width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid #D4AF37}</style></head>
<body><div id="m"></div><script>
mapboxgl.accessToken=${JSON.stringify(process.env.MAPBOX_TOKEN || '')};
const P=${JSON.stringify(P)};
const map=new mapboxgl.Map({container:'m',style:'mapbox://styles/mapbox/satellite-streets-v12',center:P[0],zoom:${cruise - 1.5},pitch:20,
  interactive:false,fadeDuration:0,preserveDrawingBuffer:true,antialias:true});
window.ready=new Promise((res)=>map.on('load',()=>{
  map.addSource('dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});
  map.setTerrain({source:'dem',exaggeration:1.25});
  map.setFog({range:[0.8,8],color:'#d8c9a8','horizon-blend':0.08});
  map.addSource('route',{type:'geojson',data:{type:'Feature',geometry:{type:'LineString',coordinates:P.slice(0,2)}}});
  map.addLayer({id:'glow',type:'line',source:'route',paint:{'line-color':'#D4AF37','line-width':${vertical ? 18 : 14},'line-opacity':0.35,'line-blur':6}});
  map.addLayer({id:'route',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#F2D27A','line-width':${vertical ? 7 : 6}}});
  const a=document.createElement('div');a.className='air';new mapboxgl.Marker({element:a}).setLngLat(P[0]).addTo(map);
  const p=document.createElement('div');p.className='pin';new mapboxgl.Marker({element:p}).setLngLat(P[P.length-1]).addTo(map);
  const l=document.createElement('div');l.className='lab';l.textContent=${JSON.stringify(r.to.name)};new mapboxgl.Marker({element:l}).setLngLat(P[P.length-1]).addTo(map);
  res();
}));
window.frame=(c)=>new Promise((res)=>{
  map.getSource('route').setData({type:'Feature',geometry:{type:'LineString',coordinates:P.slice(0,c.upto)}});
  map.jumpTo({center:c.center,zoom:c.zoom,pitch:c.pitch,bearing:c.bearing});
  let done=false;const fin=()=>{if(!done){done=true;requestAnimationFrame(()=>res());}};
  map.once('idle',fin);setTimeout(fin,12000);
});
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `flight-${id}-`));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => log('page error:', e.message));
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.evaluate(() => window.ready);
  const t0 = Date.now();
  for (let f = 0; f < cams.length; f++) {
    await page.evaluate((c) => window.frame(c), cams[f]);
    await page.screenshot({ path: path.join(tmp, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    if (f % 120 === 0) log(`frame ${f}/${cams.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
} finally { await browser.close(); }

// one clip per flight line, on R2, put on the line
const base = process.env.VITE_MEDIA_BASE_URL || 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';
flightLines.forEach((li, k) => {
  const out = path.join(tmp, `flight-${k + 1}.mp4`);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-start_number', String(k * SEG * FPS), '-i', path.join(tmp, '%05d.jpg'), '-frames:v', String(SEG * FPS),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  const key = `vault/tour/${id}/flight-${k + 1}.mp4`;
  execFileSync('aws', ['s3', 'cp', out, `s3://${process.env.R2_BUCKET}/${key}`, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--content-type', 'video/mp4', '--no-progress'], { stdio: 'inherit' });
  const l = lines[li];
  l.clip = { url: `${base}/${key}?v=${Date.now()}`, what: 'map flight to the place', credit: '© Mapbox © OpenStreetMap', license: 'Mapbox map (attribution on screen)', mapFlight: true };
  delete l.map; l.noMap = true;
  log(`line ${li + 1}: ${key}`);
});
fs.writeFileSync(file, JSON.stringify(script, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
log(`${id}: ${flightLines.length} flight clips, ${(total / FPS).toFixed(0)} s, ${r.mode} ${r.km} km from ${r.from}`);
