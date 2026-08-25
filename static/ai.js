/* ============================================================
   Notebox XP — Shared AI helper
   Wraps Gemini: json() for structured output, text() for prose.
   Handles free-tier model picker + 429 fallback + backoff.
   ============================================================ */
(function () {
  "use strict";
  const store = window.NB && window.NB.store;
  if (!store) { window.NB = window.NB || {}; window.NB.ai = { json: () => Promise.reject(new Error("store missing")), text: () => Promise.reject(new Error("store missing")) }; return; }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function repairJSON(text) {
    let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = t.indexOf("[");
    const objStart = t.indexOf("{");
    const s = start === -1 ? objStart : (objStart === -1 ? start : Math.min(start, objStart));
    if (s === -1) return null;
    t = t.slice(s);
    if (t.lastIndexOf("]") === -1 && t.lastIndexOf("}") === -1) t = t + (t.trim().endsWith("[") ? "]" : "}");
    let open = 0, cut = -1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "[" || t[i] === "{") open++;
      else if (t[i] === "]" || t[i] === "}") { open--; if (open === 0 && cut === -1) cut = i; }
    }
    if (cut !== -1) t = t.slice(0, cut + 1).replace(/,\s*$/, "");
    else if (open > 0) t = t.replace(/,\s*$/, "") + (t.indexOf("[") !== -1 ? "]".repeat(open) : "}".repeat(open));
    try { return JSON.parse(t); } catch (_) { return null; }
  }

  function endpoint(model, key) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` + encodeURIComponent(key);
  }

  let curModel = "gemini-3.5-flash-lite";

  async function call(prompt, opts) {
    const json = !!(opts && opts.json);
    const what = opts && opts.what;
    const key = store.getSettings().geminiKey;
    if (!key) throw new Error("No API key configured. Open Flashcards → API key to add one.");
    const models = [store.getSettings().model || "gemini-3.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
    let lastErr = null, died = false;
    for (let mi = 0; mi < models.length && !died; mi++) {
      curModel = models[mi];
      const attempts = [0, 2000, 5000];
      for (let a = 0; a < attempts.length; a++) {
        if (a > 0) await sleep(attempts[a]);
        try {
          const res = await fetch(endpoint(curModel, key), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 16384,
                responseMimeType: json ? "application/json" : "text/plain",
              },
            }),
          });
          const body = await res.text().catch(() => "");
          let apiMsg = "";
          try { const j = JSON.parse(body); apiMsg = (j.error && j.error.message) || ""; } catch (_) { apiMsg = body.slice(0, 300); }

          if (res.ok) {
            const data = JSON.parse(body);
            const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
              data.candidates[0].content.parts.map(p => p.text || "").join("")) || "";
            if (json) {
              let parsed = null;
              try { parsed = JSON.parse(text); } catch (_) { parsed = repairJSON(text); }
              if (parsed != null) return parsed;
              lastErr = new Error("AI returned unparsable JSON" + (what ? " for " + what : "") + ".");
              throw lastErr;
            }
            return text.trim();
          }
          if (res.status === 429) {
            const lower = (apiMsg + "").toLowerCase();
            if (lower.includes("quota") || lower.includes("exhausted") || lower.includes("per day") || lower.includes("request limits")) {
              died = true;
              lastErr = new Error("Gemini says (429): " + (apiMsg || "quota exhausted") + " — " + curModel);
              break;
            }
            lastErr = new Error("Rate limiter (429) on " + curModel + ": " + (apiMsg || "throttled, retrying…"));
            continue;
          }
          if (res.status >= 500) { lastErr = new Error("Server error " + res.status + " — retrying…"); continue; }
          throw new Error("API error " + res.status + ": " + (apiMsg || ""));
        } catch (e) {
          if (e && e.message && e.message.indexOf("unparsable") !== -1) { lastErr = e; break; }
          lastErr = e;
        }
      }
    }
    throw lastErr || new Error("Gemini request failed.");
  }

  window.NB = window.NB || {};
  window.NB.ai = {
    json: (prompt, what) => call(prompt, { json: true, what }),
    text: (prompt) => call(prompt, { json: false }),
    model: () => curModel,
    // Lazily generate (and persist) a compact summary for a source.
    // Used by Chat context modes, the Source Library and Audio Overview.
    ensureSummary: async (srcId) => {
      const s = store.getSource(srcId);
      if (!s) return "";
      if (s.summary) return s.summary;
      const body = (s.text || "").slice(0, 30000);
      if (!body.trim()) return "";
      const sum = await call(
        `Summarize the following study material in 6-10 plain sentences. Capture the topic, the key claims/facts, and any names, dates or formulas that matter. No markdown, no bullet points — prose only.\n\nTITLE: ${s.title}\n\nTEXT:\n"""${body}"""`,
        { json: false }
      );
      store.updateSource(srcId, { summary: String(sum || "").trim() });
      return String(sum || "").trim();
    },
  };
})();
