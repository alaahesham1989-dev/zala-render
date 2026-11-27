// The watchdog of the machine: reads a list of workflow runs and says what went wrong since the last look.
// Pure (no network): clock.mjs fetches the runs and sends the message. Each run is reported once per clock
// (the `told` set), and a failure only if it finished after `since`, so a new clock does not repeat old news.
const BAD = new Set(['failure', 'timed_out', 'startup_failure']);
export const STUCK_MS = 5.5 * 3600e3;   // in progress for longer than this (GitHub kills a job at 6 hours)
export const QUEUED_MS = 3 * 3600e3;    // waiting for a runner or its lane longer than this

// Hand-started tools and tests: whoever starts them sees the result, so they never raise the alarm.
export const QUIET = ['ZALA clock', 'ZALA lip-sync', 'ZALA Meta check', 'ZALA Telegram check', 'ZALA keys check', 'ZALA frames'];

export function findTrouble(runs, { now, since, told = new Set(), ignore = QUIET }) {
  const out = [];
  for (const r of runs) {
    if (told.has(r.databaseId) || ignore.some((n) => String(r.workflowName).startsWith(n))) continue;
    const age = now - Date.parse(r.createdAt);
    let why = null;
    if (r.status === 'completed') {
      if (BAD.has(r.conclusion) && Date.parse(r.updatedAt) > since) why = 'failed';
    } else if (r.status === 'in_progress' && age > STUCK_MS) why = 'stuck';
    else if (r.status !== 'in_progress' && age > QUEUED_MS) why = 'waiting';
    if (why) out.push({ id: r.databaseId, name: r.workflowName, why });
  }
  return out;
}

// Owner, 2026-11-27: no failure messages. A failed run is tried again once by itself and written in the clock's log;
// the owner hears only about what nothing but his own hand can fix.
// Only runs that publish nothing are retried, so nothing can ever be posted twice.
export const RETRY = ['ZALA Arabic prep', 'ZALA Arabic Short', 'ZALA prep', 'ZALA long', 'ZALA picture post — prep', 'ZALA insights'];
export const mayRetry = (name, attempt) => attempt === 1 && RETRY.some((n) => String(name).startsWith(n));

const NEEDS_HAND = [
  { kind: 'login', test: /invalid_grant|Token has been expired or revoked|Error validating access token|Session has expired/i, ask: 'دخول حساب انتهى (يوتيوب أو ميتا). محتاج تسجل الدخول من جديد.' },
  { kind: 'key', test: /API key not valid|API_KEY_INVALID|API key expired|reported as leaked/i, ask: 'مفتاح من مفاتيح المصنع وقف. محتاج مفتاح جديد منك.' },
  // not the ordinary "quota exceeded, check your billing" of a free limit: only a service that will not run without paying
  { kind: 'payment', test: /payment required|BILLING_DISABLED|billing account (is )?(disabled|closed)/i, ask: 'خدمة بتطلب دفع. ما دفعتش حاجة، ومحتاج قرارك.' },
];

/** What the owner has to do, read from a failed run's log; null when there is nothing for him. */
export const needsHand = (log) => NEEDS_HAND.find((n) => n.test.test(String(log))) || null;

export const handText = (need, name, repo, id) => `ZALA: ${need.ask}\n(${name})\nhttps://github.com/${repo}/actions/runs/${id}`;

export const troubleLine = (t) => `${t.name}: ${t.why} (run ${t.id})`;
