import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAQi3exTQA2jXheGJj0Rua8RsV8A6i7wEg",
  authDomain: "my-notebook-web.firebaseapp.com",
  projectId: "my-notebook-web",
  storageBucket: "my-notebook-web.firebasestorage.app",
  messagingSenderId: "774734979683",
  appId: "1:774734979683:web:137ae2206e6b0f59560e56",
  measurementId: "G-B8HHF0C91C",
};

const fbApp     = initializeApp(firebaseConfig);
const db        = getFirestore(fbApp);
// indexedDBLocalPersistence survives iOS Safari's cross-site navigation wipe;
// sessionStorage (the default) gets cleared when the browser leaves for Google and returns.
const auth      = initializeAuth(fbApp, { persistence: indexedDBLocalPersistence });
const gProvider = new GoogleAuthProvider();

// ── Types ─────────────────────────────────────────────────────────────────────
type Tag        = "work" | "ideas" | "personal";
type FilterType = "all" | "pinned" | Tag;

interface Note {
  id:        string;
  uid:       string;
  title:     string;
  body:      string;
  tag:       Tag;
  pinned:    boolean;
  createdAt: Timestamp | null;
}

// ── State ─────────────────────────────────────────────────────────────────────
let notes:      Note[]               = [];
let filter:     FilterType           = "all";
let searchQuery                      = "";
let editingId:  string | null        = null;
let unsubNotes: (() => void) | null  = null;
let quoteTimer: ReturnType<typeof setInterval> | null = null;

// ── Constants ─────────────────────────────────────────────────────────────────
const QUOTES = [
  "You got this. Probably.",
  "Genius at work. Allegedly.",
  "One note at a time, boss.",
  "Touch grass later. Write now.",
  "Big brain energy detected.",
  "Future you says: nice work.",
  "Main character behavior.",
  "Notes are just vibes with ambition.",
  "You're built different. Literally.",
  "Coffee is optional. You are not.",
  "Award-winning note-taker.",
  "Productivity? She's right here.",
];

const TC: Record<Tag, string>        = { work: "tw", ideas: "ti", personal: "tp" };
const TL: Record<Tag, string>        = { work: "Work", ideas: "Ideas", personal: "Personal" };
const FL: Record<FilterType, string> = {
  all: "All Notes", pinned: "Pinned",
  work: "Work", ideas: "Ideas", personal: "Personal",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(ts: Timestamp | null): string {
  if (!ts || typeof ts.toMillis !== "function") return "Just now";
  const d = Date.now() - ts.toMillis();
  if (d < 60_000)      return "Just now";
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 172_800_000) return "Yesterday";
  return ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(u: User): string {
  if (u.displayName) {
    const p = u.displayName.trim().split(/\s+/);
    return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase();
  }
  return (u.email?.[0] ?? "?").toUpperCase();
}

function firstName(u: User): string {
  if (u.displayName) return u.displayName.trim().split(/\s+/)[0];
  return u.email?.split("@")[0] ?? "User";
}

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── CSS ───────────────────────────────────────────────────────────────────────
function injectCSS(): void {
  const s = document.createElement("style");
  s.textContent = `
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overflow:hidden}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;background:#f0f0ed}
    #app{width:100vw;height:100dvh;display:flex;align-items:stretch;border:none!important;max-width:none!important;text-align:left}

    .app{display:flex;width:100%;height:100dvh;background:#fff}

    /* ── Sidebar ── */
    .sidebar{width:210px;flex-shrink:0;background:#f9f9f7;border-right:1px solid #efefed;display:flex;flex-direction:column}
    .profile{display:flex;align-items:center;gap:10px;padding:20px 16px 16px;border-bottom:1px solid #efefed}
    .av{width:32px;height:32px;border-radius:50%;background:#1a1a1a;color:#fff;font-size:12px;font-weight:500;display:flex;align-items:center;justify-content:center;flex-shrink:0;letter-spacing:.3px;cursor:default}
    .pname{font-size:13px;font-weight:500;color:#1a1a1a}
    .psub{font-size:11px;color:#b0b0ae;margin-top:1px}
    nav{padding:10px 8px;flex:1}
    .ni{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;font-size:13px;color:#666;cursor:pointer;transition:background 120ms,color 120ms;user-select:none}
    .ni:hover{background:#edede9;color:#1a1a1a}
    .ni.on{background:#e8e8e4;color:#1a1a1a;font-weight:500}
    .ndot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
    .ndiv{height:1px;background:#efefed;margin:5px 10px}

    /* ── Mascot ── */
    .mascot{padding:12px 12px 14px;border-top:1px solid #efefed;display:flex;flex-direction:column;align-items:center;gap:9px}
    .qbox{background:#fff;border:1px solid #e8e8e5;border-radius:10px;padding:7px 10px;font-size:10.5px;color:#777;line-height:1.5;text-align:center;width:100%;transition:opacity 280ms ease;font-style:italic}
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    @keyframes bounce{0%{transform:translateY(0)}30%{transform:translateY(-9px) scale(1.05)}65%{transform:translateY(-3px)}100%{transform:translateY(0)}}
    .fig{animation:bob 3s ease-in-out infinite;cursor:default}
    .fig.boing{animation:bob 3s ease-in-out infinite,bounce .55s ease-out}

    /* ── Main ── */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;min-width:0}
    .topbar{padding:22px 24px 0;flex-shrink:0}
    .topbar-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .ptitle{font-size:20px;font-weight:600;letter-spacing:-.3px;color:#1a1a1a}
    .mob-av{display:none;width:30px;height:30px;border-radius:50%;background:#1a1a1a;color:#fff;font-size:11px;font-weight:500;align-items:center;justify-content:center;border:none;cursor:pointer;letter-spacing:.3px;flex-shrink:0}
    .searchrow{position:relative;margin-bottom:14px}
    .searchrow svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none}
    .searchrow input{width:100%;padding:8px 12px 8px 32px;border:1px solid #ebebeb;border-radius:9px;background:#f9f9f7;font-size:13px;color:#1a1a1a;outline:none;transition:border-color 150ms,background 150ms;font-family:inherit}
    .searchrow input::placeholder{color:#c0c0bd}
    .searchrow input:focus{border-color:#ccc;background:#fff}

    /* ── Grid ── */
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));align-items:start;gap:12px;padding:0 24px 90px;overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:#e0e0dc transparent}
    .grid::-webkit-scrollbar{width:4px}
    .grid::-webkit-scrollbar-thumb{background:#e0e0dc;border-radius:4px}

    /* ── Cards ── */
    .card{position:relative;overflow:hidden;background:#fff;border:1px solid #edede9;border-radius:12px;padding:11px 12px;max-height:160px;cursor:default;transition:border-color 180ms,transform 200ms,box-shadow 200ms;animation:cardIn .3s cubic-bezier(.4,0,.2,1) both}
    .card:hover{border-color:#d2d2cc;transform:translateY(-2px);box-shadow:0 6px 22px rgba(0,0,0,.07)}
    .card::after{content:'';position:absolute;inset:0;background:linear-gradient(108deg,transparent 30%,rgba(255,255,255,.72) 50%,transparent 70%);transform:translateX(-140%);pointer-events:none}
    .card:hover::after{animation:shine .55s ease-out forwards}
    @keyframes shine{to{transform:translateX(160%)}}
    @keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .ctitle{font-size:13px;font-weight:500;margin-bottom:5px;line-height:1.4;color:#1a1a1a;padding-right:60px}
    .cbody{font-size:12px;color:#a0a09c;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .cmeta{display:flex;justify-content:space-between;align-items:center;margin-top:8px}
    .cdate{font-size:10.5px;color:#c5c5c0}
    .ctag{font-size:10px;padding:2px 7px;border-radius:6px;font-weight:500}
    .tw{background:#f0f0ec;color:#888}
    .ti{background:#fdf3ec;color:#b07840}
    .tp{background:#ecf1fc;color:#5878b8}

    /* ── Card action buttons ── */
    .card-actions{position:absolute;top:7px;right:7px;display:flex;gap:3px;opacity:0;transition:opacity 150ms;z-index:1}
    .card:hover .card-actions{opacity:1}
    .card-btn{width:24px;height:24px;border-radius:6px;border:1px solid #e8e8e4;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:background 120ms,border-color 120ms;padding:0;line-height:1;color:#aaa}
    .card-btn:hover{background:#f0f0ed;color:#1a1a1a;border-color:#d8d8d4}
    .card-del:hover{background:#fff0f0!important;border-color:#f8d4d4!important;color:#c55!important}
    .card-pin.pinned{color:#c09040}

    /* ── FAB ── */
    .fab{position:absolute;bottom:24px;right:24px;width:48px;height:48px;border-radius:50%;background:#1a1a1a;border:none;color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 220ms cubic-bezier(.34,1.4,.64,1),background 150ms;box-shadow:0 2px 16px rgba(0,0,0,.15);z-index:10}
    .fab:hover{transform:scale(1.1) rotate(88deg);background:#222}
    .fab:active{transform:scale(.94)}

    /* ── Modal ── */
    .ov{position:absolute;inset:0;background:rgba(255,255,255,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 180ms;z-index:50}
    .ov.open{opacity:1;pointer-events:all}
    .modal{background:#fff;border:1px solid #e4e4e0;border-radius:14px;padding:22px;width:300px;transform:scale(.93) translateY(10px);transition:transform 240ms cubic-bezier(.34,1.3,.64,1),opacity 200ms;opacity:0;box-shadow:0 8px 40px rgba(0,0,0,.1)}
    .ov.open .modal{transform:scale(1) translateY(0);opacity:1}
    .modal h3{font-size:14px;font-weight:600;margin-bottom:14px;color:#1a1a1a}
    .modal input,.modal textarea,.modal select{width:100%;border:1px solid #e8e8e4;border-radius:8px;padding:9px 10px;font-size:13px;color:#1a1a1a;background:#f9f9f7;outline:none;font-family:inherit;transition:border-color 140ms,background 140ms;margin-bottom:9px;display:block}
    .modal input:focus,.modal textarea:focus,.modal select:focus{border-color:#c8c8c4;background:#fff}
    .modal textarea{resize:none;height:76px;line-height:1.55}
    .modal select{appearance:none;-webkit-appearance:none;cursor:pointer}
    .pin-row{display:flex;align-items:center;gap:7px;font-size:13px;color:#666;margin-bottom:12px;cursor:pointer;user-select:none}
    .pin-row input[type=checkbox]{width:14px;height:14px;margin:0;cursor:pointer;accent-color:#1a1a1a}
    .mbtns{display:flex;gap:8px;justify-content:flex-end}
    .btn{padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;border:1px solid #e4e4e0;background:#fff;color:#666;transition:background 120ms,opacity 120ms}
    .btn:hover{background:#f5f5f2}
    .btn:disabled{opacity:.5;cursor:default}
    .btnp{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
    .btnp:hover{background:#2e2e2e}
    .err-msg{font-size:11.5px;color:#c44;margin-bottom:10px;display:none}
    .err-msg.show{display:block}

    /* ── Mobile bottom nav ── */
    .mnav{display:none}

    /* ── Login ── */
    .login-wrap{display:flex;align-items:center;justify-content:center;width:100vw;height:100dvh}
    .login-box{text-align:center;padding:40px}
    .login-icon{font-size:44px;margin-bottom:14px}
    .login-box h1{font-size:28px;font-weight:600;color:#1a1a1a;margin-bottom:6px;letter-spacing:-.5px}
    .login-box p{font-size:13px;color:#aaa;margin-bottom:30px}
    .g-btn{display:inline-flex;align-items:center;gap:10px;padding:12px 24px;border:1px solid #e0e0e0;border-radius:10px;background:#fff;cursor:pointer;font-size:14px;font-family:inherit;color:#1a1a1a;box-shadow:0 1px 8px rgba(0,0,0,.07);transition:box-shadow 150ms,transform 120ms}
    .g-btn:hover{box-shadow:0 4px 16px rgba(0,0,0,.11);transform:translateY(-1px)}

    /* ── Mobile ── */
    @media(max-width:640px){
      .sidebar{display:none}
      .topbar{padding:16px 14px 0}
      .mob-av{display:flex}
      .grid{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:9px;padding:0 14px 16px}
      .fab{bottom:74px;right:16px;width:46px;height:46px}
      .ov .modal{width:calc(100vw - 32px);margin:0 16px}
      .mnav{
        display:flex;border-top:1px solid #efefed;background:#f9f9f7;
        flex-shrink:0;padding-bottom:env(safe-area-inset-bottom,0px)
      }
      .mn-btn{
        flex:1;padding:10px 2px 11px;border:none;background:none;
        font-size:10px;color:#888;cursor:pointer;font-family:inherit;
        display:flex;flex-direction:column;align-items:center;gap:3px;
        transition:color 120ms;-webkit-tap-highlight-color:transparent
      }
      .mn-btn span{font-size:16px;line-height:1}
      .mn-btn.on{color:#1a1a1a;font-weight:600}
    }
  `;
  document.head.appendChild(s);
}

// ── Login screen ──────────────────────────────────────────────────────────────
function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-icon">📓</div>
        <h1>Notebook</h1>
        <p>Sign in to access your notes</p>
        <button class="g-btn" id="google-signin">
          <svg width="17" height="17" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  `;
  $("google-signin").addEventListener("click", () => {
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      signInWithRedirect(auth, gProvider).catch(console.error);
    } else {
      signInWithPopup(auth, gProvider).catch(console.error);
    }
  });
}

// ── App shell ─────────────────────────────────────────────────────────────────
function renderApp(root: HTMLElement, user: User): void {
  const av   = esc(initials(user));
  const name = esc(firstName(user));

  root.innerHTML = `
    <div class="app">
      <div class="sidebar">
        <div class="profile">
          <div class="av">${av}</div>
          <div>
            <div class="pname">${name}</div>
            <div class="psub" id="note-count">Loading…</div>
          </div>
        </div>
        <nav>
          <div class="ni on" data-filter="all">All Notes</div>
          <div class="ni" data-filter="pinned">Pinned</div>
          <div class="ndiv"></div>
          <div class="ni" data-filter="work"><span class="ndot" style="background:#b0b0ac"></span>Work</div>
          <div class="ni" data-filter="ideas"><span class="ndot" style="background:#c09868"></span>Ideas</div>
          <div class="ni" data-filter="personal"><span class="ndot" style="background:#8090c8"></span>Personal</div>
          <div class="ndiv"></div>
          <div class="ni" id="signout-btn" style="color:#b55">Sign out</div>
        </nav>
        <div class="mascot">
          <div class="qbox" id="qb">You got this. Probably.</div>
          <svg class="fig" id="fig" width="46" height="60" viewBox="0 0 46 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="23" cy="13" r="11.5" fill="#1a1a1a"/>
            <circle cx="18.5" cy="11.5" r="2.2" fill="white"/>
            <circle cx="27.5" cy="11.5" r="2.2" fill="white"/>
            <circle cx="19" cy="12" r="1.1" fill="#1a1a1a"/>
            <circle cx="28" cy="12" r="1.1" fill="#1a1a1a"/>
            <circle cx="19.6" cy="11.3" r=".45" fill="white"/>
            <circle cx="28.6" cy="11.3" r=".45" fill="white"/>
            <path d="M 17 16.5 Q 23 21.5 29 16.5" stroke="white" stroke-width="1.6" fill="none" stroke-linecap="round"/>
            <ellipse cx="15" cy="16" rx="2.5" ry="1.4" fill="rgba(255,160,120,.35)"/>
            <ellipse cx="31" cy="16" rx="2.5" ry="1.4" fill="rgba(255,160,120,.35)"/>
            <line x1="23" y1="24.5" x2="23" y2="42" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="23" y1="30" x2="12" y2="38" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>
            <line x1="23" y1="30" x2="34" y2="38" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>
            <line x1="23" y1="42" x2="15.5" y2="56" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>
            <line x1="23" y1="42" x2="30.5" y2="56" stroke="#1a1a1a" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <div class="main">
        <div class="topbar">
          <div class="topbar-row">
            <div class="ptitle" id="ptitle">All Notes</div>
            <button class="mob-av" id="mob-signout" title="Sign out">${av}</button>
          </div>
          <div class="searchrow">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#c0c0bc" stroke-width="1.5">
              <circle cx="6" cy="6" r="4.5"/><line x1="9.5" y1="9.5" x2="13" y2="13"/>
            </svg>
            <input type="text" id="search-input" placeholder="Search notes…">
          </div>
        </div>

        <div class="grid" id="grid"></div>

        <button class="fab" id="fab">+</button>

        <div class="ov" id="ov">
          <div class="modal">
            <h3 id="modal-title">New note</h3>
            <div class="err-msg" id="err-msg"></div>
            <input  type="text" id="nt"   placeholder="Title">
            <textarea            id="nb"   placeholder="Write something…"></textarea>
            <select              id="ntag">
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

        <nav class="mnav" id="mnav">
          <button class="mn-btn on" data-filter="all"><span>📋</span>All</button>
          <button class="mn-btn"    data-filter="pinned"><span>📌</span>Pinned</button>
          <button class="mn-btn"    data-filter="work"><span>💼</span>Work</button>
          <button class="mn-btn"    data-filter="ideas"><span>💡</span>Ideas</button>
          <button class="mn-btn"    data-filter="personal"><span>🙂</span>Personal</button>
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

  const list = notes
    .filter((n) => filter === "pinned" ? n.pinned : filter === "all" ? true : n.tag === filter)
    .filter((n) => !searchQuery || `${n.title} ${n.body}`.toLowerCase().includes(searchQuery));

  if (!list.length) {
    grid.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:200px;color:#ccc;font-size:13px;gap:8px;grid-column:1/-1"><span style="font-size:28px;opacity:.4">🗒</span>Nothing here yet</div>`;
    return;
  }

  grid.innerHTML = list.map((n, i) => `
    <div class="card" data-id="${n.id}" style="animation-delay:${i * 20}ms">
      <div class="card-actions">
        <button class="card-btn card-pin${n.pinned ? " pinned" : ""}" data-id="${n.id}" title="${n.pinned ? "Unpin" : "Pin"}">${n.pinned ? "★" : "☆"}</button>
        <button class="card-btn card-edit" data-id="${n.id}" title="Edit">✎</button>
        <button class="card-btn card-del"  data-id="${n.id}" title="Delete">✕</button>
      </div>
      <div class="ctitle">${esc(n.title)}</div>
      <div class="cbody">${esc(n.body)}</div>
      <div class="cmeta">
        <span class="cdate">${fmtDate(n.createdAt)}</span>
        <span class="ctag ${TC[n.tag] ?? "tw"}">${TL[n.tag] ?? n.tag}</span>
      </div>
    </div>
  `).join("");
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function openModal(id?: string): void {
  editingId = id ?? null;

  const ntEl   = $<HTMLInputElement>("nt");
  const nbEl   = $<HTMLTextAreaElement>("nb");
  const ntagEl = $<HTMLSelectElement>("ntag");
  const npinEl = $<HTMLInputElement>("npin");

  clearModalError();

  if (id) {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    $("modal-title").textContent = "Edit note";
    $("save-btn").textContent    = "Save";
    ntEl.value     = n.title;
    nbEl.value     = n.body;
    ntagEl.value   = n.tag;
    npinEl.checked = n.pinned;
  } else {
    $("modal-title").textContent = "New note";
    $("save-btn").textContent    = "Add note";
    ntEl.value     = "";
    nbEl.value     = "";
    ntagEl.value   = "work";
    npinEl.checked = false;
  }

  $("ov").classList.add("open");
  setTimeout(() => ntEl.focus(), 210);
}

function closeModal(): void {
  $("ov").classList.remove("open");
  editingId = null;
}

function clearModalError(): void {
  const el = $("err-msg");
  el.textContent = "";
  el.classList.remove("show");
}

function showModalError(msg: string): void {
  const el = $("err-msg");
  el.textContent = msg;
  el.classList.add("show");
}

// ── Save (create or update) ───────────────────────────────────────────────────
async function saveNote(user: User): Promise<void> {
  const title  = $<HTMLInputElement>("nt").value.trim()    || "Untitled";
  const body   = $<HTMLTextAreaElement>("nb").value.trim();
  const tag    = $<HTMLSelectElement>("ntag").value        as Tag;
  const pinned = $<HTMLInputElement>("npin").checked;
  const btn    = $<HTMLButtonElement>("save-btn");

  clearModalError();
  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    if (editingId) {
      await updateDoc(doc(db, "notes", editingId), { title, body, tag, pinned });
    } else {
      await addDoc(collection(db, "notes"), {
        uid: user.uid, title, body, tag, pinned,
        createdAt: serverTimestamp(),
      });
    }
    closeModal();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    showModalError(`Failed to save: ${msg}`);
    btn.textContent = editingId ? "Save" : "Add note";
    btn.disabled    = false;
  }
}

// ── Firestore realtime listener ────────────────────────────────────────────────
// No orderBy in the query — sorts client-side to avoid requiring a composite index.
function subscribeToNotes(user: User): void {
  const q = query(
    collection(db, "notes"),
    where("uid", "==", user.uid),
  );

  unsubNotes = onSnapshot(
    q,
    (snap) => {
      notes = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<Note, "id">) }))
        .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));

      const el = $("note-count");
      if (el) el.textContent = `Free · ${notes.length} note${notes.length !== 1 ? "s" : ""}`;
      renderCards();
    },
    (err) => {
      console.error("Firestore:", err);
    },
  );
}

// ── Filter helper ─────────────────────────────────────────────────────────────
function applyFilter(f: FilterType): void {
  filter = f;
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) => {
    el.classList.toggle("on", el.dataset.filter === f);
  });
  const ptitle = $("ptitle");
  if (ptitle) ptitle.textContent = FL[f];
  renderCards();
}

// ── Event binding ──────────────────────────────────────────────────────────────
function bindEvents(user: User): void {
  // Filter buttons (sidebar + mobile nav both use [data-filter])
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => applyFilter(el.dataset.filter as FilterType));
  });

  // Desktop sign-out
  $("signout-btn").addEventListener("click", () => doSignOut());

  // Mobile sign-out (avatar tap)
  $("mob-signout").addEventListener("click", () => {
    if (confirm("Sign out?")) doSignOut();
  });

  function doSignOut(): void {
    unsubNotes?.(); unsubNotes = null;
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
    notes = []; filter = "all"; searchQuery = "";
    signOut(auth);
  }

  // Search
  $<HTMLInputElement>("search-input").addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    renderCards();
  });

  // FAB
  $("fab").addEventListener("click", () => openModal());

  // Modal controls
  $("cancel-btn").addEventListener("click", () => closeModal());
  $("save-btn").addEventListener("click", () => { saveNote(user).catch(console.error); });

  $("ov").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { saveNote(user).catch(console.error); }
  });

  $("ov").addEventListener("click", (e) => {
    if (e.target === $("ov")) closeModal();
  });

  // Card actions via delegation
  $<HTMLDivElement>("grid").addEventListener("click", (e) => {
    const t       = e.target as HTMLElement;
    const editBtn = t.closest<HTMLElement>(".card-edit");
    const delBtn  = t.closest<HTMLElement>(".card-del");
    const pinBtn  = t.closest<HTMLElement>(".card-pin");

    if (editBtn) {
      e.stopPropagation();
      openModal(editBtn.dataset.id!);
    } else if (delBtn) {
      e.stopPropagation();
      deleteDoc(doc(db, "notes", delBtn.dataset.id!)).catch(console.error);
    } else if (pinBtn) {
      e.stopPropagation();
      const n = notes.find((x) => x.id === pinBtn.dataset.id);
      if (n) updateDoc(doc(db, "notes", n.id), { pinned: !n.pinned }).catch(console.error);
    }
  });
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

// ── Entry ─────────────────────────────────────────────────────────────────────
function startApp(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) { setTimeout(startApp, 10); return; }

  injectCSS();

  // Needed on mobile: pick up the user after Google redirects back to the app.
  getRedirectResult(auth).catch(console.error);

  onAuthStateChanged(auth, (user) => {
    unsubNotes?.(); unsubNotes = null;
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }

    if (user) {
      renderApp(root, user);
    } else {
      renderLogin(root);
    }
  });
}

startApp();
