import {
  collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp,
} from "firebase/firestore";
import { signOut, type User } from "firebase/auth";
import { auth, db } from "./firebase";
import {
  type Note, type Tag, type FilterType, type SortOrder, type Draft,
  TC, TL, FL, SORT_LABELS, QUOTES,
} from "./types";
import { $, esc, fmtDate, fmtCardDate, initials, firstName, showToast, hideToast, logoMark } from "./ui";
import { renderMd, previewMd } from "./markdown";
import { parseDraft } from "./draft";

// ── State ─────────────────────────────────────────────────────────────────────
let notes:           Note[]                                = [];
let filter:          FilterType                            = "all";
let searchQuery                                            = "";
let sortOrder:       SortOrder                             = "newest";
let editingId:       string | null                         = null;
let viewId:          string | null                         = null;
let unsubNotes:      (() => void) | null                   = null;
let searchDebounce:  ReturnType<typeof setTimeout> | null  = null;
let quoteTimer:      ReturnType<typeof setInterval> | null = null;
let keyboardHandler: ((e: KeyboardEvent) => void) | null   = null;
let draftKey:        string | null                         = null;
// Note ids the grid has already shown; only unseen ones play the entrance animation.
let seenIds                                                = new Set<string>();

// Called on every auth change (including sign-out) so listeners and timers
// from a previous session never leak into the next render.
export function teardownApp(): void {
  unsubNotes?.(); unsubNotes = null;
  if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
  if (keyboardHandler) { document.removeEventListener("keydown", keyboardHandler); keyboardHandler = null; }
  hideToast();
  viewId = null; editingId = null; draftKey = null;
  notes = []; filter = "all"; searchQuery = ""; sortOrder = "newest";
  seenIds = new Set();
}

const SKELETONS =
  `<div class="sk-card"><div class="sk-line t"></div><div class="sk-line b"></div><div class="sk-line b2"></div><div class="sk-line g"></div></div>`.repeat(6);

// ── App shell ─────────────────────────────────────────────────────────────────
export function renderApp(root: HTMLElement, user: User): void {
  const av   = esc(initials(user));
  const name = esc(firstName(user));

  // Drafts are per user so the next person signing in on this browser never
  // sees them. The old shared key can't be attributed to anyone, so drop it.
  draftKey = `${DRAFT_KEY}:${user.uid}`;
  localStorage.removeItem(DRAFT_KEY);

  root.innerHTML = `
    <div class="app">
      <div class="sidebar">
        <div class="profile">
          <div class="av">${av}</div>
          <div>
            <div class="pname">${name}</div>
            <div class="psub" id="note-count">Loading&#x2026;</div>
          </div>
        </div>
        <nav>
          <div class="ni on" data-filter="all">All Notes<span class="ncount" data-count="all"></span></div>
          <div class="ni" data-filter="pinned">Pinned<span class="ncount" data-count="pinned"></span></div>
          <div class="ndiv"></div>
          <div class="ni" data-filter="work"><span class="ndot" style="background:#a0a09a"></span>Work<span class="ncount" data-count="work"></span></div>
          <div class="ni" data-filter="ideas"><span class="ndot" style="background:#c09060"></span>Ideas<span class="ncount" data-count="ideas"></span></div>
          <div class="ni" data-filter="personal"><span class="ndot" style="background:#7080c0"></span>Personal<span class="ncount" data-count="personal"></span></div>
          <div class="ndiv"></div>
          <div class="ni ni-danger" id="signout-btn">Sign out</div>
        </nav>
        <div class="mascot">
          <div class="qbox" id="qb">You got this. Probably.</div>
          <svg class="fig" id="fig" width="46" height="60" viewBox="0 0 46 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle class="mbody" cx="23" cy="13" r="11.5"/>
            <circle class="mlight" cx="18.5" cy="11.5" r="2.2"/>
            <circle class="mlight" cx="27.5" cy="11.5" r="2.2"/>
            <circle class="mbody" cx="19" cy="12" r="1.1"/>
            <circle class="mbody" cx="28" cy="12" r="1.1"/>
            <circle class="mlight" cx="19.6" cy="11.3" r=".45"/>
            <circle class="mlight" cx="28.6" cy="11.3" r=".45"/>
            <path class="msmile" d="M 17 16.5 Q 23 21.5 29 16.5" stroke-width="1.6" stroke-linecap="round"/>
            <ellipse class="mblush" cx="15" cy="16" rx="2.5" ry="1.4"/>
            <ellipse class="mblush" cx="31" cy="16" rx="2.5" ry="1.4"/>
            <line class="mlimb" x1="23" y1="24.5" x2="23" y2="42" stroke-width="2.5" stroke-linecap="round"/>
            <line class="mlimb" x1="23" y1="30" x2="12" y2="38" stroke-width="2" stroke-linecap="round"/>
            <line class="mlimb" x1="23" y1="30" x2="34" y2="38" stroke-width="2" stroke-linecap="round"/>
            <line class="mlimb" x1="23" y1="42" x2="15.5" y2="56" stroke-width="2" stroke-linecap="round"/>
            <line class="mlimb" x1="23" y1="42" x2="30.5" y2="56" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <div class="main">
        <div class="topbar">
          <div class="topbar-row">
            <div class="ptitle" id="ptitle">All Notes</div>
            <div class="topbar-right">
              <button class="mob-av" id="mob-signout" title="Sign out">${av}</button>
            </div>
          </div>
          <div class="searchrow">
            <div class="search-wrap">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--text-m)" stroke-width="1.5">
                <circle cx="6" cy="6" r="4.5"/><line x1="9.5" y1="9.5" x2="13" y2="13"/>
              </svg>
              <input type="text" id="search-input" placeholder="Search notes&#x2026;">
              <button class="search-clear" id="search-clear" title="Clear search">&#x2715;</button>
              <span class="search-hint">/</span>
            </div>
            <button class="sort-btn" id="sort-btn">${SORT_LABELS.newest}</button>
          </div>
        </div>

        <div class="grid" id="grid">${SKELETONS}</div>

        <button class="fab" id="fab">+</button>

        <!-- Edit / create modal -->
        <div class="ov" id="ov">
          <div class="modal">
            <h3 id="modal-title">New note</h3>
            <div class="err-msg" id="err-msg"></div>
            <input  type="text" id="nt" placeholder="Title" maxlength="200">
            <textarea           id="nb" placeholder="Write something&#x2026;" maxlength="20000"></textarea>
            <div class="wcount" id="wcount"></div>
            <select             id="ntag">
              <option value="work">Work</option>
              <option value="ideas">Ideas</option>
              <option value="personal">Personal</option>
            </select>
            <label class="pin-row">
              <input type="checkbox" id="npin"> Pin this note
            </label>
            <div class="mbtns">
              <button class="btn"      id="cancel-btn">Cancel</button>
              <button class="btn btnp" id="save-btn">Add note</button>
            </div>
          </div>
        </div>

        <!-- View modal -->
        <div class="ov" id="ov-view">
          <div class="view-modal">
            <div class="view-header">
              <div class="view-header-left">
                <span class="ctag" id="view-tag"></span>
                <span class="view-pin-badge" id="view-pin-badge">&#x2605; Pinned</span>
              </div>
              <button class="card-btn" id="view-close" title="Close">&#x2715;</button>
            </div>
            <div class="view-title" id="view-title"></div>
            <div class="view-body" id="view-body"></div>
            <div class="view-footer">
              <span class="view-date" id="view-date"></span>
              <div class="view-actions">
                <button class="btn" id="view-pin-btn">&#x2606; Pin</button>
                <button class="btn view-del" id="view-del-btn">Delete</button>
                <button class="btn btnp" id="view-edit">Edit</button>
              </div>
            </div>
          </div>
        </div>

        <nav class="mnav" id="mnav">
          <button class="mn-btn on" data-filter="all"><span>&#x1F4CB;</span>All</button>
          <button class="mn-btn"    data-filter="pinned"><span>&#x1F4CC;</span>Pinned</button>
          <button class="mn-btn"    data-filter="work"><span>&#x1F4BC;</span>Work</button>
          <button class="mn-btn"    data-filter="ideas"><span>&#x1F4A1;</span>Ideas</button>
          <button class="mn-btn"    data-filter="personal"><span>&#x1F642;</span>Personal</button>
        </nav>
      </div>
    </div>
  `;

  bindEvents(user);
  startMascot();
  subscribeToNotes(user);
}

// ── Card rendering ─────────────────────────────────────────────────────────────
function renderCards(): void {
  const grid = $<HTMLDivElement>("grid");
  if (!grid) return;

  // The grid is rebuilt on every search keystroke, filter, pin and snapshot,
  // so only notes it hasn't shown before animate in, and only the first paint
  // staggers. Notes hidden by a filter count as shown: revealing them later
  // isn't new content. Undo re-adds under a new id, so a restored note animates.
  const seenBefore = seenIds;
  const firstPaint = seenBefore.size === 0;
  seenIds = new Set(notes.map((n) => n.id));

  const filtered = notes.filter((n) =>
    (filter === "pinned" ? n.pinned : filter === "all" ? true : n.tag === filter) &&
    (!searchQuery || `${n.title} ${n.body}`.toLowerCase().includes(searchQuery))
  );

  // Pinned notes always float to top, then sort by chosen order
  const list = [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortOrder === "oldest") return (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0);
    if (sortOrder === "az")     return a.title.localeCompare(b.title);
    return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
  });

  if (!list.length) {
    const firstTime = notes.length === 0 && filter === "all" && !searchQuery;
    grid.innerHTML = firstTime
      ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                     height:240px;gap:10px;grid-column:1/-1;text-align:center">
           <span style="width:44px;height:44px;opacity:.2">${logoMark()}</span>
           <div style="font-size:15px;font-weight:500;color:var(--text-s)">Your notebook is empty</div>
           <div style="font-size:12px;color:var(--text-m);line-height:1.6">
             Tap <strong style="color:var(--text-s)">+</strong> to write your first note
           </div>
         </div>`
      : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                     height:200px;color:var(--text-m);font-size:13px;gap:8px;grid-column:1/-1">
           <span style="font-size:28px;opacity:.3">&#x1F5D2;</span>
           Nothing here yet
         </div>`;
    return;
  }

  grid.innerHTML = list.map((n, i) => {
    const id    = esc(n.id);
    const isNew = !seenBefore.has(n.id);
    const delay = isNew && firstPaint ? ` style="animation-delay:${Math.min(i, 8) * 45}ms"` : "";
    return `
    <div class="card${isNew ? " card-in" : ""}" data-id="${id}"${delay}>
      <div class="card-actions">
        <button class="card-btn card-pin${n.pinned ? " pinned" : ""}" data-id="${id}" title="${n.pinned ? "Unpin" : "Pin"}">${n.pinned ? "&#x2605;" : "&#x2606;"}</button>
        <button class="card-btn card-edit" data-id="${id}" title="Edit">&#x270E;</button>
        <button class="card-btn card-del"  data-id="${id}" title="Delete">&#x2715;</button>
      </div>
      <div class="ctitle">${esc(n.title)}</div>
      <div class="cbody">${previewMd(n.body)}</div>
      <div class="cmeta">
        <span class="cdate">${fmtCardDate(n)}</span>
        <span class="ctag ${TC[n.tag] ?? "tw"}">${TL[n.tag] ?? esc(String(n.tag))}</span>
      </div>
    </div>
  `;
  }).join("");
}

// ── View modal ─────────────────────────────────────────────────────────────────
function fillView(n: Note): void {
  $("view-title").textContent = n.title || "Untitled";
  $("view-body").innerHTML    = renderMd(n.body || "");
  const tagEl = $("view-tag");
  tagEl.className = `ctag ${TC[n.tag] ?? "tw"}`;
  tagEl.textContent = TL[n.tag] ?? n.tag;
  $("view-pin-badge").classList.toggle("show", n.pinned);
  const pinBtn = $<HTMLButtonElement>("view-pin-btn");
  pinBtn.innerHTML = n.pinned ? "&#x2605; Pinned" : "&#x2606; Pin";
  pinBtn.style.color = n.pinned ? "var(--pin)" : "";
  const edited = n.updatedAt && n.createdAt && n.updatedAt.toMillis() > n.createdAt.toMillis();
  $("view-date").textContent = edited
    ? `Edited ${fmtDate(n.updatedAt)}`
    : `Created ${fmtDate(n.createdAt)}`;
}

function openView(id: string): void {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  viewId = id;
  fillView(n);
  $("ov-view").classList.add("open");
}

function closeView(): void {
  $("ov-view")?.classList.remove("open");
  viewId = null;
}

function refreshView(): void {
  if (!viewId) return;
  const n = notes.find(x => x.id === viewId);
  if (!n) { closeView(); return; }
  fillView(n);
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(id?: string): void {
  editingId = id ?? null;
  const ntEl   = $<HTMLInputElement>("nt");
  const nbEl   = $<HTMLTextAreaElement>("nb");
  const ntagEl = $<HTMLSelectElement>("ntag");
  const npinEl = $<HTMLInputElement>("npin");
  clearModalError();
  const saveBtn = $<HTMLButtonElement>("save-btn");
  saveBtn.disabled = false;
  if (id) {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    $("modal-title").textContent = "Edit note";
    saveBtn.textContent          = "Save";
    ntEl.value = n.title; nbEl.value = n.body; ntagEl.value = n.tag; npinEl.checked = n.pinned;
  } else {
    $("modal-title").textContent = "New note";
    saveBtn.textContent          = "Add note";
    const draft = loadDraft();
    ntEl.value   = draft?.title  ?? "";
    nbEl.value   = draft?.body   ?? "";
    ntagEl.value = draft?.tag    ?? "work";
    npinEl.checked = draft?.pinned ?? false;
  }
  updateWordCount();
  $("ov").classList.add("open");
  setTimeout(() => ntEl.focus(), 210);
}

function closeModal(): void { $("ov").classList.remove("open"); editingId = null; }
function clearModalError(): void { const e = $("err-msg"); e.textContent = ""; e.classList.remove("show"); }

function updateWordCount(): void {
  const el = $("wcount");
  if (!el) return;
  const text  = $<HTMLTextAreaElement>("nb")?.value ?? "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  el.textContent = chars > 0 ? `${words} word${words !== 1 ? "s" : ""} · ${chars} char${chars !== 1 ? "s" : ""}` : "";
}

// ── Delete with undo ───────────────────────────────────────────────────────────
function deleteNote(id: string): void {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  const restore = {
    uid: n.uid, title: n.title, body: n.body, tag: n.tag, pinned: n.pinned,
    createdAt: n.createdAt ?? serverTimestamp(),
    ...(n.updatedAt ? { updatedAt: n.updatedAt } : {}),
  };
  // The cache (and the list) updates immediately, but the promise only settles
  // once the server confirms, which never happens offline, so don't wait on it.
  deleteDoc(doc(db, "notes", id))
    .catch((err) => { console.error(err); showToast("Couldn't delete — try again"); });
  showToast("Note deleted", () => {
    addDoc(collection(db, "notes"), restore).catch(console.error);
  });
}

// ── New-note draft (survives accidental dismiss / reload) ─────────────────────
// Stored per user under `${DRAFT_KEY}:${uid}` (see renderApp).
const DRAFT_KEY = "noteDraft";

function saveDraft(): void {
  if (editingId || !draftKey) return;
  const title = $<HTMLInputElement>("nt").value;
  const body  = $<HTMLTextAreaElement>("nb").value;
  if (!title.trim() && !body.trim()) { localStorage.removeItem(draftKey); return; }
  writeDraft(draftKey, {
    title, body,
    tag:    $<HTMLSelectElement>("ntag").value as Tag,
    pinned: $<HTMLInputElement>("npin").checked,
  });
}

function writeDraft(key: string, draft: Draft): void { localStorage.setItem(key, JSON.stringify(draft)); }

function clearDraft(): void { if (draftKey) localStorage.removeItem(draftKey); }

function loadDraft(): Draft | null {
  if (!draftKey) return null;
  try { return parseDraft(localStorage.getItem(draftKey)); } catch { return null; }
}

// ── Save note ─────────────────────────────────────────────────────────────────
// Firestore applies the write to the local cache right away (onSnapshot shows
// it) but only settles the promise once the server confirms, which never
// happens offline. So close the dialog immediately and only report failures,
// keeping the text as a draft so a rejected save doesn't lose it.
function saveNote(user: User): void {
  const btn = $<HTMLButtonElement>("save-btn");
  if (btn.disabled) return; // save already in flight (double-click / Cmd+Enter)
  const title  = $<HTMLInputElement>("nt").value.trim().slice(0, 200) || "Untitled";
  const body   = $<HTMLTextAreaElement>("nb").value.trim().slice(0, 20000);
  const tag    = $<HTMLSelectElement>("ntag").value      as Tag;
  const pinned = $<HTMLInputElement>("npin").checked;
  btn.disabled = true;
  const write = editingId
    ? updateDoc(doc(db, "notes", editingId), { title, body, tag, pinned, updatedAt: serverTimestamp() })
    : addDoc(collection(db, "notes"), { uid: user.uid, title, body, tag, pinned, createdAt: serverTimestamp() });
  const key = draftKey;
  if (!editingId) clearDraft();
  closeModal();
  if (!navigator.onLine) showToast("Saved offline — will sync when you're back online");
  write.catch((err) => {
    console.error(err);
    if (!key || key !== draftKey) return; // a different user is signed in by now
    writeDraft(key, { title, body, tag, pinned });
    showToast("Couldn't save — your text is kept as a draft", () => openModal(), "Open");
  });
}

// ── Firestore listener ────────────────────────────────────────────────────────
function subscribeToNotes(user: User): void {
  unsubNotes?.();
  const q = query(collection(db, "notes"), where("uid", "==", user.uid));
  unsubNotes = onSnapshot(
    q,
    (snap) => {
      notes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Note, "id">) }));
      const el = $("note-count");
      if (el) el.textContent = `Free · ${notes.length} note${notes.length !== 1 ? "s" : ""}`;
      updateNavCounts();
      renderCards();
      refreshView();
    },
    (err) => { console.error("Firestore:", err); showLoadError(); },
  );
}

// The listener stops after an error, so offer a way to re-subscribe.
function showLoadError(): void {
  const el = $("note-count");
  if (el) el.textContent = "Couldn't load notes";
  const grid = $<HTMLDivElement>("grid");
  if (!grid) return;
  grid.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                     height:200px;color:var(--text-m);font-size:13px;gap:10px;grid-column:1/-1;text-align:center">
       <span style="font-size:28px;opacity:.3">&#x26A0;&#xFE0F;</span>
       Couldn't load your notes.
       <button class="btn" id="notes-retry">Retry</button>
     </div>`;
}

// ── Filter / sort ─────────────────────────────────────────────────────────────
function updateNavCounts(): void {
  const counts: Record<string, number> = { all: notes.length, pinned: 0, work: 0, ideas: 0, personal: 0 };
  for (const n of notes) {
    if (n.pinned) counts.pinned++;
    if (counts[n.tag] !== undefined) counts[n.tag]++;
  }
  document.querySelectorAll<HTMLElement>(".ncount").forEach((el) => {
    el.textContent = String(counts[el.dataset.count ?? ""] ?? 0);
  });
}

function applyFilter(f: FilterType): void {
  filter = f;
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) => {
    el.classList.toggle("on", el.dataset.filter === f);
  });
  const pt = $("ptitle");
  if (pt) pt.textContent = FL[f];
  renderCards();
}

function cycleSortOrder(): void {
  sortOrder = sortOrder === "newest" ? "oldest" : sortOrder === "oldest" ? "az" : "newest";
  const btn = $("sort-btn");
  if (btn) btn.textContent = SORT_LABELS[sortOrder];
  renderCards();
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents(user: User): void {
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => applyFilter(el.dataset.filter as FilterType));
  });

  function doSignOut(): void {
    clearDraft(); // shared computers: don't leave unsaved text behind
    teardownApp();
    signOut(auth);
  }

  $("signout-btn").addEventListener("click", () => doSignOut());
  $("mob-signout").addEventListener("click", () => { if (confirm("Sign out?")) doSignOut(); });

  $("sort-btn").addEventListener("click", cycleSortOrder);

  function syncSearchUI(): void {
    const si = $<HTMLInputElement>("search-input");
    $("search-clear").classList.toggle("show", !!si.value);
    si.closest(".search-wrap")?.classList.toggle("has-value", !!si.value);
  }
  function clearSearch(): void {
    $<HTMLInputElement>("search-input").value = "";
    searchQuery = "";
    syncSearchUI();
    renderCards();
  }
  $<HTMLInputElement>("search-input").addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    syncSearchUI();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderCards, 120);
  });
  $("search-clear").addEventListener("click", () => {
    clearSearch();
    $<HTMLInputElement>("search-input").focus();
  });

  $("fab").addEventListener("click", () => openModal());
  $("cancel-btn").addEventListener("click", () => { if (!editingId) clearDraft(); closeModal(); });
  $("save-btn").addEventListener("click", () => saveNote(user));

  $<HTMLTextAreaElement>("nb").addEventListener("input", () => { updateWordCount(); saveDraft(); });
  $<HTMLInputElement>("nt").addEventListener("input", saveDraft);
  $<HTMLSelectElement>("ntag").addEventListener("change", saveDraft);
  $<HTMLInputElement>("npin").addEventListener("change", saveDraft);

  $("ov").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(user);
  });
  $("ov").addEventListener("click", (e) => { if (e.target === $("ov")) closeModal(); });

  $("view-close").addEventListener("click", closeView);
  $("ov-view").addEventListener("click", (e) => { if (e.target === $("ov-view")) closeView(); });
  $("view-edit").addEventListener("click", () => {
    const id = viewId;
    closeView();
    if (id) openModal(id);
  });
  $("view-pin-btn").addEventListener("click", () => {
    if (!viewId) return;
    const n = notes.find(x => x.id === viewId);
    if (n) updateDoc(doc(db, "notes", n.id), { pinned: !n.pinned }).catch(console.error);
  });
  $("view-del-btn").addEventListener("click", () => {
    const id = viewId;
    closeView();
    if (id) deleteNote(id);
  });

  $<HTMLDivElement>("grid").addEventListener("click", (e) => {
    const t       = e.target as HTMLElement;
    if (t.closest("#notes-retry")) {
      $("grid").innerHTML = SKELETONS;
      $("note-count").textContent = "Loading…";
      subscribeToNotes(user);
      return;
    }
    const editBtn = t.closest<HTMLElement>(".card-edit");
    const delBtn  = t.closest<HTMLElement>(".card-del");
    const pinBtn  = t.closest<HTMLElement>(".card-pin");
    if (editBtn) {
      openModal(editBtn.dataset.id!);
    } else if (delBtn) {
      deleteNote(delBtn.dataset.id!);
    } else if (pinBtn) {
      const n = notes.find((x) => x.id === pinBtn.dataset.id);
      if (n) updateDoc(doc(db, "notes", n.id), { pinned: !n.pinned }).catch(console.error);
    } else {
      const card = t.closest<HTMLElement>(".card");
      if (card?.dataset.id) openView(card.dataset.id);
    }
  });

  // Global keyboard shortcuts
  keyboardHandler = (e: KeyboardEvent) => {
    const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === "Escape") {
      if ($("ov-view")?.classList.contains("open")) { closeView(); return; }
      if ($("ov")?.classList.contains("open"))      { closeModal(); return; }
      const si = $<HTMLInputElement>("search-input");
      if (si && document.activeElement === si && si.value) { clearSearch(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      if (!$("ov")?.classList.contains("open") && !$("ov-view")?.classList.contains("open")) openModal();
      return;
    }
    if (e.key === "/" && !inInput) {
      e.preventDefault();
      $<HTMLInputElement>("search-input")?.focus();
    }
  };
  document.addEventListener("keydown", keyboardHandler);
}

// ── Mascot ────────────────────────────────────────────────────────────────────
function startMascot(): void {
  let qi = 0;
  quoteTimer = setInterval(() => {
    const qb  = $("qb");
    const fig = $("fig");
    if (!qb || !fig) return;
    qb.style.opacity = "0";
    setTimeout(() => {
      qi = (qi + 1) % QUOTES.length;
      qb.textContent   = QUOTES[qi];
      qb.style.opacity = "1";
      fig.classList.add("boing");
      setTimeout(() => fig.classList.remove("boing"), 600);
    }, 290);
  }, 4000);
}
