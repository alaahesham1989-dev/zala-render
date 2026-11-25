// The watchdog of the machine: reads a list of workflow runs and says what went wrong since the last look.
// Pure (no network): clock.mjs fetches the runs and sends the message. Each run is reported once per clock
// (the `told` set), and a failure only if it finished after `since`, so a new clock does not repeat old news.
const BAD = new Set(['failure', 'timed_out', 'startup_failure']);
export const STUCK_MS = 5.5 * 3600e3;   // in progress for longer than this (GitHub kills a job at 6 hours)
export const QUEUED_MS = 3 * 3600e3;    // waiting for a runner or its lane longer than this

// Hand-started tools and tests: whoever starts them sees the result, so they never raise the alarm.
export const QUIET = ['ZALA clock', 'ZALA lip-sync', 'ZALA Meta check', 'ZALA keys check', 'ZALA frames'];

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

const WHY = { failed: 'فشل', stuck: 'معلّق من أكتر من خمس ساعات ونص', waiting: 'مستني دوره من أكتر من تلات ساعات' };

export const troubleText = (list, repo) =>
  ['⚠️ حارس المصنع:', ...list.map((t) => `• ${t.name}: ${WHY[t.why]}\nhttps://github.com/${repo}/actions/runs/${t.id}`)].join('\n');

// Arabic machine trouble goes to the Arabic group; everything else to the owner's own chat, never the
// English review group.
export const byChat = (list, { admin, arabic }) => [
  [arabic || admin, list.filter((t) => /Arabic/i.test(t.name))],
  [admin, list.filter((t) => !/Arabic/i.test(t.name))],
].filter(([chat, items]) => chat && items.length);
