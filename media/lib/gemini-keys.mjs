// Gemini keys for the server: GEMINI_API_KEYS (comma separated) first, then GEMINI_API_KEY.
// Free limits belong to a project, so each key here should come from its own project.
// A key is left for the rest of the run, for one model, once that model's day is used up on it. Keys are never logged.
export const geminiKeys = [...new Set(
  [...String(process.env.GEMINI_API_KEYS || '').split(/[,\s]+/), String(process.env.GEMINI_API_KEY || '').trim()].filter(Boolean),
)];

const spent = new Set();

/** The key to use for this model now; null when every key has used up its day on it. */
export const keyFor = (model) => geminiKeys.find((k) => !spent.has(`${model}|${k}`)) || null;

/** Leave this key for this model. Says which key number it was, so the log never shows the key itself. */
export function markSpent(model, key) {
  spent.add(`${model}|${key}`);
  return geminiKeys.indexOf(key) + 1;
}

/** After the daily reset every key is good again. */
export const clearSpent = () => spent.clear();

/** True when Google refused the key itself, so the next key should be tried. */
export const keyRefused = (status, error) => [400, 401, 403].includes(status) && /API.?key|PERMISSION_DENIED/i.test(JSON.stringify(error || ''));
