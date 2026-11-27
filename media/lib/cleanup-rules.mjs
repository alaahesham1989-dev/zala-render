// What the storage cleanup may remove. Pure: list in, plan out (tested by cleanup-rules.test.mjs).
// Owner's rules (2026-11-27): remove useless things as we go. NEVER remove media made with Flow / Veo /
// Nano Banana until it has been used in every way, nor the picture library, nor recorded voice.
// Only the four named kinds below are ever removed; anything not matched stays.

const DAY = 864e5;
const PROTECTED = ['vault/', 'library/', 'atlas/', 'atlas-work/', 'world-atlas/', 'videos/', 'handover/', 'blog/', 'posts/', 'social/',
  'episodes/', 'prep/', 'render-input/', 'render-state', 'render-cache/voice/', 'render-cache/meta/', 'render-cache/music/'];
const AI_MEDIA = /(^|[/_.-])(flow|veo|nano|banana|nanobanana|omni)([/_.-]|\d|$)/i;
const AUDIO = /\.(wav|mp3|m4a|flac|pcm|ogg|aac|opus)$/i;
const LONG_ID = /^ZV-([LTD]|ARL|ENL|ESL|VAR)\d+$/;      // long videos; standalone shorts (ZV-S...) never match

export function isProtected(key) {
  return PROTECTED.some((p) => key.startsWith(p)) || AI_MEDIA.test(key) || AUDIO.test(key);
}

/**
 * objects: [{ key, size, modified (ISO), etag }]; outbox: content/outbox.json; queue: content/meta-queue.json
 * returns [{ key, size, reason }]
 */
export function plan(objects, { outbox = [], queue = [], now = Date.now() } = {}) {
  const by = new Map(objects.map((o) => [o.key, o]));
  const age = (o) => now - Date.parse(o.modified);
  const finished = (id) => by.has(`renders/${id}/publish/${id}.mp4`);
  const aiTags = new Set(objects.filter((o) => AI_MEDIA.test(o.key)).map((o) => `${o.etag}:${o.size}`));
  const scheduled = new Set(outbox.filter((i) => i.scheduled).map((i) => i.id));
  const waitingCuts = new Set(queue.filter((q) => !q.done && String(q.which || '').startsWith('R')).map((q) => q.episode));
  const out = [];
  for (const o of objects) {
    const { key } = o;
    if (isProtected(key) || aiTags.has(`${o.etag}:${o.size}`)) continue;
    const parts = key.split('/');
    const id = parts[0] === 'render-cache' ? parts[2] : parts[1];
    const name = parts[parts.length - 1];
    let reason = '';
    if (parts[0] === 'renders' && /\.part\.mp4$/.test(name)) {
      if (age(o) > DAY && finished(id)) reason = 'partial';
    } else if (parts[0] === 'render-cache' && parts[1] === 'work' && /\.(mp4|png|jpg|jpeg|webp|filter|txt)$/i.test(name)) {
      if (age(o) > 3 * DAY && finished(id)) reason = 'old-work';
    } else if (/^(renders\/[^/]+\/publish|outbox\/[^/]+)\/[^/]+-R[123](-R3)?\.mp4$/.test(key)) {
      if (age(o) > DAY && LONG_ID.test(id) && !waitingCuts.has(id)) reason = 'cut-short';
    } else if (parts[0] === 'outbox' && /\.mp4$/.test(name)) {
      const twin = by.get(`renders/${id}/publish/${name}`);
      if (age(o) > DAY && scheduled.has(id) && twin && twin.size === o.size && twin.etag === o.etag) reason = 'second-copy';
    }
    if (reason) out.push({ key, size: o.size, reason });
  }
  return out;
}
