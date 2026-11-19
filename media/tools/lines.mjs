#!/usr/bin/env node
// The two video machines (media/lines/en.json and ar.json) and the guard that keeps them apart.
// Usage: node media/tools/lines.mjs check              exit 1 when the two machines share a write path, queue, key or lock
//        node media/tools/lines.mjs get <line> <a.b.c>  print one value (for workflows)
//        node media/tools/lines.mjs prep <line>         print the prep checklist of that machine
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const load = (line) => JSON.parse(read(`media/lines/${line}.json`));
const [, , cmd = 'check', a, b] = process.argv;

if (cmd === 'get') {
  const v = b.split('.').reduce((o, k) => (o == null ? o : o[k]), load(a));
  console.log(typeof v === 'string' ? v : JSON.stringify(v));
  process.exit(0);
}
if (cmd === 'prep') {
  const l = load(a);
  console.log(`PREP FILE: ${l.label}  (${l.prep.script}, workflow ${l.prep.workflow})`);
  l.prep.checklist.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  process.exit(0);
}

const en = load('en');
const ar = load('ar');
const ERR = [];
const WARN = [];
const must = (ok, msg) => { if (!ok) ERR.push(msg); };
const overlap = (x, y) => `${x}/`.startsWith(`${y}/`) || `${y}/`.startsWith(`${x}/`);
const common = (x, y) => x.filter((k) => y.includes(k));

must(!overlap(en.state.r2_prefix, ar.state.r2_prefix), `R2 state prefixes overlap: ${en.state.r2_prefix} / ${ar.state.r2_prefix}`);
must(en.state.outbox !== ar.state.outbox, 'both machines share one outbox');
must(en.state.meta_queue !== ar.state.meta_queue, 'both machines share one Meta queue');
const grp = (l) => [l.run.concurrency, ...(l.run.also_concurrency || [])];
must(!common(grp(en), grp(ar)).length, 'both machines share a concurrency group');
must(!common(en.run.workflows, ar.run.workflows).length, `shared workflows: ${common(en.run.workflows, ar.run.workflows)}`);
must(!common(en.keys.gemini, ar.keys.gemini).length, `shared Gemini keys: ${common(en.keys.gemini, ar.keys.gemini)}`);
if (en.keys.youtube_token && ar.keys.youtube_token) must(en.keys.youtube_token !== ar.keys.youtube_token, 'both machines share one YouTube token');
must(en.topics.skip_id_prefix.includes(ar.topics.id_prefix), `the English machine must skip ${ar.topics.id_prefix} topics`);

for (const l of [en, ar]) {
  for (const f of [l.prep.script, l.topics.source, l.cta.config, l.prep.style].filter(Boolean)) must(fs.existsSync(path.join(ROOT, f)), `${l.line}: missing file ${f}`);
  for (const w of l.run.workflows) must(fs.existsSync(path.join(ROOT, '.github/workflows', w)), `${l.line}: missing workflow ${w}`);
}
const arIds = Object.keys(JSON.parse(read(ar.topics.source)));
must(arIds.length > 0 && arIds.every((i) => i.startsWith(ar.topics.id_prefix)), `every Arabic topic id must start with ${ar.topics.id_prefix}`);
const enIds = Object.keys(JSON.parse(read(en.topics.source)));
const carried = enIds.filter((i) => arIds.includes(i));
if (carried.length) WARN.push(`the English topic list still carries ${carried.length} Arabic ids (the library tool needs them there): the English pickers must filter them`);
for (const w of ['prep.yml', 'factory.yml']) for (const p of en.topics.skip_id_prefix) must(read(`.github/workflows/${w}`).includes(`startsWith(\"${p}\")`), `English ${w} does not filter ${p} topics`);

// a workflow of one machine must never upload into the other machine's state
const uploadsTo = (wf, prefix) => new RegExp(`aws s3 (?:sync|cp)[^\\n]*"?s3://\\$\\{R2_BUCKET\\}/${prefix.replace(/[/.-]/g, '\\$&')}(?:/|"|\\s)`).test(read(`.github/workflows/${wf}`).split('\n').filter((x) => /aws s3 (sync|cp) (content|\/tmp\/ar-out|\.\/)/.test(x)).join('\n'));
for (const w of ar.run.workflows) must(!uploadsTo(w, en.state.r2_prefix), `${w} uploads into the English state ${en.state.r2_prefix}`);
for (const w of en.run.workflows) must(!uploadsTo(w, ar.state.r2_prefix), `${w} uploads into the Arabic state ${ar.state.r2_prefix}`);

if (ar.keys.gemini_borrows_shared_until_own_key) WARN.push('Arabic machine has no Gemini key of its own yet: it borrows the shared ones (GEMINI_API_KEY_AR is the owner\'s step)');
if (!ar.live) WARN.push(`Arabic machine is OFF: ${ar.gate}`);

console.log(`lines check: ${ERR.length ? 'FAILED' : 'ok'}  (en: ${enIds.length} topics, ar: ${arIds.length} topics)`);
WARN.forEach((m) => console.log(`  warn  ${m}`));
ERR.forEach((m) => console.log(`  ERROR ${m}`));
process.exit(ERR.length ? 1 : 0);
