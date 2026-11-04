// media/lib/paths.mjs — shared folders for the ZALA VIP video machine.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(ROOT, '..');
export const CONTENT = path.join(REPO, 'content');
export const CACHE = path.join(ROOT, 'cache');
export const OUT = path.join(ROOT, 'out');
export const TMP = path.join(ROOT, 'tmp');
export const FONTS = path.join(ROOT, 'brand', 'fonts');
export const BRAND = path.join(ROOT, 'brand');
export const VAULT = path.join(CONTENT, 'vault');

for (const d of [CACHE, OUT, TMP]) fs.mkdirSync(d, { recursive: true });

// Load repo .env.local safely into process.env if present
try {
  const envPath = path.join(REPO, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
} catch {}

