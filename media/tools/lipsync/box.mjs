// Private hand-over for the lip-sync test: the R2 bucket is public and so is this repository, so a person's
// picture and voice only travel encrypted. The key is derived from the R2 secret, which both ends already hold.
//   node media/tools/lipsync/box.mjs send <job> face.png voice.wav     (laptop)
//   node media/tools/lipsync/box.mjs open <job> <out.mp4>              (laptop, fetches the result)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const env = {};
try {
  for (const l of fs.readFileSync(process.env.ENV_FILE || '.env.local', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* the environment may already hold them */ }
const K = (n) => process.env[n] || env[n] || (() => { throw new Error(`${n} is not set`); })();
const BASE = 'https://pub-20815a715a814497b24a479c98b1815e.r2.dev';
const key = () => crypto.createHmac('sha256', K('R2_SECRET_ACCESS_KEY')).update('zala-lipsync-v1').digest();
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function put(name, body) {
  const host = `${K('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
  const uri = `/${K('R2_BUCKET')}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const headers = { host, 'x-amz-content-sha256': sha(body), 'x-amz-date': stamp };
  const names = Object.keys(headers).sort();
  const canonical = ['PUT', uri, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), headers['x-amz-content-sha256']].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const sk = hmac(hmac(hmac(hmac(`AWS4${K('R2_SECRET_ACCESS_KEY')}`, day), 'auto'), 's3'), 'aws4_request');
  const signature = hmac(sk, ['AWS4-HMAC-SHA256', stamp, scope, sha(canonical)].join('\n')).toString('hex');
  const auth = `AWS4-HMAC-SHA256 Credential=${K('R2_ACCESS_KEY_ID')}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  delete headers.host;
  const r = await fetch(`https://${host}${uri}`, { method: 'PUT', headers: { ...headers, authorization: auth }, body });
  if (!r.ok) throw new Error(`R2 refused the upload: ${r.status}`);
}

const seal = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
};
const unseal = (box) => {
  const d = crypto.createDecipheriv('aes-256-gcm', key(), box.subarray(0, 12));
  d.setAuthTag(box.subarray(box.length - 16));
  return Buffer.concat([d.update(box.subarray(12, box.length - 16)), d.final()]);
};

const [cmd, job, ...files] = process.argv.slice(2);
if (!/^[a-z0-9]{12,40}$/.test(job || '')) throw new Error('job must be 12-40 lowercase letters or digits');
if (cmd === 'send') {
  const names = ['face.png', 'voice.wav'];
  for (const [i, f] of files.entries()) await put(`handover/lipsync/${job}/${names[i]}.box`, seal(fs.readFileSync(f)));
  console.log(`sent ${files.length} encrypted files for job ${job}`);
} else if (cmd === 'open') {
  const r = await fetch(`${BASE}/handover/lipsync/${job}/result.mp4.box`);
  if (!r.ok) throw new Error(`no result yet: ${r.status}`);
  fs.mkdirSync(path.dirname(path.resolve(files[0])), { recursive: true });
  fs.writeFileSync(files[0], unseal(Buffer.from(await r.arrayBuffer())));
  console.log(`result written: ${fs.statSync(files[0]).size} bytes`);
} else throw new Error('send or open');
