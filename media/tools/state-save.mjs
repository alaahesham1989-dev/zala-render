#!/usr/bin/env node
// Saves the state files (the queue, the outbox, the lists of what was made) to git without ever losing a result.
// A render runs for hours; meanwhile other workflows push their own changes to the same JSON files. A plain
// "git pull --rebase" then stops on a conflict and the whole result is thrown away (2026-11-14: a finished tour was
// on YouTube but never reached the queue or the outbox). Here each file is merged entry by entry instead:
//   base   = the file as this job checked it out,   mine = the file as this job left it,   theirs = origin/main now
//   an entry I added is added, an entry I changed gets my changes, an entry I removed is removed, the rest is theirs.
// Usage: node media/tools/state-save.mjs "<commit message>" <file> [<file> ...]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [message, ...files] = process.argv.slice(2);
if (!message || !files.length) { console.error('usage: state-save.mjs "<message>" <file> [...]'); process.exit(2); }
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const show = (ref, f) => { try { return JSON.parse(git('show', `${ref}:${f}`)); } catch { return undefined; } };
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const keyOf = (x) => !isObj(x) ? JSON.stringify(x)
  : x.episode && x.which ? `${x.episode}|${x.which}|${[].concat(x.to || []).map((t) => String(t).replace(/^yt:.*/, 'yt')).sort().join('+')}`
  : x.id !== undefined ? `${x.id}|${x.refused ? x.at : ''}`
  : x.topic ? `t:${x.topic}` : x.slug ? `s:${x.slug}` : JSON.stringify(x);

function merge(base, mine, theirs) {
  if (mine === undefined) return theirs;
  if (theirs === undefined || same(mine, theirs)) return mine;
  if (same(mine, base)) return theirs;          // I changed nothing here
  if (same(theirs, base)) return mine;          // only I changed it
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const b = new Map((Array.isArray(base) ? base : []).map((x) => [keyOf(x), x]));
    const m = new Map(mine.map((x) => [keyOf(x), x]));
    const out = [];
    const seen = new Set();
    for (const t of theirs) {
      const k = keyOf(t);
      seen.add(k);
      if (!m.has(k)) { if (!b.has(k)) out.push(t); continue; }   // in base and gone from mine: I removed it
      out.push(merge(b.get(k), m.get(k), t));
    }
    for (const [k, x] of m) if (!seen.has(k) && !b.has(k)) out.push(x);   // added by me
    return out;
  }
  if (isObj(mine) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = merge(isObj(base) ? base[k] : undefined, mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    // something posted is never un-posted by a merge
    if (theirs.done && !out.done) out.done = theirs.done;
    if (theirs.scheduled && !out.scheduled) out.scheduled = theirs.scheduled;
    return out;
  }
  return mine;
}

const mine = Object.fromEntries(files.map((f) => [f, read(f)]));
const base = Object.fromEntries(files.map((f) => [f, show('HEAD', f)]));
const todo = files.filter((f) => mine[f] !== undefined);
if (!todo.length) { console.log('[state] nothing to save'); process.exit(0); }
try { git('config', 'user.name'); } catch { git('config', 'user.name', 'zala-bot'); git('config', 'user.email', 'zala-bot@users.noreply.github.com'); }

for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    git('fetch', '-q', 'origin', 'main');
    git('reset', '-q', 'origin/main');            // HEAD and index move, the working tree is left alone
    let changed = 0;
    for (const f of todo) {
      const theirs = show('origin/main', f);
      const merged = merge(base[f], mine[f], theirs);
      fs.writeFileSync(f, `${JSON.stringify(merged, null, 2)}\n`);
      git('add', '-f', f);
      if (!same(merged, theirs)) changed++;
    }
    if (!changed) { console.log('[state] already up to date'); process.exit(0); }
    git('commit', '-q', '-m', message);
    git('push', '-q', 'origin', 'HEAD:main');
    console.log(`[state] saved ${changed} file(s): ${message}`);
    process.exit(0);
  } catch (e) {
    console.log(`[state] try ${attempt}: ${String(e.stderr || e.message).trim().split('\n').pop()}`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
}
console.error('[state] could not save after 6 tries');
process.exit(1);
