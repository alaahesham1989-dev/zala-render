// Small Gemini text helper for the daily posts and comment replies: free keys, busy models skipped, JSON answers.
const KEYS = [...new Set([...(process.env.GEMINI_API_KEYS || '').split(','), process.env.GEMINI_API_KEY || ''].map((k) => k.trim()).filter(Boolean))];
const MODELS = (process.env.GEMINI_TEXT_MODELS || 'gemini-3.5-flash,gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map((m) => m.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** prompt: text, or Gemini parts (text and inline_data pictures). One JSON answer, or null when every model and key is busy or refused. */
export async function askJson(prompt, { temperature = 0.7, rounds = 3 } = {}) {
  for (let round = 1; round <= rounds; round++) {
    for (const model of MODELS) {
      for (const key of KEYS) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ contents: [{ parts: Array.isArray(prompt) ? prompt : [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature } }),
            signal: AbortSignal.timeout(120000),
          });
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
          if (res.ok && text) return JSON.parse(text);
          console.log(`  ${model}: ${res.status} ${data.error?.status || ''}`);
          if (res.status === 503) break;   // the model is busy for everyone: try the next model
        } catch (e) { console.log(`  ${model}: ${e.name}`); }
      }
    }
    await sleep(30000 * round);
  }
  return null;
}
