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
import {
  $, esc, fmtDate, fmtCardDate, initials, firstName, showToast, hideToast, mountToast, undoFromToast,
} from "./ui";
import { renderMd, previewMd, markdownText } from "./markdown";
import { parseDraft, isDraftChanged } from "./draft";
import { pendingWritesSynced } from "./offline-cache";
import { SIGN_OUT_AT_KEY } from "./boot";
import { saveFocus, restoreFocus, tabbables, trapTarget, type ListFocusConfig, type SavedFocus } from "./focus";

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
let dialogReturn:    SavedFocus | null                     = null; // focus target once the open dialog closes
let focusTimer:      ReturnType<typeof setTimeout> | null  = null;
let editOriginal:    Draft | null                          = null; // note as the edit dialog opened it

// Called on every auth change (including sign-out) so listeners and timers
// from a previous session never leak into the next render.
export function teardownApp(): void {
  unsubNotes?.(); unsubNotes = null;
  editOriginal = null;
  if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
  document.body.classList.remove("dialog-open");
  if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
  if (keyboardHandler) { document.removeEventListener("keydown", keyboardHandler); keyboardHandler = null; }
  hideToast();
  viewId = null; editingId = null; draftKey = null; dialogReturn = null;
  notes = []; filter = "all"; searchQuery = ""; sortOrder = "newest";
}

// Legal links and the reCAPTCHA attribution: App Check keeps running while
// signed in, and hiding the badge (style.css) requires this notice.
const LEGAL_FOOT = `<p class="grid-foot">Protected by reCAPTCHA – the Google
  <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Privacy Policy</a> and
  <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Terms of Service</a> apply.
  · <a href="/datenschutz.html">Datenschutz</a> · <a href="/impressum.html">Impressum</a></p>`;

const SKELETONS =
  `<div class="sk-card"><div class="sk-line t"></div><div class="sk-line b"></div><div class="sk-line b2"></div><div class="sk-line g"></div></div>`.repeat(6);

// The grid is rebuilt with innerHTML; these let focus find the same card
// control again (see renderCards / returnFocus).
const CARD_FOCUS: ListFocusConfig = {
  item: ".card", primary: ".card-open", keyed: ["card-open", "card-pin", "card-edit", "card-del"],
};

// Accessible names of the sort button (its text is only "↓ Newest" etc.).
const SORT_NAMES: Record<SortOrder, string> = {
  newest: "Sort: newest first", oldest: "Sort: oldest first", az: "Sort: A–Z",
};

// ── App shell ─────────────────────────────────────────────────────────────────
export function renderApp(root: HTMLElement, user: User): void {
  const av   = esc(initials(user));
  const name = esc(firstName(user));

  // Drafts are per user so the next person signing in on this browser never
  // sees them. The old shared key can't be attributed to anyone, so drop it.
  draftKey = `${DRAFT_KEY}:${user.uid}`;
  localStorage.removeItem(DRAFT_KEY);

  // Coming from the login (or landing) screen, the focused control is about
  // to disappear; on a plain page load there is nothing to carry over.
  const fromScreen = !!root.querySelector(".login-wrap, .landing");

  document.title = `${FL.all} – Notebook`;
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="profile">
          <div class="av" aria-hidden="true">${av}</div>
          <div>
            <div class="pname">${name}</div>
            <div class="psub" id="note-count">Loading&#x2026;</div>
          </div>
        </div>
        <nav aria-label="Filters">
          <button type="button" class="ni on" data-filter="all" aria-current="true">All Notes<span class="ncount" data-count="all"></span></button>
          <button type="button" class="ni" data-filter="pinned">Pinned<span class="ncount" data-count="pinned"></span></button>
          <div class="ndiv"></div>
          <button type="button" class="ni" data-filter="work"><span class="ndot" style="background:#a0a09a"></span>Work<span class="ncount" data-count="work"></span></button>
          <button type="button" class="ni" data-filter="ideas"><span class="ndot" style="background:#c09060"></span>Ideas<span class="ncount" data-count="ideas"></span></button>
          <button type="button" class="ni" data-filter="personal"><span class="ndot" style="background:#7080c0"></span>Personal<span class="ncount" data-count="personal"></span></button>
          <div class="ndiv"></div>
          <button type="button" class="ni ni-danger" id="signout-btn">Sign out</button>
        </nav>
        <button type="button" class="mascot" id="mascot" aria-pressed="false" aria-labelledby="mascot-label qb" title="Pause or resume the quotes">
          <span class="sr-only" id="mascot-label">Pause quotes:</span>
          <div class="qbox" id="qb">You got this. Probably.</div>
          <svg class="fig" id="fig" width="46" height="60" viewBox="0 0 46 60" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
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
        </button>
      </aside>

      <main class="main">
        <div class="topbar">
          <div class="topbar-row">
            <h1 class="ptitle" id="ptitle" tabindex="-1">All Notes</h1>
            <div class="topbar-right">
              <button class="mob-av" id="mob-signout" title="Sign out" aria-label="Sign out, ${av}">${av}</button>
            </div>
          </div>
          <div class="searchrow">
            <div class="search-wrap">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="var(--text-m)" stroke-width="1.5" aria-hidden="true" focusable="false">
                <circle cx="6" cy="6" r="4.5"/><line x1="9.5" y1="9.5" x2="13" y2="13"/>
              </svg>
              <input type="text" id="search-input" placeholder="Search notes&#x2026;" aria-label="Search notes" aria-keyshortcuts="/">
              <button class="search-clear" id="search-clear" title="Clear search" aria-label="Clear search">&#x2715;</button>
              <span class="search-hint" aria-hidden="true">/</span>
            </div>
            <button class="sort-btn" id="sort-btn" aria-label="${SORT_NAMES.newest}">${SORT_LABELS.newest}</button>
          </div>
        </div>

        <!-- Result count after a filter / search change, for screen readers -->
        <div class="sr-only" id="grid-status" role="status" aria-live="polite" aria-atomic="true"></div>

        <div class="grid" id="grid">${SKELETONS}</div>

        <button class="fab" id="fab" aria-label="New note">+</button>

        <!-- Edit / create modal -->
        <div class="ov" id="ov" inert>
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <h2 id="modal-title">New note</h2>
            <div class="err-msg" id="err-msg" role="alert"></div>
            <input  type="text" id="nt" placeholder="Title" maxlength="200" aria-label="Title">
            <textarea           id="nb" placeholder="Write something&#x2026;" maxlength="20000" aria-label="Note text"></textarea>
            <div class="wcount" id="wcount"></div>
            <select             id="ntag" aria-label="Tag">
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
        <div class="ov" id="ov-view" inert>
          <div class="view-modal" role="dialog" aria-modal="true" aria-labelledby="view-title">
            <div class="view-header">
              <div class="view-header-left">
                <span class="ctag" id="view-tag"></span>
                <span class="view-pin-badge" id="view-pin-badge"><span aria-hidden="true">&#x2605; </span>Pinned</span>
              </div>
              <button class="card-btn" id="view-close" title="Close" aria-label="Close">&#x2715;</button>
            </div>
            <h2 class="view-title" id="view-title"></h2>
            <div class="view-body" id="view-body"></div>
            <div class="view-footer">
              <span class="view-date" id="view-date"></span>
              <div class="view-actions">
                <button class="btn" id="view-pin-btn" aria-pressed="false"><span aria-hidden="true">&#x2606; </span>Pin</button>
                <button class="btn view-del" id="view-del-btn">Delete</button>
                <button class="btn btnp" id="view-edit">Edit</button>
              </div>
            </div>
          </div>
        </div>

        <nav class="mnav" id="mnav" aria-label="Filters">
          <button class="mn-btn on" data-filter="all" aria-current="true"><span aria-hidden="true">&#x1F4CB;</span>All</button>
          <button class="mn-btn"    data-filter="pinned"><span aria-hidden="true">&#x1F4CC;</span>Pinned</button>
          <button class="mn-btn"    data-filter="work"><span aria-hidden="true">&#x1F4BC;</span>Work</button>
          <button class="mn-btn"    data-filter="ideas"><span aria-hidden="true">&#x1F4A1;</span>Ideas</button>
          <button class="mn-btn"    data-filter="personal"><span aria-hidden="true">&#x1F642;</span>Personal</button>
        </nav>
      </main>
    </div>
  `;

  mountToast(); // the live region must exist before its first message
  bindEvents(user);
  startMascot();
  subscribeToNotes(user);
  if (fromScreen) $("ptitle").focus();
}

// Lower-cased title, markdown source and the text it renders to, per note
// object (a snapshot creates new objects, so edits refresh it).
const searchTexts = new WeakMap<Note, string>();
function searchText(n: Note): string {
  let t = searchTexts.get(n);
  if (t === undefined) {
    t = `${n.title} ${n.body} ${markdownText(n.body)}`.toLowerCase();
    searchTexts.set(n, t);
  }
  return t;
}

// ── Card rendering ─────────────────────────────────────────────────────────────
// `announce`: the user changed the filter or search, so tell screen readers
// how many notes are shown now (#grid-status, a polite live region).
function renderCards(announce = false): void {
  const grid = $<HTMLDivElement>("grid");
  if (!grid) return;

  // innerHTML below destroys a focused card control (pin, delete, a snapshot
  // arriving): put focus back on the same control, or a neighbour, not <body>.
  // Only keyboard focus scrolls; a mouse click keeps the grid where it is.
  const active = grid.contains(document.activeElement) ? document.activeElement : null;
  const saved  = saveFocus(active, grid, CARD_FOCUS);
  const scroll = !!active?.matches(":focus-visible");
  const list   = visibleNotes();
  grid.innerHTML = cardsHtml(list);
  if (saved) restoreFocus(grid, saved, CARD_FOCUS, $("fab"), { preventScroll: !scroll });
  if (announce) $("grid-status").textContent = resultStatus(list.length);
}

function resultStatus(count: number): string {
  const n = count === 0 ? "no notes" : count === 1 ? "1 note" : `${count} notes`;
  return searchQuery ? `Search: ${n} found` : `${FL[filter]}: ${n}`;
}

function visibleNotes(): Note[] {
  const filtered = notes.filter((n) =>
    (filter === "pinned" ? n.pinned : filter === "all" ? true : n.tag === filter) &&
    // Search the markdown source and the text it renders to ("**bold**" and "bold").
    (!searchQuery || searchText(n).includes(searchQuery))
  );

  // Pinned notes always float to top, then sort by chosen order
  return [...filtered].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortOrder === "oldest") return (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0);
    if (sortOrder === "az")     return a.title.localeCompare(b.title);
    return (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0);
  });
}

function cardsHtml(list: Note[]): string {
  if (!list.length) {
    const firstTime = notes.length === 0 && filter === "all" && !searchQuery;
    return (firstTime
      ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                     height:240px;gap:10px;grid-column:1/-1;text-align:center">
           <span style="font-size:40px;opacity:.2" aria-hidden="true">&#x1F4D3;</span>
           <div style="font-size:15px;font-weight:500;color:var(--text-s)">Your notebook is empty</div>
           <div style="font-size:12px;color:var(--text-m);line-height:1.6">
             Tap <strong style="color:var(--text-s)">+</strong> to write your first note
           </div>
         </div>`
      : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                     height:200px;color:var(--text-m);font-size:13px;gap:8px;grid-column:1/-1">
           <span style="font-size:28px;opacity:.3" aria-hidden="true">&#x1F5D2;</span>
           Nothing here yet
         </div>`) + LEGAL_FOOT;
  }

  // The whole card opens the note on click (grid delegation in bindEvents);
  // .card-open is its keyboard control (inside the card's heading), followed
  // by the card's actions, named after the note: "Delete note: Groceries".
  return list.map((n, i) => {
    const id = esc(n.id);
    const t  = esc(n.title || "Untitled");
    return `
    <div class="card" data-id="${id}" style="animation-delay:${Math.min(i, 8) * 45}ms">
      <h2 class="card-h"><button type="button" class="card-open" data-id="${id}"><span class="ctitle">${esc(n.title)}</span></button></h2>
      <div class="card-actions">
        <button class="card-btn card-pin${n.pinned ? " pinned" : ""}" data-id="${id}" title="${n.pinned ? "Unpin" : "Pin"}" aria-label="Pin note: ${t}" aria-pressed="${n.pinned}">${n.pinned ? "&#x2605;" : "&#x2606;"}</button>
        <button class="card-btn card-edit" data-id="${id}" title="Edit" aria-label="Edit note: ${t}">&#x270E;</button>
        <button class="card-btn card-del"  data-id="${id}" title="Delete" aria-label="Delete note: ${t}">&#x2715;</button>
      </div>
      <div class="cbody">${previewMd(n.body)}</div>
      <div class="cmeta">
        <span class="cdate">${fmtCardDate(n)}</span>
        <span class="ctag ${TC[n.tag] ?? "tw"}">${TL[n.tag] ?? esc(String(n.tag))}</span>
      </div>
    </div>
  `;
  }).join("") + LEGAL_FOOT;
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
  pinBtn.innerHTML = n.pinned ? `<span aria-hidden="true">&#x2605; </span>Pinned` : `<span aria-hidden="true">&#x2606; </span>Pin`;
  pinBtn.setAttribute("aria-pressed", String(n.pinned));
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
  // Afterwards focus goes back to this card: the control that was used, or its title.
  const grid = $("grid");
  const card = [...grid.querySelectorAll<HTMLElement>(".card")].find((c) => c.dataset.id === id);
  const from = card?.contains(document.activeElement) ? document.activeElement : card?.querySelector(".card-open") ?? null;
  dialogReturn = saveFocus(from, grid, CARD_FOCUS);
  showOverlay($("ov-view"), true);
  $("view-close").focus();
}

// `restore` is false when the edit dialog takes over (it inherits dialogReturn).
function closeView(restore = true): void {
  const ov = $("ov-view");
  viewId = null;
  if (!ov?.classList.contains("open")) return;
  showOverlay(ov, false);
  if (restore) returnFocus();
}

// ── Dialog focus ──────────────────────────────────────────────────────────────
// While a dialog is open everything behind it is inert (no clicks, no Tab
// stops, hidden from screen readers), Tab stays inside the dialog (keydown
// handler) and closing it returns focus to the control that opened it.
const DIALOG_BACKGROUND = ".sidebar, .topbar, #grid, #fab, #mnav";

// A closed overlay is inert right away: its fade-out keeps it visible (and,
// without this, focusable) for another 200 ms.
function showOverlay(ov: HTMLElement, open: boolean): void {
  ov.classList.toggle("open", open);
  ov.inert = !open;
  document.body.classList.toggle("dialog-open", open); // hides the floating theme toggle
  document.querySelectorAll<HTMLElement>(DIALOG_BACKGROUND).forEach((el) => { el.inert = open; });
}

function openDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ov.open [role=dialog]");
}

function returnFocus(): void {
  const saved = dialogReturn;
  dialogReturn = null;
  const fab = $("fab");
  if (saved) restoreFocus($("grid"), saved, CARD_FOCUS, fab);
  else fab?.focus();
}

function refreshView(): void {
  if (!viewId) return;
  const n = notes.find(x => x.id === viewId);
  if (!n) { closeView(); return; }
  fillView(n);
}

// ── Modal ──────────────────────────────────────────────────────────────────────
// `returnTo`: where focus goes on close; defaults to the currently focused control.
function openModal(id?: string, returnTo?: SavedFocus | null): void {
  const back = returnTo === undefined ? saveFocus(document.activeElement, $("grid"), CARD_FOCUS) : returnTo;
  const n = id ? notes.find((x) => x.id === id) : undefined;
  if (id && !n) { dialogReturn = back; returnFocus(); return; } // deleted meanwhile (e.g. on another device)
  editingId = id ?? null;
  const ntEl   = $<HTMLInputElement>("nt");
  const nbEl   = $<HTMLTextAreaElement>("nb");
  const ntagEl = $<HTMLSelectElement>("ntag");
  const npinEl = $<HTMLInputElement>("npin");
  clearModalError();
  const saveBtn = $<HTMLButtonElement>("save-btn");
  saveBtn.disabled = false;
  if (n) {
    $("modal-title").textContent = "Edit note";
    saveBtn.textContent          = "Save";
    ntEl.value = n.title; nbEl.value = n.body; ntagEl.value = n.tag; npinEl.checked = n.pinned;
    editOriginal = modalDraft();
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
  dialogReturn = back;
  showOverlay($("ov"), true);
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    focusTimer = null;
    if ($("ov")?.classList.contains("open")) ntEl.focus();
  }, 210);
}

function modalDraft(): Draft {
  return {
    title:  $<HTMLInputElement>("nt").value,
    body:   $<HTMLTextAreaElement>("nb").value,
    tag:    $<HTMLSelectElement>("ntag").value as Tag,
    pinned: $<HTMLInputElement>("npin").checked,
  };
}

// Esc, backdrop and Cancel: edits to an existing note aren't kept as a draft,
// so confirm before throwing them away.
function requestCloseModal(): void {
  if (editingId && editOriginal && isDraftChanged(editOriginal, modalDraft())
      && !confirm("Discard your changes to this note?")) return;
  closeModal();
}

function closeModal(): void {
  editingId = null;
  editOriginal = null;
  if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
  const ov = $("ov");
  if (!ov?.classList.contains("open")) return;
  showOverlay(ov, false);
  returnFocus();
}
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
       <span style="font-size:28px;opacity:.3" aria-hidden="true">&#x26A0;&#xFE0F;</span>
       Couldn't load your notes.
       <button class="btn" id="notes-retry">Retry</button>
     </div>` + LEGAL_FOOT;
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
    const on = el.dataset.filter === f;
    el.classList.toggle("on", on);
    if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
  });
  const pt = $("ptitle");
  if (pt) pt.textContent = FL[f];
  document.title = `${FL[f]} – Notebook`;
  renderCards(true);
}

function cycleSortOrder(): void {
  sortOrder = sortOrder === "newest" ? "oldest" : sortOrder === "oldest" ? "az" : "newest";
  const btn = $("sort-btn");
  if (btn) { btn.textContent = SORT_LABELS[sortOrder]; btn.setAttribute("aria-label", SORT_NAMES[sortOrder]); }
  renderCards();
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents(user: User): void {
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => applyFilter(el.dataset.filter as FilterType));
  });

  // Signing out also removes this account's offline copy of the notes from the
  // device (shared computers). Edits that haven't synced yet only exist in that
  // copy, so ask before deleting them.
  // session.ts then removes the offline copy (in every tab) and reloads into
  // the login screen.
  let signingOut = false;
  async function doSignOut(): Promise<void> {
    if (signingOut) return; // waiting for pending writes can take a few seconds
    signingOut = true;
    try {
      if (!(await pendingWritesSynced()) &&
          !confirm("Some notes haven't synced yet. Signing out now deletes them from this device. Sign out anyway?")) return;
      clearDraft(); // shared computers: don't leave unsaved text behind
      // Tells session.ts in every tab to remove the offline notes (the user
      // just confirmed losing unsynced edits, if there were any).
      try { localStorage.setItem(SIGN_OUT_AT_KEY, String(Date.now())); }
      catch { console.warn("Sign-out marker not saved: site data is blocked"); }
      await signOut(auth);
    } catch (err: unknown) {
      console.error("Sign-out failed:", err);
      showToast("Couldn't sign out — try again");
    } finally {
      signingOut = false;
    }
  }

  $("signout-btn").addEventListener("click", () => { void doSignOut(); });
  $("mob-signout").addEventListener("click", () => { if (confirm("Sign out?")) void doSignOut(); });

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
    renderCards(true);
  }
  $<HTMLInputElement>("search-input").addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    syncSearchUI();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => renderCards(true), 120);
  });
  $("search-clear").addEventListener("click", () => {
    clearSearch();
    $<HTMLInputElement>("search-input").focus();
  });

  // Explicit return target: Safari doesn't focus buttons on click.
  $("fab").addEventListener("click", () => openModal(undefined, saveFocus($("fab"), $("grid"), CARD_FOCUS)));
  $("cancel-btn").addEventListener("click", () => {
    if (editingId) { requestCloseModal(); return; }
    clearDraft(); // explicit cancel of a new note discards its draft
    closeModal();
  });
  $("save-btn").addEventListener("click", () => saveNote(user));

  $<HTMLTextAreaElement>("nb").addEventListener("input", () => { updateWordCount(); saveDraft(); });
  $<HTMLInputElement>("nt").addEventListener("input", saveDraft);
  $<HTMLSelectElement>("ntag").addEventListener("change", saveDraft);
  $<HTMLInputElement>("npin").addEventListener("change", saveDraft);

  // Escape is handled by the global handler below (a second handler here would
  // see focus already returned to, e.g., the search box and clear it).
  $("ov").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(user);
  });
  $("ov").addEventListener("click", (e) => { if (e.target === $("ov")) requestCloseModal(); });

  $("view-close").addEventListener("click", () => closeView());
  $("ov-view").addEventListener("click", (e) => { if (e.target === $("ov-view")) closeView(); });
  $("view-edit").addEventListener("click", () => {
    const id = viewId, back = dialogReturn;
    closeView(false);
    if (id) openModal(id, back); else returnFocus();
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
      openModal(editBtn.dataset.id!, saveFocus(editBtn, $("grid"), CARD_FOCUS));
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
    if (e.key === "Tab") {
      // Keep Tab / Shift+Tab inside an open dialog (aria-modal).
      const dialog = openDialog();
      const to = dialog && trapTarget(dialog, tabbables(dialog), document.activeElement, e.shiftKey);
      if (to) { e.preventDefault(); to.focus(); }
      return;
    }
    const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === "Escape") {
      if ($("ov-view")?.classList.contains("open")) { closeView(); return; }
      if ($("ov")?.classList.contains("open"))      { requestCloseModal(); return; }
      const si = $<HTMLInputElement>("search-input");
      if (si && document.activeElement === si && si.value) { clearSearch(); return; }
    }
    // Undo a delete while its toast is shown (announced with the toast), so
    // keyboard users don't have to Tab to the Undo button in time. Not in a
    // text field (native undo there) or a dialog.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z" && !inInput && !openDialog()) {
      if (undoFromToast()) e.preventDefault();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      if (!$("ov")?.classList.contains("open") && !$("ov-view")?.classList.contains("open")) openModal();
      return;
    }
    // "/" only while no control has focus – body or a non-interactive focus
    // target such as the page heading (WCAG 2.1.4: a single-key shortcut
    // must not fire on buttons or fields); Ctrl/Cmd+K works everywhere.
    const ae = document.activeElement;
    const searchKey = e.key === "/" && (!ae || ae === document.body || ae.getAttribute("tabindex") === "-1");
    if ((searchKey || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) && !openDialog()) {
      e.preventDefault();
      $<HTMLInputElement>("search-input")?.focus();
    }
  };
  document.addEventListener("keydown", keyboardHandler);
}

// ── Mascot ────────────────────────────────────────────────────────────────────
function startMascot(): void {
  let qi = 0;
  const rotate = (): void => {
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
  };
  // Auto-rotating text needs a way to stop it (WCAG 2.2.2): the mascot is a
  // pause toggle, and it starts paused for people who prefer reduced motion.
  const btn = $<HTMLButtonElement>("mascot");
  const setPaused = (paused: boolean): void => {
    btn?.setAttribute("aria-pressed", String(paused));
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
    if (!paused) quoteTimer = setInterval(rotate, 4000);
  };
  setPaused(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  btn?.addEventListener("click", () => setPaused(btn.getAttribute("aria-pressed") !== "true"));
}
