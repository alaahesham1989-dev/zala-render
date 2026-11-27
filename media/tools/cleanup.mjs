#!/usr/bin/env node
// Smart storage cleanup (rules: media/lib/cleanup-rules.mjs). Prints totals only; the log is public.
//   node media/tools/cleanup.mjs            dry run: says what would go
//   node media/tools/cleanup.mjs --apply    removes it
//   --list <file.json>                      read the object list from a file instead of the bucket (testing)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { plan, isProtected } from '../lib/cleanup-rules.mjs';

const LIMIT_GB = Number(process.env.CLEANUP_LIMIT_GB || 25);   // more than this in one go means something is wrong: stop
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const listFile = argv.includes('--list') ? argv[argv.indexOf('--list') + 1] : '';
const gb = (n) => (n / 1e9).toFixed(2);
const read = (f) => { try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(d) ? d : d.items || d.queue || Object.values(d); } catch { return null; } };
const aws = (...a) => execFileSync('aws', [...a, '--endpoint-url', `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`],
  { encoding: 'utf8', maxBuffer: 1 << 29 });

function listBucket() {
  if (listFile) return JSON.parse(fs.readFileSync(listFile, 'utf8')).map(([key, size, day, etag]) => ({ key, size, modified: `${day}T23:59:59Z`, etag }));
  const rows = JSON.parse(aws('s3api', 'list-objects-v2', '--bucket', process.env.R2_BUCKET, '--output', 'json',
    '--query', 'Contents[].[Key,Size,LastModified,ETag]'));
  return rows.map(([key, size, modified, etag]) => ({ key, size, modified, etag }));
}

const outbox = read('content/outbox.json');
const queue = read('content/meta-queue.json');
if (!outbox || !queue) { console.error('the queue files could not be read: nothing removed'); process.exit(1); }
const objects = listBucket();
const remove = plan(objects, { outbox, queue });
if (remove.some((x) => isProtected(x.key))) { console.error('a protected file is in the plan: nothing removed'); process.exit(1); }

const total = objects.reduce((a, o) => a + o.size, 0);
const freed = remove.reduce((a, x) => a + x.size, 0);
const kinds = {};
for (const x of remove) { kinds[x.reason] = kinds[x.reason] || [0, 0]; kinds[x.reason][0] += 1; kinds[x.reason][1] += x.size; }
console.log(`bucket ${gb(total)} GB in ${objects.length} files; to remove ${remove.length} files, ${gb(freed)} GB`);
for (const [k, [n, s]] of Object.entries(kinds)) console.log(`  ${k}: ${n} files, ${gb(s)} GB`);
if (freed > LIMIT_GB * 1e9) { console.error(`more than ${LIMIT_GB} GB in one run: nothing removed, look first`); process.exit(1); }
if (!apply) { console.log('dry run: nothing removed'); process.exit(0); }

const tmp = path.join(os.tmpdir(), 'cleanup-batch.json');
for (let i = 0; i < remove.length; i += 500) {
  fs.writeFileSync(tmp, JSON.stringify({ Objects: remove.slice(i, i + 500).map((x) => ({ Key: x.key })), Quiet: true }));
  const out = aws('s3api', 'delete-objects', '--bucket', process.env.R2_BUCKET, '--delete', `file://${tmp}`, '--output', 'json');
  const errors = out.trim() ? JSON.parse(out).Errors || [] : [];
  if (errors.length) { console.error(`storage refused ${errors.length} files`); process.exit(1); }
}
console.log(`removed ${remove.length} files, ${gb(freed)} GB; bucket now about ${gb(total - freed)} GB`);
