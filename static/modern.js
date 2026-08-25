/* ============================================================
   Notebox Modern — the studio shell.
   Same data spine (NB.store), same Gemini wrapper (NB.ai),
   same ingest engine (NBIngest) as Classic XP. UI only.
   ============================================================ */
(() => {
  "use strict";
  const S = window.NB && window.NB.store;
  const AI = window.NB && window.NB.ai;
  if (!S || !AI) {
    document.body.innerHTML = "<div style='color:#F1ECEC;font-family:monospace;padding:40px'>Core failed to load.</div>";
    return;
  }

  /* ---------- helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const stripHtml = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = (t) => (String(t || "").match(/\S+/g) || []).length;
  const fmt = (ts) => { try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (_) { return ""; } };
  const STOP = new Set(["the", "and", "what", "how", "why", "does", "did", "are", "was", "were", "for", "with", "this", "that", "from", "about", "explain", "tell", "can", "you", "your", "there", "their", "when", "which", "who", "whom", "into", "give", "list"]);

  /* ---------- state ---------- */
  let view = "chat";
  const st = {
    chat: { cur: null, ctx: [], modes: {}, deep: false },
    guide: { cur: null, ctx: [], tab: "read" },
    audio: { cur: null, picked: [], lines: [], playing: false, idx: -1 },
    cards: { deckId: null, queue: [], i: -1, flipped: false },
    notes: { cur: null },
    sources: { sel: null, q: "", nb: "" },
  };

  /* ============================================================
     boot
     ============================================================ */
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "static/vendor/pdf.worker.min.js";

  function tickClock() {
    const el = $("#md-clock");
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  setInterval(tickClock, 15000); tickClock();

  function keydot() { $("#md-keydot").className = "dot " + (S.getSettings().geminiKey ? "on" : "off"); }
  keydot();

  $$("#md-rail button[data-view]").forEach(b =>
    b.addEventListener("click", () => route(b.dataset.view)));
  $("#md-settings").addEventListener("click", settingsModal);
  $("#md-search-btn").addEventListener("click", openSearch);
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
    if (e.key === "Escape" && !$("#md-overlay").hidden) closeOverlay();
  });

  setTimeout(() => { const b = $("#md-boot"); if (b) b.classList.add("gone"); }, 350);

  function route(v) {
    view = v;
    $$("#md-rail button[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    renderList();
    renderPanel();
  }

  /* ============================================================
     generic modal
     ============================================================ */
  function openModal(html) { $("#md-overlay").hidden = false; $("#md-overlay").innerHTML = html; }
  function closeOverlay() { const o = $("#md-overlay"); o.hidden = true; o.innerHTML = ""; }
  $("#md-overlay").addEventListener("mousedown", (e) => { if (e.target.id === "md-overlay") closeOverlay(); });

  function formModal(title, kicker, bodyHtml, okLabel, onOk) {
    openModal(`<div class="modal">
      <h3>${esc(title)}</h3><div class="mh">${esc(kicker)}</div>
      <div class="mbody">${bodyHtml}</div>
      <div class="mfoot"><button class="btn" id="mm-cancel">Cancel</button>
      <button class="btn primary" id="mm-ok">${esc(okLabel)}</button></div></div>`);
    $("#mm-cancel").addEventListener("click", closeOverlay);
    $("#mm-ok").addEventListener("click", () => { if (onOk() !== false) closeOverlay(); });
    const first = $(".mbody input,.mbody textarea", $("#md-overlay"));
    if (first) first.focus();
  }
  function confirmModal(msg, onYes) {
    openModal(`<div class="modal"><h3>Are you sure?</h3><div class="mh">This cannot be undone</div>
      <div class="mbody"><p style="font-size:13px;line-height:1.6;color:var(--sub)">${msg}</p></div>
      <div class="mfoot"><button class="btn" id="mm-cancel">Cancel</button>
      <button class="btn danger" id="mm-ok">Delete</button></div></div>`);
    $("#mm-cancel").addEventListener("click", closeOverlay);
    $("#mm-ok").addEventListener("click", () => { closeOverlay(); onYes(); });
  }

  /* ---------- settings ---------- */
  function settingsModal() {
    const s = S.getSettings();
    formModal("Settings", "Gemini · free tier",
      `<label class="field"><label>API key &nbsp;<span style="color:var(--dim)">aistudio.google.com → Get API key</span></label>
       <input class="inp" id="st-key" value="${esc(s.geminiKey)}" placeholder="AIza…" spellcheck="false"></label>
       <label class="field"><label>Model</label>
       <select class="sel" id="st-model">
         <option value="">Auto — lite first, falls back when throttled</option>
         <option value="gemini-3.5-flash-lite"${s.model === "gemini-3.5-flash-lite" ? " selected" : ""}>gemini-3.5-flash-lite</option>
         <option value="gemini-3.1-flash-lite"${s.model === "gemini-3.1-flash-lite" ? " selected" : ""}>gemini-3.1-flash-lite</option>
         <option value="gemini-2.5-flash"${s.model === "gemini-2.5-flash" ? " selected" : ""}>gemini-2.5-flash</option>
         <option value="gemini-2.5-pro"${s.model === "gemini-2.5-pro" ? " selected" : ""}>gemini-2.5-pro</option>
       </select></label>
       <label class="field"><label>Study focus — shapes every AI answer</label>
       <textarea class="ta" id="st-instr" rows="4" placeholder="e.g. I'm revising for a med-school anatomy exam, focus on clinical relevance">${esc(s.instructions)}</textarea></label>`,
      "Save", () => {
        S.setKey($("#st-key").value);
        S.setModel($("#st-model").value);
        S.setInstructions($("#st-instr").value);
        keydot();
      });
  }

  /* ============================================================
     shared context helpers
     ============================================================ */
  function contextItems() {
    const srcs = S.listSources().map(s => ({ id: "s:" + s.id, srcId: s.id, title: s.title, text: s.text || "", summary: s.summary || "", kind: "source" }));
    const notes = S.listNotes().map(n => ({ id: "n:" + n.id, title: n.title, text: stripHtml(n.body), kind: "note" }));
    return srcs.concat(notes);
  }

  /* ============================================================
     CHAT
     ============================================================ */
  const MODES = ["full", "summary", "off"];
  const MODE_LABEL = { full: "Full text in context", summary: "Summary only (saves tokens)", off: "Excluded from context" };

  function chatContextRows(items, modes) {
    return items.map(it => {
      const on = st.chat.ctx.some(c => c.id === it.id);
      const mode = modes[it.id] || "full";
      const chip = it.kind === "source"
        ? `<button class="mode ${mode}" data-id="${esc(it.id)}" data-mode="${mode}" title="${MODE_LABEL[mode]}">${mode.toUpperCase()}</button>` : "";
      return `<div class="ctxrow"><input type="checkbox" data-id="${esc(it.id)}" ${on ? "checked" : ""}>
        <label data-id="${esc(it.id)}">${it.kind === "note" ? "✎" : "▦"} ${esc(it.title.slice(0, 30))}</label>${chip}</div>`;
    }).join("");
  }

  function renderChatList() {
    const items = contextItems();
    $("#md-list-head").innerHTML = `<h3>Chats</h3><button class="btn-new" id="ls-chat-new">+ New</button>`;
    $("#ls-chat-new").addEventListener("click", () => { st.chat.cur = null; renderList(); renderPanel(); });
    let html = S.listChats().map(c => `<div class="li${c.id === (st.chat.cur && st.chat.cur.id) ? " sel" : ""}" data-id="${c.id}">
        <span class="t">${esc(c.title)}</span><span class="m">${fmt(c.updated)}</span>
        <button class="x" data-del="${c.id}">✕</button></div>`).join("") || `<div class="empty">No chats yet.<br>Pick sources below and ask anything.</div>`;
    html += `<div class="list-sub">Context</div>`;
    html += items.length
      ? `<div style="padding:0 8px">${chatContextRows(items, st.chat.modes)}</div>`
      : `<div class="empty">No sources yet.<br>Add some under Sources.</div>`;
    $("#md-list-body").innerHTML = html;

    $$("#md-list-body .li").forEach(li => li.addEventListener("click", (e) => {
      if (e.target.closest(".x")) return;
      loadChat(li.dataset.id);
    }));
    $$("#md-list-body .x").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      S.deleteChat(b.dataset.del);
      if (st.chat.cur && st.chat.cur.id === b.dataset.del) { st.chat.cur = null; renderPanel(); }
      renderList();
    }));
    $$("#md-list-body input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      if (cb.checked) { if (!st.chat.ctx.some(c => c.id === id)) st.chat.ctx.push(items.find(i => i.id === id)); }
      else st.chat.ctx = st.chat.ctx.filter(c => c.id !== id);
    }));
    $$("#md-list-body label[data-id]").forEach(l => l.addEventListener("click", () => {
      const cb = l.parentElement.querySelector("input");
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    }));
    $$("#md-list-body .mode").forEach(b => b.addEventListener("click", () => {
      const id = b.dataset.id;
      st.chat.modes[id] = MODES[(MODES.indexOf(b.dataset.mode) + 1) % MODES.length];
      renderList();
    }));
  }

  function loadChat(id) {
    st.chat.cur = S.getChat(id);
    if (!st.chat.cur) return;
    const items = contextItems();
    st.chat.ctx = (st.chat.cur.sourceIds || []).map(cid => items.find(i => i.id === cid)).filter(Boolean);
    st.chat.modes = Object.assign({}, st.chat.cur.ctxModes || {});
    renderList(); renderPanel();
  }

  function chatWelcome() {
    const n = contextItems().length;
    return n
      ? `<div class="welcome"><b>Grounded chat.</b><br>Pick sources in the left rail, then ask anything.<br>Answers cite [n] straight from your material.</div>`
      : `<div class="welcome"><b>Welcome to Notebox.</b><br>Add your first source under <b>Sources</b>,<br>then come back and ask away.</div>`;
  }

  function appendTrail(deep) {
    const t = document.createElement("div");
    t.className = "trail mono";
    t.textContent = "\uD83E\uDDE0 searched: " + (deep.terms || []).join(" · ") + " — grounded in " + (deep.picks || 0) + " passages";
    return t;
  }

  function citedNode(text, citations) {
    const span = document.createElement("span");
    const re = /\[(\d+)\]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      span.appendChild(document.createTextNode(text.slice(last, m.index)));
      const i = +m[1];
      const cit = (citations || []).find(c => c.i === i);
      const chip = document.createElement("span");
      chip.className = "cit";
      chip.textContent = "[" + i + "]";
      if (cit) {
        chip.title = cit.title;
        chip.addEventListener("click", () => {
          const bar = $("#ch-citbar");
          if (bar) { bar.innerHTML = `<b>${esc(cit.title)}</b> · ${esc(cit.snippet)}`; bar.classList.add("on"); }
        });
      }
      span.appendChild(chip);
      last = re.lastIndex;
    }
    span.appendChild(document.createTextNode(text.slice(last)));
    return span;
  }

  function chatBuildContext() {
    const items = contextItems();
    let chosen = st.chat.ctx.length ? st.chat.ctx.slice() : items.slice();
    chosen = chosen.map(c => items.find(i => i.id === c.id) || c)
      .filter(it => it && (it.kind === "note" || (st.chat.modes[it.id] || "full") !== "off"));
    const numbered = [], pending = [];
    let prompt = "SOURCES:\n";
    chosen.forEach((it, idx) => {
      const i = idx + 1;
      numbered.push({ i, id: it.id, title: it.title, snippet: (it.text || "").slice(0, 160) });
      let txt;
      if (it.kind === "source" && st.chat.modes[it.id] === "summary") {
        if (it.summary) txt = "SUMMARY — " + it.summary;
        else { pending.push(it.srcId); txt = "(summary being generated — excerpt)\n" + (it.text || "").slice(0, 4000); }
      } else txt = (it.text || "").slice(0, 22000);
      prompt += `[${i}] ${it.title}\n${txt}\n\n`;
    });
    pending.forEach(id => AI.ensureSummary(id).then(renderList).catch(() => {}));
    return { numbered, prompt };
  }

  function chunkText(text) {
    const t = text || "", chunks = [];
    let i = 0;
    while (i < t.length) {
      let end = Math.min(i + 1100, t.length);
      if (end < t.length) { const dot = t.lastIndexOf(". ", end); if (dot > i + 400) end = dot + 1; }
      chunks.push(t.slice(i, end));
      i = end;
    }
    return chunks;
  }
  async function planSearch(q, items) {
    const listing = items.map((it, i) => `[${i + 1}] ${it.title}`).join("\n");
    try {
      const j = await AI.json(
        `You are a search planner. Given a student's question and a list of sources, output 4-7 short keyword search phrases (1-3 words each, lowercase) that would find the passages answering the question.\nReturn strict JSON: {"terms":["..."]}\n\nQUESTION: ${q}\n\nAVAILABLE SOURCES:\n${listing}`,
        "search terms");
      const terms = Array.isArray(j) ? j : (j && j.terms) || [];
      return terms.map(String).slice(0, 8);
    } catch (_) { return []; }
  }
  function topChunks(items, terms, q) {
    const ws = ((terms.join(" ") + " " + q).toLowerCase().match(/[a-z0-9']{3,}/g) || []).filter(w => !STOP.has(w));
    const uniq = [...new Set(ws)];
    const scored = [];
    items.forEach((it, idx) => {
      chunkText(it.text).forEach(ch => {
        const low = ch.toLowerCase();
        let sc = 0;
        uniq.forEach(w => { const c = low.split(w).length - 1; if (c) sc += c * (w.length > 5 ? 1.6 : 1); });
        if (sc > 0) scored.push({ i: idx + 1, text: ch.trim(), sc });
      });
    });
    scored.sort((a, b) => b.sc - a.sc);
    const per = {}, out = [];
    for (const s of scored) {
      per[s.i] = (per[s.i] || 0) + 1;
      if (per[s.i] <= 3) out.push(s);
      if (out.length >= 6) break;
    }
    return out;
  }
  function sysPrompt() {
    const instr = (S.getSettings().instructions || "").trim();
    return `You are a focused study assistant. Answer using ONLY the provided SOURCES — never from your own knowledge.` +
      (instr ? `\n\nSTUDENT CONTEXT (tailor level and focus to this): ${instr}` : "") +
      `\n\nCITATION RULES:\n- After any fact taken from a source, cite it like [2] using the exact bracketed numbers of the SOURCES list.\n- NEVER invent or guess a citation number that is not in the list.\n- If the sources do not contain the answer, say you don't know.`;
  }

  async function chatSend() {
    const ta = $("#ch-text"), wrap = $("#ch-msgs");
    if (!ta || !wrap) return;
    const q = ta.value.trim();
    if (!q) return;
    if (!contextItems().length) { flashCitbar("Add at least one source/note first."); return; }
    if (!st.chat.ctx.length) flashCitbar("No sources selected — using all available sources.");

    if (!st.chat.cur) {
      st.chat.cur = S.addChat({ title: q.slice(0, 40), sourceIds: st.chat.ctx.map(c => c.id), messages: [] });
      renderList();
    }
    ta.value = "";
    $(".welcome", wrap) && ($(".welcome", wrap).remove());

    const um = document.createElement("div");
    um.className = "msg-user"; um.textContent = q;
    wrap.appendChild(um);

    const thinking = document.createElement("div");
    thinking.className = "msg-ai";
    thinking.textContent = st.chat.deep ? "\uD83E\uDDE0 Planning search…" : "Thinking…";
    wrap.appendChild(thinking);
    wrap.parentElement.scrollTop = wrap.parentElement.scrollHeight;

    const { numbered, prompt } = chatBuildContext();
    const history = (st.chat.cur.messages || []).slice(-8)
      .map(m => (m.role === "user" ? "User: " : "Assistant: ") + m.text).join("\n");

    try {
      let full, deepMeta = null;
      if (st.chat.deep) {
        const included = numbered.map(n => ({ title: n.title, text: (contextItems().find(x => x.id === n.id) || {}).text || "" }));
        const terms = await planSearch(q, included);
        thinking.textContent = "\uD83E\uDDE0 Reading relevant passages…";
        const picks = topChunks(included, terms, q);
        if (!picks.length) throw new Error("Deep think found no matching passages for that question.");
        deepMeta = { terms, picks: picks.length };
        const passages = picks.map(p => `[[source ${p.i}]] ${p.text}`).join("\n---\n");
        full = `${sysPrompt()}\n\nYou are in DEEP mode: answer using ONLY these retrieved PASSAGES from the sources.\n\nRETRIEVED PASSAGES:\n${passages}\n---\nPrevious conversation:\n${history}\n\nQuestion: ${q}`;
      } else {
        full = `${sysPrompt()}\n\n${prompt}---\nPrevious conversation:\n${history}\n\nQuestion: ${q}`;
      }
      const answer = await AI.text(full);
      const citations = []; const used = new Set();
      const rm = /\[(\d+)\]/g; let mm;
      while ((mm = rm.exec(answer))) used.add(+mm[1]);
      used.forEach(i => { const n = numbered.find(x => x.i === i); if (n) citations.push({ i, id: n.id, title: n.title, snippet: n.snippet }); });
      thinking.remove();
      const am = document.createElement("div");
      am.className = "msg-ai";
      if (deepMeta) am.appendChild(appendTrail(deepMeta));
      am.appendChild(citedNode(answer, citations));
      wrap.appendChild(am);
      st.chat.cur.messages.push({ role: "user", text: q });
      st.chat.cur.messages.push(deepMeta ? { role: "ai", text: answer, citations, deep: deepMeta } : { role: "ai", text: answer, citations });
      S.updateChat(st.chat.cur.id, { messages: st.chat.cur.messages, sourceIds: st.chat.ctx.map(c => c.id), ctxModes: st.chat.modes });
    } catch (e) {
      thinking.remove();
      const em = document.createElement("div");
      em.className = "msg-ai"; em.textContent = "⚠ " + (e.message || "Request failed.");
      wrap.appendChild(em);
    }
    wrap.parentElement.scrollTop = wrap.parentElement.scrollHeight;
  }
  function flashCitbar(msg) { const b = $("#ch-citbar"); if (!b) return; b.textContent = msg; b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 3500); }

  function renderChatPanel() {
    $("#md-panel-head").innerHTML = `<h2>Chat</h2><span class="sub">grounded in your sources · cites [n]</span><span class="spacer"></span>
      <button class="tgl ${st.chat.deep ? "on" : ""}" id="ch-deep">\uD83E\uDDE0 DEEP</button>`;
    $("#ch-deep").addEventListener("click", () => {
      st.chat.deep = !st.chat.deep;
      $("#ch-deep").classList.toggle("on", st.chat.deep);
      if (st.chat.deep) flashCitbar("Deep think ON — planned retrieval, answers only from passages.");
    });
    $("#md-panel-body").innerHTML = `
      <div class="chat-wrap" id="ch-msgs" style="position:relative"></div>
      <div class="citbar" id="ch-citbar"></div>
      <div class="composer"><div class="composer-in">
        <textarea id="ch-text" rows="2" placeholder="Ask about your sources…  (Enter to send)"></textarea>
        <div class="composer-tools">
          <button class="send" id="ch-send">Send ↑</button>
        </div></div></div>`;
    const wrap = $("#ch-msgs");
    const ms = (st.chat.cur && st.chat.cur.messages) || [];
    ms.forEach(m => {
      if (m.role === "ai" && m.deep) wrap.appendChild(appendTrail(m.deep));
      if (m.role === "user") { const d = document.createElement("div"); d.className = "msg-user"; d.textContent = m.text; wrap.appendChild(d); }
      else { const d = document.createElement("div"); d.className = "msg-ai"; d.appendChild(citedNode(m.text, m.citations)); wrap.appendChild(d); }
    });
    if (!ms.length) wrap.innerHTML = chatWelcome();
    $("#ch-send").addEventListener("click", chatSend);
    $("#ch-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
    });
    $("#ch-text").focus();
  }

  /* ============================================================
     GUIDE
     ============================================================ */
  function renderGuideList() {
    $("#md-list-head").innerHTML = `<h3>Guides</h3><button class="btn-new" id="sg-gen">✦ Generate</button>`;
    $("#sg-gen").addEventListener("click", guideGenerate);
    const items = contextItems();
    let html = S.listGuides().map(g => `<div class="li${g.id === (st.guide.cur && st.guide.cur.id) ? " sel" : ""}" data-id="${g.id}">
        <span class="t">${esc(g.title)}</span><span class="m">${fmt(g.created)}</span>
        <button class="x" data-del="${g.id}">✕</button></div>`).join("") || `<div class="empty">No guides yet.</div>`;
    html += `<div class="list-sub">Use sources</div>`;
    html += items.length ? `<div style="padding:0 8px">${items.map(it => {
      const on = st.guide.ctx.some(c => c.id === it.id);
      return `<div class="ctxrow"><input type="checkbox" data-gid="${esc(it.id)}" ${on ? "checked" : ""}>
        <label data-gid="${esc(it.id)}">${it.kind === "note" ? "✎" : "▦"} ${esc(it.title.slice(0, 28))}</label></div>`;
    }).join("")}</div>` : `<div class="empty">No sources yet.</div>`;
    $("#md-list-body").innerHTML = html;
    $$("#md-list-body .li").forEach(li => li.addEventListener("click", (e) => { if (e.target.closest(".x")) return; guideLoad(li.dataset.id); }));
    $$("#md-list-body .x").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation(); S.deleteGuide(b.dataset.del);
      if (st.guide.cur && st.guide.cur.id === b.dataset.del) { st.guide.cur = null; renderPanel(); }
      renderList();
    }));
    $$("#md-list-body input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
      const id = cb.dataset.gid;
      if (cb.checked) { if (!st.guide.ctx.some(c => c.id === id)) st.guide.ctx.push(id); }
      else st.guide.ctx = st.guide.ctx.filter(x => x !== id);
    }));
    $$("#md-list-body label[data-gid]").forEach(l => l.addEventListener("click", () => {
      const cb = l.parentElement.querySelector("input");
      cb.checked = !cb.checked; cb.dispatchEvent(new Event("change"));
    }));
  }

  function guideLoad(id) {
    st.guide.cur = S.getGuide(id);
    if (!st.guide.cur) return;
    st.guide.tab = "read";
    renderList(); renderPanel();
  }

  async function guideGenerate() {
    const items = contextItems();
    const chosen = st.guide.ctx.length
      ? st.guide.ctx.map(id => items.find(i => i.id === id)).filter(Boolean)
      : items;
    if (!chosen.length) { alert("Add at least one source/note first."); return; }
    const instr = (S.getSettings().instructions || "").trim();
    const prompt = `You are a master tutor.${instr ? `\nThe student says: "${instr}" — tailor the guide's depth and emphasis to this.` : ""} From the SOURCES below, build a study guide as JSON.

Return exactly this JSON shape (no markdown):
{
  "title": short guide title,
  "summary": 3-5 sentence overview,
  "keyTerms": [{"term":"", "def":""}] (8-15 items),
  "timeline": [{"date":"", "event":""}] (if relevant, else []),
  "faqs": [{"q":"", "a":""}] (6-10 items),
  "outline": {"title":"Top concept", "children":[{"title":"", "children":[{"title":""}]}]}  (3-level concept map of the subject)
}

SOURCES:
${chosen.map((it, i) => `[${i + 1}] ${it.title}\n${(it.text || "").slice(0, 22000)}`).join("\n\n")}`;
    const sub = $("#md-sub"); if (sub) sub.textContent = "generating… (up to a minute)";
    const bodyEl = $("#md-panel-body");
    if (bodyEl) bodyEl.innerHTML = `<div class="welcome">Working…</div>`;
    try {
      const data = await AI.json(prompt, "study guide");
      if (!data || typeof data !== "object") throw new Error("empty guide");
      data.title = data.title || chosen[0].title;
      st.guide.cur = S.addGuide({ title: data.title, sourceIds: chosen.map(c => c.id), data });
      st.guide.tab = "read";
      renderList(); renderPanel();
    } catch (e) {
      if (bodyEl) bodyEl.innerHTML = `<div class="welcome">Generation failed:<br>${esc(e.message || "")}</div>`;
      if ($("#md-sub")) $("#md-sub").textContent = "";
    }
  }

  function drawReader(data) {
    const terms = (data.keyTerms || []).map(t => `<li><b>${esc(t.term)}</b> — ${esc(t.def)}</li>`).join("");
    const tl = (data.timeline || []).map(t => `<li><b>${esc(t.date)}</b> — ${esc(t.event)}</li>`).join("");
    const faq = (data.faqs || []).map(f => `<div class="faq"><b>Q:</b> ${esc(f.q)}<br><b>A:</b> ${esc(f.a)}</div>`).join("");
    return `<div class="prose"><h1>${esc(data.title || "Study Guide")}</h1>
      <h3>Summary</h3><p>${esc(data.summary || "")}</p>
      ${terms ? `<h3>Key terms</h3><ul>${terms}</ul>` : ""}
      ${tl ? `<h3>Timeline</h3><ul>${tl}</ul>` : ""}
      ${faq ? `<h3>Questions &amp; answers</h3>${faq}` : ""}</div>`;
  }

  function drawMap(outline) {
    if (!outline) return `<div class="welcome">No concept map in this guide.</div>`;
    const root = typeof outline === "string" ? { title: outline, children: [] } : outline;
    const row = { n: 0 };
    layout(root, 0, row);
    const dx = 210, dy = 58, pad = 34;
    const W = (maxDepth(root) + 1) * dx + pad * 2;
    const H = row.n * dy + pad * 2;
    let svg = `<svg width="${W}" height="${H}">`;
    const draw = (node) => {
      const x = pad + node._x * dx, y = pad + node._y * dy;
      if (node.children) node.children.forEach(c => {
        const cx = pad + c._x * dx, cy = pad + c._y * dy;
        svg += `<path d="M${x + 160},${y + 18} C${x + 185},${y + 18} ${cx - 25},${cy + 18} ${cx},${cy + 18}" stroke="#656363" fill="none" stroke-width="1.3"/>`;
        draw(c);
      });
      svg += `<g><rect x="${x}" y="${y}" width="160" height="36" rx="9" fill="#262320" stroke="#4A443E"/><text x="${x + 80}" y="${y + 22}" text-anchor="middle" font-size="11" fill="#F1ECEC" font-family="Segoe UI,sans-serif">${esc(String(node.title || "").slice(0, 24))}</text></g>`;
    };
    draw(root);
    svg += `</svg>`;
    return `<div class="mapwrap">${svg}</div>`;
  }
  function layout(node, depth, row) {
    node._x = depth;
    if (!node.children || !node.children.length) node._y = row.n++;
    else { node.children.forEach(c => layout(c, depth + 1, row)); node._y = (node.children[0]._y + node.children[node.children.length - 1]._y) / 2; }
  }
  function maxDepth(n) { return !n.children || !n.children.length ? n._x : Math.max(n._x, ...n.children.map(maxDepth)); }

  function renderGuidePanel() {
    const g = st.guide.cur;
    $("#md-panel-head").innerHTML = `<h2>Study Guide</h2><span class="sub" id="md-sub">${g ? esc(g.title) : "summary · key terms · timeline · Q&A · concept map"}</span>
      <span class="spacer"></span>
      <div class="seg"><button data-tab="read" class="${st.guide.tab === "read" ? "on" : ""}">Reader</button>
      <button data-tab="map" class="${st.guide.tab === "map" ? "on" : ""}">Mind map</button></div>
      ${g && g.data ? `<button class="btn" id="sg-notes">Save to Notes</button>` : ""}`;
    $$("#md-panel-head .seg button").forEach(b => b.addEventListener("click", () => { st.guide.tab = b.dataset.tab; renderGuidePanel(); }));
    const sn = $("#sg-notes");
    if (sn) sn.addEventListener("click", () => {
      const d = st.guide.cur.data;
      const terms = (d.keyTerms || []).map(t => `<li><b>${esc(t.term)}</b> — ${esc(t.def)}</li>`).join("");
      const tl = (d.timeline || []).map(t => `<li><b>${esc(t.date)}</b> — ${esc(t.event)}</li>`).join("");
      const faq = (d.faqs || []).map(f => `<div class="faq"><b>Q:</b> ${esc(f.q)}<br><b>A:</b> ${esc(f.a)}</div>`).join("");
      S.addNote({ title: d.title || "Study Guide", body: `<h2>${esc(d.title || "")}</h2><p>${esc(d.summary || "")}</p>${terms ? `<h3>Key terms</h3><ul>${terms}</ul>` : ""}${tl ? `<h3>Timeline</h3><ul>${tl}</ul>` : ""}${faq ? `<h3>Q&amp;A</h3>${faq}` : ""}` });
      route("notes");
    });
    $("#md-panel-body").innerHTML = !g || !g.data
      ? `<div class="welcome" style="padding-top:12vh">Pick sources on the left, then hit <b>✦ Generate</b>.<br>We'll build a summary, key terms, timeline, Q&amp;A and a concept map.</div>`
      : (st.guide.tab === "map" ? drawMap(g.data.outline) : drawReader(g.data));
  }

  /* ============================================================
     AUDIO
     ============================================================ */
  const A_STYLES = [
    { id: "friendly", desc: "warm, curious, occasionally funny" },
    { id: "prof", desc: "one explains, one asks the questions you'd ask" },
    { id: "debate", desc: "the two hosts stress-test the material against each other" },
  ];
  const A_LENS = [
    { id: "s", label: "Short ~2 min", words: 320 },
    { id: "m", label: "Medium ~4 min", words: 640 },
    { id: "l", label: "Long ~8 min", words: 1250 },
  ];

  function audioVoices() {
    if (!window.speechSynthesis) return [];
    return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang))
      .sort((a, b) => (b.name.includes("Natural") - a.name.includes("Natural")) || a.name.localeCompare(b.name));
  }
  function fillVoiceSelect(sel) {
    if (!sel) return;
    const vs = audioVoices();
    sel.innerHTML = vs.length ? vs.map((v, i) => `<option value="${i}">${esc(v.name)}</option>`).join("")
      : `<option value="-1">Default voice</option>`;
  }

  function renderAudioList() {
    $("#md-list-head").innerHTML = `<h3>Episodes</h3><button class="btn-new" id="ao-new">+ New</button>`;
    $("#ao-new").addEventListener("click", () => { audioStop(); st.audio.cur = null; renderList(); renderPanel(); });
    let html = S.listAudio().map(a => `<div class="li${a.id === (st.audio.cur && st.audio.cur.id) ? " sel" : ""}" data-id="${a.id}">
        <span class="t">${esc(a.title)}</span><span class="m">${(a.data.lines || []).length}L</span>
        <button class="x" data-del="${a.id}">✕</button></div>`).join("") || `<div class="empty">No episodes yet.</div>`;
    const all = S.listSources();
    html += `<div class="list-sub">New episode</div>
      <div style="padding:0 10px;display:flex;flex-direction:column;gap:9px">
        ${all.length ? all.map(s => `<div class="ctxrow" style="padding:4px 2px"><input type="checkbox" data-aid="${s.id}" ${st.audio.picked.includes(s.id) ? "checked" : ""}><label data-aid="${s.id}" style="font-size:11.5px">${s.summary ? "✓" : "▦"} ${esc(s.title.slice(0, 24))}</label></div>`).join("") : `<div class="empty">No sources yet.</div>`}
        <div class="frow"><div class="field"><label>H1</label><input class="inp" id="ao-h1" value="Alex" style="padding:6px 8px"></div>
        <div class="field"><label>H2</label><input class="inp" id="ao-h2" value="Sam" style="padding:6px 8px"></div></div>
        <select class="sel" id="ao-style">${A_STYLES.map(s => `<option value="${s.id}">${s.id}</option>`).join("")}</select>
        <select class="sel" id="ao-len">${A_LENS.map(l => `<option value="${l.id}"${l.id === "m" ? " selected" : ""}>${l.label}</option>`).join("")}</select>
        <button class="btn primary" id="ao-gen">Generate script</button>
      </div>`;
    $("#md-list-body").innerHTML = html;
    $$("#md-list-body .li").forEach(li => li.addEventListener("click", (e) => { if (e.target.closest(".x")) return; audioLoad(li.dataset.id); }));
    $$("#md-list-body .x").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      audioStop();
      S.deleteAudio(b.dataset.del);
      if (st.audio.cur && st.audio.cur.id === b.dataset.del) st.audio.cur = null;
      renderList(); renderPanel();
    }));
    $$("#md-list-body input[type=checkbox][data-aid]").forEach(cb => cb.addEventListener("change", () => {
      const id = cb.dataset.aid;
      if (cb.checked) { if (!st.audio.picked.includes(id)) st.audio.picked = st.audio.picked.concat(id); }
      else st.audio.picked = st.audio.picked.filter(x => x !== id);
    }));
    $$("#md-list-body label[data-aid]").forEach(l => l.addEventListener("click", () => {
      const cb = l.parentElement.querySelector("input");
      cb.checked = !cb.checked; cb.dispatchEvent(new Event("change"));
    }));
    const gen = $("#ao-gen");
    if (gen) gen.addEventListener("click", audioGenerate);
  }

  async function audioGenerate() {
    if (!st.audio.picked.length) { flashSub("Pick at least one source."); return; }
    const h1 = ($("#ao-h1").value || "Alex").trim().slice(0, 18);
    const h2 = ($("#ao-h2").value || "Sam").trim().slice(0, 18);
    const style = A_STYLES.find(s => s.id === $("#ao-style").value) || A_STYLES[0];
    const len = A_LENS.find(l => l.id === $("#ao-len").value) || A_LENS[1];
    const btn = $("#ao-gen"); btn.disabled = true;
    flashSub("Writing the episode… (up to a minute)");
    try {
      const parts = [];
      for (const id of st.audio.picked) {
        const s = S.getSource(id);
        if (!s) continue;
        parts.push(`[${s.title}]\n` + (s.summary ? "SUMMARY:\n" + s.summary : "EXCERPT:\n" + (s.text || "").slice(0, 6000)));
      }
      const instr = (S.getSettings().instructions || "").trim();
      const prompt = `You are an award-winning podcast scriptwriter. Write an engaging two-host audio overview discussing the SOURCES below, in this style: ${style.desc}.
Hosts are named "${h1}" and "${h2}". Target length: about ${len.words} words total.

Rules:
- Return STRICT JSON only: {"title":"episode title","lines":[{"host":"${h1}","text":"..."},{"host":"${h2}","text":"..."}]}
- Alternate speakers naturally with short, spoken-style lines (1-4 sentences each). Natural reactions ("wait, really?") are welcome.
- Ground EVERYTHING in the sources — do not invent facts. If sources conflict, have the hosts discuss it.
- Open with a hook, teach the core ideas clearly, close with a rapid recap.
- No markdown, no emojis, no stage directions, no asterisks. Text is spoken aloud.
- Spell out numbers and symbols the way a person would say them.${instr ? `\nListener context: ${instr}` : ""}

SOURCES:
${parts.join("\n\n")}`;
      const data = await AI.json(prompt, "podcast script");
      const outLines = (data && Array.isArray(data.lines) ? data.lines : [])
        .filter(l => l && l.text)
        .map((l, idx) => ({ host: [h1, h2].includes(l.host) ? l.host : (idx % 2 === 0 ? h1 : h2), text: String(l.text).trim() }));
      if (!outLines.length) throw new Error("The model returned no usable script.");
      const s0 = S.getSource(st.audio.picked[0]);
      st.audio.cur = S.addAudio({
        title: (data && data.title) || (s0 ? s0.title.slice(0, 48) : "Audio overview"),
        sourceIds: st.audio.picked.slice(),
        data: { title: (data && data.title) || "Audio overview", lines: outLines },
        opts: { hosts: [h1, h2], style: style.id, length: len.id },
      });
      st.audio.lines = outLines;
      audioStop();
      renderList(); renderPanel();
      flashSub(`Episode ready ✓ — press Play (${outLines.length} lines).`);
    } catch (e) {
      flashSub("⚠ " + (e.message || "Generation failed."));
    } finally { btn.disabled = false; }
  }
  function flashSub(msg) { const s = $("#md-sub"); if (s) s.textContent = msg || ""; }

  function audioLoad(id) {
    audioStop();
    st.audio.cur = S.getAudio(id);
    if (!st.audio.cur) return;
    renderList(); renderPanel();
  }

  function audioMark(i) {
    $$(".epiline").forEach(d => d.classList.toggle("now", +d.dataset.i === i));
    const el = $(`.epiline[data-i="${i}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function audioStop() {
    st.audio.playing = false; st.audio.idx = -1;
    if (window.speechSynthesis) speechSynthesis.cancel();
    const p = $("#ao-play"); if (p) p.textContent = "▶ Play";
    $$(".epiline.now").forEach(d => d.classList.remove("now"));
  }
  function audioSpeakLine(i) {
    const lines = st.audio.lines;
    if (!st.audio.playing || i >= lines.length) {
      audioStop();
      if (lines.length && i >= lines.length) flashSub("Episode finished ✓");
      return;
    }
    st.audio.idx = i; audioMark(i);
    const cur = st.audio.cur;
    const hosts = (cur && cur.opts && cur.opts.hosts) || [];
    const first = hosts.indexOf(lines[i].host) === 0;
    const u = new SpeechSynthesisUtterance(lines[i].text);
    const vs = audioVoices();
    const vSel = first ? $("#ao-v1") : $("#ao-v2");
    if (vSel && vs[+vSel.value]) u.voice = vs[+vSel.value];
    u.rate = parseFloat(($("#ao-rate") || {}).value) || 1;
    u.pitch = first ? 0.95 : 1.08;
    u.onend = () => { if (st.audio.playing) audioSpeakLine(i + 1); };
    u.onerror = () => { if (st.audio.playing) audioSpeakLine(i + 1); };
    speechSynthesis.speak(u);
    flashSub(`Playing line ${i + 1}/${lines.length}`);
  }
  function audioPlay() {
    if (!st.audio.lines.length) { flashSub("Generate or load a script first."); return; }
    speechSynthesis.cancel();
    st.audio.playing = true;
    $("#ao-play").textContent = "❚❚ Pause";
    audioSpeakLine(Math.max(0, st.audio.idx));
  }

  function renderAudioPanel() {
    const cur = st.audio.cur;
    const hasScript = cur && cur.data && cur.data.lines && cur.data.lines.length;
    st.audio.lines = hasScript ? cur.data.lines : [];
    $("#md-panel-head").innerHTML = `<h2>Audio Overview</h2><span class="sub" id="md-sub">${hasScript ? esc(cur.data.title || cur.title) : "two hosts, your sources, zero cost"}</span>
      <span class="spacer"></span>${hasScript ? `<button class="btn" id="ao-export">Export .txt</button>` : ""}`;
    const ex = $("#ao-export");
    if (ex) ex.addEventListener("click", () => {
      const t = cur.data.title + "\n\n" + cur.data.lines.map(l => l.host.toUpperCase() + ": " + l.text).join("\n\n");
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(t);
      a.download = (cur.data.title || "overview").replace(/[^\w\-]+/g, "_") + ".txt";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    $("#md-panel-body").innerHTML = `
      <div class="aud-grid">
        <div class="player">
          <button class="btn primary" id="ao-play">▶ Play</button>
          <button class="btn" id="ao-stop">■ Stop</button>
          <span class="mono" style="font-size:9px;color:var(--mut)">SPD</span>
          <input type="range" id="ao-rate" min="0.7" max="1.4" step="0.05" value="1">
          <span class="field"><label>Voice 1</label><select class="sel" id="ao-v1" style="max-width:140px"></select></span>
          <span class="field"><label>Voice 2</label><select class="sel" id="ao-v2" style="max-width:140px"></select></span>
        </div>
        <div id="ao-script">${hasScript
          ? cur.data.lines.map((ln, i) => {
              const hosts = (cur.opts && cur.opts.hosts) || [];
              const cls = hosts.indexOf(ln.host) === 0 ? "a" : "b";
              return `<div class="epiline" data-i="${i}" title="Double-click to play from here"><span class="host ${cls}">${esc(ln.host)}</span><span>${esc(ln.text)}</span></div>`;
            }).join("")
          : `<div class="welcome">Pick sources on the left and generate an episode.<br>Then press play — your own podcast, read by neural voices.</div>`}
        </div></div>`;
    fillVoiceSelect($("#ao-v1")); fillVoiceSelect($("#ao-v2"));
    if (window.speechSynthesis && !audioVoices().length) speechSynthesis.onvoiceschanged = () => { fillVoiceSelect($("#ao-v1")); fillVoiceSelect($("#ao-v2")); };
    $("#ao-play").addEventListener("click", audioPlay);
    $("#ao-stop").addEventListener("click", audioStop);
    $$(".epiline").forEach(d => d.addEventListener("dblclick", () => { st.audio.idx = +d.dataset.i - 1 >= 0 ? +d.dataset.i - 1 : 0; st.audio.idx = +d.dataset.i; audioPlay(); }));
  }

  /* ============================================================
     CARDS
     ============================================================ */
  function cardChunk(text, size) {
    const chunks = [];
    for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
    return chunks.length ? chunks : [""];
  }
  const CARD_PROMPT = (chunk, budget) =>
    `You are an expert study-material generator. Read the source text below and create flashcards that would let a student master this section of the subject.

Rules:
- Cover the important facts and ideas in this section AS EXHAUSTIVELY AS IS REASONABLE, up to ${budget} flashcards. Aim for about one card per 350 characters of content — not fewer, not drastically more.
- Include: terms and definitions, key concepts, facts, formulas, processes (step by step), sequences, events and dates, causes and effects, comparisons, named entities.
- Each card: front = crisp question/term; back = the complete, precise answer.
- type in ["term","definition","concept","fact","formula","process","sequence","comparison","cause-effect","event","task"].
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

  async function generateCardsForSource(source, onProgress) {
    const chunks = cardChunk(source.text, 7000);
    const budgetPer = Math.max(10, Math.round(source.text.length / 350 / chunks.length) + 6);
    let cards = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      onProgress && onProgress(`chunk ${ci + 1}/${chunks.length}`);
      const cs = await AI.json(CARD_PROMPT(chunks[ci], budgetPer), "cards");
      if (Array.isArray(cs)) cards = cards.concat(cs);
    }
    if (cards.length) {
      onProgress && onProgress("gap pass…");
      const existing = [...new Set(cards.map(c => c.front.trim().toLowerCase()))];
      const added = await AI.json(GAP_PROMPT(source.text.slice(0, 80000), existing, budgetPer), "gaps");
      if (Array.isArray(added)) cards = cards.concat(added);
    }
    const seen = new Set(), out = [];
    for (const c of Array.isArray(cards) ? cards : []) {
      if (!c || !c.front || !c.back) continue;
      const key = c.front.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ front: String(c.front).trim(), back: String(c.back).trim(), type: c.type || "concept", snippet: String(c.snippet || "").trim().slice(0, 220) });
    }
    return out;
  }

  async function deckGenerate(deckId) {
    const d = S.getDeck(deckId);
    if (!d) return;
    const srcs = (d.sourceIds || []).map(id => S.getSource(id)).filter(Boolean);
    if (!srcs.length) { flashSub("Deck has no sources."); return; }
    flashSub("Generating cards…");
    let made = 0;
    try {
      for (const s of srcs) {
        const cards = await generateCardsForSource(s, m => flashSub(`Generating cards — ${s.title}: ${m}`));
        S.addCards(d.id, cards.map(c => Object.assign({}, c, { sourceId: s.id })));
        made += cards.length;
      }
      flashSub(`${made} new cards ✓`);
    } catch (e) { flashSub("⚠ " + (e.message || "generation failed")); }
    renderCardsPanel();
  }

  function startStudy(deckId) {
    st.cards.queue = S.dueCards(deckId, 50);
    st.cards.i = -1; st.cards.flipped = false;
    if (!st.cards.queue.length) { flashSub("Nothing due in this deck."); return; }
    nextCard();
  }
  function nextCard() {
    st.cards.i++; st.cards.flipped = false;
    if (st.cards.i >= st.cards.queue.length) { st.cards.queue = []; st.cards.i = -1; }
    renderCardsPanel();
  }
  function gradeCurrent(g) {
    const c = st.cards.queue[st.cards.i];
    if (!c) return;
    S.gradeCard(c.id, g);
    if (g === "again") st.cards.queue.push(c);
    nextCard();
  }

  function renderCardsList() {
    $("#md-list-head").innerHTML = `<h3>Decks</h3><button class="btn-new" id="dk-new">+ New</button>`;
    $("#dk-new").addEventListener("click", () => {
      formModal("New deck", "name it, pick sources",
        `<label class="field"><label>Name</label><input class="inp" id="nd-name" placeholder="Biology — cells"></label>
         <label class="field"><label>Sources</label><div style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow:auto">${S.listSources().map(s => `<label style="display:flex;gap:8px;font-size:12.5px"><input type="checkbox" value="${s.id}" class="nd-src">${esc(s.title)}</label>`).join("") || "<span class='empty'>No sources yet.</span>"}</div></label>`,
        "Create", () => {
          const name = $("#nd-name").value.trim() || "New deck";
          const ids = $$(".nd-src").filter(c => c.checked).map(c => c.value);
          const d = S.addDeck({ name, sourceIds: ids });
          st.cards.deckId = d.id;
          renderList(); renderCardsPanel();
          if (ids.length) deckGenerate(d.id);
        });
    });
    $("#md-list-body").innerHTML = S.listDecks().map(d => {
      const stats = S.deckStats(d.id);
      return `<div class="li${d.id === st.cards.deckId ? " sel" : ""}" data-id="${d.id}">
        <span class="t">${esc(d.name)}</span><span class="m" ${stats.due ? 'style="color:var(--warn)"' : ""}>${stats.due}/${stats.total}</span>
        <button class="x" data-del="${d.id}">✕</button></div>`;
    }).join("") || `<div class="empty">No decks yet.<br>Create one from your sources.</div>`;
    $$("#md-list-body .li").forEach(li => li.addEventListener("click", (e) => {
      if (e.target.closest(".x")) return;
      st.cards.deckId = li.dataset.id;
      st.cards.queue = [];
      renderList(); renderCardsPanel();
    }));
    $$("#md-list-body .x").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmModal("Delete this deck and all its cards?", () => {
        S.deleteDeck(b.dataset.del);
        if (st.cards.deckId === b.dataset.del) { st.cards.deckId = null; renderCardsPanel(); }
        renderList();
      });
    }));
  }

  function renderCardsPanel() {
    const d = st.cards.deckId ? S.getDeck(st.cards.deckId) : null;
    if (st.cards.queue.length && st.cards.i >= 0 && st.cards.i < st.cards.queue.length) {
      const c = st.cards.queue[st.cards.i];
      $("#md-panel-head").innerHTML = `<h2>Studying</h2><span class="sub" id="md-sub">${esc(d.name)} · card ${st.cards.i + 1} of ${st.cards.queue.length}</span>
        <span class="spacer"></span><button class="btn" id="cs-end">End session</button>`;
      $("#cs-end").addEventListener("click", () => { st.cards.queue = []; renderCardsPanel(); });
      $("#md-panel-body").innerHTML = `<div class="study-stage">
        <div class="flash" id="fl-card">
          <div class="${st.cards.flipped ? "a" : "q"}">${st.cards.flipped ? esc(c.back) : esc(c.front)}</div>
          ${c.snippet && st.cards.flipped ? `<div class="snip">“${esc(c.snippet)}”</div>` : ""}
          <span class="mono" style="font-size:9px;color:var(--dim);letter-spacing:.2em">${st.cards.flipped ? "ANSWER" : (c.type || "").toUpperCase() + " · CLICK TO FLIP"}</span>
        </div>
        ${st.cards.flipped ? `<div class="grades">
          <button class="btn danger" data-g="again">Again</button>
          <button class="btn" data-g="hard">Hard</button>
          <button class="btn primary" data-g="good">Good</button>
          <button class="btn" data-g="easy">Easy</button></div>`
        : `<span class="mono" style="font-size:10px;color:var(--mut)">SPACE to flip</span>`}
      </div>`;
      $("#fl-card").addEventListener("click", () => { st.cards.flipped = true; renderCardsPanel(); });
      $$("[data-g]").forEach(b => b.addEventListener("click", () => gradeCurrent(b.dataset.g)));
      return;
    }
    if (!d) {
      $("#md-panel-head").innerHTML = `<h2>Cards</h2><span class="sub">spaced repetition, SM-2</span>`;
      $("#md-panel-body").innerHTML = `<div class="welcome" style="padding-top:14vh">Select or create a deck.<br>Decks pull facts from your sources automatically.</div>`;
      return;
    }
    const stats = S.deckStats(d.id);
    const cards = S.listCards(d.id);
    $("#md-panel-head").innerHTML = `<h2>${esc(d.name)}</h2><span class="sub" id="md-sub">${stats.total} cards · ${stats.due} due</span>
      <span class="spacer"></span>
      <button class="btn primary" id="cs-study" ${stats.due ? "" : "disabled"}>Study ${stats.due ? "(" + stats.due + ")" : ""}</button>
      <button class="btn" id="cs-gen">Generate more</button>`;
    $("#cs-study").addEventListener("click", () => startStudy(d.id));
    $("#cs-gen").addEventListener("click", () => deckGenerate(d.id));
    $("#md-panel-body").innerHTML = `<div style="max-width:760px;margin:0 auto;padding:24px">
      <div class="stats">
        <div class="stat"><b>${stats.total}</b><span>Total</span></div>
        <div class="stat"><b>${stats.due}</b><span>Due now</span></div>
        <div class="stat"><b>${stats.new}</b><span>New</span></div>
        <div class="stat"><b>${stats.learning}</b><span>Learning</span></div>
        <div class="stat"><b>${stats.mastered}</b><span>Mastered</span></div>
      </div>
      <div class="hairline"></div>
      ${(d.sourceIds || []).map(id => { const s = S.getSource(id); return s ? `<span class="tag" style="margin-right:6px">▦ ${esc(s.title.slice(0, 30))}</span>` : ""; }).join("")}
      <div class="hairline"></div>
      ${cards.slice(0, 40).map(c => `<div style="padding:9px 2px;border-bottom:1px solid var(--line);font-size:12.5px">
        <b>${esc(c.front)}</b> <span class="mono" style="font-size:9px;color:var(--dim)">· ${esc(c.type)}${c.ivl >= 14 ? " · mastered" : c.reps ? " · learning" : ""}</span>
        <div style="color:var(--sub);margin-top:3px">${esc(c.back)}</div></div>`).join("") || `<div class="empty">No cards yet — hit Generate more.</div>`}
    </div>`;
  }

  /* ============================================================
     NOTES
     ============================================================ */
  let noteTimer = null;
  function saveNoteNow() {
    const n = st.notes.cur;
    if (!n) return;
    const title = $("#nt-title") ? $("#nt-title").value.trim() : n.title;
    const body = $("#nt-ed") ? $("#nt-ed").innerHTML : n.body;
    S.updateNote(n.id, { title: title || "Untitled note", body });
    const stat = $("#nt-stat");
    if (stat) stat.textContent = "saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function scheduleSave() {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNoteNow, 700);
  }

  function renderNotesList() {
    $("#md-list-head").innerHTML = `<h3>Notes</h3><button class="btn-new" id="nt-new">+ New</button>`;
    $("#nt-new").addEventListener("click", () => {
      st.notes.cur = S.addNote({ title: "Untitled note", body: "" });
      renderList(); renderPanel();
    });
    $("#md-list-body").innerHTML = S.listNotes().map(n => `<div class="li${n.id === (st.notes.cur && st.notes.cur.id) ? " sel" : ""}" data-id="${n.id}">
        <span class="t">${esc(stripHtml(n.title || "Untitled"))}</span><span class="m">${fmt(n.updated)}</span>
        <button class="x" data-del="${n.id}">✕</button></div>`).join("") || `<div class="empty">No notes yet.<br>Transformations land here too.</div>`;
    $$("#md-list-body .li").forEach(li => li.addEventListener("click", (e) => {
      if (e.target.closest(".x")) return;
      saveNoteNow();
      st.notes.cur = S.getNote(li.dataset.id);
      renderList(); renderPanel();
    }));
    $$("#md-list-body .x").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmModal("Delete this note?", () => {
        S.deleteNote(b.dataset.del);
        if (st.notes.cur && st.notes.cur.id === b.dataset.del) st.notes.cur = null;
        renderList(); renderPanel();
      });
    }));
  }

  function cmd(c, v) { document.execCommand(c, false, v || null); $("#nt-ed").focus(); scheduleSave(); }

  function renderNotesPanel() {
    const n = st.notes.cur;
    $("#md-panel-head").innerHTML = `<h2>Notes</h2><span class="sub">${n ? "autosaves as you type" : "cozy writing space"}</span>`;
    $("#md-panel-body").innerHTML = !n
      ? `<div class="welcome" style="padding-top:14vh">Pick a note on the left,<br>or start a new one.</div>`
      : `<div class="notes-grid">
          <div class="notes-ed">
            <input class="title-in" id="nt-title" value="${esc(n.title)}">
            <div class="statusline" id="nt-stat">&nbsp;</div>
            <div class="notes-bar">
              <button class="ntb" data-c="bold"><b>B</b></button>
              <button class="ntb" data-c="italic"><i>I</i></button>
              <button class="ntb" data-c="underline"><u>U</u></button>
              <button class="ntb" data-b="h2" style="font-weight:650">H</button>
              <button class="ntb" data-b="insertUnorderedList">• List</button>
              <button class="ntb" data-b="insertOrderedList">1. List</button>
              <button class="ntb" data-b="formatBlock" data-v="blockquote">❝</button>
              <span class="sw" data-hilite="#f7e28c" style="background:#f7e28c"></span>
              <span class="sw" data-hilite="#bfe3bf" style="background:#bfe3bf"></span>
              <span class="sw" data-hilite="#f4b8b0" style="background:#f4b8b0"></span>
              <button class="ntb" data-c="removeFormat">Clear</button>
            </div>
            <div class="editor" id="nt-ed" contenteditable="true">${n.body || ""}</div>
          </div></div>`;
    if (!n) return;
    $("#nt-title").addEventListener("input", scheduleSave);
    $("#nt-title").addEventListener("change", renderNotesList);
    const ed = $("#nt-ed");
    ed.addEventListener("input", scheduleSave);
    $$(".ntb").forEach(b => b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (b.dataset.b === "h2") cmd("formatBlock", "h2");
      else if (b.dataset.b) cmd(b.dataset.b);
      else cmd(b.dataset.c);
    }));
    $$(".sw").forEach(sw => sw.addEventListener("mousedown", (e) => {
      e.preventDefault();
      cmd("hiliteColor", sw.dataset.hilite);
    }));
    ed.focus();
  }

  /* ============================================================
     SOURCES
     ============================================================ */
  const PRESETS = [
    { id: "summary", label: "Study notes", task: "Write compact study notes covering the key points of the material. Use short paragraphs and bullet-style lines." },
    { id: "outline", label: "Essay outline", task: "Produce a structured essay outline based on the material: thesis, section headings, and the evidence from the material supporting each section." },
    { id: "defs", label: "Key definitions", task: "List every important term or name found in the material with a precise definition drawn ONLY from the material. One per line as 'term — definition'." },
    { id: "eli5", label: "ELI5 explanation", task: "Explain the material simply, as if to a smart 12-year-old. Use one everyday analogy." },
    { id: "cheat", label: "Cheat sheet", task: "Make a one-page cheat sheet: formulas, dates, names, must-remember facts, and 3 mnemonic devices for the hardest parts." },
    { id: "custom", label: "Custom…", task: "" },
  ];

  function visibleSources() {
    const q = st.sources.q.toLowerCase().trim();
    const nb = st.sources.nb;
    return S.listSources().filter(s => {
      if (nb && ((s.meta && s.meta.notebook) || "") !== nb) return false;
      if (!q) return true;
      return (s.title || "").toLowerCase().includes(q) || (s.text || "").toLowerCase().includes(q.slice(0, 60));
    });
  }

  function renderSourcesList() {
    $("#md-list-head").innerHTML = `<h3>Sources</h3><button class="btn-new" id="src-add">+ Add</button>`;
    $("#src-add").addEventListener("click", () => {
      formModal("Add source", "paste text for now — files/URL live in the toolbar",
        `<label class="field"><label>Title</label><input class="inp" id="as-t" placeholder="Lecture 4 notes"></label>
         <label class="field"><label>Text</label><textarea class="ta" id="as-a" rows="9" placeholder="Paste study material…"></textarea></label>`,
        "Add", () => {
          const txt = ($("#as-a").value || "").trim();
          if (!txt) return false;
          const s = S.addSource({ title: ($("#as-t").value || "").trim() || "Pasted text", text: txt, kind: "text" });
          st.sources.sel = s.id;
          renderList(); renderPanel();
        });
    });
    const all = S.listSources();
    $("#md-list-body").innerHTML = visibleSources().map(s => `<div class="li${s.id === st.sources.sel ? " sel" : ""}" data-id="${s.id}">
        <span class="kbadge">${esc(s.kind)}</span><span class="t">${esc(s.title)}</span>
        <span class="m">${words(s.text)}w</span><button class="x" data-del="${s.id}">✕</button></div>`).join("")
      || `<div class="empty">No sources yet.</div>`;
    $$("#md-list-body .li").forEach(li => li.addEventListener("click", (e) => {
      if (e.target.closest(".x")) return;
      st.sources.sel = li.dataset.id;
      renderList(); renderPanel();
    }));
    $$("#md-list-body .x").forEach(b => b.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmModal("Delete this source? Cards generated from it stay.", () => {
        S.deleteSource(b.dataset.del);
        if (st.sources.sel === b.dataset.del) st.sources.sel = null;
        renderList(); renderPanel();
      });
    }));
  }

  function renderSourcesToolbar() {
    const nbs = [...new Set(S.listSources().map(s => (s.meta && s.meta.notebook) || "").filter(Boolean))].sort();
    return `<div class="toolbar">
      <input class="inp" id="src-q" placeholder="Search…" style="width:170px" value="${esc(st.sources.q)}">
      <select class="sel" id="src-nb"><option value="">All notebooks</option>${nbs.map(n => `<option value="${esc(n)}"${n === st.sources.nb ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>
      <span style="flex:1"></span>
      <button class="btn" id="tb-file">Upload file</button>
      <button class="btn" id="tb-url">From URL</button>
      <button class="btn" id="tb-yt">YT transcript</button>
      <input type="file" id="tb-file-in" hidden multiple accept=".txt,.md,.pdf,.docx,.doc,.epub,.pptx,.xlsx">
    </div>`;
  }

  async function uploadFiles(files) {
    for (const f of files) {
      try {
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        let r;
        if (window.NBIngest && ["epub", "pptx", "xlsx", "doc"].includes(ext)) r = await NBIngest.read(f);
        else if (ext === "pdf") r = await readPdf(f);
        else if (ext === "docx" && window.mammoth) r = { text: (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value, kind: "docx" };
        else r = { text: (await f.text()).trim(), kind: ext === "md" ? "md" : "text" };
        if (!r.text) { flashSub(`⚠ "${f.name}" produced no extractable text.`); continue; }
        const s = S.addSource({ title: f.name.replace(/\.[^.]+$/, ""), text: r.text, kind: r.kind });
        st.sources.sel = s.id;
        renderList(); renderPanel();
      } catch (e) { flashSub(`⚠ "${f.name}": ${e.message}`); }
    }
  }
  async function readPdf(f) {
    if (!window.pdfjsLib) throw new Error("PDF engine not loaded.");
    const doc = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
    let all = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      all += tc.items.map(it => it.str).join(" ") + "\n";
    }
    return { text: all.trim(), kind: "pdf" };
  }

  async function runTransform(s) {
    const preset = PRESETS.find(p => p.id === ($("#tr-preset") || {}).value);
    if (!preset) return;
    let task = preset.task;
    if (preset.id === "custom") {
      task = ($("#tr-custom").value || "").trim();
      if (!task) { $("#tr-stat").textContent = "Describe the transformation first."; return; }
    }
    const stat = $("#tr-stat"), go = $("#tr-go");
    if (s.summary == null || !s.summary) { stat.textContent = "Summarizing…"; await AI.ensureSummary(s.id).catch(() => {}); }
    const fresh = S.getSource(s.id);
    const instr = (S.getSettings().instructions || "").trim();
    const prompt = `You are a study assistant helping a student work on their own material.` +
      (instr ? `\nStudent context: ${instr}.` : "") +
      `\nApply this transformation:\nTASK: ${task}\n\nSOURCE TITLE: ${fresh.title}\n${fresh.summary ? "SOURCE SUMMARY (for orientation):\n" + fresh.summary + "\n" : ""}SOURCE TEXT:\n"""${(fresh.text || "").slice(0, 30000)}"""\n\nOutput the transformation result directly — no preamble, no markdown fences.`;
    go.disabled = true; stat.textContent = "Working…";
    try {
      const out = await AI.text(prompt);
      const paras = String(out || "").split(/\n{2,}/).map(p => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");
      S.addNote({ title: preset.label + " — " + fresh.title, body: paras });
      stat.textContent = "Saved ✓";
      go.disabled = false;
      flashSub("Saved as a note ✓");
    } catch (e) {
      stat.textContent = "⚠ " + (e.message || "failed");
      go.disabled = false;
    }
  }

  function renderSourcesPanel() {
    const head = $("#md-panel-head");
    head.innerHTML = `<h2>Sources</h2><span class="sub" id="md-sub">${visibleSources().length} of ${S.listSources().length}</span>`;
    const body = $("#md-panel-body");
    body.innerHTML = renderSourcesToolbar() + `<div id="src-detail"></div>`;
    const q = $("#src-q");
    q.addEventListener("input", () => { st.sources.q = q.value; const pos = q.selectionStart; renderSourcesDetailOnly(); $("#src-q").focus(); try { $("#src-q").setSelectionRange(pos, pos); } catch (_) {} });
    $("#src-nb").addEventListener("change", () => { st.sources.nb = $("#src-nb").value; renderSourcesDetailOnly(); });
    $("#tb-file").addEventListener("click", () => $("#tb-file-in").click());
    $("#tb-file-in").addEventListener("change", () => { const fi = $("#tb-file-in"); if (fi.files.length) uploadFiles([...fi.files]); fi.value = ""; });
    $("#tb-url").addEventListener("click", () => {
      formModal("Import from URL", "best effort — some sites block robots",
        `<label class="field"><label>URL</label><input class="inp" id="fu-u" placeholder="https://example.com/article"></label>`,
        "Import", () => {
          const u = ($("#fu-u").value || "").trim();
          if (!u) return false;
          flashSub("Fetching page…");
          NBIngest.readUrl(u).then(res => {
            const s = S.addSource({ title: res.title, text: res.text, kind: "url", meta: { url: u } });
            st.sources.sel = s.id;
            renderList(); renderPanel();
          }).catch(e => flashSub("⚠ " + e.message));
        });
    });
    $("#tb-yt").addEventListener("click", () => {
      formModal("YouTube transcript", "…more → Show transcript → copy → paste here",
        `<label class="field"><label>Title</label><input class="inp" id="yt-t" placeholder="Khan Academy — Photosynthesis"></label>
         <label class="field"><label>Transcript</label><textarea class="ta" id="yt-a" rows="8" placeholder="0:00&#10;welcome back everyone…"></textarea></label>`,
        "Clean & add", () => {
          const raw = ($("#yt-a").value || "").trim();
          if (!raw) return false;
          const clean = NBIngest.cleanTranscript(raw);
          if (!clean) { flashSub("⚠ Nothing left after cleaning."); return false; }
          const s = S.addSource({ title: ($("#yt-t").value || "").trim() || "YouTube transcript", text: clean, kind: "yt" });
          st.sources.sel = s.id;
          renderList(); renderPanel();
        });
    });
    renderSourcesDetailOnly();

    function renderSourcesDetailOnly() {
      // re-render only the list column + detail, keep toolbar intact
      renderList();
      const s = st.sources.sel ? S.getSource(st.sources.sel) : null;
      const det = $("#src-detail");
      if (!det) return;
      if (!s) { det.innerHTML = `<div class="empty" style="padding:60px 20px">Select a source to see its summary<br>and run an AI transformation.</div>`; return; }
      det.innerHTML = `<div class="detail">
        <div class="trow">
          <input class="inp" id="dt-rename" value="${esc(s.title)}" style="flex:1;font-size:14px;font-weight:600">
          <input class="inp" id="dt-nb" value="${esc((s.meta && s.meta.notebook) || "")}" placeholder="notebook tag" style="width:130px">
          <button class="btn danger" id="dt-del">Delete</button>
        </div>
        <h4>AI Summary</h4>
        <div class="sumbox" id="dt-sum">${s.summary ? esc(s.summary) : "<i style='color:var(--dim)'>No summary yet.</i>"}</div>
        <div class="trow" style="margin-top:9px">${!s.summary ? `<button class="btn" id="dt-sumgen">Summarize</button>` : ""}<span class="status" id="tr-stat"></span></div>
        <h4>Transform ✎</h4>
        <div class="trow">
          <select class="sel" id="tr-preset">${PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join("")}</select>
          <button class="btn primary" id="tr-go">Run → saves as note</button>
        </div>
        <textarea class="ta" id="tr-custom" rows="2" style="display:none;margin-top:9px" placeholder="Describe your transformation…"></textarea>
        <p style="margin-top:16px;font-size:12px;line-height:1.7;color:var(--mut)">${words(s.text)} words · added ${new Date(s.added).toLocaleDateString()} ${s.kind !== "text" ? "· " + esc(s.kind) : ""}</p>
      </div>`;
      $("#dt-rename").addEventListener("change", () => { S.updateSource(s.id, { title: $("#dt-rename").value.trim() || s.title }); renderList(); });
      $("#dt-nb").addEventListener("change", () => {
        S.updateSource(s.id, { meta: Object.assign({}, s.meta, { notebook: $("#dt-nb").value.trim() }) });
        renderList();
      });
      $("#dt-del").addEventListener("click", () => confirmModal(`Delete "<b>${esc(s.title)}</b>"? Cards generated from it stay.`, () => {
        S.deleteSource(s.id); st.sources.sel = null;
        renderList(); renderPanel();
      }));
      const sg = $("#dt-sumgen");
      if (sg) sg.addEventListener("click", async () => {
        sg.disabled = true; $("#tr-stat").textContent = "Summarizing…";
        try { await AI.ensureSummary(s.id); renderList(); renderPanel(); }
        catch (e) { $("#tr-stat").textContent = "⚠ " + e.message; sg.disabled = false; }
      });
      const psel = $("#tr-preset"), cust = $("#tr-custom");
      psel.addEventListener("change", () => { cust.style.display = psel.value === "custom" ? "block" : "none"; });
      $("#tr-go").addEventListener("click", () => runTransform(s));
    }
  }

  /* ============================================================
     SEARCH (Ctrl+K)
     ============================================================ */
  function openSearch() {
    openModal(`<div class="modal search-box">
      <input id="sk-in" placeholder="Jump to anything — views, sources, notes, decks…" autocomplete="off">
      <div class="results" id="sk-res"></div></div>`);
    const inp = $("#sk-in");
    const ACTIONS = [
      { k: "View", t: "Chat", go: () => route("chat") },
      { k: "View", t: "Study Guide", go: () => route("guide") },
      { k: "View", t: "Audio", go: () => route("audio") },
      { k: "View", t: "Cards", go: () => route("cards") },
      { k: "View", t: "Notes", go: () => route("notes") },
      { k: "View", t: "Sources", go: () => route("sources") },
      { k: "Action", t: "Settings", go: settingsModal },
    ];
    let results = [], hot = 0;
    function compute() {
      const q = inp.value.toLowerCase().trim();
      results = ACTIONS.filter(a => !q || a.t.toLowerCase().includes(q));
      S.listSources().forEach(s => { if ((!q || s.title.toLowerCase().includes(q))) results.push({ k: "Source", t: s.title, go: () => { st.sources.sel = s.id; route("sources"); } }); });
      S.listNotes().forEach(n => { if ((!q || stripHtml(n.title).toLowerCase().includes(q))) results.push({ k: "Note", t: n.title, go: () => { st.notes.cur = S.getNote(n.id); route("notes"); } }); });
      S.listDecks().forEach(d => { if ((!q || d.name.toLowerCase().includes(q))) results.push({ k: "Deck", t: d.name, go: () => { st.cards.deckId = d.id; route("cards"); } }); });
      hot = 0;
      paint();
    }
    function paint() {
      $("#sk-res").innerHTML = results.slice(0, 12).map((r, i) =>
        `<div class="res${i === hot ? " hot" : ""}" data-i="${i}"><span class="rk">${r.k}</span><span class="rt">${esc(r.t)}</span></div>`).join("")
        || `<div class="empty">Nothing found.</div>`;
      $$("#sk-res .res").forEach(r => r.addEventListener("click", () => { closeOverlay(); results[+r.dataset.i].go(); }));
    }
    inp.addEventListener("input", compute);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { hot = Math.min(hot + 1, Math.min(results.length, 12) - 1); paint(); e.preventDefault(); }
      if (e.key === "ArrowUp") { hot = Math.max(hot - 1, 0); paint(); e.preventDefault(); }
      if (e.key === "Enter" && results[hot]) { closeOverlay(); results[hot].go(); }
    });
    compute();
    inp.focus();
  }

  /* ============================================================
     router dispatch
     ============================================================ */
  const LISTS = { chat: renderChatList, guide: renderGuideList, audio: renderAudioList, cards: renderCardsList, notes: renderNotesList, sources: renderSourcesList };
  const PANELS = { chat: renderChatPanel, guide: renderGuidePanel, audio: renderAudioPanel, cards: renderCardsPanel, notes: renderNotesPanel, sources: renderSourcesPanel };

  function renderList() { (LISTS[view] || renderChatList)(); }
  function renderPanel() { (PANELS[view] || renderChatPanel)(); }

  route("chat");
})();
