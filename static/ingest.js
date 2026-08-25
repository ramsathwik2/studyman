/* ============================================================
   Notebox XP — Shared Ingestion Engine
   Pure client-side readers: txt/md, pdf, docx (mammoth),
   epub / pptx / xlsx / doc via JSZip, URL import via CORS
   proxy (best effort), YouTube transcript cleaner.
   ============================================================ */
(() => {
  "use strict";

  const zipText = async (zip, name) => {
    const f = zip.file(name);
    if (!f) return null;
    return f.async("string");
  };

  const stripTags = (xml, tag) => {
    const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g");
    let m, out = [];
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
  };

  const decodeEntities = (s) => {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  };

  /* ---------- EPUB ---------- */
  async function readEpub(buf) {
    if (!window.JSZip) throw new Error("ZIP engine not loaded.");
    const zip = await JSZip.loadAsync(buf);
    const container = await zipText(zip, "META-INF/container.xml");
    let opfPath = null;
    if (container) {
      const m = container.match(/full-path="([^"]+)"/);
      if (m) opfPath = m[1];
    }
    let order = [];
    if (opfPath && zip.file(opfPath)) {
      const opf = await zip.file(opfPath).async("string");
      const base = opfPath.replace(/[^/]*$/, "");
      const idToHref = {};
      stripTags(opf, "item").forEach(it => {
        const id = (it.match(/id="([^"]+)"/) || [])[1];
        const href = (it.match(/href="([^"]+)"/) || [])[1];
        if (id && href) idToHref[id] = base + href.replace(/^\.\//, "");
      });
      stripTags(opf, "itemref").forEach(ir => {
        const idref = (ir.match(/idref="([^"]+)"/) || [])[1];
        if (idToHref[idref]) order.push(idToHref[idref]);
      });
    }
    if (!order.length) {
      // fallback: every xhtml/html file in the zip
      order = Object.keys(zip.files).filter(n => /\.x?html?$/i.test(n)).sort();
    }
    let all = [];
    for (const name of order.slice(0, 400)) {
      try {
        const html = await zip.file(name).async("string");
        const doc = new DOMParser().parseFromString(html, "text/html");
        all.push((doc.body ? doc.body.textContent : doc.textContent || "").trim());
      } catch (_) {}
    }
    const text = all.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("No extractable text in this EPUB (images only?).");
    return { text, kind: "epub" };
  }

  /* ---------- PPTX ---------- */
  async function readPptx(buf) {
    if (!window.JSZip) throw new Error("ZIP engine not loaded.");
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10)) - (parseInt(b.match(/\d+/)[0], 10)));
    if (!slides.length) throw new Error("No slides found in this PPTX.");
    let all = [];
    for (const s of slides) {
      const xml = await zip.file(s).async("string");
      const texts = stripTags(xml, "a:t").map(decodeEntities).join(" ");
      if (texts.trim()) all.push(texts.trim());
    }
    const text = all.join("\n\n").trim();
    if (!text) throw new Error("No extractable text in this deck.");
    return { text, kind: "pptx" };
  }

  /* ---------- XLSX ---------- */
  async function readXlsx(buf) {
    if (!window.JSZip) throw new Error("ZIP engine not loaded.");
    const zip = await JSZip.loadAsync(buf);
    const shared = await zipText(zip, "xl/sharedStrings.xml");
    if (!shared) throw new Error("No shared strings in this workbook.");
    const vals = stripTags(shared, "t").map(decodeEntities);
    const text = vals.join("\n").trim();
    if (!text) throw new Error("Empty spreadsheet.");
    return { text, kind: "xlsx" };
  }

  /* ---------- legacy .doc (best-effort binary scrape) ---------- */
  function readDoc(buf) {
    // crude: pull runs of printable ASCII/UTF-16 from the OLE stream
    const bytes = new Uint8Array(buf);
    let ascii = "", utf16 = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 32 && b < 127) ascii += String.fromCharCode(b); else ascii += "\u0000";
    }
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const c = bytes[i] | (bytes[i + 1] << 8);
      utf16 += (c >= 32 && c < 65533) ? String.fromCharCode(c) : "\u0000";
    }
    const pick = (s) => {
      const runs = s.split("\u0000+").filter(r => r.trim().length > 40);
      runs.sort((a, b) => b.length - a.length);
      return runs.slice(0, 4).join("\n");
    };
    const text = [pick(ascii), pick(utf16)].sort((a, b) => b.length - a.length)[0] || "";
    if (!text.trim()) throw new Error("Could not extract text from this legacy .doc — save as .docx instead.");
    return { text: text.replace(/\s{4,}/g, "\n").trim(), kind: "doc" };
  }

  /* ---------- dispatch ---------- */
  async function read(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    switch (ext) {
      case "epub": return readEpub(await file.arrayBuffer());
      case "pptx": return readPptx(await file.arrayBuffer());
      case "xlsx": return readXlsx(await file.arrayBuffer());
      case "doc": return readDoc(await file.arrayBuffer());
      default: throw new Error("Unsupported file type: ." + ext);
    }
  }

  /* ---------- URL import (best effort, free CORS proxies) ---------- */
  async function readUrl(url) {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    const proxies = [
      (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
      (u) => "https://corsproxy.io/?" + encodeURIComponent(u),
    ];
    let lastErr = null;
    for (const p of proxies) {
      try {
        const res = await fetch(p(url), { signal: AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script,style,noscript,nav,header,footer,iframe").forEach(n => n.remove());
        const title = (doc.title || url).slice(0, 120);
        const text = (doc.body ? doc.body.textContent : "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
        if (text.length < 200) throw new Error("Page produced too little text (JS-rendered site?).");
        return { title, text: text.slice(0, 300000), kind: "url" };
      } catch (e) { lastErr = e; }
    }
    throw new Error("Could not fetch that URL (" + (lastErr ? lastErr.message : "blocked") + "). Copy-paste the page text instead.");
  }

  /* ---------- YouTube transcript paste cleaner ---------- */
  function cleanTranscript(raw) {
    let lines = raw.split(/\r?\n/);
    const out = [];
    for (let ln of lines) {
      ln = ln.trim();
      if (!ln) continue;
      if (/^\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s*$/.test(ln)) continue;          // bare timestamp line
      ln = ln.replace(/^\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s*/, "");             // leading ts
      ln = ln.replace(/\d{1,2}:\d{2}(?::\d{2})?\s*→\s*\d{1,2}:\d{2}(?::\d{2})?\s*/g, ""); // srt ranges
      ln = ln.replace(/^\[[^\]]*\]\s*/, "");                                  // [Music]
      ln = ln.replace(/^-\s*/g, "");
      if (ln) out.push(ln);
    }
    return out.join(" ").replace(/\s{2,}/g, " ").trim();
  }

  window.NBIngest = { read, readUrl, cleanTranscript };
})();
