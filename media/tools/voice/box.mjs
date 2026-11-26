// Private hand-over for the owner's voice: the bucket and this repository are public, so the sample and the
// generated speech only travel encrypted (same scheme as ../lipsync/box.mjs, with its own key label).
//   node media/tools/voice/box.mjs send <job> bundle.json     (laptop)
//   node media/tools/voice/box.mjs open <job> result.zip      (laptop)
import fs from 'node:fs';
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
const key = () => crypto.createHmac('sha256', K('R2_SECRET_ACCESS_KEY')).update('zala-voice-v1').digest();
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

const [cmd, job, file] = process.argv.slice(2);
if (!/^[a-z0-9]{12,40}$/.test(job || '')) throw new Error('job must be 12-40 lowercase letters or digits');
if (cmd === 'send') {
  await put(`handover/voice/${job}/bundle.box`, seal(fs.readFileSync(file)));
  console.log(`sent encrypted bundle for job ${job}`);
} else if (cmd === 'open') {
  const r = await fetch(`${BASE}/handover/voice/${job}/result.box`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`no result yet: ${r.status}`);
  fs.writeFileSync(file, unseal(Buffer.from(await r.arrayBuffer())));
  console.log(`result written: ${fs.statSync(file).size} bytes`);
} else throw new Error('send or open');
