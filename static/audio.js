/* ============================================================
   Notebox XP — Audio Overview
   Turns your sources into a two-host podcast script (Gemini)
   and plays it aloud with free neural voices built into the
   browser (speechSynthesis). Zero cost, zero server.
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  const store = window.NB && window.NB.store;
  const ai = window.NB && window.NB.ai;
  if (!shell || !store || !ai) { window.NBAudio = { open: () => {} }; return; }

  const esc = (s) => shell.esc(s == null ? "" : s);

  const STYLES = [
    { id: "friendly", label: "Friendly co-hosts", desc: "warm, curious, occasionally funny" },
    { id: "prof", label: "Professor & student", desc: "one explains, one asks the questions you'd ask" },
    { id: "debate", label: "Point & counterpoint", desc: "the two hosts stress-test the material against each other" },
  ];
  const LENGTHS = [
    { id: "s", label: "Short (~2 min)", words: 320 },
    { id: "m", label: "Medium (~4 min)", words: 640 },
    { id: "l", label: "Long (~8 min)", words: 1250 },
  ];

  let win = null, curId = null;

  function open() {
    if (win && document.body.contains(win.el)) { win.el.classList.add("focus"); win.el.style.zIndex = 9999; return; }
    win = shell.win({
      title: "Audio Overview",
      width: 860, height: 560,
      app: "audio",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><rect x='5' y='5' width='24' height='24' rx='3' fill='%23fff7e6' stroke='%23c9a86a' stroke-width='1.6'/><path d='M11 20v-6M15 22v-10M19 21v-8M23 19v-4' stroke='%232a6fd6' stroke-width='2' stroke-linecap='round'/></svg>`),
      menubar: shell.menu("File", "Help"),
      statusbar: '<div id="ao-status">Your sources, on air.</div>',
      body: `<div id="ao-app" class="ao-app">
        <div class="ao-side">
          <div class="ao-side-head"><button class="bv" id="ao-new">&#10133; New overview</button></div>
          <div id="ao-form" class="ao-form">
            <div class="ao-f-lbl">Sources</div>
            <div class="ao-srcs" id="ao-srcs"></div>
            <div class="ao-row"><div><div class="ao-f-lbl">Host 1</div><input id="ao-h1" value="Alex"></div>
            <div><div class="ao-f-lbl">Host 2</div><input id="ao-h2" value="Sam"></div></div>
            <div class="ao-f-lbl">Style</div>
            <select id="ao-style">${STYLES.map(s => `<option value="${s.id}">${s.label}</option>`).join("")}</select>
            <div class="ao-f-lbl">Length</div>
            <select id="ao-len">${LENGTHS.map(l => `<option value="${l.id}"${l.id === "m" ? " selected" : ""}>${l.label}</option>`).join("")}</select>
            <button class="bv ao-gen" id="ao-gen">&#127908; Generate script</button>
          </div>
          <div class="ao-saved-head">Saved overviews</div>
          <div class="ao-list" id="ao-list"></div>
        </div>
        <div class="ao-main">
          <div class="ao-player">
            <button class="bv" id="ao-play">&#9654; Play</button>
            <button class="bv" id="ao-stop">&#9209; Stop</button>
            <label class="ao-rate-l">Speed</label>
            <input type="range" id="ao-rate" min="0.7" max="1.4" step="0.05" value="1">
            <span style="flex:1"></span>
            <span class="ao-vwrap"><label>Voice 1</label><select id="ao-v1"></select></span>
            <span class="ao-vwrap"><label>Voice 2</label><select id="ao-v2"></select></span>
          </div>
          <div class="ao-script" id="ao-script">
            <div class="ao-welcome">Pick sources on the left and hit <b>Generate script</b>. Then press play — your own podcast, free forever.</div>
          </div>
        </div>
      </div>`,
      onOpen: (el) => init(el),
    });
  }

  function init(el) {
    const srcsBox = el.querySelector("#ao-srcs");
    const listBox = el.querySelector("#ao-list");
    const scriptEl = el.querySelector("#ao-script");
    const status = el.querySelector("#ao-status");
    const playBtn = el.querySelector("#ao-play");
    const stopBtn = el.querySelector("#ao-stop");
    const rateEl = el.querySelector("#ao-rate");
    const v1El = el.querySelector("#ao-v1");
    const v2El = el.querySelector("#ao-v2");
    let picked = [];       // source ids for next generation
    let cur = null;        // loaded overview record
    let lines = [];        // current script lines
    let playIdx = -1, playing = false;

    /* ---------- voices ---------- */
    function fillVoices() {
      const vs = (window.speechSynthesis ? speechSynthesis.getVoices() : [])
        .filter(v => /^en/i.test(v.lang));
      const nice = vs.slice().sort((a, b) =>
        (b.name.includes("Natural") - a.name.includes("Natural")) || a.name.localeCompare(b.name));
      const opt = (sel) => sel.innerHTML = nice.length
        ? nice.map((v, i) => `<option value="${i}">${esc(v.name)}</option>`).join("")
        : `<option value="-1">Default voice</option>`;
      opt(v1El); opt(v2El);
    }
    if (window.speechSynthesis) {
      fillVoices();
      speechSynthesis.onvoiceschanged = fillVoices;
    } else {
      v1El.innerHTML = v2El.innerHTML = `<option value="-1">No TTS available</option>`;
    }
    const voiceAt = (sel) => {
      const vs = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
      return vs[+sel.value] || null;
    };
    v1El.addEventListener("change", () => { stop(); });
    v2El.addEventListener("change", () => { stop(); });

    /* ---------- source picker ---------- */
    function renderSrcs() {
      const all = store.listSources();
      srcsBox.innerHTML = all.length ? all.map(s =>
        `<label class="ao-ck${picked.includes(s.id) ? " on" : ""}">
           <input type="checkbox" data-id="${s.id}" ${picked.includes(s.id) ? "checked" : ""}>
           ${s.summary ? "&#10003;" : "&#128218;"} ${esc(s.title.slice(0, 26))}</label>`).join("")
        : `<div class="ao-empty">No sources yet — add them in the Source Library.</div>`;
      srcsBox.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
        const id = cb.dataset.id;
        if (cb.checked) { if (!picked.includes(id)) picked = picked.concat(id); }
        else { picked = picked.filter(x => x !== id); }
        renderSrcs();
      }));
    }

    /* ---------- saved list ---------- */
    function renderList() {
      const all = store.listAudio();
      listBox.innerHTML = all.length ? all.map(a =>
        `<div class="ao-li${cur && a.id === cur.id ? " sel" : ""}" data-id="${a.id}">
           <span class="ao-li-t">${esc(a.title)}</span>
           <button class="ao-li-x" data-id="${a.id}" title="Delete">&#10005;</button></div>`).join("")
        : `<div class="ao-empty">None yet.</div>`;
      listBox.querySelectorAll(".ao-li").forEach(li => li.addEventListener("mousedown", (e) => {
        if (e.target.closest(".ao-li-x")) return;
        load(li.dataset.id);
      }));
      listBox.querySelectorAll(".ao-li-x").forEach(b => b.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        if (cur && cur.id === b.dataset.id) stop();
        store.deleteAudio(b.dataset.id);
        if (cur && cur.id === b.dataset.id) cur = null;
        renderList(); renderScript();
      }));
    }

    /* ---------- script rendering ---------- */
    function renderScript() {
      const d = cur && cur.data;
      if (!d || !d.lines || !d.lines.length) {
        scriptEl.innerHTML = `<div class="ao-welcome">Pick sources on the left and hit <b>Generate script</b>. Then press play — your own podcast, free forever.</div>`;
        return;
      }
      const hosts = (cur.opts && cur.opts.hosts) || ["Host 1", "Host 2"];
      scriptEl.innerHTML = `<div class="ao-title">${esc(d.title || "Audio overview")}</div>` +
        d.lines.map((ln, i) =>
          `<div class="ao-line" data-i="${i}"><span class="ao-host h-${hosts.indexOf(ln.host) === 0 ? "a" : "b"}">${esc(ln.host)}</span><span class="ao-text">${esc(ln.text)}</span></div>`
        ).join("");
      lines = d.lines;
      scriptEl.querySelectorAll(".ao-line").forEach(div => div.addEventListener("dblclick", () => {
        play(+div.dataset.i);
      }));
    }

    function markLine(i) {
      scriptEl.querySelectorAll(".ao-line").forEach(d => d.classList.toggle("now", +d.dataset.i === i));
      const el = scriptEl.querySelector(`.ao-line[data-i="${i}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    /* ---------- playback ---------- */
    function setPlayBtn(txt) { playBtn.innerHTML = txt; }
    function stop() {
      playing = false; playIdx = -1;
      if (window.speechSynthesis) speechSynthesis.cancel();
      setPlayBtn("&#9654; Play");
      scriptEl.querySelectorAll(".ao-line.now").forEach(d => d.classList.remove("now"));
      status.textContent = "Stopped.";
    }
    function speakFrom(i) {
      if (!lines.length) { status.textContent = "Generate or load a script first."; return; }
      if (playing && playIdx === i) {
        // toggle pause/resume
        if (speechSynthesis.paused) { speechSynthesis.resume(); setPlayBtn("&#9208; Pause"); }
        else { speechSynthesis.pause(); setPlayBtn("&#9654; Resume"); }
        return;
      }
      speechSynthesis.cancel();
      playing = true;
      setPlayBtn("&#9208; Pause");
      speakLine(i);
    }
    function speakLine(i) {
      if (!playing || i >= lines.length) { stop(); if (lines.length && i >= lines.length) status.textContent = "Episode finished ✓"; return; }
      playIdx = i;
      markLine(i);
      const ln = lines[i];
      const hosts = (cur.opts && cur.opts.hosts) || [];
      const first = hosts.indexOf(ln.host) === 0;
      const u = new SpeechSynthesisUtterance(ln.text);
      const v = voiceAt(first ? v1El : v2El);
      if (v) u.voice = v;
      u.rate = parseFloat(rateEl.value) || 1;
      u.pitch = first ? 0.95 : 1.08;
      u.onend = () => { if (playing) speakLine(i + 1); };
      u.onerror = () => { if (playing) speakLine(i + 1); };
      speechSynthesis.speak(u);
      status.textContent = `Playing line ${i + 1}/${lines.length} — double-click any line to jump there.`;
    }

    playBtn.addEventListener("mousedown", (e) => { e.stopPropagation(); if (!lines.length) { status.textContent = "Generate or load a script first."; return; } speakFrom(playIdx < 0 ? 0 : playIdx); });
    stopBtn.addEventListener("mousedown", (e) => { e.stopPropagation(); stop(); });

    /* ---------- generation ---------- */
    async function generate() {
      if (!picked.length) { status.textContent = "Pick at least one source."; return; }
      const h1 = (el.querySelector("#ao-h1").value || "Alex").trim().slice(0, 18);
      const h2 = (el.querySelector("#ao-h2").value || "Sam").trim().slice(0, 18);
      const style = STYLES.find(s => s.id === el.querySelector("#ao-style").value);
      const len = LENGTHS.find(l => l.id === el.querySelector("#ao-len").value);
      const genBtn = el.querySelector("#ao-gen");
      genBtn.disabled = true;
      status.textContent = "Writing the episode… (this can take a minute)";
      try {
        const parts = [];
        for (const id of picked) {
          const s = store.getSource(id);
          if (!s) continue;
          const body = s.summary ? "SUMMARY:\n" + s.summary : "EXCERPT:\n" + (s.text || "").slice(0, 6000);
          parts.push(`[${s.title}]\n${body}`);
        }
        const instr = (store.getSettings().instructions || "").trim();
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

        const data = await ai.json(prompt, "podcast script");
        const outLines = (data && Array.isArray(data.lines) ? data.lines : [])
          .filter(l => l && l.text)
          .map((l, idx) => ({ host: [h1, h2].includes(l.host) ? l.host : (idx % 2 === 0 ? h1 : h2), text: String(l.text).trim() }));
        if (!outLines.length) throw new Error("The model returned no usable script.");
        cur = store.addAudio({
          title: (data && data.title) || pickedTitle(),
          sourceIds: picked.slice(),
          data: { title: (data && data.title) || "Audio overview", lines: outLines },
          opts: { hosts: [h1, h2], style: style.id, length: len.id },
        });
        lines = outLines;
        stop();
        renderList(); renderScript();
        status.textContent = `Episode ready ✓ — press Play (${outLines.length} lines).`;
      } catch (e) {
        status.textContent = "⚠ " + (e.message || "Generation failed.");
      } finally {
        genBtn.disabled = false;
      }
    }
    function pickedTitle() {
      const s = store.getSource(picked[0]);
      return s ? s.title.slice(0, 48) : "Audio overview";
    }

    function load(id) {
      stop();
      cur = store.getAudio(id);
      if (!cur) return;
      renderList(); renderScript();
      status.textContent = `Loaded "${cur.title}".`;
    }

    function newForm() {
      stop(); cur = null; lines = [];
      renderList(); renderScript();
      status.textContent = "New overview — pick sources and generate.";
    }

    function exportTxt() {
      if (!cur || !cur.data) { status.textContent = "Nothing to export."; return; }
      const t = cur.data.title + "\n\n" + cur.data.lines.map(l => l.host.toUpperCase() + ": " + l.text).join("\n\n");
      const a = document.createElement("a");
      a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(t);
      a.download = (cur.data.title || "overview").replace(/[^\w\-]+/g, "_") + ".txt";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }

    el.querySelector("#ao-new").addEventListener("mousedown", (e) => { e.stopPropagation(); newForm(); });
    el.querySelector("#ao-gen").addEventListener("mousedown", (e) => { e.stopPropagation(); generate(); });

    const menubar = el.querySelector(".menubar");
    menu(el, menubar, [
      { label: "File", items: [
        { label: "New overview", action: newForm },
        { label: "Export script (.txt)", action: exportTxt },
        { label: "Delete current", action: () => { if (cur) { stop(); store.deleteAudio(cur.id); cur = null; renderList(); renderScript(); } } },
      ]},
      { label: "Help", items: [
        { label: "About Audio Overview", action: () => shell.dialog("About Audio Overview",
          `<span class="x-ic">&#127908;</span><span>Turn your sources into a two-host podcast episode. Scripts are written by Gemini and read aloud with the free neural voices already installed in your browser — no paid TTS, ever. Double-click a line to start playback from there.</span>`) },
      ]},
    ]);

    renderSrcs();
    const first = store.listAudio()[0];
    if (first) load(first.id);
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

  const app = { title: "Audio Overview", iconClass: "audio", open };
  window.NBAudio = app;
  if (window.NBApp) window.NBApp.register("audio", app);
})();
