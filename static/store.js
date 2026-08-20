/* ============================================================
   Notebox XP — Data Spine
   localStorage-backed store: sources, decks, cards, settings.
   ============================================================ */
(function () {
  const KEY = "notebox.store.v1";

  const defaults = () => ({
    sources: [],
    decks: [],
    cards: [],
    settings: { geminiKey: "", model: "gemini-3.7-flash" },
  });

  let state = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      state = raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults();
      // migrate: always run on the current recommended model
      state.settings.model = "gemini-3.7-flash";
    } catch (e) {
      state = defaults();
    }
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { /* quota or private mode */ }
  }

  function uid() {
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- settings ---------- */
  function getSettings() { return state.settings; }
  function setKey(k) { state.settings.geminiKey = (k || "").trim(); save(); }
  function setModel(m) { state.settings.model = (m || "gemini-3.5-flash-lite").trim(); save(); }

  /* ---------- sources ---------- */
  function addSource({ title, text, kind, meta }) {
    const s = {
      id: uid(),
      title: title || "Untitled source",
      text: text || "",
      kind: kind || "text",
      meta: meta || {},
      added: Date.now(),
    };
    state.sources.push(s);
    save();
    return s;
  }
  function getSource(id) { return state.sources.find(s => s.id === id); }
  function deleteSource(id) {
    state.sources = state.sources.filter(s => s.id !== id);
    save();
  }
  function listSources() { return state.sources.slice(); }

  /* ---------- decks ---------- */
  function addDeck({ name, sourceIds, generatedFrom }) {
    const d = {
      id: uid(),
      name: name || "New deck",
      sourceIds: sourceIds || [],
      generatedFrom: generatedFrom || "",
      created: Date.now(),
    };
    state.decks.push(d);
    save();
    return d;
  }
  function getDeck(id) { return state.decks.find(d => d.id === id); }
  function deleteDeck(id) {
    state.decks = state.decks.filter(d => d.id !== id);
    state.cards = state.cards.filter(c => c.deckId !== id);
    save();
  }
  function listDecks() { return state.decks.slice(); }

  /* ---------- cards ---------- */
  function addCards(deckId, cards) {
    const stamped = cards.map(c => ({
      id: uid(),
      deckId,
      front: c.front,
      back: c.back,
      type: c.type || "concept",
      snippet: c.snippet || "",
      sourceId: c.sourceId || "",
      // SM-2 state
      reps: 0,
      ef: 2.5,        // ease factor
      ivl: 0,         // interval in days
      due: Date.now(),
      lapses: 0,
      lastGrade: null,
    }));
    state.cards.push(...stamped);
    save();
    return stamped;
  }
  function getCard(id) { return state.cards.find(c => c.id === id); }
  function listCards(deckId) { return state.cards.filter(c => c.deckId === deckId); }
  function updateCard(id, patch) {
    const c = getCard(id);
    if (c) { Object.assign(c, patch); save(); return c; }
    return null;
  }
  function deleteCardsForSource(sourceId) {
    state.cards = state.cards.filter(c => c.sourceId !== sourceId);
    save();
  }

  /* ---------- grade + SM-2 ---------- */
  // grade: "again" | "hard" | "good" | "easy"
  function gradeCard(id, grade) {
    const c = getCard(id);
    if (!c) return null;
    const map = { again: 0, hard: 0.5, good: 1, easy: 1.5 };
    const q = map[grade] ?? 1;
    const MIN = 1; // minimum reps recommended before 1d+
    if (grade === "again") {
      c.reps = Math.max(0, c.reps - 1);
      c.lapses += 1;
      c.ef = Math.max(1.3, c.ef - 0.2);
      c.ivl = 1; // relearn tomorrow (minutes handled in UI queue)
      c.due = Date.now() + 10 * 60 * 1000; // 10 minutes
    } else {
      c.reps += 1;
      if (c.ivl === 0) c.ivl = 1;
      else if (c.reps === 1) c.ivl = 3;
      else c.ivl = Math.round(c.ivl * c.ef);
      if (grade === "hard") c.ef = Math.max(1.3, c.ef - 0.15);
      else if (grade === "easy") c.ef = Math.min(2.8, c.ef + 0.15);
      if (grade === "easy") c.ivl += 1;
      c.due = Date.now() + c.ivl * 24 * 60 * 60 * 1000;
    }
    c.lastGrade = grade;
    save();
    return c;
  }

  function dueCards(deckId, limit) {
    const now = Date.now();
    return listCards(deckId)
      .filter(c => c.due <= now)
      .sort((a, b) => a.due - b.due)
      .slice(0, limit || 50);
  }

  function deckStats(deckId) {
    const cards = listCards(deckId);
    if (!cards.length) return { total: 0, due: 0, mastered: 0, new: 0, learning: 0 };
    return {
      total: cards.length,
      due: cards.filter(c => c.due <= Date.now()).length,
      mastered: cards.filter(c => c.ivl >= 14).length,
      new: cards.filter(c => c.reps === 0).length,
      learning: cards.filter(c => c.reps > 0 && c.ivl < 14).length,
    };
  }

  /* ---------- api ---------- */
  window.NB = window.NB || {};
  window.NB.store = {
    _load: load,
    _save: save,
    uid,
    getSettings, setKey, setModel,
    addSource, getSource, deleteSource, listSources,
    addDeck, getDeck, deleteDeck, listDecks,
    addCards, getCard, listCards, updateCard, deleteCardsForSource,
    gradeCard, dueCards, deckStats,
  };

  load();
})();