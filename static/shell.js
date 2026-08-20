/* ============================================================
   Windows XP shell — behaviour layer
   pure front-end: no backend, no notebook features
   ============================================================ */
(() => {
  "use strict";

  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- tiny system sounds (WebAudio) ---------- */
  const Sound = (() => {
    let ctx = null, enabled = true;
    const beep = (freq, dur, type = "sine", vol = 0.08, when = 0) => {
      if (!enabled) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, ctx.currentTime + when);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.02);
      } catch (_) {}
    };
    const chord = (notes, dur = 0.5) => notes.forEach((n, i) => beep(n, dur, "sine", 0.06, i * 0.12));
    return {
      toggle: () => (enabled = !enabled, enabled),
      isOn: () => enabled,
      start: () => { if (enabled) chord([523, 659, 784, 1047], 0.9); },
      click: () => beep(1200, 0.03, "square", 0.03),
      error: () => { beep(320, 0.18, "square", 0.06); beep(240, 0.25, "square", 0.06, 0.15); },
      open: () => beep(900, 0.06, "sine", 0.05),
      close: () => beep(600, 0.05, "sine", 0.04),
      shutdown: () => chord([659, 523, 440, 392], 1.2),
    };
  })();

  /* ---------- boot sequence ---------- */
  function boot() {
    const b = $("#boot");
    setTimeout(() => {
      b.classList.add("gone");
      setTimeout(() => b.hidden = true, 750);
      Sound.start();
      openWelcome();
    }, 2300);
  }

  /* ---------- window factory ---------- */
  const Windows = [];
  let zTop = 60, focused = null, drag = null;

  function openWindow(opts) {
    const id = opts.id || ("win-" + Date.now());
    const el = document.createElement("div");
    el.className = "win";
    el.id = id;
    el.dataset.app = opts.app || "app";
    el.style.left = opts.left || (120 + (Windows.length * 26) % 160) + "px";
    el.style.top  = opts.top  || (60 + (Windows.length * 22) % 90) + "px";
    el.style.width = opts.width || 480 + "px";
    el.style.height = opts.height || 340 + "px";

    el.innerHTML = `
      <div class="titlebar">
        <span class="wicon">${opts.icon || ""}</span>
        <span class="wtitle">${escHtml(opts.title || "Window")}</span>
        <div class="winctl">
          <button class="wctl" data-act="min" title="Minimize">_</button>
          <button class="wctl" data-act="max" title="Maximize">&#9633;</button>
          <button class="wctl close" data-act="close" title="Close">&#10005;</button>
        </div>
      </div>
      ${opts.menubar ? `<div class="menubar">${opts.menubar}</div>` : ""}
      ${opts.toolbar ? `<div class="toolbar">${opts.toolbar}</div>` : ""}
      ${opts.addressbar ? `<div class="addressbar">${opts.addressbar}</div>` : ""}
      <div class="wb">${opts.body || ""}</div>
      ${opts.statusbar ? `<div class="statusbar">${opts.statusbar}</div>` : ""}`;

    $("#windows-layer").appendChild(el);

    let state = { el, title: opts.title, icon: opts.icon || "", maximized: false };
    Windows.push(state);

    bindWindowControls(el);
    bindWindowDrag(el, state);
    focusWindow(state);
    addTaskButton(state);

    if (opts.onOpen) opts.onOpen(el, state);
    return state;
  }

  function bindWindowControls(el) {
    $$(".wctl", el).forEach(btn => btn.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const state = Windows.find(w => w.el === el);
      const act = btn.dataset.act;
      Sound.click();
      if (act === "min") minimizeWindow(state);
      else if (act === "max") maximizeWindow(state);
      else if (act === "close") closeWindow(state);
    }));
  }

  function bindWindowDrag(el, state) {
    const bar = $(".titlebar", el);
    if (!bar) return;
    bar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".wctl")) return;
      focusWindow(state);
      if (state.maximized) return;
      drag = { state, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop, moved: false };
      document.body.style.cursor = "move";
    });
  }

  document.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const { state, dx, dy } = drag;
    const h = 30;
    state.el.style.left = Math.max(-state.el.offsetWidth + 60, Math.min(e.clientX - dx, innerWidth - 60)) + "px";
    state.el.style.top  = Math.max(0, Math.min(e.clientY - dy, innerHeight - h)) + "px";
    drag.moved = true;
  });
  document.addEventListener("mouseup", () => {
    if (drag) drag.moved && Sound.click();
    drag = null;
    document.body.style.cursor = "";
  });

  function focusWindow(state) {
    if (focused && focused.el === state.el) return;
    if (focused) focused.el.classList.remove("focus");
    focused = state;
    state.el.classList.add("focus");
    state.el.style.zIndex = ++zTop;
    syncTaskButtons();
  }

  function minimizeWindow(state) {
    state.el.classList.add("minimized");
    if (focused === state) { focused = null; }
    syncTaskButtons();
    Sound.close();
  }

  function maximizeWindow(state) {
    state.maximized = !state.maximized;
    state.el.classList.toggle("maximized", state.maximized);
    if (state.maximized) { state.el.style.zIndex = ++zTop; syncTaskButtons(); }
    Sound.click();
  }

  function closeWindow(state) {
    state.el.remove();
    const i = Windows.indexOf(state);
    if (i >= 0) Windows.splice(i, 1);
    const btn = document.querySelector(`.tbtn[data-id="${state.el.id}"]`);
    if (btn) btn.remove();
    if (focused === state) {
      focused = Windows[Windows.length - 1] || null;
      if (focused) focused.el.classList.add("focus");
    }
    Sound.close();
  }

  /* ---------- taskbar buttons ---------- */
  function addTaskButton(state) {
    const b = document.createElement("button");
    b.className = "tbtn";
    b.dataset.id = state.el.id;
    b.innerHTML = `<span class="ticon">${state.icon || "&#9632;"}</span><span class="tlbl">${escHtml(state.title)}</span>`;
    b.addEventListener("mousedown", () => {
      if (state.el.classList.contains("minimized")) {
        state.el.classList.remove("minimized");
        focusWindow(state);
      } else if (focused === state && !state.maximized) {
        minimizeWindow(state);
      } else {
        focusWindow(state);
      }
    });
    $("#taskbtns").appendChild(b);
  }

  function syncTaskButtons() {
    $$("#taskbtns .tbtn").forEach(b => {
      const st = Windows.find(w => w.el.id === b.dataset.id);
      if (st) b.classList.toggle("act", focused === st && !st.el.classList.contains("minimized"));
    });
  }

  /* ---------- desktop marquee (drag box) ---------- */
  const dbox = $("#dragbox");
  let boxStart = null;

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".dicon") || e.target.closest("#taskbar") ||
        e.target.closest("#windows-layer") || e.target.closest("#start-menu") ||
        e.target.closest(".modal")) return;
    boxStart = { x: e.clientX, y: e.clientY };
  });

  document.addEventListener("mousemove", (e) => {
    if (!boxStart) return;
    const x = Math.min(boxStart.x, e.clientX);
    const y = Math.min(boxStart.y, e.clientY);
    const w = Math.abs(e.clientX - boxStart.x);
    const h = Math.abs(e.clientY - boxStart.y);
    if (w < 3 && h < 3) return;
    dbox.style.left = x + "px";
    dbox.style.top = y + "px";
    dbox.style.width = w + "px";
    dbox.style.height = h + "px";
    dbox.classList.add("on");
    // live-select icons intersecting the box
    $$("#desktop .dicon").forEach(ic => {
      const r = ic.getBoundingClientRect();
      const hit = !(r.right < x || r.left > x + w || r.bottom < y || r.top > y + h);
      ic.classList.toggle("sel", hit);
    });
  });

  document.addEventListener("mouseup", () => {
    if (boxStart) {
      dbox.classList.remove("on");
      boxStart = null;
    }
  });

  /* ---------- desktop icon selection ---------- */
  let selIcon = null;
  $$("#desktop .dicon").forEach(ic => {
    ic.addEventListener("mousedown", (e) => {
      Sound.click();
      $$("#desktop .dicon").forEach(x => x.classList.remove("sel"));
      ic.classList.add("sel");
      selIcon = ic;
      e.stopPropagation();
    });
    ic.addEventListener("dblclick", () => openFromIcon(ic.dataset.name));
    ic.addEventListener("contextmenu", (e) => showContextMenu(e, iconMenu(ic)));
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#desktop .dicon")) {
      $$("#desktop .dicon").forEach(x => x.classList.remove("sel"));
      selIcon = null;
    }
  });

  function openFromIcon(name) {
    Sound.open();
    const map = {
      "My Documents": () => openWindow({ title: "My Documents", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Cpath fill=\'%23fbd050\' stroke=\'%23c98a00\' d=\'M3 8h11l3 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>', width: 560, height: 380,
        statusbar: '<div>My Documents is empty.</div>',
        body: '<div style="padding:16px;font-size:12px;color:#555">No documents.</div>' }),
      "My Computer": () => openWindow({ title: "My Computer", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Crect x=\'5\' y=\'8\' width=\'24\' height=\'16\' rx=\'1.5\' fill=\'%23cfdfee\' stroke=\'%23333\' stroke-width=\'1.5\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>', width: 500, height: 360 }),
      "My Network Places": () => openWindow({ title: "My Network Places", icon: '<div class="wicon"></div>', width: 500, height: 360 }),
      "Recycle Bin": () => openWindow({ title: "Recycle Bin", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Cpath d=\'M10 7h14l8 8v10a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6V15z\' fill=\'%23e6eef5\' stroke=\'%23457\' stroke-width=\'1.6\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>', width: 460, height: 340,
        body: '<div style="padding:16px;font-size:12px;color:#888">The Recycle Bin is empty.</div>' }),
      "Internet Explorer": () => openWindow({ title: "Microsoft Internet Explorer", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Ccircle cx=\'17\' cy=\'17\' r=\'14\' fill=\'%23177ed6\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>', width: 720, height: 460,
        addressbar: '<span class="ablbl">Address</span><span class="abadr">about:blank</span>',
        menubar: menubar('File', 'Edit', 'View', 'Favorites', 'Tools', 'Help').replace(/class="mbtn"/g, 'class="mbtn" style="padding:4px 7px"'),
        body: '<iframe src="about:blank" style="width:100%;height:100%;border:0"></iframe>' }),
      "My Documents": () => openWindow({ title: "My Documents", icon: '<div class="wicon"></div>', width: 560, height: 380 }),
      "Flashcards": () => launchApp("flashcards"),
      "Paint": () => launchApp("paint"),
    };
    (map[name] || (() => openWindow({ title: name, icon: "", width: 460, height: 340 })))();
  }

  function menubar(...names) {
    return names.map(n => `<button class="mbtn">${n}</button>`).join("");
  }

  /* ---------- quick launch ---------- */
  const quickApp = {
    ie: () => openFromIcon("Internet Explorer"),
    notepad: () => openNotepad(),
    mydocs: () => openFromIcon("My Documents"),
    sounds: () => openMediaPlayer(),
  };
  $$("#quicklaunch .ql").forEach(btn => btn.addEventListener("mousedown", () => {
    Sound.click();
    (quickApp[btn.dataset.app] || (() => {}))();
  }));

  function openNotepad() {
    openWindow({
      title: "Untitled - Notepad", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Cpath d=\'M9 5h12l6 6v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z\' fill=\'%23f7fafe\' stroke=\'%239aa\' stroke-width=\'1.5\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>',
      width: 520, height: 380,
      menubar: menubar('File', 'Edit', 'Format', 'View', 'Help'),
      body: '<textarea style="width:100%;height:100%;border:0;resize:none;font:13px Consolas,monospace;padding:8px">Welcome to Notebox XP.</textarea>',
      statusbar: '<div id="np-status">Ln 1, Col 1</div>',
    });
  }

  function openMediaPlayer() {
    const w = openWindow({
      title: "Windows Media Player", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Crect x=\'4\' y=\'7\' width=\'26\' height=\'20\' rx=\'2.5\' fill=\'%23112233\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>',
      width: 380, height: 260,
      body: `<div style="height:100%;background:#0b1626;color:#cfe6ff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-size:12px">
        <div style="font-size:40px">&#127925;</div>
        <div style="opacity:.7">Now Playing — Notebox XP</div>
        <div style="width:70%;height:16px;border:1px solid #2a5f9a;border-radius:8px;overflow:hidden"><div style="width:0%;height:100%;background:linear-gradient(90deg,#3a8dff,#7ab4ff)" id="wmp-bar"></div></div>
      </div>` },
    );
    w.el.querySelector("#wmp-bar");
    let p = 0;
    const t = setInterval(() => {
      p += 2;
      const bar = w.el.querySelector("#wmp-bar");
      if (!bar) { clearInterval(t); return; }
      bar.style.width = (p % 100) + "%";
    }, 120);
  }

  /* ---------- start menu ---------- */
  const startBtn = $("#start-btn"), sm = $("#start-menu");
  startBtn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    toggleStart();
  });

  const smApps = {
    internet: () => openFromIcon("Internet Explorer"),
    email: () => openFromIcon("My Documents"),
    mydocs: () => openFromIcon("My Documents"),
    mypics: () => openFromIcon("My Documents"),
    mymusic: () => openMediaPlayer(),
    computer: () => openFromIcon("My Computer"),
    notepad: () => openNotepad(),
    paint: () => window.NBPaint ? NBPaint.open() : openWindow({ title: "Paint", icon: "", width: 560, height: 420, body: '<div style="height:100%;background:#fff"></div>' }),
    mediaplayer: () => openMediaPlayer(),
    movie: () => openWindow({ title: "Windows Movie Maker", icon: "", width: 640, height: 440, body: '<div style="height:100%;background:#111;color:#ccc;display:flex;align-items:center;justify-content:center;font-size:12px">No clips.</div>' }),
    help: () => openWelcome(),
    search: () => openWindow({ title: "Search Results", icon: "", width: 560, height: 420, body: '<div style="height:100%;background:#fff;padding:18px;color:#666;font-size:12px">Enter a filename to search&hellip;</div>' }),
    run: () => openRunDialog(),
    flashcards: () => window.NBFlashcards ? NBFlashcards.open() : openWindow({ title: "Flashcards", icon: "", width: 760, height: 500 }),
  };

  function openWelcome() {
    const w = openWindow({
      title: "Welcome to Notebox XP", icon: '<div class="wicon" style="background:url(data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 34 34\'%3E%3Ccircle cx=\'17\' cy=\'17\' r=\'14\' fill=\'%23177ed6\'/%3E%3C/svg%3E);background-size:contain;background-repeat:no-repeat;background-position:center"></div>',
      width: 560, height: 340, left: 300, top: 120,
      body: `<div style="height:100%;background:linear-gradient(180deg,#e8f2ff,#ffffff);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center">
        <div style="font-size:44px">&#127881;</div>
        <div style="font-size:16px;font-weight:bold;color:#0a2f6b">Welcome to Windows XP</div>
        <div style="font-size:12px;color:#444;max-width:400px;line-height:1.6">Your machine feels right at home. Drag a window, open the Start menu, right-click the desktop — everything is built to feel exactly like the operating system you remember.</div>
        <div style="display:flex;gap:12px;margin-top:6px">
          <button class="bv" id="welcome-start">Get started</button>
        </div>
      </div>`,
    });
    w.el.querySelector("#welcome-start").addEventListener("mousedown", () => { Sound.click(); closeWindow(w); });
  }

  function openRunDialog() {
    showXDialog("Run", '<span class="x-ic">&#128193;</span><span>Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.<br><br><input id="xdialog-input" class="bv" style="width:200px;box-shadow:inset 1px 1px 2px rgba(0,0,0,.3);padding:4px 6px" placeholder="notepad">', ["OK", "Cancel"]);
    setTimeout(() => { const i = $("#xdialog-input"); if (i) i.focus(); }, 50);
  }

  function toggleStart() {
    const open = sm.hidden;
    closeAllOverlays();
    if (open) {
      sm.hidden = false;
      startBtn.classList.add("pressed");
      Sound.open();
    } else {
      closeStart();
    }
    hideFlyout();
    hideCtx();
  }

  function closeStart() {
    sm.hidden = true;
    startBtn.classList.remove("pressed");
  }

  function hideFlyout() {
    const f = $("#all-programs");
    if (f) f.hidden = true;
    $$("#all-programs-btn").forEach(b => b.classList.remove("open"));
  }

  const launchApp = (app) => {
    Sound.click();
    closeStart(); hideFlyout(); hideCtx();
    const known = smApps[app];
    if (known) return known();
    openWindow({ title: app, icon: "", width: 460, height: 340 });
  };

  $$(".sm-item").forEach(item => {
    item.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (item.dataset.app) launchApp(item.dataset.app);
    });
  });

  const apBtn = $("#all-programs-btn"), flyout = $("#all-programs");
  apBtn.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    const hidden = flyout.hidden;
    hideFlyout();
    if (hidden) {
      flyout.hidden = false;
      apBtn.classList.add("open");
    }
  });

  const apList = ["Accessories", "Games", "Internet Explorer", "Media Player", "Movie Maker", "Notepad", "Paint", "Flashcards", "Windows Explorer", "Help and Support", "Command Prompt", "Calculator", "Sound Recorder", "WordPad", "Windows Update"];
  const buildFlyout = () => {
    const m = { "Notepad": () => openNotepad(), "Paint": () => launchApp("paint"), "Media Player": () => openMediaPlayer(), "Movie Maker": () => smApps.movie(), "Internet Explorer": () => openFromIcon("Internet Explorer"), "Help and Support": () => openWelcome(), "Windows Explorer": () => openFromIcon("My Computer"), "Calculator": () => openWindow({ title: "Calculator", icon: "", width: 280, height: 360, body: calcBody() }), "Flashcards": () => launchApp("flashcards") };
    flyout.innerHTML = apList.map(name => `<button class="sm-item" data-app="${cssName(name)}">${name}</button>`).join("");
    $$("#all-programs .sm-item").forEach(i => i.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      const name = i.textContent.trim();
      (m[name] || launchApp)(name);
    }));
  };
  buildFlyout();

  function cssName(s) { return s.toLowerCase().replace(/\s+/g, ""); }

  function calcBody() {
    return `<div style="height:100%;background:#ece9d8;padding:12px;display:flex;align-items:center;justify-content:center">
      <div style="width:200px;background:#fdfdfd;border:1px solid #aaa;box-shadow:inset 1px 1px 1px rgba(0,0,0,.15);padding:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:5px;font-size:12px">
        <div style="grid-column:1/-1;background:#fff;border:1px solid #999;text-align:right;padding:6px 8px;font-size:16px;margin-bottom:4px">0</div>
        <button class="bv" style="padding:4px">7</button><button class="bv" style="padding:4px">8</button><button class="bv" style="padding:4px">9</button><button class="bv" style="padding:4px">/</button>
        <button class="bv" style="padding:4px">4</button><button class="bv" style="padding:4px">5</button><button class="bv" style="padding:4px">6</button><button class="bv" style="padding:4px">*</button>
        <button class="bv" style="padding:4px">1</button><button class="bv" style="padding:4px">2</button><button class="bv" style="padding:4px">3</button><button class="bv" style="padding:4px">-</button>
        <button class="bv" style="padding:4px">0</button><button class="bv" style="padding:4px">.</button><button class="bv" style="padding:4px">=</button><button class="bv" style="padding:4px">+</button>
      </div>
    </div>`;
  }

  function showXDialog(title, html, buttons = ["OK"], cb) {
    $("#xdialog-title").textContent = title;
    $("#xdialog-msg").innerHTML = html;
    const btns = $("#xdialog-btns");
    btns.innerHTML = "";
    buttons.forEach(b => {
      const btn = document.createElement("button");
      btn.className = "bv";
      btn.textContent = b;
      btn.addEventListener("mousedown", () => { Sound.click(); hideXDialog(); if (cb) cb(b); });
      btns.appendChild(btn);
    });
    const d = $("#xdialog");
    d.classList.remove("hidden");
    d.hidden = false;
    Sound.open();
  }
  function hideXDialog() {
    const d = $("#xdialog");
    d.classList.add("hidden");
    d.hidden = true;
  }
  $$("#xdialog .wctl[data-act=close]").forEach(b => b.addEventListener("mousedown", hideXDialog));

  /* ---------- shutdown / standby ---------- */
  const shut = $("#shutdown");
  const showModal = (el) => { el.classList.remove("hidden"); el.hidden = false; };
  const hideModal = (el) => { el.classList.add("hidden"); el.hidden = true; };
  function openShutdown() {
    closeStart(); hideFlyout(); hideCtx();
    showModal(shut);
    Sound.open();
  }
  $$("#shutdown .shut-btn").forEach(b => b.addEventListener("mousedown", () => {
    const act = b.dataset.act;
    Sound.click();
    if (act === "off") doOff();
    else if (act === "restart") location.reload();
    else if (act === "standby") doStandby();
  }));
  $$("#shutdown .wctl[data-act=close]").forEach(b => b.addEventListener("mousedown", () => hideModal(shut)));
  document.addEventListener("mousedown", (e) => {
    if (e.target.id === "shutdown") hideModal(shut);
  });
  $("#sm-shutdown").addEventListener("mousedown", (e) => { e.stopPropagation(); openShutdown(); });

  function doOff() {
    hideModal(shut);
    Sound.shutdown();
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:900;background:#000;display:flex;align-items:center;justify-content:center;color:#fff;font-size:15px";
    ov.textContent = "It is now safe to turn off your computer.";
    document.body.appendChild(ov);
    setTimeout(() => location.reload(), 2600);
  }
  function doStandby() {
    shut.hidden = true;
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:900;background:#050a12;display:flex;align-items:center;justify-content:center;color:#7ab4ff;font-size:13px;cursor:pointer";
    ov.innerHTML = '&#8986; Stand by — click anywhere to wake';
    document.body.appendChild(ov);
    ov.addEventListener("mousedown", () => { ov.remove(); Sound.click(); });
  }

  $$(".sm-logoff").forEach(b => b.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    closeStart();
    showXDialog("Log Off Windows", '<span class="x-ic">&#128100;</span><span>Are you sure you want to log off?</span>', ["Log Off", "Cancel"], (r) => { if (r === "Log Off") location.reload(); });
  }));

  /* ---------- context menu ---------- */
  const ctx = $("#ctxmenu");
  let ctxCloseFn = null;

  function showContextMenu(e, items) {
    e.preventDefault();
    hideCtx();
    ctx.innerHTML = "";
    items.forEach(item => {
      if (item.sep) { const d = document.createElement("div"); d.className = "cm-sep"; ctx.appendChild(d); return; }
      const btn = document.createElement("div");
      btn.className = "cm-item" + (item.disabled ? " disabled" : "");
      btn.innerHTML = `<span class="cm-ic">${item.icon || ""}</span><span>${item.label}</span>`;
      btn.addEventListener("mousedown", () => {
        Sound.click();
        hideCtx();
        if (item.action) item.action();
      });
      ctx.appendChild(btn);
    });
    ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.min(e.clientX, innerWidth - w - 4) + "px";
    ctx.style.top  = Math.min(e.clientY, innerHeight - h - 4) + "px";
    ctxCloseFn = () => hideCtx();
  }

  function hideCtx() { ctx.hidden = true; }

  function iconMenu(ic) {
    const name = ic.dataset.name;
    return [
      { label: "Open", icon: "&#128194;", action: () => openFromIcon(name) },
      { label: "Explore", icon: "&#128193;" },
      { sep: true },
      { label: "Cut", icon: "&#9986;" }, { label: "Copy", icon: "&#8997;", disabled: true }, { label: "Delete", icon: "&#128465;" },
      { sep: true },
      { label: "Rename", icon: "&#9998;" },
      { label: "Properties", icon: "&#9881;" },
    ];
  }

  document.addEventListener("contextmenu", (e) => {
    if (e.target.closest("#desktop .dicon") || e.target.closest("#ctxmenu") || e.target.closest(".modal")) return;
    e.preventDefault();
    showContextMenu(e, [
      { label: "Arrange Icons By", icon: "&#9776;" },
      { label: "Refresh", icon: "&#8635;", action: () => Sound.reload || Sound.click() },
      { sep: true },
      { label: "New", icon: "&#10133;" },
      { label: "Properties", icon: "&#9881;", action: () => showXDialog("Display Properties", '<span class="x-ic">&#128203;</span><span>Display Properties — Windows XP Luna Blue theme.</span>') },
    ]);
  });
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#ctxmenu")) hideCtx();
  });

  function closeAllOverlays() { hideModal(shut); hideXDialog(); hideCtx(); }

  /* ---------- tray clock + calendar ---------- */
  const calpop = $("#calpop");
  function tick() {
    const d = new Date();
    let h = d.getHours(), m = d.getMinutes();
    const am = h < 12 ? "AM" : "PM";
    h = h % 12 || 12;
    $("#tray-clock").textContent = `${h}:${String(m).padStart(2, "0")} ${am}`;
  }
  tick(); setInterval(tick, 1000);

  const tc = $(".tray-clock");
  tc.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    Sound.click();
    calpop.hidden = !calpop.hidden;
    if (!calpop.hidden) buildCal();
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#calpop") && !e.target.closest(".tray-clock")) calpop.hidden = true; });

  function buildCal() {
    const d = new Date();
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const days = ["Su","Mo","Tu","We","Th","Fr","Sa"];
    $("#cal-head").textContent = `${months[d.getMonth()]} ${d.getFullYear()}`;
    let g = '<div class="dow" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(7,1fr)">' + days.map(x => `<span>${x}</span>`).join("") + '</div>';
    const first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    g += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px">';
    for (let i = 0; i < first; i++) g += '<span></span>';
    for (let day = 1; day <= dim; day++) {
      g += `<span class="day${day === d.getDate() ? " today" : ""}">${day}</span>`;
    }
    g += '</div>';
    const grid = $("#cal-grid") || document.createElement("div");
    grid.id = "cal-grid"; grid.innerHTML = g;
    calpop.innerHTML = `<div class="cal-head" id="cal-head">${months[d.getMonth()]} ${d.getFullYear()}</div>`;
    calpop.appendChild(grid);
    calpop.insertAdjacentHTML("beforeend", `<div class="cal-clock">${$("#tray-clock").textContent}</div>`);
  }

  const traySound = $("#tray-sound");
  traySound.addEventListener("mousedown", () => {
    const on = Sound.toggle();
    traySound.textContent = on ? "&#128266;" : "&#128263;";
    if (on) Sound.click(); else Sound.error();
  });

  /* ---------- init ---------- */
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#start-menu") && !e.target.closest("#start-btn") && !e.target.closest("#all-programs")) closeStart();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeStart(); hideCtx(); hideFlyout(); calpop.hidden = true; }
  });

  function escHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ---------- external app bridge ---------- */
  // Apps that live in separate <script> files register themselves here.
  // They get the shell's window factory + fabric helpers, and expose their
  // open() so the Start menu / desktop icons can reach them.
  const NBApps = {};
  window.NBApp = {
    register(name, app) {
      NBApps[name] = app;
      if (!smApps[name]) smApps[name] = () => app.open();
      if (![...document.querySelectorAll(".dicon")].some(d => d.dataset.name === app.title)) {
        const icon = document.createElement("div");
        icon.className = "dicon";
        icon.dataset.name = app.title;
        icon.tabIndex = 0;
        icon.innerHTML = `<span class="di-ic ${app.iconClass || ""}"></span><span class="di-t">${escHtml(app.title)}</span>`;
        $("#desktop").appendChild(icon);
        icon.addEventListener("mousedown", (e) => {
          Sound.click();
          $$("#desktop .dicon").forEach(x => x.classList.remove("sel"));
          icon.classList.add("sel");
          selIcon = icon;
          e.stopPropagation();
        });
        icon.addEventListener("dblclick", () => app.open());
        icon.addEventListener("contextmenu", (e) => showContextMenu(e, iconMenu(icon)));
      }
      if (!apList.includes(app.title)) {
        apList.push(app.title);
        buildFlyout();
      }
    },
    shell: {
      launch: launchApp,
      win: (opts) => openWindow(opts),
      dialog: (title, html, buttons, cb) => showXDialog(title, html, buttons, cb),
      esc: (s) => escHtml(s),
      menu: (...names) => menubar(...names),
      icon: (svgPath) => `<div class="wicon" style="background:url(data:image/svg+xml,${encodeURIComponent(svgPath)}) ;background-size:contain;background-repeat:no-repeat;background-position:center"></div>`,
    },
  };

  boot();
})();