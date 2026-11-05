#!/usr/bin/env node
// Writes the owner's preview page: every episode's video, reels, thumbnails, length and quality result.
// Usage: node media/tools/preview-board.mjs <out.html>   (reads public files, needs VITE_MEDIA_BASE_URL)
import fs from 'node:fs';
const base = (process.env.VITE_MEDIA_BASE_URL || '').replace(/\/$/, '');
const IDS = ['ZV-L01', 'ZV-L02', 'ZV-L05', 'ZV-L06', 'ZV-L08', 'ZV-L09', 'ZV-L11'];
const get = async (u) => { try { const r = await fetch(`${u}?t=${Date.now()}`); return r.ok ? r.json() : null; } catch { return null; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let cards = '';
for (const id of IDS) {
  const root = `${base}/renders/${id}`;
  const pkg = await get(`${root}/publish/${id}.youtube.json`);
  if (!pkg) { cards += `<section><h2>${id}</h2><p class="wait">لسه ما اتعملش</p></section>`; continue; }
  const v = await get(`${root}/review/verdict.json`);
  const min = `${Math.floor(pkg.duration / 60)}:${String(Math.round(pkg.duration % 60)).padStart(2, '0')}`;
  cards += `<section><h2>${esc(pkg.title)}</h2><p>${id} · ${min} · <b class="${v?.pass ? 'ok' : 'no'}">${v?.pass ? 'الفحص نجح' : 'الفحص موقفه'}</b> · ${esc((pkg.renderedAt || '').slice(0, 10))}</p>
${v && !v.pass ? `<ul>${v.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
<video controls preload="none" src="${root}/publish/${esc(pkg.file)}" poster="${root}/publish/${esc(pkg.thumbnail)}"></video>
<div class="thumbs">${(pkg.thumbnails || []).map((t) => `<img loading="lazy" src="${root}/publish/${esc(t)}" alt="">`).join('')}</div>
<div class="reels">${(pkg.reels || []).map((r) => `<a href="${root}/publish/${esc(r.file)}">ريل: ${esc(r.title)} (${Math.round(r.duration)} ث)</a>`).join('')}</div></section>`;
}
fs.writeFileSync(process.argv[2], `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة قناة ZALA</title><style>
body{margin:0;background:#0b0b0b;color:#eee;font:16px system-ui;padding:16px}h1{color:#d4af37}section{background:#171717;border:1px solid #333;border-radius:12px;padding:16px;margin:0 auto 16px;max-width:900px}h2{margin:0 0 6px;font-size:20px}.ok{color:#5fd17a}.no{color:#ff7b6b}.wait{color:#888}video{width:100%;border-radius:8px;background:#000}.thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}.thumbs img{width:100%;border-radius:6px}.reels a{display:inline-block;margin:8px 8px 0 0;color:#d4af37}</style><h1>معاينة قناة ZALA</h1>${cards}</html>`);
