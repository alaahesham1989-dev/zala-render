// Per-language factory settings. One reader for lang.config.json so no script hard-codes a language rule.
// Usage: import { isProduction, keysFor, statePrefix } from './lang/paths.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lang.config.json');
let cache = null;

export const config = () => (cache ??= JSON.parse(fs.readFileSync(FILE, 'utf8')));
export const LANGS = () => Object.keys(config().languages);

export function lang(code) {
  const l = config().languages[code];
  if (!l) throw new Error(`unknown language: ${code}`);
  return l;
}

export const isProduction = (code) => lang(code).production === true;
export const isPublishing = (code) => lang(code).publish === true;
export const keysFor = (code) => [...lang(code).keys];
export const statePrefix = (code) => lang(code).state.r2Prefix;
export const queuePath = (code) => lang(code).state.queue;
export const outboxPath = (code) => lang(code).state.outbox;

// Problems that would let one language write over another's state, quota or accounts. Empty array = fine.
export function validateConfig(cfg = config()) {
  const problems = [];
  const seen = { keys: new Map(), r2Prefix: new Map(), queue: new Map(), outbox: new Map() };
  const claim = (bucket, value, code) => {
    const owner = seen[bucket].get(value);
    if (owner && owner !== code) problems.push(`${bucket} "${value}" is used by both ${owner} and ${code}`);
    else seen[bucket].set(value, code);
  };
  for (const [code, l] of Object.entries(cfg.languages)) {
    for (const f of ['name', 'production', 'publish', 'keys', 'state', 'storyAnchorsUtc', 'hybrid', 'longAnchorUtc']) {
      if (l[f] === undefined) problems.push(`${code}: missing ${f}`);
    }
    (l.keys || []).forEach((k) => claim('keys', k, code));
    claim('r2Prefix', l.state?.r2Prefix, code);
    claim('queue', l.state?.queue, code);
    claim('outbox', l.state?.outbox, code);
    if (l.publish && !l.production && code !== 'en') problems.push(`${code}: publishing without production`);
  }
  for (const [kind, k] of Object.entries(cfg.kinds)) {
    if (k.ads && k.platforms.some((p) => cfg.rules.noAdsOn.includes(p))) problems.push(`kind ${kind}: ads on a no-ads platform`);
  }
  return problems;
}
