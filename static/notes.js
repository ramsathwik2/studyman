/* ============================================================
   Notebox XP — Cozy Notes
   A warm, paper-like notebook: rich text, highlight colors,
   margin annotations, autosave, multiple notes.
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  const store = window.NB && window.NB.store;
  if (!shell || !store) { window.NBNotes = { open: () => {} }; return; }

  const esc = (s) => shell.esc(s == null ? "" : s);

  const HL = [
    { c: "#fff3a3", n: "Yellow" },
    { c: "#ffd6a5", n: "Peach" },
    { c: "#caffbf", n: "Mint" },
    { c: "#a0e7ff", n: "Sky" },
    { c: "#ffadad", n: "Rose" },
    { c: "#e0c3fc", n: "Lilac" },
  ];
  const TX = [
    "#222222", "#b32020", "#1f7a1f", "#0b51a8", "#6b2fb3", "#a85800",
  ];

  let win = null, curId = null, saveT = null;

  function open() {
    if (win && document.body.contains(win.el)) { focus(win); return; }
    win = shell.win({
      title: "Notes - Cozy Notebook",
      width: 880, height: 560,
      app: "notes",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><rect x='6' y='3' width='22' height='28' rx='2' fill='%23fff7e6' stroke='%23c9a86a' stroke-width='1.6'/><rect x='6' y='3' width='22' height='6' rx='2' fill='%23ffe1a8'/><line x1='10' y1='15' x2='24' y2='15' stroke='%23c9a86a'/><line x1='10' y1='20' x2='24' y2='20' stroke='%23c9a86a'/><line x1='10' y1='25' x2='20' y2='25' stroke='%23c9a86a'/></svg>`),
      menubar: shell.menu("File", "Edit", "Format", "Insert", "Help"),
      body: `<div id="nt-app" class="nt-app">
        <div class="nt-side">
          <div class="nt-side-head"><button class="bv" id="nt-new">&#10133; New note</button></div>
          <div class="nt-list" id="nt-list"></div>
        </div>
        <div class="nt-main">
          <div class="nt-titlebar">
            <input id="nt-title" class="nt-title" placeholder="Title your note…" maxlength="120">
          </div>
          <div class="nt-toolbar" id="nt-toolbar">
            <button class="nt-tb" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
            <button class="nt-tb" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
            <button class="nt-tb" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
            <button class="nt-tb" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
            <span class="nt-sep"></span>
            <button class="nt-tb" data-cmd="h1" title="Heading 1">H1</button>
            <button class="nt-tb" data-cmd="h2" title="Heading 2">H2</button>
            <button class="nt-tb" data-cmd="quote" title="Quote">&#8220;</button>
            <span class="nt-sep"></span>
            <button class="nt-tb" data-cmd="insertUnorderedList" title="Bulleted list">&#8226;</button>
            <button class="nt-tb" data-cmd="insertOrderedList" title="Numbered list">1.</button>
            <span class="nt-sep"></span>
            <span class="nt-lbl">Highlight</span>
            ${HL.map(h => `<button class="nt-sw" data-hl="${h.c}" title="${esc(h.n)}" style="background:${h.c}"></button>`).join("")}
            <button class="nt-tb" id="nt-clr" title="Clear highlight">&#10005;</button>
            <span class="nt-sep"></span>
            <span class="nt-lbl">Text</span>
            ${TX.map(c => `<button class="nt-sw" data-tx="${c}" title="${esc(c)}" style="background:${c}"></button>`).join("")}
            <span class="nt-sep"></span>
            <button class="nt-tb nt-annotate" id="nt-annotate" title="Annotate selection">&#128172; Note</button>
            <button class="nt-tb" data-cmd="removeFormat" title="Clear formatting">&#9852;</button>
          </div>
          <div class="nt-editwrap">
            <div id="nt-editor" class="nt-editor" contenteditable="true" spellcheck="true"></div>
            <div class="nt-ann" id="nt-ann">
              <div class="nt-ann-head">Margin notes <span id="nt-ann-count" class="nt-badge">0</span></div>
              <div class="nt-ann-list" id="nt-ann-list"></div>
            </div>
          </div>
          <div class="nt-status" id="nt-status">Cozy and ready.</div>
        </div>
      </div>`,
      onOpen: (el) => init(el),
    });
  }

  function focus(w) { w.el.classList.add("focus"); w.el.style.zIndex = 9999; }

  function init(el) {
    const editor = el.querySelector("#nt-editor");
    const title = el.querySelector("#nt-title");
    const list = el.querySelector("#nt-list");
    const status = el.querySelector("#nt-status");
    const toolbar = el.querySelector("#nt-toolbar");

    const setStatus = (s) => { status.textContent = s; };

    /* ---- note list ---- */
    function renderList() {
      const notes = store.listNotes();
      list.innerHTML = notes.length
        ? notes.map(n => {
            const preview = (n.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
            const d = new Date(n.updated);
            const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            return `<div class="nt-li${n.id === curId ? " sel" : ""}" data-id="${n.id}">
              <div class="nt-li-t">${esc(n.title || "Untitled note")}</div>
              <div class="nt-li-p">${esc(preview || "Empty page…")}</div>
              <div class="nt-li-d">${when}${n.annotations && n.annotations.length ? " · &#128172;" + n.annotations.length : ""}</div>
            </div>`;
          }).join("")
        : `<div class="nt-empty">No notes yet.<br>Click <b>+ New note</b> to begin.</div>`;
      list.querySelectorAll(".nt-li").forEach(li => li.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        loadNote(li.dataset.id);
      }));
    }

    function loadNote(id) {
      const n = store.getNote(id);
      if (!n) return;
      if (curId && curId !== id) flush();
      curId = id;
      title.value = n.title || "";
      editor.innerHTML = n.body || "";
      renderAnn(n.annotations || []);
      renderList();
      setStatus("Opened · saved automatically.");
    }

    function newNote() {
      flush();
      const n = store.addNote({ title: "Untitled note", body: "" });
      curId = n.id;
      title.value = "";
      editor.innerHTML = "";
      renderAnn([]);
      renderList();
      title.focus();
      setStatus("New cozy page.");
    }

    function flush() {
      if (!curId) return;
      const n = store.getNote(curId);
      if (!n) return;
      const body = editor.innerHTML;
      const t = title.value.trim() || "Untitled note";
      if (n.body !== body || n.title !== t) {
        store.updateNote(curId, { title: t, body });
      }
    }

    /* ---- autosave ---- */
    function scheduleSave() {
      setStatus("Editing…");
      clearTimeout(saveT);
      saveT = setTimeout(() => {
        if (!curId) return;
        flush();
        renderList();
        setStatus("Saved ✓");
      }, 600);
    }

    editor.addEventListener("input", scheduleSave);
    title.addEventListener("input", scheduleSave);

    /* ---- toolbar commands ---- */
    toolbar.querySelectorAll(".nt-tb[data-cmd]").forEach(b => b.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const cmd = b.dataset.cmd;
      editor.focus();
      if (cmd === "h1") document.execCommand("formatBlock", false, "H2");
      else if (cmd === "h2") document.execCommand("formatBlock", false, "H3");
      else if (cmd === "quote") document.execCommand("formatBlock", false, "BLOCKQUOTE");
      else document.execCommand(cmd, false, null);
      scheduleSave();
    }));
    toolbar.querySelectorAll(".nt-sw[data-hl]").forEach(b => b.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      editor.focus();
      document.execCommand("hiliteColor", false, b.dataset.hl);
      scheduleSave();
    }));
    toolbar.querySelector("#nt-clr").addEventListener("mousedown", (e) => {
      e.stopPropagation(); editor.focus();
      try { document.execCommand("hiliteColor", false, "transparent"); } catch (_) {}
      document.execCommand("removeFormat", false, null);
      scheduleSave();
    });
    toolbar.querySelectorAll(".nt-sw[data-tx]").forEach(b => b.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      editor.focus();
      document.execCommand("foreColor", false, b.dataset.tx);
      scheduleSave();
    }));

    /* ---- annotations ---- */
    function renderAnn(anns) {
      const n = store.getNote(curId);
      const listEl = el.querySelector("#nt-ann-list");
      const badge = el.querySelector("#nt-ann-count");
      const arr = (n && n.annotations) || anns || [];
      badge.textContent = arr.length;
      listEl.innerHTML = arr.length
        ? arr.map(a => `<div class="nt-anno" data-aid="${a.id}">
            <div class="nt-anno-q">“${esc((a.quote || "").slice(0, 60))}”</div>
            <div class="nt-anno-b">${esc(a.text)}</div>
            <button class="nt-anno-del" data-aid="${a.id}" title="Delete">&#10005;</button>
          </div>`).join("")
        : `<div class="nt-anno-empty">Select some text, then click <b>&#128172; Note</b> to leave a margin comment.</div>`;
      listEl.querySelectorAll(".nt-anno").forEach(card => card.addEventListener("mousedown", (e) => {
        if (e.target.closest(".nt-anno-del")) return;
        const span = editor.querySelector(`.nt-anno-mark[data-aid="${card.dataset.aid}"]`);
        if (span) { span.scrollIntoView({ block: "center", behavior: "smooth" }); flash(span); }
      }));
      listEl.querySelectorAll(".nt-anno-del").forEach(b => b.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const id = b.dataset.aid;
        const note = store.getNote(curId);
        if (note) store.updateNote(curId, { annotations: note.annotations.filter(a => a.id !== id) });
        editor.querySelectorAll(`.nt-anno-mark[data-aid="${id}"]`).forEach(s => {
          const p = s.parentNode; while (s.firstChild) p.insertBefore(s.firstChild, s); p.removeChild(s);
        });
        renderAnn((store.getNote(curId) || {}).annotations);
        scheduleSave();
      }));
    }

    function flash(span) {
      span.classList.add("flash");
      setTimeout(() => span.classList.remove("flash"), 900);
    }

    function addAnnotation() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setStatus("Select some text first, then click Note.");
        return;
      }
      const range = sel.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        setStatus("Selection must be inside the note.");
        return;
      }
      const quote = sel.toString().trim();
      if (!quote) return;
      shell.dialog("Add a margin note",
        `<span class="x-ic">&#128172;</span><span>Attach a cozy note to:</span><br>
         <div style="background:#fff7e6;border-left:3px solid #ffc24a;padding:6px 8px;margin:8px 0;font-style:italic;font-size:11px">“${esc(quote.slice(0, 120))}”</div>
         <textarea id="nt-anno-text" class="fc-input" style="width:100%;height:74px;resize:none" placeholder="Your thought, question, or reminder…"></textarea>`,
        ["Save note", "Cancel"], (r) => {
          if (r !== "Save note") return;
          const ta = document.getElementById("nt-anno-text");
          const text = (ta && ta.value || "").trim();
          if (!text) return;
          const note = store.getNote(curId) || store.addNote({ title: title.value, body: editor.innerHTML });
          curId = note.id;
          const aid = store.uid();
          const ann = { id: aid, quote, text, at: Date.now() };
          const anns = note.annotations ? note.annotations.concat(ann) : [ann];
          store.updateNote(curId, { annotations: anns });
          // wrap selection in a mark
          const mark = document.createElement("span");
          mark.className = "nt-anno-mark";
          mark.dataset.aid = aid;
          mark.title = text;
          try { range.surroundContents(mark); }
          catch (_) { mark.appendChild(range.extractContents()); range.insertNode(mark); }
          renderAnn(anns);
          scheduleSave();
          setStatus("Margin note added ✓");
        });
    }
    el.querySelector("#nt-annotate").addEventListener("mousedown", (e) => { e.stopPropagation(); addAnnotation(); });

    /* ---- new note ---- */
    el.querySelector("#nt-new").addEventListener("mousedown", (e) => { e.stopPropagation(); newNote(); });

    /* ---- click a highlight mark to peek ---- */
    editor.addEventListener("mouseup", () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) setStatus(`${sel.toString().length} chars selected — highlight or Note it.`);
    });

    /* ---- menus ---- */
    const menubar = el.querySelector(".menubar");
    menu(el, menubar, [
      { label: "File", items: [
        { label: "New note", action: newNote },
        { label: "Delete note", action: () => {
          if (!curId) return;
          shell.dialog("Delete note", `<span class="x-ic">&#9888;</span><span>Delete this note permanently?</span>`, ["Delete", "Cancel"], (r) => {
            if (r !== "Delete") return;
            const id = curId; curId = null; store.deleteNote(id);
            const first = store.listNotes()[0];
            renderList();
            if (first) loadNote(first.id); else { title.value = ""; editor.innerHTML = ""; renderAnn([]); }
          });
        } },
        { sep: true },
        { label: "Export note (.txt)", action: () => exportTxt() },
      ]},
      { label: "Edit", items: [
        { label: "Undo", action: () => document.execCommand("undo") },
        { label: "Redo", action: () => document.execCommand("redo") },
        { label: "Select all", action: () => { editor.focus(); document.execCommand("selectAll"); } },
        { label: "Clear formatting", action: () => { editor.focus(); document.execCommand("removeFormat"); } },
      ]},
      { label: "Format", items: [
        { label: "Heading 1", action: () => { editor.focus(); document.execCommand("formatBlock", false, "H2"); } },
        { label: "Heading 2", action: () => { editor.focus(); document.execCommand("formatBlock", false, "H3"); } },
        { label: "Quote", action: () => { editor.focus(); document.execCommand("formatBlock", false, "BLOCKQUOTE"); } },
        { label: "Bulleted list", action: () => { editor.focus(); document.execCommand("insertUnorderedList"); } },
        { label: "Numbered list", action: () => { editor.focus(); document.execCommand("insertOrderedList"); } },
      ]},
      { label: "Insert", items: [
        { label: "From a study source…", action: () => importSource() },
        { label: "Today's date", action: () => { editor.focus(); document.execCommand("insertText", false, new Date().toLocaleDateString()); } },
      ]},
      { label: "Help", items: [
        { label: "About Cozy Notes", action: () => shell.dialog("About Cozy Notes", `<span class="x-ic">&#128172;</span><span>A warm little notebook: write, highlight in six colors, and pin margin notes to any sentence. Everything saves itself.</span>`) },
      ]},
    ]);

    function importSource() {
      const srcs = store.listSources();
      if (!srcs.length) { shell.dialog("No sources", `<span class="x-ic">&#128193;</span><span>Add a source in Flashcards first, then come back to quote it here.</span>`); return; }
      const opts = srcs.map(s => `<button class="bv ft-item" data-i="${s.id}" style="width:100%;text-align:left;margin:3px 0">${esc(s.title)}</button>`).join("");
      shell.dialog("Insert from source", `<span class="x-ic">&#128218;</span><span>Pick a source to drop into a new note:</span><br>${opts}`, [], () => {});
      const box = document.getElementById("xdialog-msg");
      if (box) box.querySelectorAll(".ft-item").forEach(b => b.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        const s = store.getSource(b.dataset.i);
        const dlg = document.getElementById("xdialog"); if (dlg) dlg.hidden = true;
        if (!s) return;
        newNote();
        title.value = s.title;
        editor.innerHTML = `<h2>${esc(s.title)}</h2>\n<p>${esc((s.text || "").slice(0, 4000)).replace(/\n/g, "<br>")}</p>`;
        scheduleSave();
      }));
    }

    function exportTxt() {
      if (!curId) return;
      const n = store.getNote(curId);
      const text = (n.title || "") + "\n\n" + (n.body || "").replace(/<br\s*\/?>(?!)/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n");
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
      a.download = (n.title || "note").replace(/[^\w\-]+/g, "_") + ".txt";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    /* ---- keyboard ---- */
    const kd = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "b") { e.preventDefault(); document.execCommand("bold"); scheduleSave(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "i") { e.preventDefault(); document.execCommand("italic"); scheduleSave(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "u") { e.preventDefault(); document.execCommand("underline"); scheduleSave(); }
      else if (e.ctrlKey && e.key.toLowerCase() === "s") { e.preventDefault(); flush(); setStatus("Saved ✓"); }
    };
    document.addEventListener("keydown", kd);
    window.addEventListener("unload", () => document.removeEventListener("keydown", kd));

    // open first note or start fresh
    const first = store.listNotes()[0];
    if (first) loadNote(first.id); else { renderList(); }
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

  /* ---------- register ---------- */
  const app = { title: "Notes", iconClass: "notes", open };
  window.NBNotes = app;
  if (window.NBApp) window.NBApp.register("notes", app);
})();
