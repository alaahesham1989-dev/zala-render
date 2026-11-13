#!/usr/bin/env node
// The map flight of a ZALA Virtual Tour (part of its PREP stage): a real Mapbox map (satellite, 3D terrain) filmed frame by
// frame in a headless browser on the server, so it never stutters: each frame waits until every map tile has loaded.
// It follows the way a real visitor travels (tour-prep.mjs route legs):
//   Cairo and Giza: the limousine road from Cairo airport; Alexandria and the like: the intercity road from Cairo;
//   far places: the domestic flight line from Cairo airport to the nearest airport, then the short road to the place.
// The camera comes down from space onto Egypt, follows the way while the line draws itself (dashed for the flight, gold for
// the road), then lands on the place with a slow turn. Mapbox logo and attribution stay on screen.
// Ideas from Mapbox's journey-animation-sequence (line-progress reveal, smoothed camera, globe intro) and the Remotion maps
// skill (interactive off, no label fades, wait for idle, film bigger and scale down so satellite detail does not shimmer).
// The flight is cut into one clip per "flight" line of the script and put on those lines (l.clip). Clips: R2 vault/tour/<id>/.
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
if (!r?.legs?.length) throw new Error(`${id}: no route in the script (tour-prep.mjs first)`);
const log = (...a) => console.log('[flight]', ...a);
const vertical = !!script.verticalOnly;
const W = vertical ? 1080 : 1920, H = vertical ? 1920 : 1080, FPS = 30, SEG = 8, SS = 1.5;
const lines = script.chapters.flatMap((c) => c.lines);
let flightLines = lines.map((l, i) => (l.flight ? i : -1)).filter((i) => i >= 0);
if (!flightLines.length) flightLines = [0];
const total = flightLines.length * SEG * FPS;
const FF = process.env.FFMPEG_PATH || 'ffmpeg';
const dest = [r.to.lng, r.to.lat];

// ── the way: each leg resampled evenly and smoothed; a zoom wanted at every point (high for the flight, low for the road) ──
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
const smooth = (pts, w, passes) => { let P = pts; for (let p = 0; p < passes; p++) P = P.map((q, i) => { const s = P.slice(Math.max(0, i - w), i + w + 1); return [s.reduce((a, x) => a + x[0], 0) / s.length, s.reduce((a, x) => a + x[1], 0) / s.length]; }); P[0] = pts[0]; P[P.length - 1] = pts[pts.length - 1]; return P; };
const legs = r.legs.map((leg) => {
  const coords = leg.line.length > 1 ? leg.line : [leg.line[0], dest];
  const n = leg.mode === 'fly' ? 260 : 420;
  const pts = leg.mode === 'fly' ? resample(coords, n) : smooth(resample(coords, n), 6, 3);
  const zoom = leg.mode === 'fly' ? (leg.km > 500 ? 5.4 : 6.2) : leg.km > 120 ? 9.6 : leg.km > 40 ? 11.0 : 12.3;
  return { ...leg, pts, zoom, weight: leg.mode === 'fly' ? 0.42 : 0.58 };
});
const wsum = legs.reduce((a, l) => a + l.weight, 0);
legs.forEach((l) => (l.weight /= wsum));
// global position s in 0..1 -> the leg, the point inside it, and its zoom (blended near the hand-over so the camera descends smoothly)
function along(s) {
  let acc = 0;
  for (let k = 0; k < legs.length; k++) {
    const l = legs[k];
    if (s <= acc + l.weight || k === legs.length - 1) {
      const t = Math.min(1, Math.max(0, (s - acc) / l.weight));
      const i = Math.round(t * (l.pts.length - 1));
      let zoom = l.zoom - (l.mode === 'fly' ? Math.sin(Math.PI * t) * 0.7 : 0);
      const next = legs[k + 1];
      if (next && t > 0.8) zoom += (next.zoom - zoom) * ((t - 0.8) / 0.2);
      return { k, t, c: l.pts[i], ahead: l.pts[Math.min(l.pts.length - 1, i + Math.ceil(l.pts.length * 0.04))], zoom };
    }
    acc += l.weight;
  }
}
const heading = (a, b) => { const k = Math.PI / 180, y = Math.sin((b[0] - a[0]) * k) * Math.cos(b[1] * k), x = Math.cos(a[1] * k) * Math.sin(b[1] * k) - Math.sin(a[1] * k) * Math.cos(b[1] * k) * Math.cos((b[0] - a[0]) * k); return (Math.atan2(y, x) / k + 360) % 360; };
const ease = (t) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, t))) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const angLerp = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

// ── one camera per frame: down from space, along the way, then land and turn slowly over the place ──
const cams = [];
const start = along(0);
let bearing = heading(start.c, start.ahead), zoomNow = 3.2;
for (let f = 0; f < total; f++) {
  const u = f / (total - 1);
  let a, zoom, pitch, b;
  const prog = legs.map(() => 0);
  if (u < 0.14) { const t = ease(u / 0.14); a = along(0); zoom = lerp(3.2, a.zoom, t); pitch = lerp(0, 48, t); b = heading(a.c, a.ahead); }
  else if (u < 0.8) {
    const s = ease((u - 0.14) / 0.66); a = along(s); zoom = a.zoom; pitch = legs[a.k].mode === 'fly' ? 40 : 54; b = heading(a.c, a.ahead);
    legs.forEach((l, k) => { prog[k] = k < a.k ? 1 : k === a.k ? a.t : 0; });
  } else {
    const t = ease((u - 0.8) / 0.2); a = { c: dest }; zoom = lerp(legs[legs.length - 1].zoom, 16.3, t); pitch = lerp(54, 63, t);
    b = heading(legs[legs.length - 1].pts.at(-8) || dest, dest) + 35 * t; legs.forEach((l, k) => (prog[k] = 1));
  }
  bearing = angLerp(bearing, b, 0.07);
  zoomNow = f === 0 ? zoom : lerp(zoomNow, zoom, 0.25);
  cams.push({ center: a.c, zoom: zoomNow, pitch, bearing, prog });
}

const legLayers = legs.map((l, k) => ({ id: `leg${k}`, mode: l.mode, coords: l.pts }));
const markers = [...legs.map((l) => ({ at: l.pts[0], label: l.from })), ...legs.filter((l) => l.mode === 'fly').map((l) => ({ at: l.pts.at(-1), label: '' }))];
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.js"></script>
<style>html,body,#m{margin:0;width:${W}px;height:${H}px;background:#000}
.pin{width:26px;height:26px;border-radius:50%;background:#D4AF37;border:4px solid #fff;box-shadow:0 0 0 10px rgba(212,175,55,.35),0 4px 14px rgba(0,0,0,.6)}
.lab{font:700 ${vertical ? 40 : 34}px Inter,Arial,sans-serif;color:#fff;text-shadow:0 2px 10px #000,0 0 3px #000;white-space:nowrap;transform:translateY(-58px)}
.air{width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid #D4AF37}
.alab{font:600 ${vertical ? 28 : 24}px Inter,Arial,sans-serif;color:#fff;text-shadow:0 2px 8px #000;white-space:nowrap;transform:translateY(34px)}</style></head>
<body><div id="m"></div><script>
mapboxgl.accessToken=${JSON.stringify(process.env.MAPBOX_TOKEN || '')};
const LEGS=${JSON.stringify(legLayers)}, MARKERS=${JSON.stringify(markers)}, DEST=${JSON.stringify(dest)};
const map=new mapboxgl.Map({container:'m',style:'mapbox://styles/mapbox/satellite-streets-v12',projection:'globe',center:LEGS[0].coords[0],zoom:3.2,pitch:0,
  interactive:false,fadeDuration:0,preserveDrawingBuffer:true,antialias:true});
const grad=(p,mode)=>['step',['line-progress'],mode==='fly'?'#FFFFFF':'#F2D27A',Math.max(0.0001,p),'rgba(0,0,0,0)'];
window.ready=new Promise((res)=>map.on('load',()=>{
  map.addSource('dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});
  map.setTerrain({source:'dem',exaggeration:1.25});
  map.setFog({range:[0.8,8],color:'#d8c9a8','horizon-blend':0.08,'space-color':'#05070d','star-intensity':0.25});
  for(const l of LEGS){
    map.addSource(l.id,{type:'geojson',lineMetrics:true,data:{type:'Feature',geometry:{type:'LineString',coordinates:l.coords}}});
    map.addLayer({id:l.id+'g',type:'line',source:l.id,paint:{'line-width':${vertical ? 18 : 14},'line-blur':6,'line-opacity':0.35,'line-gradient':grad(0,l.mode)}});
    map.addLayer({id:l.id,type:'line',source:l.id,layout:{'line-cap':'round','line-join':'round'},paint:{'line-width':${vertical ? 7 : 6},'line-gradient':grad(0,l.mode)}});
  }
  for(const m of MARKERS){const a=document.createElement('div');a.className='air';new mapboxgl.Marker({element:a}).setLngLat(m.at).addTo(map);
    if(m.label){const t=document.createElement('div');t.className='alab';t.textContent=m.label;new mapboxgl.Marker({element:t}).setLngLat(m.at).addTo(map);}}
  const p=document.createElement('div');p.className='pin';new mapboxgl.Marker({element:p}).setLngLat(DEST).addTo(map);
  const l=document.createElement('div');l.className='lab';l.textContent=${JSON.stringify(r.to.name)};new mapboxgl.Marker({element:l}).setLngLat(DEST).addTo(map);
  res();
}));
window.frame=(c)=>new Promise((res)=>{
  LEGS.forEach((l,k)=>{map.setPaintProperty(l.id,'line-gradient',grad(c.prog[k],l.mode));map.setPaintProperty(l.id+'g','line-gradient',grad(c.prog[k],l.mode));});
  map.jumpTo({center:c.center,zoom:c.zoom,pitch:c.pitch,bearing:c.bearing});
  let done=false;const fin=()=>{if(!done){done=true;requestAnimationFrame(()=>res());}};
  map.once('idle',fin);setTimeout(fin,12000);
});
</script></body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `flight-${id}-`));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H, deviceScaleFactor: SS },
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

// one clip per flight line, filmed 1.5x bigger and scaled down (sharper, no shimmer), on R2, put on the line
const base = process.env.VITE_MEDIA_BASE_URL || 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';
flightLines.forEach((li, k) => {
  const out = path.join(tmp, `flight-${k + 1}.mp4`);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-start_number', String(k * SEG * FPS), '-i', path.join(tmp, '%05d.jpg'), '-frames:v', String(SEG * FPS),
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  const key = `vault/tour/${id}/flight-${k + 1}.mp4`;
  execFileSync('aws', ['s3', 'cp', out, `s3://${process.env.R2_BUCKET}/${key}`, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, '--content-type', 'video/mp4', '--no-progress'], { stdio: 'inherit' });
  const l = lines[li];
  l.clip = { url: `${base}/${key}?v=${Date.now()}`, what: 'map flight to the place', credit: '© Mapbox © OpenStreetMap', license: 'Mapbox map (attribution on screen)', mapFlight: true };
  delete l.map; l.noMap = true;
  log(`line ${li + 1}: ${key}`);
});
fs.writeFileSync(file, JSON.stringify(script, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
log(`${id}: ${flightLines.length} flight clips, ${(total / FPS).toFixed(0)} s — ${r.summary}`);
