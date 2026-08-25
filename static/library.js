/* ============================================================
   Notebox XP — Source Library
   The hub: manage all sources (search / tag / summarize),
   ingest new ones (paste, file, URL, YouTube transcript) and
   run AI "transformations" that save results as notes.
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  const store = window.NB && window.NB.store;
  const ai = window.NB && window.NB.ai;
  if (!shell || !store || !ai) { window.NBLibrary = { open: () => {} }; return; }

  const esc = (s) => shell.esc(s == null ? "" : s);
  const words = (t) => (t.match(/\S+/g) || []).length;

  const PRESETS = [
    { id: "summary", label: "Study notes", task: "Write compact study notes covering the key points of the material. Use short paragraphs and bullet-style lines." },
    { id: "outline", label: "Essay outline", task: "Produce a structured essay outline based on the material: thesis, section headings, and the evidence from the material supporting each section." },
    { id: "defs", label: "Key definitions", task: "List every important term or name found in the material with a precise definition drawn ONLY from the material. One per line as 'term — definition'." },
    { id: "eli5", label: "ELI5 explanation", task: "Explain the material simply, as if to a smart 12-year-old. Use one everyday analogy." },
    { id: "cheat", label: "Cheat sheet", task: "Make a one-page cheat sheet: formulas, dates, names, must-remember facts, and 3 mnemonic devices for the hardest parts." },
    { id: "custom", label: "Custom…", task: "" },
  ];

  let win = null, selId = null;

  function open() {
    if (win && document.body.contains(win.el)) { win.el.classList.add("focus"); win.el.style.zIndex = 9999; return; }
    win = shell.win({
      title: "Source Library",
      width: 860, height: 560,
      app: "library",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><path d='M7 6h6l2 3h12a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z' fill='%23fbd050' stroke='%23c98a00' stroke-width='1.6'/><path d='M9 14h16M9 18h16M9 22h10' stroke='%23c98a00' stroke-width='1.4'/></svg>`),
      menubar: shell.menu("File", "Help"),
      statusbar: '<div id="lb-status">Your research, in one place.</div>',
      body: `<div id="lb-app" class="lb-app">
        <div class="lb-toolbar">
          <input id="lb-search" placeholder="Search sources…">
          <select id="lb-nbfilter"><option value="">All notebooks</option></select>
          <button class="bv" id="lb-add-paste">Paste text</button>
          <button class="bv" id="lb-add-file">Upload file</button>
          <button class="bv" id="lb-add-url">From URL</button>
          <button class="bv" id="lb-add-yt">YT transcript</button>
          <button class="bv" id="lb-key">API key</button>
          <input type="file" id="lb-file" style="display:none" multiple accept=".txt,.md,.pdf,.docx,.doc,.epub,.pptx,.xlsx">
        </div>
        <div class="lb-list" id="lb-list"></div>
        <div class="lb-detail" id="lb-detail"></div>
      </div>`,
      onOpen: (el) => init(el),
    });
  }

  function init(el) {
    const searchEl = el.querySelector("#lb-search");
    const nbSel = el.querySelector("#lb-nbfilter");
    const listEl = el.querySelector("#lb-list");
    const detailEl = el.querySelector("#lb-detail");
    const fileEl = el.querySelector("#lb-file");
    const status = el.querySelector("#lb-status");
    const setStatus = (s) => { status.textContent = s || ""; };

    /* ---------- list ---------- */
    function visibleSources() {
      const q = (searchEl.value || "").toLowerCase().trim();
      const nb = nbSel.value;
      return store.listSources().filter(s => {
        if (nb && ((s.meta && s.meta.notebook) || "") !== nb) return false;
        if (!q) return true;
        return (s.title || "").toLowerCase().includes(q) || (s.text || "").toLowerCase().includes(q.slice(0, 60));
      });
    }
    function refreshNbFilter() {
      const cur = nbSel.value;
      const nbs = [...new Set(store.listSources().map(s => (s.meta && s.meta.notebook) || "").filter(Boolean))].sort();
      nbSel.innerHTML = `<option value="">All notebooks</option>` + nbs.map(n => `<option value="${esc(n)}"${n === cur ? " selected" : ""}>${esc(n)}</option>`).join("");
    }
    function render() {
      refreshNbFilter();
      const srcs = visibleSources();
      listEl.innerHTML = srcs.length ? srcs.map(s =>
        `<div class="lb-row${s.id === selId ? " sel" : ""}" data-id="${s.id}">
          <span class="fc-ctype ${esc(s.kind)}">${esc(s.kind)}</span>
          <span class="lb-title">${esc(s.title)}</span>
          ${s.summary ? '<span class="lb-sum" title="Has AI summary">&#10003;</span>' : ""}
          ${(s.meta && s.meta.notebook) ? `<span class="lb-tag">${esc(s.meta.notebook)}</span>` : ""}
          <span class="lb-words">${words(s.text || "")}w</span>
        </div>`).join("")
        : `<div class="lb-empty">No sources${searchEl.value ? " match your search" : " yet"}.<br>Add material with the buttons above.</div>`;
      listEl.querySelectorAll(".lb-row").forEach(r => r.addEventListener("mousedown", () => {
        selId = r.dataset.id;
        render();
      }));
      renderDetail();
    }

    /* ---------- detail + transform ---------- */
    function renderDetail() {
      const s = selId ? store.getSource(selId) : null;
      if (!s) {
        detailEl.innerHTML = `<div class="lb-detail-hint">Select a source to see its summary and run an AI transformation.</div>`;
        return;
      }
      const nb = (s.meta && s.meta.notebook) || "";
      detailEl.innerHTML = `
        <div class="lb-d-head">
          <input id="lb-rename" value="${esc(s.title)}" title="Rename">
          <label class="lb-nb-lbl">Notebook</label><input id="lb-nb" value="${esc(nb)}" placeholder="untagged" title="Group sources into notebooks">
          <button class="bv" id="lb-del">&#128465;</button>
        </div>
        <div class="lb-sumline" id="lb-sumline">${s.summary ? esc(s.summary) : "<i>No AI summary yet.</i>"}</div>
        <div class="lb-transform">
          <label>Transform &#9998;</label>
          <select id="lb-preset">${PRESETS.map(p => `<option value="${p.id}">${p.label}</option>`).join("")}</select>
          <textarea id="lb-custom" rows="2" style="display:none" placeholder="Describe your transformation… e.g. 'Extract every date and what happened on it'"></textarea>
          <button class="bv" id="lb-go">Run &amp; save as note</button>
          <span id="lb-tstat"></span>
        </div>`;
      const ren = detailEl.querySelector("#lb-rename");
      ren.addEventListener("change", () => { store.updateSource(s.id, { title: ren.value.trim() || s.title }); render(); });
      const nbin = detailEl.querySelector("#lb-nb");
      nbin.addEventListener("change", () => {
        const meta = Object.assign({}, s.meta, { notebook: nbin.value.trim() });
        store.updateSource(s.id, { meta });
        render();
      });
      detailEl.querySelector("#lb-del").addEventListener("mousedown", () => {
        shell.dialog("Delete source", `<span class="x-ic">&#128465;</span><span>Delete "<b>${esc(s.title)}</b>"? Cards generated from it stay.</span>`, ["Delete", "Cancel"], (r) => {
          if (r === "Delete") { store.deleteSource(s.id); selId = null; render(); }
        });
      });
      const presetSel = detailEl.querySelector("#lb-preset");
      const customBox = detailEl.querySelector("#lb-custom");
      presetSel.addEventListener("change", () => { customBox.style.display = presetSel.value === "custom" ? "block" : "none"; });
      detailEl.querySelector("#lb-go").addEventListener("mousedown", () => runTransform(s));
    }

    async function ensureSummary(s, statEl) {
      if (s.summary) return s.summary;
      if (statEl) statEl.textContent = "Summarizing…";
      try {
        const sum = await ai.ensureSummary(s.id);
        if (statEl) statEl.textContent = "";
        render();
        return sum;
      } catch (e) {
        if (statEl) statEl.textContent = "⚠ " + e.message;
        return "";
      }
    }

    async function runTransform(s) {
      const tstat = document.getElementById("lb-tstat");
      const goBtn = document.getElementById("lb-go");
      const preset = PRESETS.find(p => p.id === (document.getElementById("lb-preset") || {}).value);
      if (!preset) return;
      let task = preset.task;
      if (preset.id === "custom") {
        task = (document.getElementById("lb-custom").value || "").trim();
        if (!task) { tstat.textContent = "Describe the transformation first."; return; }
      }
      // make sure we have a summary for big docs — prepend it as orientation
      const sumStat = tstat;
      await ensureSummary(s, sumStat).catch(() => {});
      const fresh = store.getSource(s.id);
      const instr = (store.getSettings().instructions || "").trim();
      const prompt = `You are a study assistant helping a student work on their own material.` +
        (instr ? `\nStudent context: ${instr}.` : "") +
        `\nApply this transformation:\nTASK: ${task}\n\nSOURCE TITLE: ${fresh.title}\n${fresh.summary ? "SOURCE SUMMARY (for orientation):\n" + fresh.summary + "\n" : ""}SOURCE TEXT:\n"""${(fresh.text || "").slice(0, 30000)}"""\n\nOutput the transformation result directly — no preamble, no markdown fences.`;
      goBtn.disabled = true;
      tstat.textContent = "Working…";
      try {
        const out = await ai.text(prompt);
        const paras = String(out || "").split(/\n{2,}/).map(p => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>").join("");
        const note = store.addNote({ title: preset.label + " — " + fresh.title, body: paras });
        tstat.textContent = "Saved ✓";
        goBtn.disabled = false;
        setStatus(`Transformation "${preset.label}" saved as note.`);
        if (window.NBNotes) window.NBNotes.open();
        void note;
      } catch (e) {
        tstat.textContent = "⚠ " + (e.message || "failed");
        goBtn.disabled = false;
      }
    }

    /* ---------- adding sources ---------- */
    function addAndSelect(s) { selId = s.id; render(); setStatus(`Added "${s.title}".`); }

    function pasteDialog() {
      shell.dialog("Paste text",
        `<span class="x-ic">&#128238;</span><span>Paste study material below.</span><br>
         <label style="font-size:11px;display:block;margin-top:6px">Title</label>
         <input id="lb-pt" class="fc-input" style="width:100%" placeholder="Lecture 4 notes">
         <textarea id="lb-pa" rows="9" style="width:100%;box-sizing:border-box;margin-top:6px;font:12px Consolas,monospace;resize:vertical"></textarea>`,
        ["Add", "Cancel"], (r) => {
          if (r !== "Add") return;
          const txt = (document.getElementById("lb-pa").value || "").trim();
          if (!txt) return;
          const t = (document.getElementById("lb-pt").value || "").trim();
          addAndSelect(store.addSource({ title: t || "Pasted text", text: txt, kind: "text" }));
        });
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
          if (!r.text) { setStatus(`⚠ "${f.name}" produced no extractable text.`); continue; }
          addAndSelect(store.addSource({ title: f.name.replace(/\.[^.]+$/, ""), text: r.text, kind: r.kind }));
        } catch (e) { setStatus(`⚠ "${f.name}": ${e.message}`); }
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

    function urlDialog() {
      shell.dialog("Import from URL",
        `<span class="x-ic">&#127760;</span><span>Fetch a web article as a source (best effort — some sites block robots).</span><br>
         <input id="lb-url" class="fc-input" style="width:100%;margin-top:8px" placeholder="https://example.com/article">`,
        ["Import", "Cancel"], (r) => {
          if (r !== "Import") return;
          const u = (document.getElementById("lb-url").value || "").trim();
          if (!u) return;
          setStatus("Fetching page…");
          NBIngest.readUrl(u).then(res => {
            addAndSelect(store.addSource({ title: res.title, text: res.text, kind: "url", meta: { url: u } }));
          }).catch(e => setStatus("⚠ " + e.message));
        });
    }

    function ytDialog() {
      shell.dialog("YouTube transcript",
        `<span class="x-ic">&#9654;</span><span>On YouTube: <b>…more</b> → <b>Show transcript</b> → select-all, copy, paste here. Timestamps are cleaned automatically.</span><br>
         <label style="font-size:11px;display:block;margin-top:6px">Title</label>
         <input id="lb-yt" class="fc-input" style="width:100%" placeholder="Khan Academy — Photosynthesis">
         <textarea id="lb-yta" rows="9" style="width:100%;box-sizing:border-box;margin-top:6px;font:12px Consolas,monospace;resize:vertical" placeholder="0:00&#10;welcome back everyone…&#10;0:07&#10;today we…"></textarea>`,
        ["Clean & add", "Cancel"], (r) => {
          if (r !== "Clean & add") return;
          const raw = (document.getElementById("lb-yta").value || "").trim();
          if (!raw) return;
          const clean = NBIngest.cleanTranscript(raw);
          if (!clean) { setStatus("⚠ Nothing left after cleaning."); return; }
          const t = (document.getElementById("lb-yt").value || "").trim();
          addAndSelect(store.addSource({ title: t || "YouTube transcript", text: clean, kind: "yt" }));
        });
    }

    /* ---------- wiring ---------- */
    el.querySelector("#lb-add-paste").addEventListener("mousedown", (e) => { e.stopPropagation(); pasteDialog(); });
    el.querySelector("#lb-add-file").addEventListener("mousedown", (e) => { e.stopPropagation(); fileEl.click(); });
    el.querySelector("#lb-add-url").addEventListener("mousedown", (e) => { e.stopPropagation(); urlDialog(); });
    el.querySelector("#lb-add-yt").addEventListener("mousedown", (e) => { e.stopPropagation(); ytDialog(); });
    el.querySelector("#lb-key").addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (window.NBFlashcards && NBFlashcards.settingsDialog) NBFlashcards.settingsDialog();
    });
    fileEl.addEventListener("change", () => { if (fileEl.files.length) uploadFiles([...fileEl.files]); fileEl.value = ""; });
    searchEl.addEventListener("input", render);
    nbSel.addEventListener("change", render);

    /* ---------- menus ---------- */
    const menubar = el.querySelector(".menubar");
    menu(el, menubar, [
      { label: "File", items: [
        { label: "Paste text…", action: pasteDialog },
        { label: "Upload files…", action: () => fileEl.click() },
        { label: "From URL…", action: urlDialog },
        { label: "YouTube transcript…", action: ytDialog },
      ]},
      { label: "Help", items: [
        { label: "About Source Library", action: () => shell.dialog("About Source Library",
          `<span class="x-ic">&#128193;</span><span>Your research hub. Every source you add is shared by Flashcards, Chat, Study Guide and Audio Overview. Tag sources with a <b>Notebook</b> name to group them, generate summaries, and run one-click AI transformations that save as notes.</span>`) },
      ]},
    ]);

    render();
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

  const app = { title: "Sources", iconClass: "sources", open };
  window.NBLibrary = app;
  if (window.NBApp) window.NBApp.register("library", app);
})();
