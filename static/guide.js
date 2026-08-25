/* ============================================================
   Notebox XP — Study Guide + Mind Map
   Generates summary / key terms / timeline / FAQ / concept map
   from selected sources, with "Open in Notes".
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  const store = window.NB && window.NB.store;
  const ai = window.NB && window.NB.ai;
  if (!shell || !store || !ai) { window.NBGuide = { open: () => {} }; return; }

  const esc = (s) => shell.esc(s == null ? "" : s);
  const stripHtml = (h) => (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  let win = null, curGuide = null, curCtx = [];

  function open() {
    if (win && document.body.contains(win.el)) { win.el.classList.add("focus"); win.el.style.zIndex = 9999; return; }
    win = shell.win({
      title: "Study Guide",
      width: 860, height: 580,
      app: "guide",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><rect x='5' y='6' width='24' height='22' rx='2' fill='%23fff7e6' stroke='%23c9a86a' stroke-width='1.6'/><path d='M5 11h24' stroke='%23c9a86a'/><circle cx='17' cy='20' r='5' fill='none' stroke='%23c9a86a' stroke-width='1.4'/><path d='M20 23l3 3' stroke='%23c9a86a' stroke-width='1.4'/></svg>`),
      menubar: shell.menu("File", "View", "Help"),
      body: `<div id="sg-app" class="sg-app">
        <div class="sg-side">
          <div class="sg-side-head"><button class="bv" id="sg-gen">&#9889; Generate guide</button></div>
          <div class="sg-ctx-head">Sources &amp; notes</div>
          <div class="sg-ctx" id="sg-ctx"></div>
          <div class="sg-ctx-head">Saved guides</div>
          <div class="sg-list" id="sg-list"></div>
        </div>
        <div class="sg-main">
          <div class="sg-tabs">
            <button class="sg-tab sel" data-tab="read">Reader</button>
            <button class="sg-tab" data-tab="map">Mind map</button>
            <button class="bv sg-notes" id="sg-notes">&#128172; Open in Notes</button>
          </div>
          <div class="sg-body" id="sg-body">
            <div class="sg-welcome">Pick sources on the left, then click <b>Generate guide</b>. We'll build a summary, key terms, timeline, Q&amp;A, and a concept map.</div>
          </div>
          <div class="sg-status" id="sg-status"></div>
        </div>
      </div>`,
      onOpen: (el) => init(el),
    });
  }

  function init(el) {
    const ctxBox = el.querySelector("#sg-ctx");
    const listBox = el.querySelector("#sg-list");
    const body = el.querySelector("#sg-body");
    const status = el.querySelector("#sg-status");
    const tabs = el.querySelector(".sg-tabs");

    function contextItems() {
      const srcs = store.listSources().map(s => ({ id: "s:" + s.id, title: s.title, text: s.text || "", kind: "source" }));
      const notes = store.listNotes().map(n => ({ id: "n:" + n.id, title: n.title, text: stripHtml(n.body), kind: "note" }));
      return srcs.concat(notes);
    }
    function renderCtx() {
      const items = contextItems();
      if (!items.length) { ctxBox.innerHTML = `<div class="sg-ctx-empty">No sources yet.</div>`; return; }
      ctxBox.innerHTML = items.map(it => {
        const on = curCtx.some(c => c.id === it.id);
        return `<label class="sg-ck${on ? " on" : ""}"><input type="checkbox" data-id="${esc(it.id)}" ${on ? "checked" : ""}>${it.kind === "note" ? "&#128172;" : "&#128218;"} ${esc(it.title.slice(0, 32))}</label>`;
      }).join("");
      ctxBox.querySelectorAll("input[type=checkbox]").forEach(cb => cb.addEventListener("change", () => {
        const id = cb.dataset.id;
        if (cb.checked) { if (!curCtx.some(c => c.id === id)) curCtx.push(items.find(i => i.id === id)); }
        else curCtx = curCtx.filter(c => c.id !== id);
        renderCtx();
      }));
    }

    function renderList() {
      const gs = store.listGuides();
      listBox.innerHTML = gs.length
        ? gs.map(g => `<div class="sg-li${g.id === (curGuide && curGuide.id) ? " sel" : ""}" data-id="${g.id}">
            <span class="sg-li-t">${esc(g.title)}</span>
            <button class="sg-li-x" data-id="${g.id}" title="Delete">&#10005;</button>
          </div>`).join("")
        : `<div class="sg-empty">None yet.</div>`;
      listBox.querySelectorAll(".sg-li").forEach(li => li.addEventListener("mousedown", (e) => {
        if (e.target.closest(".sg-li-x")) return;
        loadGuide(li.dataset.id);
      }));
      listBox.querySelectorAll(".sg-li-x").forEach(b => b.addEventListener("mousedown", (e) => {
        e.stopPropagation(); store.deleteGuide(b.dataset.id);
        if (curGuide && curGuide.id === b.dataset.id) curGuide = null;
        renderList();
      }));
    }

    function loadGuide(id) {
      curGuide = store.getGuide(id);
      if (!curGuide) return;
      const items = contextItems();
      curCtx = (curGuide.sourceIds || []).map(cid => items.find(i => i.id === cid)).filter(Boolean);
      renderCtx(); renderList(); showReader();
    }

    function setStatus(s) { status.textContent = s || ""; }

    /* entry points route through setTab; the actual rendering lives in
       drawReader/drawMap so setTab ↔ showReader can't recurse forever */
    function showReader() { setTab("read"); }
    function showMap() { setTab("map"); }

    function drawReader(data) {
      if (!data) { body.innerHTML = `<div class="sg-welcome">No guide loaded.</div>`; return; }
      const terms = (data.keyTerms || []).map(t => `<li><b>${esc(t.term)}</b> — ${esc(t.def)}</li>`).join("");
      const tl = (data.timeline || []).map(t => `<li><b>${esc(t.date)}</b> — ${esc(t.event)}</li>`).join("");
      const faq = (data.faqs || []).map(f => `<div class="sg-faq"><div class="sg-q">Q: ${esc(f.q)}</div><div class="sg-a">A: ${esc(f.a)}</div></div>`).join("");
      body.innerHTML = `
        <div class="sg-sec"><h2>${esc(data.title || "Study Guide")}</h2></div>
        <div class="sg-sec"><h3>Summary</h3><p>${esc(data.summary || "")}</p></div>
        ${terms ? `<div class="sg-sec"><h3>Key terms</h3><ul class="sg-ul">${terms}</ul></div>` : ""}
        ${tl ? `<div class="sg-sec"><h3>Timeline</h3><ul class="sg-ul">${tl}</ul></div>` : ""}
        ${faq ? `<div class="sg-sec"><h3>Questions &amp; answers</h3>${faq}</div>` : ""}`;
    }

    function drawMap(outline) {
      if (!outline) { body.innerHTML = `<div class="sg-welcome">No concept map in this guide.</div>`; return; }
      const root = typeof outline === "string" ? { title: outline, children: [] } : outline;
      const row = { n: 0 };
      layout(root, 0, row);
      const dx = 200, dy = 56, pad = 30;
      const W = (maxDepth(root) + 1) * dx + pad * 2;
      const H = (row.n) * dy + pad * 2;
      let svg = `<svg width="${W}" height="${H}" class="sg-svg">`;
      const draw = (node) => {
        const x = pad + node._x * dx, y = pad + node._y * dy;
        if (node.children) node.children.forEach(c => {
          const cx = pad + c._x * dx, cy = pad + c._y * dy;
          svg += `<path d="M${x + 156},${y + 17} C${x + 178},${y + 17} ${cx - 22},${cy + 17} ${cx},${cy + 17}" stroke="#c9a86a" fill="none" stroke-width="1.4"/>`;
          draw(c);
        });
        const w = 156, h = 34;
        svg += `<g class="sg-node"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fff3c9" stroke="#c9a86a"/><text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" font-size="11" fill="#5a3a14">${esc(String(node.title || "").slice(0, 22))}</text></g>`;
      };
      draw(root);
      svg += `</svg>`;
      body.innerHTML = `<div class="sg-mapwrap">${svg}</div>`;
    }

    function layout(node, depth, row) {
      node._x = depth;
      if (!node.children || !node.children.length) { node._y = row.n++; }
      else { node.children.forEach(c => layout(c, depth + 1, row)); node._y = (node.children[0]._y + node.children[node.children.length - 1]._y) / 2; }
    }
    function maxDepth(n) { return !n.children || !n.children.length ? n._x : Math.max(n._x, ...n.children.map(maxDepth)); }

    function setTab(t) {
      tabs.querySelectorAll(".sg-tab").forEach(b => b.classList.toggle("sel", b.dataset.tab === t));
      if (!curGuide || !curGuide.data) {
        body.innerHTML = `<div class="sg-welcome">${t === "map" ? "Generate a guide first, then switch to Mind map." : "No guide loaded."}</div>`;
        return;
      }
      if (t === "map") drawMap(curGuide.data.outline); else drawReader(curGuide.data);
    }
    tabs.querySelectorAll(".sg-tab").forEach(b => b.addEventListener("mousedown", (e) => { e.stopPropagation(); setTab(b.dataset.tab); }));

    async function generate() {
      const items = contextItems();
      const chosen = curCtx.length ? curCtx : items;
      if (!chosen.length) { setStatus("Add at least one source/note first."); return; }
      const instr = (store.getSettings().instructions || "").trim();
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

      setStatus("Generating guide… (this can take a minute)");
      body.innerHTML = `<div class="sg-welcome">Working…</div>`;
      try {
        const data = await ai.json(prompt, "study guide");
        if (!data || typeof data !== "object") throw new Error("empty guide");
        data.title = data.title || chosen[0].title;
        curGuide = store.addGuide({ title: data.title, sourceIds: chosen.map(c => c.id), data });
        renderList();
        showReader();
        setStatus("Guide ready ✓ — switch to Mind map, or Open in Notes.");
      } catch (e) {
        setStatus("⚠ " + (e.message || "Generation failed."));
        body.innerHTML = `<div class="sg-welcome">Generation failed: ${esc(e.message || "")}</div>`;
      }
    }

    function openInNotes() {
      if (!curGuide || !curGuide.data) { setStatus("Generate a guide first."); return; }
      const d = curGuide.data;
      const terms = (d.keyTerms || []).map(t => `<li><b>${esc(t.term)}</b> — ${esc(t.def)}</li>`).join("");
      const tl = (d.timeline || []).map(t => `<li><b>${esc(t.date)}</b> — ${esc(t.event)}</li>`).join("");
      const faq = (d.faqs || []).map(f => `<div class="sg-faq"><div class="sg-q">Q: ${esc(f.q)}</div><div class="sg-a">A: ${esc(f.a)}</div></div>`).join("");
      const html = `<h2>${esc(d.title || "Study Guide")}</h2>
<h3>Summary</h3><p>${esc(d.summary || "")}</p>
${terms ? `<h3>Key terms</h3><ul>${terms}</ul>` : ""}
${tl ? `<h3>Timeline</h3><ul>${tl}</ul>` : ""}
${faq ? `<h3>Questions &amp; answers</h3>${faq}` : ""}`;
      store.addNote({ title: (d.title || "Study Guide"), body: html });
      if (window.NBNotes) window.NBNotes.open();
      setStatus("Opened in Cozy Notes ✓");
    }

    el.querySelector("#sg-gen").addEventListener("mousedown", (e) => { e.stopPropagation(); generate(); });
    el.querySelector("#sg-notes").addEventListener("mousedown", (e) => { e.stopPropagation(); openInNotes(); });

    const menubar = el.querySelector(".menubar");
    menu(el, menubar, [
      { label: "File", items: [
        { label: "Generate guide", action: generate },
        { label: "Open in Notes", action: openInNotes },
        { label: "Delete guide", action: () => { if (curGuide) { store.deleteGuide(curGuide.id); curGuide = null; renderList(); body.innerHTML = `<div class="sg-welcome">Deleted.</div>`; } } },
      ]},
      { label: "View", items: [
        { label: "Reader", action: () => setTab("read") },
        { label: "Mind map", action: () => setTab("map") },
      ]},
      { label: "Help", items: [
        { label: "About Study Guide", action: () => shell.dialog("About Study Guide", `<span class="x-ic">&#9889;</span><span>Turns your sources into a summary, key terms, timeline, Q&amp;A and a concept map — then drops it into Cozy Notes to edit.</span>`) },
      ]},
    ]);

    renderCtx(); renderList();
    const first = store.listGuides()[0];
    if (first) loadGuide(first.id);
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

  const app = { title: "Study Guide", iconClass: "guide", open };
  window.NBGuide = app;
  if (window.NBApp) window.NBApp.register("guide", app);
})();
