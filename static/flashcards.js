/* ============================================================
   Notebox XP â€” Flashcards
   Sources â†’ exhaustive AI-generated cards â†’ SM-2 spaced repetition.
   Uses the shell bridge (NBApp) for windows/icons.
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  const store = window.NB.store;

  if (!shell || !store) { window.NBFlashcards = { open: () => {} }; return; }

  let GEMINI_MODEL = "gemini-3.5-flash-lite";
  const GEMINI = {
    model: () => GEMINI_MODEL,
    endpoint: () =>
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI.model()}:generateContent?key=` + encodeURIComponent(store.getSettings().geminiKey),
  };

  /* ---------- tiny helpers ---------- */
  const h = (id) => document.getElementById(id);
  const $q = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => shell.esc(s == null ? "" : s);

  // ensure pdf.js worker points at our local copy (falls back to fake worker on file://)
  try {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "static/vendor/pdf.worker.min.js";
    }
  } catch (_) {}

  /* ---------- AI ---------- */
  function requireKey() {
    if (!store.getSettings().geminiKey) {
      settingsDialog("You need a Gemini API key (free) to generate cards.");
      return false;
    }
    return true;
  }

  function keyObtainedFromDialog() {
    return !!store.getSettings().geminiKey;
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // best-effort repair for a JSON array that Gemini truncated mid-stream
  function repairJSON(text) {
    let t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    // find first '[' and last ']' â€” if closing is missing/mismatched, close it
    const start = t.indexOf("[");
    const end = t.lastIndexOf("]");
    if (start === -1) return null;
    t = t.slice(start);
    if (t.lastIndexOf("]") === -1) t = t + "]";
    // strip a trailing comma before the final bracket
    let open = 0, cut = -1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === "[") open++;
      else if (t[i] === "]") { open--; if (open === 0 && cut === -1) cut = i; }
    }
    if (cut !== -1) {
      t = t.slice(0, cut + 1).replace(/,\s*$/, "");
    } else if (open > 0) {
      t = t.replace(/,\s*$/, "") + "]" .repeat(open);
    }
    try { return JSON.parse(t); } catch (_) { return null; }
  }

  async function geminiJSON(prompt, what) {
    const key = store.getSettings().geminiKey;
    if (!key) throw new Error("No API key configured.");
    // 429 = throttled: back off generously. 500s: short backoff. Fallback to a
    // lighter model if the configured one keeps getting throttled.
    const models = [store.getSettings().model || "gemini-3.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
    let lastErr = null;
    for (let mi = 0; mi < models.length; mi++) {
      GEMINI_MODEL = models[mi];
      const attempts = mi === 0 ? [0, 2500, 6000, 12000] : [0, 5000, 10000]; // backoff ms
      for (let a = 0; a < attempts.length; a++) {
        if (a > 0) await sleep(attempts[a]);
        try {
          const res = await fetch(GEMINI.endpoint(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 16384,
                responseMimeType: "application/json",
              },
            }),
          });
          if (res.status === 429) {
            lastErr = new Error("Rate limit (429) â€” throttled by " + GEMINI_MODEL + ". Retryingâ€¦");
            continue;
          }
          if (res.status >= 500) {
            lastErr = new Error("Server error " + res.status + " â€” retryingâ€¦");
            continue;
          }
          if (!res.ok) {
            const txt = await res.text().catch(() => "");
            let msg = "API error " + res.status;
            try { const j = JSON.parse(txt); msg = j.error && j.error.message || msg; } catch (_) {}
            throw new Error(msg);
          }
          const data = await res.json();
          const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
            data.candidates[0].content.parts.map(p => p.text || "").join("")) || "";
          const parsed = (() => {
            try { return JSON.parse(text); } catch (_) {
              const rep = repairJSON(text);
              return rep;
            }
          })();
          if (parsed !== null && parsed !== undefined) return parsed;
          lastErr = new Error("AI returned unparsable JSON" + (what ? " for " + what : "") + ".");
        } catch (e) {
          lastErr = e;
        }
      }
    }
    throw lastErr || new Error("Gemini request failed.");
  }

  function chunkText(text, size) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    return chunks.length ? chunks : [""];
  }

  const CARD_PROMPT = (chunk, budget) =>
    `You are an expert study-material generator. Read the source text below and create flashcards that would let a student master this section of the subject.

Rules:
- Cover the important facts and ideas in this section AS EXHAUSTIVELY AS IS REASONABLE, up to ${budget} flashcards. Aim for about one card per 350 characters of content â€” not fewer, not drastically more.
- Include: terms and definitions, key concepts, facts, formulas, processes (step by step), sequences, events and dates, causes and effects, comparisons, named entities.
- Each card: front = crisp question/term; back = the complete, precise answer.
- type âˆˆ ["term","definition","concept","fact","formula","process","sequence","comparison","cause-effect","event","task"].
- snippet = a short verbatim quote (max 180 chars) from the source backing this card. If none fits, use an empty string.
Return strict JSON: an array of objects [{front, back, type, snippet}]. No prose outside the JSON.

SOURCE TEXT:
"""${chunk}"""`;

  const GAP_PROMPT = (sourceText, existingFronts, budget) =>
    `The following flashcards already exist for a source (their "front" prompts):
${existingFronts.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Now re-read the FULL source text below. Identify the MOST IMPORTANT facts, terms, concepts, formulas, or processes that are NOT yet covered by any existing flashcard, and write up to ${budget} additional flashcards for them.

Return strict JSON: an array of objects [{front, back, type, snippet}].
If everything important is already covered, return [] and nothing else. Do not repeat the given cards.

FULL SOURCE TEXT:
"""${sourceText}"""`;

  // parallel pool: run tasks with limited concurrency
  async function mapPool(items, limit, fn, onProgress) {
    const results = new Array(items.length);
    let cursor = 0;
    const workers = [];
    for (let w = 0; w < limit; w++) {
      workers.push((async () => {
        while (true) {
          const i = cursor++;
          if (i >= items.length) break;
          if (onProgress) onProgress(i);
          results[i] = await fn(items[i], i);
        }
      })());
    }
    await Promise.all(workers);
    return results;
  }

  async function generateCardsForSource(source, onProgress) {
    const chunks = chunkText(source.text, 7000);
    const budgetPer = Math.max(10, Math.round(source.text.length / 350 / chunks.length) + 6);
    let cards = [];

    const perChunk = await mapPool(chunks, 2, async (chunk) => {
      const cs = await geminiJSON(CARD_PROMPT(chunk, budgetPer), "cards");
      return Array.isArray(cs) ? cs : [];
    }, (i) => onProgress && onProgress("chunk", i + 1, chunks.length));

    for (const cs of perChunk) cards = cards.concat(cs);

    // one merged gap pass (bounded)
    if (cards.length > 0) {
      const existing = [...new Set(cards.map(c => c.front.trim().toLowerCase()))];
      onProgress && onProgress("gap");
      const added = await geminiJSON(GAP_PROMPT(source.text.slice(0, 80000), existing, budgetPer), "gaps");
      if (Array.isArray(added) && added.length) cards = cards.concat(added);
    }

    // dedupe + normalize
    const seen = new Set();
    const out = [];
    for (const c of Array.isArray(cards) ? cards : []) {
      if (!c || !c.front || !c.back) continue;
      const key = c.front.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        front: String(c.front).trim(),
        back: String(c.back).trim(),
        type: c.type || "concept",
        snippet: String(c.snippet || "").trim().slice(0, 220),
      });
    }
    return out;
  }

  /* ---------- file ingestion ---------- */
  async function readFileText(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") {
      if (!window.pdfjsLib) throw new Error("PDF engine not loaded.");
      const buf = await file.arrayBuffer();
      const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let all = "";
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        all += (tc.items.map(it => it.str).join(" ") + "\n");
      }
      return { text: all.trim(), kind: "pdf" };
    }
    if (ext === "docx") {
      if (!window.mammoth) throw new Error("Word engine not loaded.");
      const buf = await file.arrayBuffer();
      const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
      return { text: (r.value || "").trim(), kind: "docx" };
    }
    // txt, md, and anything else read as text
    const text = await file.text();
    return { text: text.trim(), kind: ext === "md" ? "md" : "text" };
  }

  /* ---------- state ---------- */
  let win = null;          // openWindow state
  let view = "decks";      // decks | deck | study
  let curDeck = null;      // deck id
  let studyQueue = [];     // card ids for current session
  let studyIdx = 0;
  let studyFlipped = false;
  let newDeckName = "";
  let newDeckSources = []; // source ids for the deck being built
  let busyText = "";       // progress text during generation

  /* ---------- window ---------- */
  function open() {
    if (win && document.body.contains(win.el)) {
      win.el.classList.add("focus");
      return;
    }
    win = shell.win({
      title: "Flashcards",
      width: 820,
      height: 540,
      app: "flashcards",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'>${CARD_ICON}</svg>`),
      menubar: shell.menu("File", "View", "Help"),
      statusbar: '<div id="fc-status">Flashcards</div>',
      body: `<div id="fc-root" class="fc-root"></div>`,
      onOpen: (el, state) => { win = state; render(); },
    });
  }

  const CARD_ICON =
    `<path fill='%23fff3c4' stroke='%23b58a2a' stroke-width='1.4' d='M6 5h22a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'/>` +
    `<path stroke='%235678' stroke-width='1.6' fill='none' d='M10 11h14M10 15h14M10 19h9'/>` +
    `<rect x='13' y='22' width='8' height='8' rx='1.5' fill='%232a6fd6' stroke='%231a4a9a'/>`;

  /* ---------- rendering ---------- */
  function render() {
    if (!win || !document.body.contains(win.el)) return;
    const root = h("fc-root");
    if (!root) return;
    const status = h("fc-status");
    if (view === "study") {
      renderStudy(root);
      if (status) status.textContent = `Studying â€” ${studyIdx + 1} of ${studyQueue.length}`;
    } else if (view === "new") {
      renderNew(root);
      if (status) status.textContent = busyText || "New deck";
    } else if (curDeck) {
      renderDeck(root);
      if (status) status.textContent = deckLabel();
    } else {
      renderDecks(root);
      if (status) status.textContent = "Flashcards";
    }
  }

  function setStatus(s) { busyText = s; const st = h("fc-status"); if (st) st.textContent = s; }

  function deckLabel() {
    const d = store.getDeck(curDeck);
    return d ? d.name : "";
  }

  /* ---------- deck list ---------- */
  function renderDecks(root) {
    const decks = store.listDecks();
    root.innerHTML = `
      <div class="fc-toolbar">
        <button class="bv" id="fc-new">New deck</button>
        <button class="bv" id="fc-settings">API key</button>
        <span style="flex:1"></span><span style="color:#666;font-size:11px">${decks.length} deck${decks.length === 1 ? "" : "s"}</span>
      </div>
      <div class="fc-body">
        <div class="fc-panel">
          ${decks.length ? decks.map(d => {
            const st = store.deckStats(d.id);
            return `<div class="fc-deck" data-id="${d.id}">
              <div class="fc-deck-name">${esc(d.name)}</div>
              <div class="fc-deck-meta">${st.total} cards &middot; ${st.due} due &middot; ${st.mastered} mastered</div>
            </div>`;
          }).join("") :
          `<div class="fc-empty">No decks yet.<br>Create a deck and drop in your sources &mdash; Notes LM will turn them into a full set of flashcards.</div>`}
        </div>
        <div class="fc-hint">Select a deck on the left to study or manage it.</div>
      </div>`;
    const btn = h("fc-new");
    if (btn) btn.addEventListener("mousedown", () => { if (requireKey()) startNewDeck(); else if (keyObtainedFromDialog()) startNewDeck(); });
    const set = h("fc-settings");
    if (set) set.addEventListener("mousedown", () => settingsDialog());
    root.querySelectorAll(".fc-deck").forEach(el => el.addEventListener("dblclick", () => {
      curDeck = el.dataset.id;
      view = "deck";
      render();
    }));
    root.querySelectorAll(".fc-deck").forEach(el => el.addEventListener("click", () => {
      root.querySelectorAll(".fc-deck").forEach(x => x.classList.remove("sel"));
      el.classList.add("sel");
    }));
  }

  /* ---------- single deck ---------- */
  function renderDeck(root) {
    const d = store.getDeck(curDeck);
    if (!d) { view = "decks"; curDeck = null; return render(); }
    const st = store.deckStats(d.id);
    const cards = store.listCards(d.id);
    root.innerHTML = `
      <div class="fc-toolbar">
        <button class="bv" id="fc-back">Back</button>
        <span style="font-weight:bold;padding:0 6px">${esc(d.name)}</span>
        <span style="flex:1"></span>
        <button class="bv" id="fc-study">Study due (${st.due})</button>
        <button class="bv" id="fc-newcards">Add source + more cards</button>
        <button class="bv" id="fc-delete">Delete deck</button>
      </div>
      <div class="fc-body fc-col">
        <div class="fc-stats">
          <div class="fc-stat"><b>${st.total}</b>total</div>
          <div class="fc-stat"><b>${st.due}</b>due now</div>
          <div class="fc-stat"><b>${st.new}</b>new</div>
          <div class="fc-stat"><b>${st.learning}</b>learning</div>
          <div class="fc-stat"><b>${st.mastered}</b>mastered</div>
        </div>
        <div class="fc-cardlist">
          ${cards.length ? cards.map((c, i) => `
            <div class="fc-crow" data-id="${c.id}">
              <span class="fc-ctype ${esc(c.type)}">${esc(c.type)}</span>
              <span class="fc-cfront">${esc(c.front)}</span>
              <span class="fc-cdue">${c.reps === 0 ? "new" : c.ivl + "d"}</span>
            </div>`).join("") :
          `<div class="fc-empty">This deck has no cards yet.<br>Add a source and generate cards.</div>`}
        </div>
      </div>`;

    h("fc-back").addEventListener("mousedown", () => { view = "decks"; curDeck = null; render(); });
    h("fc-delete").addEventListener("mousedown", () => {
      shell.dialog("Delete deck", `<span class="x-ic">&#128465;</span><span>Delete "<b>${esc(d.name)}</b>" and all its cards?</span>`, ["Delete", "Cancel"], (r) => {
        if (r === "Delete") { store.deleteDeck(d.id); view = "decks"; curDeck = null; render(); }
      });
    });
    h("fc-study").addEventListener("mousedown", () => startStudy());
    h("fc-newcards").addEventListener("mousedown", () => { if (requireKey()) startNewDeck(d.id); });
  }

  /* ---------- new deck / add sources ---------- */
  function startNewDeck(existingDeckId) {
    view = "new";
    newDeckName = existingDeckId ? (store.getDeck(existingDeckId) || {}).name || "" : "";
    newDeckSources = existingDeckId ? (store.getDeck(existingDeckId) || {}).sourceIds || [] : [];
    render();
  }

  function renderNew(root) {
    const sources = newDeckSources.map(id => store.getSource(id)).filter(Boolean);
    root.innerHTML = `
      <div class="fc-toolbar">
        <button class="bv" id="fc-back2">Back</button>
        <span style="font-weight:bold;padding:0 6px">${curDeck ? "Add to deck" : "New deck"}</span>
      </div>
      <div class="fc-body fc-col" style="padding:12px">
        <label style="font-size:11px">Deck name</label>
        <input id="fc-name" class="fc-input" value="${esc(newDeckName)}" placeholder="e.g. Biology â€” Chapter 3">
        <div style="height:8px"></div>
        <label style="font-size:11px">Sources <span style="color:#888">(.txt, .md, .pdf, .docx â€” or paste text)</span></label>
        <div class="fc-srcbar">
          <button class="bv" id="fc-paste">Paste text</button>
          <button class="bv" id="fc-upload">Upload file</button>
          <input type="file" id="fc-file" style="display:none" multiple accept=".txt,.md,.pdf,.docx">
        </div>
        <div id="fc-srclist" class="fc-srclist">
          ${sources.length ? sources.map(s => `
            <div class="fc-srcrow" data-id="${s.id}">
              <span class="fc-ctype ${esc(s.kind)}">${esc(s.kind)}</span>
              <span class="fc-cfront">${esc(s.title)}</span>
              <span class="fc-cdue">${(s.text.match(/\S+/g) || []).length} words</span>
              <button class="fc-x" data-id="${s.id}" title="Remove">&times;</button>
            </div>`).join("") :
          `<div style="color:#999;font-size:12px;padding:10px 4px">No sources yet.</div>`}
        </div>
        <div style="flex:1"></div>
        <div id="fc-progress" class="fc-progress" style="display:none;margin:0"><i id="fc-progress-bar" style="width:0%"></i></div>
        <div id="fc-progress-label" style="font-size:11px;color:#555;padding:2px 0"></div>
        <div class="fc-footer">
          <span id="fc-err" style="color:#b33;font-size:11px"></span>
          <span style="flex:1"></span>
          <button class="bv" id="fc-gen">${curDeck ? "Generate more cards" : "Generate flashcards"}</button>
        </div>
      </div>`;

    h("fc-back2").addEventListener("mousedown", () => { view = curDeck ? "deck" : "decks"; render(); });
    const name = h("fc-name");
    name.addEventListener("input", () => newDeckName = name.value);

    h("fc-paste").addEventListener("mousedown", () => pasteDialog());
    h("fc-upload").addEventListener("mousedown", () => h("fc-file").click());
    const file = h("fc-file");
    file.addEventListener("change", async () => {
      if (!file.files.length) return;
      const err = h("fc-err");
      for (const f of file.files) {
        try {
          const r = await readFileText(f);
          if (!r.text) { err.textContent = `Warning: "${f.name}" produced no extractable text (scanned PDF?).`; continue; }
          const s = store.addSource({ title: f.name.replace(/\.[^.]+$/, ""), text: r.text, kind: r.kind });
          newDeckSources.push(s.id);
        } catch (e) {
          err.textContent = `Failed to read "${f.name}": ${e.message}`;
        }
      }
      file.value = "";
      renderNew(root);
    });
    root.querySelectorAll(".fc-x").forEach(b => b.addEventListener("mousedown", () => {
      newDeckSources = newDeckSources.filter(id => id !== b.dataset.id);
      renderNew(root);
    }));

    h("fc-gen").addEventListener("mousedown", () => generateFlow(collectSources()));
  }

  function collectSources() {
    return newDeckSources.map(id => store.getSource(id)).filter(Boolean);
  }

  function pasteDialog() {
    const key = "fc-paste-area";
    shell.dialog("Paste text",
      `<span class="x-ic">&#128238;</span><span>Paste study material below (any length).</span><br><br>
       <textarea id="${key}" rows="10" style="width:100%;box-sizing:border-box;font:12px Consolas,monospace;resize:vertical"></textarea>`,
      ["Add", "Cancel"], (r) => {
        if (r !== "Add") return;
        const ta = h(key);
        const txt = ta ? ta.value.trim() : "";
        if (!txt) return;
        const s = store.addSource({ title: "Pasted text", text: txt, kind: "text" });
        newDeckSources.push(s.id);
        renderNew(h("fc-root"));
      });
  }

function settingsDialog(notice) {
    const key = "fc-key";
    const cur = store.getSettings().geminiKey;
    const curModel = store.getSettings().model || "gemini-3.5-flash-lite";
    const input = `<input id="${key}" type="password" class="fc-input" style="width:100%" value="${esc(cur)}" placeholder="AIza..." autocomplete="off">`;
    const SEL = (id, val) => ` style="outline:2px solid #3a8dff" selected`;
    const modelSel = `<select id="fc-model" class="fc-input" style="width:100%">
      <option value="gemini-3.5-flash-lite"${curModel === "gemini-3.5-flash-lite" ? " selected" : ""}>gemini-3.5-flash-lite (fastest, cheapest — recommended)</option>
      <option value="gemini-3.7-flash"${curModel === "gemini-3.7-flash" ? " selected" : ""}>gemini-3.7-flash (smartest, higher rate limits needed)</option>
      <option value="gemini-3.6-flash"${curModel === "gemini-3.6-flash" ? " selected" : ""}>gemini-3.6-flash</option>
      <option value="gemini-3.1-flash-lite"${curModel === "gemini-3.1-flash-lite" ? " selected" : ""}>gemini-3.1-flash-lite</option>
    </select>`;
    shell.dialog("API key — Settings",
      `<span class="x-ic">&#9881;</span><span>Notebox XP generates cards with Google's Gemini (free tier).</span><br><span style="color:#666;font-size:11px">Get a key at aistudio.google.com &rarr; Get API key.</span><br><br>${input}
       <label style="font-size:11px;display:block;margin:8px 0 3px">Model</label>${modelSel}
       ${notice ? `<div style="color:#b33;font-size:11px;margin-top:6px">${esc(notice)}</div>` : ""}`,
      ["Save", "Cancel"], (r) => {
        const v = h(key);
        const m = h("fc-model");
        if (r === "Save" && v) store.setKey(v.value);
        if (r === "Save" && m) store.setModel(m.value);
      });
  }

  /* ---------- generation flow ---------- */
  function setProgress(pct, label) {
    const bar = h("fc-progress-bar");
    const wrap = h("fc-progress");
    const lbl = h("fc-progress-label");
    if (bar) bar.style.width = Math.max(2, Math.min(100, pct)) + "%";
    if (wrap) wrap.style.display = "block";
    if (lbl) lbl.textContent = label || "";
    setStatus(label || "Generatingâ€¦");
  }

  async function generateFlow(sources) {
    const err = h("fc-err");
    if (!sources.length) { if (err) err.textContent = "Add at least one source first."; return; }
    if (!newDeckName.trim()) newDeckName = sources[0].title || "Flashcards";
    const genBtn = h("fc-gen");
    if (genBtn) genBtn.disabled = true;
    if (err) err.textContent = "";

    // optional: validate key live
    if (!requireKey()) { if (genBtn) genBtn.disabled = false; return; }

    let deckId = curDeck;
    if (!deckId) {
      const d = store.addDeck({ name: newDeckName.trim(), sourceIds: newDeckSources, generatedFrom: sources.map(s => s.title).join(", ") });
      deckId = d.id;
    }
    // remember any newly added sources on the deck
    const d = store.getDeck(deckId);
    d.sourceIds = unique(d.sourceIds.concat(newDeckSources));
    store._save();

    const started = Date.now();
    const t0 = () => Math.round((Date.now() - started) / 1000) + "s";
    let failures = [];

    try {
      const allCards = [];
      for (let si = 0; si < sources.length; si++) {
        const s = sources[si];
        let cards = [];
        try {
          cards = await generateCardsForSource(s, (stage, a, b) => {
            if (stage === "chunk") {
              const base = (si / sources.length) * 100;
              const frac = a / b;
              setProgress(base + (100 / sources.length) * frac,
                `Source ${si + 1}/${sources.length}: "${s.title}" â€” chunk ${a}/${b} (${allCards.length} cards so far) â€¢ ${t0()}`);
            } else if (stage === "gap") {
              setProgress(((si + 1) / sources.length) * 100,
                `Source ${si + 1}/${sources.length}: filling gapsâ€¦ â€¢ ${t0()}`);
            }
          });
        } catch (e) {
          failures.push(`"${s.title}": ${e.message}`);
          setProgress(((si + 1) / sources.length) * 100, `Error on "${s.title}" â€” skipping`);
          continue;
        }
        cards.forEach(c => (c.sourceId = s.id));
        allCards.push(...cards);
        setProgress(((si + 1) / sources.length) * 100,
          `Source ${si + 1}/${sources.length}: ${cards.length} cards â€¢ ${t0()}`);
      }

      if (!allCards.length) {
        setStatus("No cards were generated.");
        shell.dialog("Generate",
          `<span class="x-ic">&#9888;</span><span>No flashcards could be generated.</span>${failures.length ? `<br><div style="color:#333;font-size:11px;margin-top:6px">${failures.join("<br>")}</div>` : ""}`);
        if (genBtn) genBtn.disabled = false;
        render();
        return;
      }

      store.addCards(deckId, allCards);
      curDeck = deckId;
      view = "deck";
      setStatus("Done â€” " + allCards.length + " flashcards added to â€œ" + (store.getDeck(deckId).name) + "â€ in " + t0() + ".");
      render();
    } catch (e) {
      setStatus("Generate failed.");
      shell.dialog("Generate", `<span class="x-ic">&#9888;</span><span>Generation failed: ${esc(e.message)}</span>`);
      if (genBtn) genBtn.disabled = false;
      render();
    }
  }

  const unique = (a) => [...new Set(a)];

  /* ---------- study (SM-2) ---------- */
  function startStudy() {
    if (!curDeck) return;
    const due = store.dueCards(curDeck, 100);
    const all = store.listCards(curDeck);
    const fresh = all.filter(c => c.reps === 0 && !due.some(x => x.id === c.id)).slice(0, 20 - due.length);
    studyQueue = due.concat(fresh).map(c => c.id);
    if (!studyQueue.length) {
      shell.dialog("Study", `<span class="x-ic">&#127881;</span><span>No cards are due right now. Come back later, or add more sources to build the deck.</span>`);
      return;
    }
    studyIdx = 0;
    studyFlipped = false;
    view = "study";
    render();
  }

  function renderStudy(root) {
    if (studyIdx >= studyQueue.length) {
      const res = store.deckStats(curDeck);
      root.innerHTML = `
        <div class="fc-body fc-center">
          <div class="fc-done">&#127881;</div>
          <div style="font-weight:bold">Session complete!</div>
          <div style="color:#666;font-size:12px">${studyQueue.length} cards reviewed. Due now: ${res.due} &middot; Mastered: ${res.mastered} of ${res.total}</div>
          <div style="margin-top:12px"><button class="bv" id="fc-end">Return to deck</button></div>
        </div>`;
      h("fc-end").addEventListener("mousedown", () => { view = "deck"; render(); });
      return;
    }
    const c = store.getCard(studyQueue[studyIdx]);
    if (!c) { studyIdx++; return render(); }

    root.innerHTML = `
      <div class="fc-body fc-col">
        <div class="fc-progress"><i style="width:${((studyIdx) / studyQueue.length * 100).toFixed(1)}%"></i></div>
        <div class="fc-stage">
          <div class="fc-ctype tag">${esc(c.type)}</div>
          <div class="fc-question">${esc(c.front)}</div>
          <div class="fc-flipbtn" id="fc-flip">${studyFlipped ? "Show &mdash;" : "Click to show answer"} &#128260;</div>
          <div class="fc-answer${studyFlipped ? "" : " hidden"}">
            <div class="fc-ans-text">${esc(c.back)}</div>
            ${c.snippet ? `<div class="fc-snippet">&ldquo;${esc(c.snippet)}&rdquo;</div>` : ""}
          </div>
        </div>
        <div class="fc-grade${studyFlipped ? "" : " hidden"}">
          <button class="bv" data-grade="again" style="background:#f7d7d0">Again</button>
          <button class="bv" data-grade="hard" style="background:#fdf0c8">Hard</button>
          <button class="bv" data-grade="good">Good</button>
          <button class="bv" data-grade="easy" style="background:#d6f0d0">Easy</button>
        </div>
      </div>`;

    h("fc-flip").addEventListener("mousedown", () => {
      studyFlipped = true;
      render();
    });
    root.querySelectorAll("[data-grade]").forEach(b => b.addEventListener("mousedown", () => {
      const g = b.dataset.grade;
      store.gradeCard(c.id, g);
      studyIdx++;
      studyFlipped = false;
      render();
    }));
    root.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!studyFlipped) h("fc-flip") && h("fc-flip").click(); }
      else if (studyFlipped && ["1", "2", "3", "4"].includes(e.key)) {
        const g = ["again", "hard", "good", "easy"][+e.key - 1];
        root.querySelector(`[data-grade="${g}"]`) && root.querySelector(`[data-grade="${g}"]`).click();
      }
    });
  }

  /* ---------- register ---------- */
  const app = { title: "Flashcards", iconClass: "fc", open };
  window.NBFlashcards = app;
  if (window.NBApp) window.NBApp.register("flashcards", app);
})();
