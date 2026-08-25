/* ============================================================
   Notebox XP — Grounded AI Chat
   Multi-source context picker, cited answers, saved history.
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  const store = window.NB && window.NB.store;
  const ai = window.NB && window.NB.ai;
  if (!shell || !store || !ai) { window.NBChat = { open: () => {} }; return; }

  const esc = (s) => shell.esc(s == null ? "" : s);
  const stripHtml = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  let win = null, curChat = null, curCtx = [];
  const MODES = ["full", "summary", "off"];
  const MODE_ICON = { full: "&#128196;", summary: "&#128221;", off: "&#9940;" };
  const MODE_LABEL = { full: "Full text in context", summary: "Summary only (saves tokens)", off: "Excluded from context" };
  const STOP = new Set(["the", "and", "what", "how", "why", "does", "did", "are", "was", "were", "for", "with", "this", "that", "from", "about", "explain", "tell", "can", "you", "your", "there", "their", "when", "which", "who", "whom", "into", "give", "list"]);

  function open() {
    if (win && document.body.contains(win.el)) { win.el.classList.add("focus"); win.el.style.zIndex = 9999; return; }
    win = shell.win({
      title: "Chat - Notebook LM killer",
      width: 820, height: 560,
      app: "chat",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><rect x='5' y='7' width='24' height='17' rx='3' fill='%23fff7e6' stroke='%23c9a86a' stroke-width='1.6'/><path d='M11 25l-3 4v-4z' fill='%23fff7e6' stroke='%23c9a86a' stroke-width='1.6'/><circle cx='12' cy='15' r='2' fill='%23c9a86a'/><circle cx='17' cy='15' r='2' fill='%23c9a86a'/><circle cx='22' cy='15' r='2' fill='%23c9a86a'/></svg>`),
      menubar: shell.menu("File", "Edit", "Help"),
      body: `<div id="ch-app" class="ch-app">
        <div class="ch-side">
          <div class="ch-side-head"><button class="bv" id="ch-new">&#10133; New chat</button></div>
          <div class="ch-chats" id="ch-chats"></div>
          <div class="ch-ctx-head">Sources &amp; notes in context</div>
          <div class="ch-ctx" id="ch-ctx"></div>
        </div>
        <div class="ch-main">
          <div class="ch-msgs" id="ch-msgs"></div>
          <div class="ch-citbar" id="ch-citbar">Citations appear here when you click a [n].</div>
          <div class="ch-input">
            <button class="bv ch-deep" id="ch-deep" title="Deep think: plans a search, reads only the most relevant passages">&#129504; Deep</button>
            <textarea id="ch-text" placeholder="Ask about your sources… (Enter to send, Shift+Enter for newline)"></textarea>
            <button class="bv ch-send" id="ch-send">Send</button>
          </div>
        </div>
      </div>`,
      onOpen: (el) => init(el),
    });
  }

  function init(el) {
    const ctxBox = el.querySelector("#ch-ctx");
    const chatsBox = el.querySelector("#ch-chats");
    const msgs = el.querySelector("#ch-msgs");
    const textEl = el.querySelector("#ch-text");
    const sendBtn = el.querySelector("#ch-send");
    const citbar = el.querySelector("#ch-citbar");
    const deepBtn = el.querySelector("#ch-deep");
    let deepMode = false;
    let ctxModes = {};   // item id -> "full" | "summary" | "off" (sources only)
    const status = () => {};

    deepBtn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      deepMode = !deepMode;
      deepBtn.classList.toggle("on", deepMode);
      citbar.textContent = deepMode
        ? "Deep think ON — answers will be planned and grounded in retrieved passages."
        : "";
    });

    /* ---- context picker ---- */
    function contextItems() {
      const srcs = store.listSources().map(s => ({ id: "s:" + s.id, srcId: s.id, title: s.title, text: s.text || "", summary: s.summary || "", kind: "source" }));
      const notes = store.listNotes().map(n => ({ id: "n:" + n.id, title: n.title, text: stripHtml(n.body), kind: "note" }));
      return srcs.concat(notes);
    }
    function renderCtx() {
      const items = contextItems();
      if (!items.length) { ctxBox.innerHTML = `<div class="ch-ctx-empty">No sources yet. Add one in Flashcards or the Source Library, or write a note.</div>`; return; }
      ctxBox.innerHTML = items.map(it => {
        const on = curCtx.some(c => c.id === it.id);
        const mode = ctxModes[it.id] || "full";
        const chip = it.kind === "source"
          ? `<button class="ch-mode m-${mode}" data-id="${esc(it.id)}" data-mode="${mode}" title="${MODE_LABEL[mode]}">${MODE_ICON[mode]}</button>`
          : "";
        return `<label class="ch-ck${on ? " on" : ""}"><input type="checkbox" data-id="${esc(it.id)}" ${on ? "checked" : ""}>${it.kind === "note" ? "&#128172;" : "&#128218;"} ${esc(it.title.slice(0, 30))}</label>${chip}`;
      }).join("");
      ctxBox.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
        const id = cb.dataset.id;
        if (cb.checked) { if (!curCtx.some(c => c.id === id)) curCtx.push(items.find(i => i.id === id)); }
        else { curCtx = curCtx.filter(c => c.id !== id); }
        renderCtx();
      }));
      ctxBox.querySelectorAll(".ch-mode").forEach(b => b.addEventListener("mousedown", (e) => {
        e.stopPropagation(); e.preventDefault();
        const id = b.dataset.id;
        const next = MODES[(MODES.indexOf(b.dataset.mode) + 1) % MODES.length];
        ctxModes[id] = next;
        renderCtx();
      }));
    }

    /* ---- chats list ---- */
    function renderChats() {
      const chats = store.listChats();
      chatsBox.innerHTML = chats.length
        ? chats.map(c => `<div class="ch-li${c.id === (curChat && curChat.id) ? " sel" : ""}" data-id="${c.id}">
            <span class="ch-li-t">${esc(c.title)}</span>
            <button class="ch-li-x" data-id="${c.id}" title="Delete">&#10005;</button>
          </div>`).join("")
        : `<div class="ch-empty">No chats yet.</div>`;
      chatsBox.querySelectorAll(".ch-li").forEach(li => li.addEventListener("mousedown", (e) => {
        if (e.target.closest(".ch-li-x")) return;
        loadChat(li.dataset.id);
      }));
      chatsBox.querySelectorAll(".ch-li-x").forEach(b => b.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        store.deleteChat(b.dataset.id);
        if (curChat && curChat.id === b.dataset.id) curChat = null;
        renderChats();
      }));
    }

    function loadChat(id) {
      curChat = store.getChat(id);
      if (!curChat) return;
      // restore context from saved ids
      const items = contextItems();
      curCtx = (curChat.sourceIds || []).map(cid => items.find(i => i.id === cid)).filter(Boolean);
      ctxModes = Object.assign({}, curChat.ctxModes || {});
      renderCtx();
      renderChats();
      renderMsgs();
    }

    function newChat() {
      curChat = null;
      curCtx = [];
      ctxModes = {};
      renderCtx();
      renderChats();
      msgs.innerHTML = `<div class="ch-welcome">Pick sources/notes on the left, then ask anything. Answers are grounded in your material and show [n] citations.</div>`;
      textEl.focus();
    }

    function renderMsgs() {
      if (!curChat) { newChat(); return; }
      const ms = curChat.messages || [];
      msgs.innerHTML = "";
      if (!ms.length) { msgs.innerHTML = `<div class="ch-welcome">Ask your first question about the selected sources.</div>`; return; }
      ms.forEach(m => {
        if (m.role === "ai" && m.deep) appendTrail(m.deep);
        appendBubble(m.role, m.text, m.citations, false);
      });
      msgs.scrollTop = msgs.scrollHeight;
    }

    function appendTrail(deep) {
      const t = document.createElement("div");
      t.className = "ch-trail";
      t.textContent = "\uD83E\uDDE0 searched: " + (deep.terms || []).join(" · ") + " — grounded in " + (deep.picks || 0) + " passages";
      msgs.appendChild(t);
    }

    function appendBubble(role, text, citations, scroll) {
      const b = document.createElement("div");
      b.className = "ch-bubble " + (role === "user" ? "me" : "ai");
      if (role === "user") {
        b.textContent = text;
      } else {
        renderCited(b, text, citations || []);
      }
      msgs.appendChild(b);
      if (scroll) msgs.scrollTop = msgs.scrollHeight;
      return b;
    }

    function renderCited(container, text, citations) {
      const re = /\[(\d+)\]/g;
      let last = 0, m;
      while ((m = re.exec(text))) {
        container.appendChild(document.createTextNode(text.slice(last, m.index)));
        const i = +m[1];
        const cit = citations.find(c => c.i === i);
        const chip = document.createElement("span");
        chip.className = "ch-chip";
        chip.textContent = "[" + i + "]";
        if (cit) {
          chip.title = cit.title + " — " + cit.snippet;
          chip.addEventListener("mousedown", () => {
            citbar.innerHTML = `<b>&#128218; ${esc(cit.title)}</b> &middot; ${esc(cit.snippet)}`;
          });
        }
        container.appendChild(chip);
        last = re.lastIndex;
      }
      container.appendChild(document.createTextNode(text.slice(last)));
    }

    function buildContextText() {
      const items = contextItems();
      let chosen = curCtx.length ? curCtx.slice() : items.slice();
      // resolve to full item objects and drop "off" sources
      chosen = chosen.map(c => items.find(i => i.id === c.id) || c).filter(it => it && (it.kind === "note" || (ctxModes[it.id] || "full") !== "off"));
      const numbered = [];
      const pending = [];
      let prompt = "SOURCES:\n";
      chosen.forEach((it, idx) => {
        const i = idx + 1;
        numbered.push({ i, id: it.id, title: it.title, snippet: (it.text || "").slice(0, 160) });
        let txt;
        if (it.kind === "source" && ctxModes[it.id] === "summary") {
          if (it.summary) { txt = "SUMMARY — " + it.summary; }
          else {
            pending.push(it.srcId);
            txt = "(summary being generated — excerpt)\n" + (it.text || "").slice(0, 4000);
          }
        } else {
          txt = (it.text || "").slice(0, 22000);
        }
        prompt += `[${i}] ${it.title}\n${txt}\n\n`;
      });
      // kick off lazy summary generation in the background
      pending.forEach(id => ai.ensureSummary(id).then(() => renderCtx()).catch(() => {}));
      return { numbered, prompt, count: chosen.length };
    }

    /* ---- deep think retrieval ---- */
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
        const j = await ai.json(
          `You are a search planner. Given a student's question and a list of sources, output 4-7 short keyword search phrases (1-3 words each, lowercase) that would find the passages answering the question.\nReturn strict JSON: {"terms":["..."]}\n\nQUESTION: ${q}\n\nAVAILABLE SOURCES:\n${listing}`,
          "search terms");
        const terms = Array.isArray(j) ? j : (j && j.terms) || [];
        return terms.map(t => String(t)).slice(0, 8);
      } catch (_) { return []; }
    }
    function topChunks(items, terms, q) {
      const words = ((terms.join(" ") + " " + q).toLowerCase().match(/[a-z0-9']{3,}/g) || [])
        .filter(w => !STOP.has(w));
      const uniq = [...new Set(words)];
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
      const instr = (store.getSettings().instructions || "").trim();
      return `You are a focused study assistant. Answer using ONLY the provided SOURCES${"" } — never from your own knowledge.` +
        (instr ? `\n\nSTUDENT CONTEXT (tailor level and focus to this): ${instr}` : "") +
        `\n\nCITATION RULES:\n- After any fact taken from a source, cite it like [2] using the exact bracketed numbers of the SOURCES list.\n- NEVER invent or guess a citation number that is not in the list.\n- If the sources do not contain the answer, say you don't know.`;
    }

    async function send() {
      const q = textEl.value.trim();
      if (!q) return;
      if (!curCtx.length && !contextItems().length) { citbar.textContent = "Add at least one source/note to the context first."; return; }
      if (curCtx.length === 0) citbar.textContent = "Note: no sources selected — using all available sources.";

      if (!curChat) {
        curChat = store.addChat({ title: q.slice(0, 40), sourceIds: curCtx.map(c => c.id), messages: [] });
        renderChats();
      }
      textEl.value = "";
      appendBubble("user", q, null, true);

      const { numbered, prompt, count } = buildContextText();
      const history = (curChat.messages || []).slice(-8).map(m => (m.role === "user" ? "User: " : "Assistant: ") + m.text).join("\n");

      const thinking = appendBubble("ai", deepMode ? "\uD83E\uDDE0 Planning search…" : "Thinking…", null, true);
      try {
        let full, deepMeta = null;
        if (deepMode) {
          const included = numbered.map(n => ({ title: n.title, text: (contextItems().find(x => x.id === n.id) || {}).text || "" }));
          const terms = await planSearch(q, included);
          thinking.textContent = "\uD83E\uDDE0 Reading relevant passages…";
          const picks = topChunks(included, terms, q);
          if (!picks.length) throw new Error("Deep think found no matching passages for that question.");
          deepMeta = { terms, picks: picks.length };
          const passages = picks.map(p => `[[source ${p.i}]] ${p.text}`).join("\n---\n");
          full = `${sysPrompt()}\n\nYou are in DEEP mode: answer using ONLY these retrieved PASSAGES from the sources.\n\nRETRIEVED PASSAGES:\n${passages}\n\n---\nPrevious conversation:\n${history}\n\nQuestion: ${q}`;
        } else {
          full = `${sysPrompt()}\n\n${prompt}---\nPrevious conversation:\n${history}\n\nQuestion: ${q}`;
        }

        const answer = await ai.text(full);
        const citations = [];
        const used = new Set();
        const rm = /\[(\d+)\]/g; let mm;
        while ((mm = rm.exec(answer))) used.add(+mm[1]);
        used.forEach(i => {
          const n = numbered.find(x => x.i === i);
          if (n) citations.push({ i, id: n.id, title: n.title, snippet: n.snippet });
        });
        thinking.remove();
        if (deepMeta) appendTrail(deepMeta);
        appendBubble("ai", answer, citations, true);
        curChat.messages.push({ role: "user", text: q });
        curChat.messages.push(deepMeta
          ? { role: "ai", text: answer, citations, deep: deepMeta }
          : { role: "ai", text: answer, citations });
        store.updateChat(curChat.id, { messages: curChat.messages, sourceIds: curCtx.map(c => c.id), ctxModes });
      } catch (e) {
        thinking.remove();
        appendBubble("ai", "⚠ " + (e.message || "Request failed."), null, true);
      }
    }

    sendBtn.addEventListener("mousedown", (e) => { e.stopPropagation(); send(); });
    textEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    el.querySelector("#ch-new").addEventListener("mousedown", (e) => { e.stopPropagation(); newChat(); });

    /* ---- menus ---- */
    const menubar = el.querySelector(".menubar");
    menu(el, menubar, [
      { label: "File", items: [
        { label: "New chat", action: newChat },
        { label: "Delete chat", action: () => { if (curChat) { store.deleteChat(curChat.id); curChat = null; renderChats(); newChat(); } } },
        { label: "Export chat (.txt)", action: exportTxt },
      ]},
      { label: "Edit", items: [
        { label: "Clear conversation", action: () => { if (curChat) { curChat.messages = []; store.updateChat(curChat.id, { messages: [] }); renderMsgs(); } } },
      ]},
      { label: "Help", items: [
        { label: "About Chat", action: () => shell.dialog("About Chat", `<span class="x-ic">&#128172;</span><span>Grounded chat over YOUR sources. Answers cite [n] from the material on the left — nothing leaves your machine except the call to Gemini.</span>`) },
      ]},
    ]);

    function exportTxt() {
      if (!curChat) return;
      const t = curChat.messages.map(m => (m.role === "user" ? "You: " : "Assistant: ") + m.text).join("\n\n");
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(t);
      a.download = (curChat.title || "chat").replace(/[^\w\-]+/g, "_") + ".txt";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    /* ---- boot ---- */
    renderCtx();
    const first = store.listChats()[0];
    if (first) loadChat(first.id); else newChat();
  }

  function menu(el, bar, defs) {
    const items = defs.map(d => `<button class="mbtn" data-menu="${d.label}">${d.label}</button>`).join("");
    bar.innerHTML = items;
    bar.querySelectorAll(".mbtn").forEach(btn => btn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const def = defs.find(x => x.label === btn.dataset.menu);
      if (!def) return;
      const html = def.items.map((it, i) => it.sep
        ? '<div style="border-top:1px solid #b5b09e;margin:4px 0"></div>'
        : `<button class="bv ft-item" style="width:100%;text-align:left;margin:2px 0" data-i="${i}">${esc(it.label)}</button>`).join("");
      shell.dialog(def.label, html, [], () => {});
      const box = document.getElementById("xdialog-msg");
      if (box) box.querySelectorAll(".ft-item").forEach(b => b.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        const it = def.items[+b.dataset.i];
        const dlg = document.getElementById("xdialog"); if (dlg) dlg.hidden = true;
        if (it && it.action) it.action();
      }));
    }));
  }

  const app = { title: "Chat", iconClass: "chat", open };
  window.NBChat = app;
  if (window.NBApp) window.NBApp.register("chat", app);
})();
