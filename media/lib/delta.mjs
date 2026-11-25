// What one parallel job changed in content/, and how to put several such changes together without losing any.
//   node media/lib/delta.mjs snapshot content <file>      remember how content/ looks now (with copies)
//   node media/lib/delta.mjs collect content <file> <out> save the files that changed since, with their old copy
//   node media/lib/delta.mjs apply <out> content          merge a saved change into content/ (three-way for JSON)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const walk = (dir, rel = '') => (fs.existsSync(path.join(dir, rel)) ? fs.readdirSync(path.join(dir, rel), { withFileTypes: true }) : [])
  .flatMap((e) => (e.isDirectory() ? walk(dir, path.join(rel, e.name)) : [path.join(rel, e.name)]));
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// what names an item of a list: outbox entries and videos by id, queue entries by episode and which cut
const idOf = (x) => (isObject(x) ? [x.id ?? x.episode, x.which].filter((v) => v !== undefined).join('|') || null : null);

/** base = before the job, mine = after the job, theirs = what is there now (maybe changed by another job). */
export function merge(base, mine, theirs) {
  if (same(mine, base)) return theirs;
  if (theirs === undefined || same(theirs, base)) return mine;
  if (isObject(mine) && isObject(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const inBase = base && Object.prototype.hasOwnProperty.call(base, k);
      if (!(k in mine)) { if (!inBase) out[k] = theirs[k]; continue; }          // the job removed it
      if (!(k in theirs)) { if (!inBase || !same(mine[k], base[k])) out[k] = mine[k]; continue; }
      out[k] = merge(inBase ? base[k] : undefined, mine[k], theirs[k]);
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const key = (x) => idOf(x) ?? JSON.stringify(x);
    const was = new Map((Array.isArray(base) ? base : []).map((x) => [key(x), x]));
    const now = new Map(mine.map((x) => [key(x), x]));
    const out = [];
    for (const x of theirs) {
      const k = key(x);
      if (!now.has(k)) { if (!was.has(k)) out.push(x); continue; }              // dropped by the job
      out.push(merge(was.get(k), now.get(k), x));
    }
    const have = new Set(theirs.map(key));
    for (const x of mine) { const k = key(x); if (!have.has(k) && !(was.has(k) && same(was.get(k), x))) out.push(x); }
    return out;
  }
  return mine;                                                                    // both changed one value: the job wins
}

export function snapshot(dir, to) {
  fs.rmSync(to, { recursive: true, force: true });
  for (const f of walk(dir)) copy(path.join(dir, f), path.join(to, f));
}

export function collect(dir, before, out) {
  let n = 0;
  for (const f of walk(dir)) {
    const old = path.join(before, f);
    const was = fs.existsSync(old);
    if (was && fs.readFileSync(old).equals(fs.readFileSync(path.join(dir, f)))) continue;
    copy(path.join(dir, f), path.join(out, 'new', f));
    if (was) copy(old, path.join(out, 'base', f));
    n++;
  }
  return n;
}

export function apply(out, dir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
  let n = 0;
  for (const f of walk(path.join(out, 'new'))) {
    const mineFile = path.join(out, 'new', f), target = path.join(dir, f);
    const mine = f.endsWith('.json') ? read(mineFile) : undefined;
    const theirs = mine === undefined ? undefined : read(target);
    if (mine === undefined || theirs === undefined) copy(mineFile, target);
    else fs.writeFileSync(target, JSON.stringify(merge(read(path.join(out, 'base', f)), mine, theirs), null, 2) + '\n');
    n++;
  }
  return n;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'snapshot') { snapshot(a, b); console.log('snapshot taken'); }
  else if (cmd === 'collect') console.log(`${collect(a, b, c)} changed files saved`);
  else if (cmd === 'apply') console.log(`${apply(a, b)} files merged`);
  else throw new Error('usage: snapshot <dir> <to> | collect <dir> <before> <out> | apply <out> <dir>');
}
