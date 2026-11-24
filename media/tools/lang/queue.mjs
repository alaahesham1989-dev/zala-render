// Retry and dead-letter rules for a per-language, per-kind queue. Pure functions over plain items; the callers
// load and save the list through state-save.mjs, so concurrent workflows never lose an entry.
// An item: { id, status: 'waiting'|'done'|'dead', attempts, dueAt, createdAt, lastError?, ...fields }
export const BACKOFF_MINUTES = [5, 30, 180];   // after failure 1, 2, 3; a fourth failure is dead

export const makeItem = (fields, nowMs) => ({ status: 'waiting', attempts: 0, dueAt: nowMs, createdAt: nowMs, ...fields });

// Due items, oldest due first. A dead or not-yet-due item never blocks the ones behind it.
export const pickDue = (items, nowMs) =>
  items.filter((x) => x.status === 'waiting' && x.dueAt <= nowMs).sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);

export function markFailed(item, error, nowMs) {
  const attempts = item.attempts + 1;
  const lastError = String(error ?? '').slice(0, 300);
  if (attempts > BACKOFF_MINUTES.length) return { ...item, attempts, status: 'dead', lastError, failedAt: nowMs };
  return { ...item, attempts, status: 'waiting', dueAt: nowMs + BACKOFF_MINUTES[attempts - 1] * 60000, lastError };
}

export const markDone = (item, nowMs) => ({ ...item, status: 'done', doneAt: nowMs });
export const deadLetters = (items) => items.filter((x) => x.status === 'dead');
