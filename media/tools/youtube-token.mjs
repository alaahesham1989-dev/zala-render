#!/usr/bin/env node
// Runs on the server once. Turns the one-time consent code into a long-lived token.
// The token leaves this machine only encrypted to a key that exists on the owner's computer, so the public log is safe.
import crypto from 'node:crypto';

const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret, AUTH_CODE: code, REDIRECT_URI: redirect, PUBLIC_KEY_B64: keyB64 } = process.env;
if (!id || !secret) throw new Error('The two YouTube secrets are missing on the server');
if (!code || !redirect || !keyB64) throw new Error('code, redirect and key are required');

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: id, client_secret: secret, code, redirect_uri: redirect, grant_type: 'authorization_code' }),
});
const data = await res.json();
if (!res.ok || !data.refresh_token) {
  console.error(`Google refused the code: ${data.error || res.status} ${data.error_description || ''}`);
  process.exit(1);
}
const sealed = crypto.publicEncrypt(
  { key: Buffer.from(keyB64, 'base64').toString('utf8'), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
  Buffer.from(data.refresh_token),
);
console.log(`SEALED_TOKEN:${sealed.toString('base64')}`);
console.log(`Scopes granted: ${data.scope}`);
