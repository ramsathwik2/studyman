/* ============================================================
   Notebox XP — Paint (classic)
   Pencil, brush, eraser, fill, lines, shapes, 28-color palette,
   left=fg / right=bg, save as PNG, undo.
   ============================================================ */
(() => {
  "use strict";
  const shell = window.NBApp && window.NBApp.shell;
  if (!shell) { window.NBPaint = { open: () => {} }; return; }

  const esc = (s) => shell.esc(s == null ? "" : s);

  // Classic 28-color Paint palette (top rows of the real picker)
  const COLORS = [
    "#000000", "#7b7b7b", "#3a3a3a", "#ffffff", "#f0f0f0", "#8b4513", "#ff0000", "#ff6347",
    "#ffa500", "#ffff00", "#9acd32", "#008000", "#00ffff", "#0000cd", "#0000ff", "#4b0082",
    "#7b00ff", "#dda0dd", "#ff00ff", "#ff1493", "#d2b48c", "#a0522d", "#808080", "#c0c0c0",
    "#00008b", "#008b8b", "#8b008b", "#2f4f4f", "#556b2f", "#b22222", "#ffe4b5", "#00fa9a",
  ];

  const TOOLS = [
    { id: "pencil", label: "Pencil", icon: "&#9998;" },
    { id: "brush", label: "Brush", icon: "&#128397;" },
    { id: "eraser", label: "Eraser", icon: "&#10055;" },
    { id: "fill", label: "Fill with color", icon: "&#127919;" },
    { id: "line", label: "Line", icon: "&#9587;" },
    { id: "rect", label: "Rectangle", icon: "&#9635;" },
    { id: "ellipse", label: "Ellipse", icon: "&#11044;" },
  ];

  let win = null;
  let canvas = null, ctx = null;
  let tool = "pencil";
  let fg = "#000000", bg = "#ffffff";
  let drawing = false, startX = 0, startY = 0;
  let saved = null; // last undo snapshot
  let cw = 680, ch = 440;
  let rect = null; // canvas bounds for coordinate mapping

  function open() {
    if (win && document.body.contains(win.el)) return;
    win = shell.win({
      title: "untitled - Paint",
      width: Math.min(760, cw + 96),
      height: Math.min(560, ch + 110),
      app: "paint",
      icon: shell.icon(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 34 34'><circle cx='17' cy='17' r='13' fill='%23dce8fb' stroke='%23467890' stroke-width='2'/><path d='M14 12l-4 7 3 1-2 5 3-2' stroke='%23c33' stroke-width='2' fill='none'/></svg>`),
      menubar: shell.menu("File", "Edit", "Image", "Colors", "Help"),
      statusbar: '<div id="pt-status">For Help, click Help Topics on the Help Menu.</div>',
      body: `<div id="pt-app" class="pt-app"></div>`,
      onOpen: (el) => init(el),
    });
  }

  function init(el) {
    const app = el.querySelector("#pt-app");
    app.innerHTML = `
      <div class="pt-tools">
        ${TOOLS.map(t => `<button class="pt-tool" data-tool="${t.id}" title="${esc(t.label)}">${t.icon}</button>`).join("")}
      </div>
      <div class="pt-mid">
        <div class="pt-canvaswrap"><canvas id="pt-canvas" width="${cw}" height="${ch}"></canvas></div>
      </div>
      <div class="pt-palette">
        <div class="pt-cur">
          <div class="pt-swatch"><div class="pt-fg" style="background:${fg}"></div><div class="pt-bg" style="background:${bg}"></div></div>
          <div class="pt-curinfo"><span id="pt-pos">0, 0</span><span style="color:#888">fg: left &middot; bg: right</span></div>
        </div>
        <div class="pt-colors">
          ${COLORS.map(c => `<button class="pt-color${c.toLowerCase() === fg.toLowerCase() ? " fg" : ""}" style="background:${c}" data-c="${esc(c)}" title="${esc(c)}"></button>`).join("")}
        </div>
      </div>`;

    canvas = app.querySelector("#pt-canvas");
    ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
    saved = ctx.getImageData(0, 0, cw, ch);

    app.querySelectorAll(".pt-tool").forEach(b => b.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      tool = b.dataset.tool;
      app.querySelectorAll(".pt-tool").forEach(x => x.classList.remove("sel"));
      b.classList.add("sel");
    }));
    // pencil selected by default
    app.querySelector('.pt-tool[data-tool="pencil"]').classList.add("sel");

    app.querySelectorAll(".pt-color").forEach(b => b.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (e.button === 2) { bg = b.dataset.c; app.querySelector(".pt-bg").style.background = bg; }
      else { fg = b.dataset.c; app.querySelector(".pt-fg").style.background = fg; }
      app.querySelectorAll(".pt-color").forEach(x => x.classList.remove("fg", "bg"));
      b.classList.add(e.button === 2 ? "bg" : "fg");
    }));

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseup", (e) => { e.preventDefault(); onUp(e); });
    canvas.addEventListener("mouseleave", (e) => { if (drawing) onUp(e, true); });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // menus
    const menubar = el.querySelector(".menubar");
    menu(el, menubar, [
      { label: "File", items: [
        { label: "New", action: () => { clear(); } },
        { sep: true },
        { label: "Save As PNG", action: savePNG },
      ]},
      { label: "Edit", items: [
        { label: "Undo", action: undo },
      ]},
      { label: "Image", items: [
        { label: "Clear Image", action: () => clear() },
        { label: "Invert Colors", action: invert },
      ]},
      { label: "Help", items: [
        { label: "About Paint", action: () => shell.dialog("About Paint", `<span class="x-ic">&#128397;</span><span>Notebox XP Paint — back in the day.</span>`) },
      ]},
    ]);

    // keyboard
    const kd = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    };
    document.addEventListener("keydown", kd);
    window.addEventListener("unload", () => document.removeEventListener("keydown", kd));
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
      if (box) {
        box.querySelectorAll(".ft-item").forEach(btn => btn.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          const it = def.items[+btn.dataset.i];
          const dlg = document.getElementById("xdialog");
          if (dlg) dlg.hidden = true;
          if (it && it.action) it.action();
        }));
      }
    }));
  }

  /* ---------- drawing ---------- */
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * (cw / r.width));
    const y = Math.round((e.clientY - r.top) * (ch / r.height));
    return [Math.max(0, Math.min(cw, x)), Math.max(0, Math.min(ch, y))];
  }

  function onDown(e) {
    e.preventDefault();
    drawing = true;
    saved = ctx.getImageData(0, 0, cw, ch);
    const [x, y] = pos(e);
    startX = x; startY = y;
    if (tool === "pencil") {
      ctx.strokeStyle = e.button === 2 ? bg : fg;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y); ctx.stroke();
    } else if (tool === "brush") {
      ctx.strokeStyle = e.button === 2 ? bg : fg;
      ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y); ctx.stroke();
    } else if (tool === "eraser") {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y); ctx.stroke();
    } else if (tool === "fill") {
      floodFill(x, y, e.button === 2 ? bg : fg);
    }
  }

  function onMove(e) {
    const [x, y] = pos(e);
    const st = h2("pt-pos");
    if (st) st.textContent = x + ", " + y + " px";
    if (!drawing) return;
    if (["line", "rect", "ellipse"].includes(tool)) return; // preview handled on up
    ctx.lineCap = tool === "pencil" ? "butt" : "round";
    ctx.lineWidth = tool === "pencil" ? 1 : tool === "brush" ? 5 : 12;
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : (e.buttons === 2 || e.button === 2 ? bg : fg);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onUp(e, cancelled) {
    if (!drawing) return;
    drawing = false;
    const [x, y] = pos(e);
    if (!cancelled) {
      const col = e.button === 2 ? bg : fg;
      if (tool === "line") {
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(x, y); ctx.stroke();
      } else if (tool === "rect") {
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.strokeRect(Math.min(startX, x), Math.min(startY, y), Math.abs(x - startX), Math.abs(y - startY));
      } else if (tool === "ellipse") {
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse((startX + x) / 2, (startY + y) / 2, Math.abs(x - startX) / 2, Math.abs(y - startY) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /* ---------- flood fill ---------- */
  function floodFill(x, y, color) {
    const img = ctx.getImageData(0, 0, cw, ch);
    const d = img.data;
    const w = cw, h = ch;
    const target = idx(d, x, y, w);
    const tR = target, tG = target + 1, tB = target + 2, tA = target + 3;
    const tc = { r: d[tR], g: d[tG], b: d[tB], a: d[tA] };
    const c = hexRgb(color);
    if (tc.r === c.r && tc.g === c.g && tc.b === c.b) return;
    const stack = [[x, y]];
    const visited = new Uint8Array(w * h);
    const TOL = 8;
    const same = (i) =>
      Math.abs(d[i] - tc.r) <= TOL && Math.abs(d[i + 1] - tc.g) <= TOL &&
      Math.abs(d[i + 2] - tc.b) <= TOL && Math.abs(d[i + 3] - tc.a) <= TOL;
    while (stack.length) {
      const [px, py] = stack.pop();
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = (py * w + px) * 4;
      if (visited[py * w + px]) continue;
      if (!same(i)) continue;
      visited[py * w + px] = 1;
      d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }

  function idx(d, x, y, w) { return (y * w + x) * 4; }

  function hexRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
  }

  /* ---------- actions ---------- */
  function undo() {
    if (saved) { ctx.putImageData(saved, 0, 0); saved = ctx.getImageData(0, 0, cw, ch); }
  }
  function clear() {
    saved = ctx.getImageData(0, 0, cw, ch);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cw, ch);
  }
  function invert() {
    saved = ctx.getImageData(0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = 255 - d.data[i]; d.data[i + 1] = 255 - d.data[i + 1]; d.data[i + 2] = 255 - d.data[i + 2];
    }
    ctx.putImageData(d, 0, 0);
  }
  function savePNG() {
    const data = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = data;
    a.download = "untitled.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const h2 = (id) => document.getElementById(id);

  /* ---------- register ---------- */
  const app = { title: "Paint", iconClass: "paint", open };
  window.NBPaint = app;
  if (window.NBApp) window.NBApp.register("paint", app);
})();