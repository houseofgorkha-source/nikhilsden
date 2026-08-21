/* Journal — a small local-first diary.
   Everything lives in this browser's localStorage. No server, no accounts. */

(function () {
  "use strict";

  var STORAGE_KEY = "nikhilsden.journal.v1";
  var LEGACY_STORAGE_KEY = "nikhilsden.notes.v1";
  var SAVE_DELAY = 300;

  var notes = [];
  var selectedId = null;
  var saveTimer = null;

  var el = {
    app: document.querySelector(".app"),
    list: document.getElementById("note-list"),
    listEmpty: document.getElementById("list-empty"),
    search: document.getElementById("search"),
    body: document.getElementById("note-body"),
    status: document.getElementById("status"),
    newNote: document.getElementById("new-note"),
    deleteNote: document.getElementById("delete-note"),
    back: document.getElementById("back"),
    exportBtn: document.getElementById("export"),
    importBtn: document.getElementById("import"),
    importFile: document.getElementById("import-file")
  };

  /* ---------- Storage ---------- */

  function load() {
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch (e) {
      // Private mode or blocked storage — run in-memory for this session.
      setStatus("Storage unavailable — entries won’t be saved.");
      return [];
    }
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isNote) : [];
    } catch (e) {
      setStatus("Saved entries could not be read.");
      return [];
    }
  }

  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
      return true;
    } catch (e) {
      setStatus("Could not save — storage is full or blocked.");
      return false;
    }
  }

  function isNote(n) {
    return n && typeof n === "object" &&
      typeof n.id === "string" && typeof n.body === "string";
  }

  function makeId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- Derived text ---------- */

  function titleOf(note) {
    return new Date(note.created).toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }

  function previewOf(note) {
    var lines = note.body.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line) return line.length > 80 ? line.slice(0, 80) + "…" : line;
    }
    return "";
  }

  function timeAgo(ts) {
    var secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 60) return "just now";
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? " min ago" : " mins ago");
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hours / 24);
    if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
    return new Date(ts).toLocaleDateString();
  }

  /* ---------- Rendering ---------- */

  function matches(note, query) {
    return !query || note.body.toLowerCase().indexOf(query) !== -1;
  }

  function visibleNotes() {
    var query = el.search.value.trim().toLowerCase();
    return notes
      .filter(function (n) { return matches(n, query); })
      .sort(function (a, b) { return b.updated - a.updated; });
  }

  function render() {
    var shown = visibleNotes();

    el.list.textContent = "";
    shown.forEach(function (note) {
      var item = document.createElement("li");
      item.className = "note-item" + (note.id === selectedId ? " is-selected" : "");
      item.dataset.id = note.id;

      var title = document.createElement("span");
      title.className = "note-title";
      title.textContent = titleOf(note);

      var meta = document.createElement("span");
      meta.className = "note-meta";
      var preview = previewOf(note);
      meta.textContent = timeAgo(note.updated) + (preview ? " · " + preview : "");

      item.appendChild(title);
      item.appendChild(meta);
      el.list.appendChild(item);
    });

    if (!shown.length) {
      el.listEmpty.hidden = false;
      el.listEmpty.textContent = notes.length
        ? "No entries match that search."
        : "No entries yet. Write your first one.";
    } else {
      el.listEmpty.hidden = true;
    }

    el.app.classList.toggle("is-empty", !current());
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  function current() {
    return notes.filter(function (n) { return n.id === selectedId; })[0] || null;
  }

  /* ---------- Actions ---------- */

  function select(id) {
    flushSave();
    selectedId = id;
    var note = current();
    el.body.value = note ? note.body : "";
    if (note) {
      setStatus("Edited " + timeAgo(note.updated));
      el.app.classList.add("is-editing");
    }
    render();
  }

  function createNote() {
    flushSave();
    var note = { id: makeId(), body: "", created: Date.now(), updated: Date.now() };
    notes.push(note);
    persist();
    el.search.value = "";
    select(note.id);
    el.body.focus();
  }

  function deleteCurrent() {
    var note = current();
    if (!note) return;
    if (!window.confirm("Delete the entry from " + titleOf(note) + "? This cannot be undone.")) return;

    window.clearTimeout(saveTimer);
    saveTimer = null;
    notes = notes.filter(function (n) { return n.id !== note.id; });
    persist();

    selectedId = null;
    el.body.value = "";
    setStatus("");
    el.app.classList.remove("is-editing");
    render();
  }

  function saveCurrent() {
    var note = current();
    if (!note) return;
    if (note.body === el.body.value) return;
    note.body = el.body.value;
    note.updated = Date.now();
    if (persist()) setStatus("Saved");
    render();
  }

  function queueSave() {
    window.clearTimeout(saveTimer);
    setStatus("Editing…");
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      saveCurrent();
    }, SAVE_DELAY);
  }

  function flushSave() {
    if (saveTimer === null) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    saveCurrent();
  }

  /* ---------- Export / import ---------- */

  function exportNotes() {
    flushSave();
    if (!notes.length) {
      setStatus("Nothing to export.");
      return;
    }
    var blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "journal-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatus("Exported " + notes.length + (notes.length === 1 ? " entry." : " entries."));
  }

  function importNotes(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var incoming;
      try {
        incoming = JSON.parse(String(reader.result));
      } catch (e) {
        setStatus("That file isn’t valid JSON.");
        return;
      }
      if (!Array.isArray(incoming)) {
        setStatus("That file doesn’t look like a journal export.");
        return;
      }

      var existing = {};
      notes.forEach(function (n) { existing[n.id] = true; });

      var added = 0;
      incoming.filter(isNote).forEach(function (n) {
        var note = {
          id: existing[n.id] ? makeId() : n.id,
          body: n.body,
          created: typeof n.created === "number" ? n.created : Date.now(),
          updated: typeof n.updated === "number" ? n.updated : Date.now()
        };
        existing[note.id] = true;
        notes.push(note);
        added++;
      });

      persist();
      render();
      setStatus(added ? "Imported " + added + (added === 1 ? " entry." : " entries.") : "No entries found in that file.");
    };
    reader.onerror = function () { setStatus("Could not read that file."); };
    reader.readAsText(file);
  }

  /* ---------- Wiring ---------- */

  el.newNote.addEventListener("click", createNote);
  el.deleteNote.addEventListener("click", deleteCurrent);
  el.body.addEventListener("input", queueSave);
  el.body.addEventListener("blur", flushSave);
  el.search.addEventListener("input", render);

  el.back.addEventListener("click", function () {
    flushSave();
    el.app.classList.remove("is-editing");
  });

  el.list.addEventListener("click", function (event) {
    var item = event.target.closest(".note-item");
    if (item) select(item.dataset.id);
  });

  el.exportBtn.addEventListener("click", exportNotes);

  el.importBtn.addEventListener("click", function () { el.importFile.click(); });
  el.importFile.addEventListener("change", function () {
    if (el.importFile.files[0]) importNotes(el.importFile.files[0]);
    el.importFile.value = "";
  });

  document.addEventListener("keydown", function (event) {
    var mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      flushSave();
    } else if (mod && event.key.toLowerCase() === "b") {
      event.preventDefault();
      createNote();
    } else if (event.key === "Escape" && document.activeElement === el.search) {
      el.search.value = "";
      render();
    }
  });

  window.addEventListener("beforeunload", flushSave);

  /* ---------- Start ---------- */

  notes = load();
  render();
})();
