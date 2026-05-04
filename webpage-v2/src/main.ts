import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, query, where, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, type Timestamp,
} from "firebase/firestore";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, fetchSignInMethodsForEmail, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged, type User,
  RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult,
} from "firebase/auth";
import emailjs from "@emailjs/browser";

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
const auth      = getAuth(fbApp);
const gProvider = new GoogleAuthProvider();

// ── Cloudflare Worker + EmailJS ───────────────────────────────────────────────
const WORKER_URL = "https://otp-verify-proxy.mohid-otp-proxy.workers.dev";

const EMAILJS_SERVICE_ID  = "service_3eaw4yl";
const EMAILJS_TEMPLATE_ID = "template_44vymhk";
const EMAILJS_PUBLIC_KEY  = "uBw8CBQZIg47Uf13-";

async function verifyOtp(
  email: string,
  code: string,
): Promise<{ result: "ok" | "wrong" | "expired" | "notfound" | "maxattempts" }> {
  const res = await fetch(WORKER_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ action: "verify", email, code }),
  });
  if (!res.ok) throw new Error(`Verification service error (${res.status})`);
  return res.json() as Promise<{ result: "ok" | "wrong" | "expired" | "notfound" | "maxattempts" }>;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Tag        = "work" | "ideas" | "personal";
type FilterType = "all" | "pinned" | Tag;
type SortOrder  = "newest" | "oldest" | "az";

interface Note {
  id:         string;
  uid:        string;
  title:      string;
  body:       string;
  tag:        Tag;
  pinned:     boolean;
  createdAt:  Timestamp | null;
  updatedAt?: Timestamp | null;
}

// ── State ─────────────────────────────────────────────────────────────────────
let notes:              Note[]                                = [];
let filter:             FilterType                            = "all";
let searchQuery                                               = "";
let sortOrder:          SortOrder                             = "newest";
let editingId:          string | null                         = null;
let viewId:             string | null                         = null;
let viewDelPending:     boolean                               = false;
let viewDelTimer:       ReturnType<typeof setTimeout> | null  = null;
let pendingDelete:      string | null                         = null;
let pendingDeleteTimer: ReturnType<typeof setTimeout> | null  = null;
let unsubNotes:         (() => void) | null                   = null;
let quoteTimer:         ReturnType<typeof setInterval> | null = null;
let lockoutTimer:       ReturnType<typeof setInterval> | null = null;
let keyboardHandler:    ((e: KeyboardEvent) => void) | null   = null;

// ── Brute-force guard ─────────────────────────────────────────────────────────
const bfMap = new Map<string, { count: number; lockedUntil: number }>();

function bfSecondsLeft(email: string): number {
  const e = bfMap.get(email);
  if (!e || e.lockedUntil <= Date.now()) return 0;
  return Math.ceil((e.lockedUntil - Date.now()) / 1000);
}
function bfFail(email: string): boolean {
  const e = bfMap.get(email) ?? { count: 0, lockedUntil: 0 };
  e.count++;
  if (e.count >= 3) { e.lockedUntil = Date.now() + 60_000; e.count = 0; }
  bfMap.set(email, e);
  return e.lockedUntil > Date.now();
}
function bfReset(email: string): void { bfMap.delete(email); }
function bfCount(email: string): number { return bfMap.get(email)?.count ?? 0; }


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
const SORT_LABELS: Record<SortOrder, string> = {
  newest: "↓ Newest",
  oldest: "↑ Oldest",
  az:     "A–Z",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toMillis !== "function") return "Just now";
  const d = Date.now() - ts.toMillis();
  if (d < 60_000)      return "Just now";
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 172_800_000) return "Yesterday";
  return ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function renderMd(raw: string): string {
  function inl(s: string): string {
    return s
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<i>$1</i>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }
  const lines = raw.split("\n");
  const parts: string[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { parts.push("<ul>" + buf.join("") + "</ul>"); buf = []; } };
  for (const line of lines) {
    const m = line.match(/^[-*] (.*)/);
    if (m) { buf.push(`<li>${inl(m[1])}</li>`); }
    else { flush(); parts.push(inl(line)); }
  }
  flush();
  return parts
    .map((p, i) => i === 0 ? p : (p.startsWith("<ul>") || parts[i - 1].endsWith("</ul>") ? p : "<br>" + p))
    .join("")
    .replace(/(<br>){3,}/g, "<br><br>");
}

function previewMd(raw: string): string {
  return raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^[-*] /gm, "");
}

function fmtCardDate(n: Note): string {
  if (n.updatedAt && n.createdAt && n.updatedAt.toMillis() > n.createdAt.toMillis()) {
    return `edited ${fmtDate(n.updatedAt)}`;
  }
  return fmtDate(n.createdAt);
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

// ── Theme ─────────────────────────────────────────────────────────────────────
function initTheme(): void {
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = saved === "dark" || saved === "light"
    ? saved
    : (prefersDark ? "dark" : "light");
  renderThemeToggle();
}

function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function toggleTheme(): void {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  updateThemeIcon();
}

function renderThemeToggle(): void {
  if (document.getElementById("theme-toggle")) { updateThemeIcon(); return; }
  const btn = document.createElement("button");
  btn.id = "theme-toggle";
  btn.title = "Toggle dark mode";
  btn.addEventListener("click", toggleTheme);
  document.body.appendChild(btn);
  updateThemeIcon();
}

function updateThemeIcon(): void {
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.innerHTML = isDark() ? "&#9788;" : "&#9790;";
}

// ── CSS ───────────────────────────────────────────────────────────────────────
function injectCSS(): void {
  const s = document.createElement("style");
  s.textContent = `
    :root {
      --bg:#f0f0ed; --surface:#ffffff; --surface-2:#f9f9f7; --surface-3:#edede9;
      --border:#efefed; --border-2:#e8e8e4; --border-3:#e0e0db;
      --text:#66645f; --text-s:#1a1a1a; --text-m:#b0b0ae; --text-f:#c8c8c4;
      --accent:#1a1a1a; --accent-t:#ffffff;
      --overlay:rgba(255,255,255,.82); --shadow:rgba(0,0,0,.06); --shadow-2:rgba(0,0,0,.10);
      --scrollbar:#e0e0dc; --err:#c44444; --pin:#b08030; --danger:#b84040;
      --tw-bg:#f0f0ec; --tw:#888; --ti-bg:#fdf3ec; --ti:#b07840; --tp-bg:#ecf1fc; --tp:#5878b8;
      --mbody:#1a1a1a; --mlight:#ffffff;
      --ease-out:cubic-bezier(0.23,1,0.32,1);
      --ease-spring:cubic-bezier(0.34,1.3,0.64,1);
      --ease-smooth:cubic-bezier(0.16,1,0.3,1);
    }
    [data-theme="dark"] {
      --bg:#0d0d10; --surface:#141418; --surface-2:#1b1b1f; --surface-3:#212126;
      --border:#222228; --border-2:#2d2d34; --border-3:#38383f;
      --text:#8a8a90; --text-s:#e6e6e3; --text-m:#52525a; --text-f:#3a3a42;
      --accent:#e6e6e3; --accent-t:#0d0d10;
      --overlay:rgba(0,0,0,.78); --shadow:rgba(0,0,0,.45); --shadow-2:rgba(0,0,0,.60);
      --scrollbar:#2a2a32; --err:#e06060; --pin:#c09040; --danger:#e06060;
      --tw-bg:#1d1d1b; --tw:#6a6a67; --ti-bg:#1f1b12; --ti:#927232; --tp-bg:#111520; --tp:#4862a2;
      --mbody:#d0d0cd; --mlight:#141418;
    }
    html.theme-changing, html.theme-changing * {
      transition: background-color 280ms ease, color 280ms ease, border-color 280ms ease,
                  box-shadow 280ms ease, fill 280ms ease, stroke 280ms ease !important;
    }

    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overflow:hidden}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;background:var(--bg);color:var(--text)}
    #app{width:100vw;height:100dvh;display:flex;align-items:stretch;border:none!important;max-width:none!important;text-align:left}

    #theme-toggle{
      position:fixed;top:13px;right:13px;z-index:200;width:32px;height:32px;border-radius:50%;
      border:1px solid var(--border-2);background:var(--surface);color:var(--text-s);font-size:15px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;box-shadow:0 1px 6px var(--shadow);padding:0;line-height:1;
      transition:box-shadow 150ms var(--ease-out),background 150ms,border-color 150ms,transform 150ms var(--ease-out);
    }
    @media(hover:hover) and (pointer:fine){#theme-toggle:hover{box-shadow:0 3px 14px var(--shadow-2)}}
    #theme-toggle:active{transform:scale(0.9)}

    .app{display:flex;width:100%;height:100dvh;background:var(--bg)}

    /* ── Sidebar ── */
    .sidebar{width:214px;flex-shrink:0;background:var(--surface-2);border-right:1px solid var(--border);display:flex;flex-direction:column}
    .profile{display:flex;align-items:center;gap:10px;padding:20px 16px 16px;border-bottom:1px solid var(--border)}
    .av{
      width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--accent-t);
      font-size:12px;font-weight:600;letter-spacing:.3px;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:default;
      box-shadow:0 0 0 2px var(--surface-2),0 0 0 3.5px var(--border-2);
    }
    .pname{font-size:13px;font-weight:500;color:var(--text-s)}
    .psub{font-size:11px;color:var(--text-m);margin-top:1px}
    nav{padding:10px 8px;flex:1}
    .ni{
      display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;
      font-size:13px;color:var(--text);cursor:pointer;
      transition:background 150ms var(--ease-out),color 150ms var(--ease-out),transform 120ms var(--ease-out);
      user-select:none
    }
    @media(hover:hover) and (pointer:fine){.ni:hover{background:var(--surface-3);color:var(--text-s)}}
    .ni:active{transform:scale(0.97)}
    .ni.on{background:var(--surface-3);color:var(--text-s);font-weight:500}
    .ni-danger{color:var(--danger)!important}
    @media(hover:hover) and (pointer:fine){.ni-danger:hover{background:var(--surface-3)!important}}
    .ndot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
    .ndiv{height:1px;background:var(--border);margin:5px 10px}

    /* ── Mascot ── */
    .mascot{padding:12px 12px 14px;border-top:1px solid var(--border);display:flex;flex-direction:column;align-items:center;gap:9px}
    .qbox{
      background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:8px 10px;
      font-size:10.5px;color:var(--text);line-height:1.55;text-align:center;width:100%;
      transition:opacity 300ms var(--ease-smooth);font-style:italic;box-shadow:0 1px 4px var(--shadow);
    }
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    @keyframes bounce{0%{transform:translateY(0)}30%{transform:translateY(-9px) scale(1.05)}65%{transform:translateY(-3px)}100%{transform:translateY(0)}}
    .fig{animation:bob 3s ease-in-out infinite;cursor:default}
    .fig.boing{animation:bob 3s ease-in-out infinite,bounce .55s ease-out}
    .mbody{fill:var(--mbody)} .mlight{fill:var(--mlight)} .msmile{stroke:var(--mlight);fill:none}
    .mlimb{stroke:var(--mbody)} .mblush{fill:rgba(255,150,110,.30)}

    /* ── Main ── */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;min-width:0}
    .topbar{padding:22px 24px 0;flex-shrink:0;background:var(--surface);border-bottom:1px solid var(--border)}
    .topbar-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .ptitle{font-size:20px;font-weight:600;letter-spacing:-.4px;color:var(--text-s)}
    .topbar-right{display:flex;align-items:center;gap:6px}
    .sort-btn{
      display:flex;align-items:center;gap:4px;padding:5px 9px;border-radius:8px;
      border:1px solid var(--border-2);background:var(--surface);font-size:11px;color:var(--text-m);
      cursor:pointer;font-family:inherit;white-space:nowrap;
      transition:background 150ms var(--ease-out),border-color 150ms,color 150ms,transform 120ms var(--ease-out);
    }
    @media(hover:hover) and (pointer:fine){.sort-btn:hover{background:var(--surface-3);color:var(--text-s);border-color:var(--border-3)}}
    .sort-btn:active{transform:scale(0.96)}
    .mob-av{
      display:none;width:30px;height:30px;border-radius:50%;background:var(--accent);color:var(--accent-t);
      font-size:11px;font-weight:600;letter-spacing:.3px;align-items:center;justify-content:center;
      border:none;cursor:pointer;flex-shrink:0;transition:transform 150ms var(--ease-out);
    }
    .mob-av:active{transform:scale(0.92)}
    .searchrow{display:flex;align-items:center;gap:8px;margin-bottom:14px}
    .search-wrap{position:relative;flex:1}
    .search-wrap svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);pointer-events:none}
    .search-wrap input{
      width:100%;padding:8px 34px 8px 32px;border:1px solid var(--border-2);border-radius:9px;
      background:var(--surface-2);color:var(--text-s);font-size:13px;outline:none;font-family:inherit;
      transition:border-color 180ms var(--ease-out),background 180ms;
    }
    .search-wrap input::placeholder{color:var(--text-f)}
    .search-wrap input:focus{border-color:var(--border-3);background:var(--surface)}
    .search-hint{
      position:absolute;right:9px;top:50%;transform:translateY(-50%);
      font-size:11px;color:var(--text-f);background:var(--surface-3);border:1px solid var(--border-2);
      border-radius:5px;padding:1px 5px;pointer-events:none;font-family:inherit;line-height:1.6;
      transition:opacity 150ms;
    }
    .search-wrap input:focus~.search-hint{opacity:0}

    /* ── Grid ── */
    .grid{
      display:grid;grid-template-columns:repeat(auto-fill,minmax(188px,1fr));align-items:start;
      gap:12px;padding:18px 24px 90px;overflow-y:auto;flex:1;background:var(--bg);
      scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent;
    }
    .grid::-webkit-scrollbar{width:4px}
    .grid::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:4px}

    /* ── Cards ── */
    .card{
      position:relative;overflow:hidden;background:var(--surface);border:1px solid var(--border-2);
      border-radius:13px;padding:13px 13px;max-height:168px;cursor:pointer;
      transition:border-color 200ms var(--ease-out),transform 220ms var(--ease-out),box-shadow 220ms var(--ease-out);
      animation:cardIn 340ms var(--ease-out) both;
    }
    @media(hover:hover) and (pointer:fine){
      .card:hover{border-color:var(--border-3);transform:translateY(-2px);box-shadow:0 8px 30px var(--shadow-2)}
    }
    .card::after{
      content:'';position:absolute;inset:0;
      background:linear-gradient(108deg,transparent 30%,rgba(255,255,255,.06) 50%,transparent 70%);
      transform:translateX(-140%);pointer-events:none;
    }
    [data-theme="dark"] .card::after{background:linear-gradient(108deg,transparent 30%,rgba(255,255,255,.04) 50%,transparent 70%)}
    @media(hover:hover) and (pointer:fine){.card:hover::after{animation:shine .6s var(--ease-out) forwards}}
    @keyframes shine{to{transform:translateX(160%)}}
    @keyframes cardIn{from{opacity:0;transform:translateY(10px) scale(0.97)}to{opacity:1;transform:none}}
    .ctitle{font-size:13px;font-weight:500;margin-bottom:5px;line-height:1.4;color:var(--text-s);padding-right:60px}
    .cbody{font-size:12px;color:var(--text-m);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .cmeta{display:flex;justify-content:space-between;align-items:center;margin-top:9px}
    .cdate{font-size:10.5px;color:var(--text-m)}
    .ctag{font-size:10px;padding:2.5px 8px;border-radius:20px;font-weight:500;letter-spacing:.1px}
    .tw{background:var(--tw-bg);color:var(--tw)} .ti{background:var(--ti-bg);color:var(--ti)} .tp{background:var(--tp-bg);color:var(--tp)}

    /* ── Card buttons ── */
    .card-actions{position:absolute;top:8px;right:8px;display:flex;gap:3px;opacity:0;transition:opacity 150ms var(--ease-out);z-index:1}
    @media(hover:hover) and (pointer:fine){.card:hover .card-actions{opacity:1}}
    .card-btn{
      width:24px;height:24px;border-radius:7px;border:1px solid var(--border-2);background:var(--surface);
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      font-size:12px;transition:background 120ms var(--ease-out),border-color 120ms,transform 120ms var(--ease-out);
      padding:0;line-height:1;color:var(--text-m);
    }
    .card-btn:active{transform:scale(0.88)}
    @media(hover:hover) and (pointer:fine){
      .card-btn:hover{background:var(--surface-3);color:var(--text-s);border-color:var(--border-3)}
      .card-del:hover{background:#fff0f0!important;border-color:#f0d0d0!important;color:#c44!important}
      [data-theme="dark"] .card-del:hover{background:#2a1010!important;border-color:#6a3030!important;color:#e06060!important}
    }
    .card-del.pending{background:#fff0f0!important;border-color:#f0b0b0!important;color:#c44!important;font-weight:700;font-size:10px}
    [data-theme="dark"] .card-del.pending{background:#2a1010!important;border-color:#6a3030!important;color:#e06060!important}
    .card-pin.pinned{color:var(--pin)}

    /* ── FAB ── */
    .fab{
      position:absolute;bottom:24px;right:24px;width:48px;height:48px;border-radius:50%;
      background:var(--accent);color:var(--accent-t);border:none;font-size:22px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      transition:transform 250ms var(--ease-spring),background 150ms,box-shadow 200ms var(--ease-out);
      box-shadow:0 2px 16px var(--shadow-2);z-index:10;
    }
    @media(hover:hover) and (pointer:fine){.fab:hover{transform:scale(1.1) rotate(90deg);box-shadow:0 6px 28px var(--shadow-2)}}
    .fab:active{transform:scale(0.92)!important;transition-duration:100ms!important}

    /* ── Overlays ── */
    .ov{
      position:absolute;inset:0;background:var(--overlay);
      backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      display:flex;align-items:center;justify-content:center;
      opacity:0;pointer-events:none;transition:opacity 200ms var(--ease-out);z-index:50;
    }
    .ov.open{opacity:1;pointer-events:all}

    /* ── Edit/create modal ── */
    .modal{
      background:var(--surface);border:1px solid var(--border-2);border-radius:16px;padding:22px;width:308px;
      transform:scale(.95) translateY(8px);
      transition:transform 280ms var(--ease-spring),opacity 200ms var(--ease-out);
      opacity:0;box-shadow:0 12px 48px var(--shadow-2),0 2px 8px var(--shadow);
    }
    .ov.open .modal{transform:scale(1) translateY(0);opacity:1}
    .modal h3{font-size:14px;font-weight:600;margin-bottom:14px;color:var(--text-s)}
    .modal input,.modal textarea,.modal select{
      width:100%;border:1px solid var(--border-2);border-radius:9px;padding:9px 10px;font-size:13px;
      color:var(--text-s);background:var(--surface-2);outline:none;font-family:inherit;
      transition:border-color 150ms var(--ease-out),background 150ms;margin-bottom:9px;display:block;
    }
    .modal input:focus,.modal textarea:focus,.modal select:focus{border-color:var(--border-3);background:var(--surface)}
    .modal textarea{resize:none;height:76px;line-height:1.55}
    .modal select{appearance:none;-webkit-appearance:none;cursor:pointer}
    .wcount{font-size:11px;color:var(--text-m);text-align:right;margin:-4px 0 8px;min-height:14px}
    .pin-row{
      display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text);margin-bottom:12px;cursor:pointer;user-select:none
    }
    .pin-row input[type=checkbox]{width:14px;height:14px;margin:0;cursor:pointer;accent-color:var(--accent)}
    .mbtns{display:flex;gap:8px;justify-content:flex-end}
    .btn{
      padding:8px 16px;border-radius:9px;font-size:13px;cursor:pointer;font-family:inherit;
      border:1px solid var(--border-2);background:var(--surface);color:var(--text);
      transition:background 120ms var(--ease-out),opacity 120ms,transform 120ms var(--ease-out);
    }
    @media(hover:hover) and (pointer:fine){.btn:hover{background:var(--surface-3)}}
    .btn:active:not(:disabled){transform:scale(0.97)}
    .btn:disabled{opacity:.4;cursor:default}
    .btnp{background:var(--accent);color:var(--accent-t);border-color:var(--accent)}
    @media(hover:hover) and (pointer:fine){.btnp:hover{opacity:.86}}
    .err-msg{font-size:11.5px;color:var(--err);margin-bottom:10px;display:none}
    .err-msg.show{display:block}

    /* ── View modal ── */
    .view-modal{
      background:var(--surface);border:1px solid var(--border-2);border-radius:18px;
      padding:22px 24px;width:480px;max-width:calc(100vw - 32px);max-height:76vh;
      display:flex;flex-direction:column;
      transform:scale(.95) translateY(8px);
      transition:transform 280ms var(--ease-spring),opacity 200ms var(--ease-out);
      opacity:0;box-shadow:0 12px 48px var(--shadow-2),0 2px 8px var(--shadow);overflow:hidden;
    }
    .ov.open .view-modal{transform:scale(1) translateY(0);opacity:1}
    .view-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-shrink:0}
    .view-header-left{display:flex;align-items:center;gap:7px}
    .view-pin-badge{font-size:12px;color:var(--pin);display:none}
    .view-pin-badge.show{display:inline}
    .view-title{font-size:18px;font-weight:600;color:var(--text-s);margin-bottom:11px;line-height:1.35;flex-shrink:0;word-break:break-word;letter-spacing:-.2px}
    .view-body{
      flex:1;overflow-y:auto;font-size:13.5px;color:var(--text);line-height:1.7;
      word-break:break-word;min-height:0;
      scrollbar-width:thin;scrollbar-color:var(--scrollbar) transparent;
    }
    .view-body:empty::before{content:'No content.';color:var(--text-f);font-style:italic}
    .view-body ul{padding-left:18px;margin:6px 0}
    .view-body li{margin:2px 0}
    .view-body b{font-weight:600;color:var(--text-s)}
    .view-body i{font-style:italic}
    .view-body code{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--surface-3);padding:1px 5px;border-radius:4px;color:var(--text-s)}
    .cbody b{font-weight:600} .cbody i{font-style:italic}
    .view-body::-webkit-scrollbar{width:4px}
    .view-body::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:4px}
    .view-footer{
      display:flex;align-items:center;justify-content:space-between;
      margin-top:14px;padding-top:12px;border-top:1px solid var(--border);flex-shrink:0;gap:8px;
    }
    .view-date{font-size:11.5px;color:var(--text-m);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .view-actions{display:flex;gap:6px;flex-shrink:0}
    .view-actions .btn{padding:6px 11px;font-size:12px}
    @media(hover:hover) and (pointer:fine){
      .view-del:hover{background:#fff0f0!important;border-color:#f0d0d0!important;color:#c44!important}
      [data-theme="dark"] .view-del:hover{background:#2a1010!important;border-color:#6a3030!important;color:#e06060!important}
    }
    .view-del.pending{background:#fff0f0!important;border-color:#f0b0b0!important;color:#c44!important;font-weight:700}
    [data-theme="dark"] .view-del.pending{background:#2a1010!important;border-color:#6a3030!important;color:#e06060!important}

    /* ── Mobile nav ── */
    .mnav{display:none}

    /* ── Login ── */
    .login-wrap{display:flex;align-items:center;justify-content:center;width:100vw;height:100dvh;background:var(--bg)}
    .login-box{text-align:center;padding:40px}
    .login-icon{font-size:44px;margin-bottom:14px;line-height:1}
    .login-box h1{font-size:28px;font-weight:600;letter-spacing:-.6px;color:var(--text-s);margin-bottom:6px}
    .login-box > p{font-size:13px;color:var(--text-m);margin-bottom:30px}
    @media(min-width:481px){
      .login-box{background:var(--surface);border:1px solid var(--border-2);border-radius:22px;min-width:340px;box-shadow:0 8px 48px var(--shadow)}
    }
    .g-btn{
      display:inline-flex;align-items:center;gap:10px;padding:12px 24px;
      border:1px solid var(--border-2);border-radius:11px;background:var(--surface);cursor:pointer;
      font-size:14px;font-family:inherit;color:var(--text-s);box-shadow:0 1px 4px var(--shadow);
      transition:box-shadow 200ms var(--ease-out),transform 150ms var(--ease-out),background 150ms;
    }
    @media(hover:hover) and (pointer:fine){.g-btn:hover{box-shadow:0 4px 18px var(--shadow-2);transform:translateY(-1px)}}
    .g-btn:active:not(:disabled){transform:scale(0.97)!important}
    .g-btn:disabled{opacity:.45;cursor:default;transform:none!important;box-shadow:none!important}
    .or-row{display:flex;align-items:center;gap:10px;margin:18px auto 16px;width:240px}
    .or-row::before,.or-row::after{content:'';flex:1;height:1px;background:var(--border-2)}
    .or-row span{font-size:11px;color:var(--text-m);flex-shrink:0}
    .email-input{
      width:240px;padding:10px 12px;border:1px solid var(--border-2);border-radius:11px;
      font-size:13px;font-family:inherit;outline:none;color:var(--text-s);background:var(--surface-2);
      transition:border-color 140ms,background 140ms;display:block;margin:0 auto;
    }
    .email-input:focus{border-color:var(--border-3);background:var(--surface)}
    .email-input::placeholder{color:var(--text-f)}
    .email-btn{width:240px;margin:8px auto 0;justify-content:center;padding:11px 0;display:flex}
    .email-btn:disabled{opacity:.5;cursor:default;transform:none!important;box-shadow:none!important}
    .back-link{
      margin:10px auto 0;font-size:12px;color:var(--text-m);background:none;border:none;
      cursor:pointer;font-family:inherit;text-decoration:underline;padding:0;display:block;
    }
    @media(hover:hover) and (pointer:fine){.back-link:hover{color:var(--text-s)}}
    .email-badge{
      font-size:12px;color:var(--text);background:var(--surface-2);border:1px solid var(--border-2);
      border-radius:8px;padding:6px 12px;margin:0 auto 14px;width:240px;text-align:center;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;
    }
    .pw-checks{width:240px;margin:10px auto 4px;display:flex;flex-direction:column;gap:5px;list-style:none;padding:0;text-align:left}
    .pw-check{font-size:12px;color:var(--text-m);display:flex;align-items:center;gap:6px;transition:color 180ms}
    .pw-check::before{content:'○';font-size:10px;flex-shrink:0}
    .pw-check.ok{color:#5a9e6f} .pw-check.ok::before{content:'✓'}
    .pw-check.fail{color:var(--err)} .pw-check.fail::before{content:'✕'}
    .attempt-dots{display:flex;gap:5px;justify-content:center;margin:10px 0 4px}
    .attempt-dot{width:8px;height:8px;border-radius:50%;background:var(--border-2);transition:background 200ms}
    .attempt-dot.used{background:#e07060}
    .lockout-msg{font-size:12px;color:#e07060;text-align:center;margin:6px 0;font-weight:500}
    .login-err{display:none;color:var(--err);font-size:13px;margin:0 auto 14px;max-width:280px;text-align:center}
    .otp-input{font-size:26px;letter-spacing:10px;text-align:center;font-family:ui-monospace,Consolas,monospace;padding:12px 8px}
    .otp-timer{font-size:11px;color:var(--text-m);text-align:center;margin:8px 0 4px;min-height:16px}
    .otp-hint{font-size:12px;color:var(--text-m);margin:0 0 14px;text-align:center;line-height:1.5}

    @media(prefers-reduced-motion:reduce){
      .card{animation:none!important;opacity:1}
      .modal,.view-modal{transition:opacity 150ms!important;transform:none!important}
      .ov.open .modal,.ov.open .view-modal{transform:none!important}
      .fig{animation:none!important}
    }

    @media(max-width:640px){
      #theme-toggle{right:52px}
      .sidebar{display:none}
      .topbar{padding:16px 14px 0}
      .mob-av{display:flex}
      .grid{grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:9px;padding:12px 14px 80px}
      .fab{bottom:74px;right:16px;width:46px;height:46px}
      .ov .modal,.ov .view-modal{width:calc(100vw - 32px);margin:0 16px}
      .mnav{
        display:flex;border-top:1px solid var(--border);background:var(--surface-2);flex-shrink:0;
        padding-bottom:env(safe-area-inset-bottom,0px);
      }
      .mn-btn{
        flex:1;padding:10px 2px 11px;border:none;background:none;font-size:10px;color:var(--text-m);
        cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:3px;
        transition:color 120ms;-webkit-tap-highlight-color:transparent;
      }
      .mn-btn span{font-size:16px;line-height:1}
      .mn-btn.on{color:var(--text-s);font-weight:600}
    }
    @media(max-width:480px){
      .login-wrap{align-items:flex-start;padding-top:clamp(24px,7vh,56px)}
      .login-box{padding:20px 20px 32px;width:100%}
      .login-icon{font-size:34px;margin-bottom:10px}
      .login-box h1{font-size:22px;margin-bottom:4px;letter-spacing:-.3px}
      .login-box > p{font-size:12px;margin-bottom:20px}
      .email-input{font-size:16px;width:100%;box-sizing:border-box}
      .search-wrap input{font-size:16px}
      .modal input,.modal textarea,.modal select{font-size:16px}
      .otp-input{font-size:20px;letter-spacing:6px;padding:12px 4px;width:100%;box-sizing:border-box}
      .g-btn{width:100%;justify-content:center;padding:12px 16px;font-size:13px;box-sizing:border-box}
      .email-btn{width:100%;margin:8px 0 0}
      .or-row{width:100%}
      .email-badge{width:100%;box-sizing:border-box}
      .pw-checks{width:100%}
      .attempt-dots{margin:8px 0 2px}
      .otp-hint{font-size:11px;margin-bottom:10px}
      .otp-timer{margin:6px 0 2px}
      .login-err{font-size:12px}
      .back-link{font-size:11px}
      .search-hint{display:none}
    }
  `;
  document.head.appendChild(s);
}

// ── Login screen ──────────────────────────────────────────────────────────────
function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-icon">&#x1F4D3;</div>
        <h1>Notebook</h1>
        <p>Sign in or create an account</p>
        <div class="login-err" id="login-err"></div>

        <div id="step-email">
          <button class="g-btn email-btn" id="google-signin">
            <svg width="17" height="17" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
          <button class="g-btn email-btn" id="phone-option-btn" style="margin-top:8px">&#x1F4F1; Continue with phone</button>
          <div class="or-row"><span>or</span></div>
          <input class="email-input" type="email" id="email-input" placeholder="your@email.com" autocomplete="email">
          <button class="g-btn email-btn" id="continue-btn">Continue &#x2192;</button>
        </div>

        <div id="step-signin" style="display:none">
          <div class="email-badge" id="badge-signin"></div>
          <input class="email-input" type="password" id="pw-input" placeholder="Password" autocomplete="current-password">
          <div class="attempt-dots">
            <span class="attempt-dot" id="dot-1"></span>
            <span class="attempt-dot" id="dot-2"></span>
            <span class="attempt-dot" id="dot-3"></span>
          </div>
          <div class="lockout-msg" id="lockout-msg" style="display:none"></div>
          <button class="g-btn email-btn" id="signin-btn">Sign in &#x2192;</button>
          <button class="back-link" id="back-from-signin">&#x2190; Use a different email</button>
        </div>

        <div id="step-otp" style="display:none">
          <div class="email-badge" id="badge-otp"></div>
          <p class="otp-hint">We sent a 6-digit code to your email.<br>Check your spam folder too.</p>
          <input class="email-input otp-input" type="text" id="otp-input"
                 placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
          <div class="otp-timer" id="otp-timer"></div>
          <button class="g-btn email-btn" id="verify-otp-btn">Verify &#x2192;</button>
          <button class="back-link" id="resend-otp" style="margin-top:8px">Resend code</button>
          <button class="back-link" id="back-from-otp">&#x2190; Use a different email</button>
        </div>

        <div id="step-create" style="display:none">
          <div class="email-badge" id="badge-create"></div>
          <input class="email-input" type="password" id="new-pw-input" placeholder="Create password" autocomplete="new-password">
          <input class="email-input" style="margin-top:8px" type="password" id="confirm-pw-input" placeholder="Confirm password" autocomplete="new-password">
          <ul class="pw-checks">
            <li class="pw-check" id="chk-len">At least 8 characters</li>
            <li class="pw-check" id="chk-upper">One uppercase letter</li>
            <li class="pw-check" id="chk-num">One number</li>
            <li class="pw-check" id="chk-match">Passwords match</li>
          </ul>
          <button class="g-btn email-btn" id="create-btn" disabled>Create account &#x2192;</button>
          <button class="back-link" id="back-from-create">&#x2190; Use a different email</button>
        </div>

        <div id="step-phone" style="display:none">
          <p class="otp-hint" style="margin-bottom:10px">Enter your number with country code.</p>
          <input class="email-input" type="tel" id="phone-input" placeholder="+1 234 567 8900"
                 autocomplete="tel" inputmode="tel">
          <button class="g-btn email-btn" id="send-code-btn" style="margin-top:8px">Send code &#x2192;</button>
          <button class="back-link" id="back-from-phone">&#x2190; Use a different method</button>
        </div>

        <div id="step-phone-otp" style="display:none">
          <div class="email-badge" id="badge-phone-otp"></div>
          <p class="otp-hint">We sent a 6-digit code to your phone.<br>Check that the number is correct.</p>
          <input class="email-input otp-input" type="text" id="phone-otp-input"
                 placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
          <div class="otp-timer" id="phone-otp-timer"></div>
          <button class="g-btn email-btn" id="verify-phone-btn">Verify &#x2192;</button>
          <button class="back-link" id="resend-phone-otp" style="margin-top:8px">Resend code</button>
          <button class="back-link" id="back-from-phone-otp">&#x2190; Change phone number</button>
        </div>

        <div id="recaptcha-container"></div>
      </div>
    </div>
  `;

  const errEl = $("login-err");
  function showErr(msg: string): void { errEl.textContent = msg; errEl.style.display = "block"; }
  function hideErr(): void { errEl.style.display = "none"; }

  let currentEmail = "";
  let otpTimerInterval: ReturnType<typeof setInterval> | null = null;
  let otpAttempts = 0;
  let currentPhone = "";
  let phoneConfirmationResult: ConfirmationResult | null = null;
  let recaptchaVerifier: RecaptchaVerifier | null = null;
  let phoneTimerInterval: ReturnType<typeof setInterval> | null = null;

  function showStep(step: "email" | "signin" | "otp" | "create" | "phone" | "phone-otp"): void {
    $("step-email").style.display     = step === "email"     ? "" : "none";
    $("step-signin").style.display    = step === "signin"    ? "" : "none";
    $("step-otp").style.display       = step === "otp"       ? "" : "none";
    $("step-create").style.display    = step === "create"    ? "" : "none";
    $("step-phone").style.display     = step === "phone"     ? "" : "none";
    $("step-phone-otp").style.display = step === "phone-otp" ? "" : "none";
    if (step !== "otp"       && otpTimerInterval)   { clearInterval(otpTimerInterval);   otpTimerInterval = null; }
    if (step !== "phone-otp" && phoneTimerInterval) { clearInterval(phoneTimerInterval); phoneTimerInterval = null; }
    hideErr();
  }

  function startOtpTimer(expiresAt: number): void {
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    const timerEl = $("otp-timer");
    const verBtn  = $<HTMLButtonElement>("verify-otp-btn");
    function tick(): void {
      const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (!timerEl) return;
      if (secs <= 0) {
        timerEl.textContent = "Code expired — request a new one";
        timerEl.style.color = "var(--err)";
        verBtn.disabled = true;
        if (otpTimerInterval) { clearInterval(otpTimerInterval); otpTimerInterval = null; }
      } else {
        const m = Math.floor(secs / 60);
        const sc = secs % 60;
        timerEl.textContent = `Expires in ${m}:${String(sc).padStart(2, "0")}`;
        timerEl.style.color = secs < 60 ? "var(--err)" : "var(--text-m)";
      }
    }
    tick();
    otpTimerInterval = setInterval(tick, 1000);
  }

  function startPhoneOtpTimer(expiresAt: number): void {
    if (phoneTimerInterval) clearInterval(phoneTimerInterval);
    const timerEl = $("phone-otp-timer");
    const verBtn  = $<HTMLButtonElement>("verify-phone-btn");
    function tick(): void {
      const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (!timerEl) return;
      if (secs <= 0) {
        timerEl.textContent = "Code expired — request a new one";
        timerEl.style.color = "var(--err)";
        verBtn.disabled = true;
        if (phoneTimerInterval) { clearInterval(phoneTimerInterval); phoneTimerInterval = null; }
      } else {
        const m  = Math.floor(secs / 60);
        const sc = secs % 60;
        timerEl.textContent = `Expires in ${m}:${String(sc).padStart(2, "0")}`;
        timerEl.style.color = secs < 60 ? "var(--err)" : "var(--text-m)";
      }
    }
    tick();
    phoneTimerInterval = setInterval(tick, 1000);
  }

  $<HTMLButtonElement>("google-signin").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("google-signin");
    btn.disabled = true; btn.textContent = "Signing in…";
    hideErr();
    try {
      await signInWithPopup(auth, gProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        signInWithRedirect(auth, gProvider).catch((e: unknown) => {
          showErr((e as Error).message ?? "Sign-in failed");
          btn.disabled = false; btn.textContent = "Continue with Google";
        });
      } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        btn.disabled = false; btn.textContent = "Continue with Google";
      } else {
        showErr(`Sign-in failed: ${(err as Error).message ?? code}`);
        btn.disabled = false; btn.textContent = "Continue with Google";
      }
    }
  });

  async function doSendOtp(email: string): Promise<void> {
    const res = await fetch(WORKER_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "send", email }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `Could not generate code (${res.status})`);
    }
    const { otp, expiresAt } = await res.json() as { otp: string; expiresAt: number };

    try {
      await emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        { to_email: email, otp_code: otp },
        EMAILJS_PUBLIC_KEY,
      );
    } catch (ejsErr: unknown) {
      const detail = (ejsErr as { text?: string; status?: number })?.text
        ?? (ejsErr instanceof Error ? ejsErr.message : JSON.stringify(ejsErr));
      throw new Error(`EmailJS: ${detail}`);
    }

    otpAttempts = 0;
    $<HTMLElement>("badge-otp").textContent = email;
    showStep("otp");
    startOtpTimer(expiresAt);
    $<HTMLInputElement>("otp-input").focus();
  }

  $<HTMLButtonElement>("continue-btn").addEventListener("click", async () => {
    const emailEl = $<HTMLInputElement>("email-input");
    const btn     = $<HTMLButtonElement>("continue-btn");
    const email   = emailEl.value.trim();
    hideErr();
    if (!email || !/\S+@\S+\.\S+/.test(email)) { showErr("Enter a valid email address."); emailEl.focus(); return; }
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      const methods = await fetchSignInMethodsForEmail(auth, email);
      currentEmail = email;
      if (methods.includes("password")) {
        $<HTMLElement>("badge-signin").textContent = email;
        updateDots(email);
        showStep("signin");
        $<HTMLInputElement>("pw-input").focus();
      } else {
        btn.textContent = "Sending code…";
        await doSendOtp(email);
      }
    } catch (err: unknown) {
      showErr(`Error: ${(err as Error).message ?? "unknown"}`);
    } finally {
      btn.disabled = false; btn.textContent = "Continue →";
    }
  });

  $<HTMLInputElement>("email-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("continue-btn").click();
  });

  function updateDots(email: string): void {
    const count = bfCount(email);
    for (let i = 1; i <= 3; i++) $(`dot-${i}`).classList.toggle("used", i <= count);
    const secs = bfSecondsLeft(email);
    const lockEl = $("lockout-msg");
    if (secs > 0) { lockEl.style.display = ""; lockEl.textContent = `Too many attempts. Try again in ${secs}s.`; }
    else lockEl.style.display = "none";
  }

  $<HTMLButtonElement>("signin-btn").addEventListener("click", async () => {
    const pwEl  = $<HTMLInputElement>("pw-input");
    const btn   = $<HTMLButtonElement>("signin-btn");
    const email = currentEmail;
    hideErr();
    if (bfSecondsLeft(email) > 0) { showErr(`Locked out. Try again in ${bfSecondsLeft(email)}s.`); return; }
    const pw = pwEl.value;
    if (!pw) { showErr("Enter your password."); pwEl.focus(); return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      bfReset(email);
      if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        const locked = bfFail(email);
        updateDots(email);
        if (locked) {
          lockoutTimer = setInterval(() => {
            updateDots(email);
            if (bfSecondsLeft(email) <= 0) { clearInterval(lockoutTimer!); lockoutTimer = null; }
          }, 1000);
          showErr("Too many failed attempts. Locked for 1 minute.");
        } else {
          showErr(`Wrong password. ${3 - bfCount(email)} attempt(s) left.`);
        }
      } else {
        showErr(`Sign-in failed: ${(err as Error).message ?? code}`);
      }
      btn.disabled = false; btn.textContent = "Sign in →";
    }
  });

  $<HTMLInputElement>("pw-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("signin-btn").click();
  });
  $("back-from-signin").addEventListener("click", () => { showStep("email"); $<HTMLInputElement>("pw-input").value = ""; });

  $<HTMLInputElement>("otp-input").addEventListener("input", () => {
    const el = $<HTMLInputElement>("otp-input");
    el.value = el.value.replace(/\D/g, "").slice(0, 6);
  });
  $<HTMLInputElement>("otp-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("verify-otp-btn").click();
  });

  $<HTMLButtonElement>("verify-otp-btn").addEventListener("click", async () => {
    const code = $<HTMLInputElement>("otp-input").value.trim();
    const btn  = $<HTMLButtonElement>("verify-otp-btn");
    hideErr();
    if (!/^\d{6}$/.test(code)) { showErr("Enter the 6-digit code from your email."); return; }
    btn.disabled = true; btn.textContent = "Verifying…";
    try {
      const verifyData = await verifyOtp(currentEmail, code);
      const result = verifyData.result;
      if (result === "ok") {
        if (otpTimerInterval) { clearInterval(otpTimerInterval); otpTimerInterval = null; }
        $<HTMLElement>("badge-create").textContent = currentEmail;
        showStep("create");
        $<HTMLInputElement>("new-pw-input").focus();
      } else if (result === "expired") {
        showErr("Code expired. Request a new one."); btn.disabled = true;
      } else if (result === "maxattempts") {
        showErr("Too many wrong attempts. Request a new code."); btn.disabled = true;
      } else {
        otpAttempts++;
        if (otpAttempts >= 5) { showErr("Too many wrong attempts. Request a new code."); btn.disabled = true; }
        else { showErr(`Wrong code. ${5 - otpAttempts} attempt(s) left.`); btn.disabled = false; btn.textContent = "Verify →"; }
      }
    } catch (err: unknown) {
      showErr(`Error: ${(err as Error).message ?? "unknown"}`);
      btn.disabled = false; btn.textContent = "Verify →";
    }
  });

  $<HTMLButtonElement>("resend-otp").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("resend-otp");
    hideErr(); btn.textContent = "Sending…";
    try {
      await doSendOtp(currentEmail);
      btn.textContent = "Sent!";
      setTimeout(() => { btn.textContent = "Resend code"; }, 2500);
    } catch (err: unknown) {
      showErr(`Could not send code: ${(err as Error).message ?? "unknown"}`);
      btn.textContent = "Resend code";
    }
  });

  $("back-from-otp").addEventListener("click", () => {
    showStep("email"); $<HTMLInputElement>("otp-input").value = ""; otpAttempts = 0;
  });

  function checkRequirements(): void {
    const pw1 = $<HTMLInputElement>("new-pw-input").value;
    const pw2 = $<HTMLInputElement>("confirm-pw-input").value;
    const len = pw1.length >= 8;
    const upp = /[A-Z]/.test(pw1);
    const num = /[0-9]/.test(pw1);
    const mat = pw1.length > 0 && pw1 === pw2;
    function mark(id: string, ok: boolean, dirty: boolean): void {
      $(id).classList.toggle("ok",   ok);
      $(id).classList.toggle("fail", !ok && dirty);
    }
    mark("chk-len",   len, pw1.length > 0);
    mark("chk-upper", upp, pw1.length > 0);
    mark("chk-num",   num, pw1.length > 0);
    mark("chk-match", mat, pw2.length > 0);
    $<HTMLButtonElement>("create-btn").disabled = !(len && upp && num && mat);
  }

  $<HTMLInputElement>("new-pw-input").addEventListener("input", checkRequirements);
  $<HTMLInputElement>("confirm-pw-input").addEventListener("input", checkRequirements);

  $<HTMLButtonElement>("create-btn").addEventListener("click", async () => {
    const pw1 = $<HTMLInputElement>("new-pw-input").value;
    const btn = $<HTMLButtonElement>("create-btn");
    hideErr(); btn.disabled = true; btn.textContent = "Creating…";
    try {
      await createUserWithEmailAndPassword(auth, currentEmail, pw1);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      showErr(code === "auth/email-already-in-use"
        ? "Email already registered. Go back and sign in with your password."
        : `Could not create account: ${(err as Error).message ?? "unknown"}`);
      btn.disabled = false; btn.textContent = "Create account →";
    }
  });

  $("back-from-create").addEventListener("click", () => {
    showStep("email");
    $<HTMLInputElement>("new-pw-input").value     = "";
    $<HTMLInputElement>("confirm-pw-input").value = "";
  });

  $("phone-option-btn").addEventListener("click", () => {
    showStep("phone");
    $<HTMLInputElement>("phone-input").focus();
  });

  $<HTMLInputElement>("phone-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("send-code-btn").click();
  });

  $<HTMLButtonElement>("send-code-btn").addEventListener("click", async () => {
    const phoneEl = $<HTMLInputElement>("phone-input");
    const btn     = $<HTMLButtonElement>("send-code-btn");
    const phone   = phoneEl.value.trim().replace(/\s/g, "");
    hideErr();
    if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
      showErr("Enter a valid phone number with country code (e.g. +1 234 567 8900).");
      phoneEl.focus();
      return;
    }
    currentPhone = phone;
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
      recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      phoneConfirmationResult = await signInWithPhoneNumber(auth, currentPhone, recaptchaVerifier);
      $<HTMLElement>("badge-phone-otp").textContent = currentPhone;
      showStep("phone-otp");
      startPhoneOtpTimer(Date.now() + 5 * 60 * 1000);
      $<HTMLInputElement>("phone-otp-input").focus();
    } catch (err: unknown) {
      showErr(`Could not send code: ${(err as Error).message ?? "unknown"}`);
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
    } finally {
      btn.disabled = false; btn.textContent = "Send code →";
    }
  });

  $<HTMLInputElement>("phone-otp-input").addEventListener("input", () => {
    const el = $<HTMLInputElement>("phone-otp-input");
    el.value = el.value.replace(/\D/g, "").slice(0, 6);
  });
  $<HTMLInputElement>("phone-otp-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("verify-phone-btn").click();
  });

  $<HTMLButtonElement>("verify-phone-btn").addEventListener("click", async () => {
    const smsCode = $<HTMLInputElement>("phone-otp-input").value.trim();
    const btn     = $<HTMLButtonElement>("verify-phone-btn");
    hideErr();
    if (!/^\d{6}$/.test(smsCode)) { showErr("Enter the 6-digit code from your SMS."); return; }
    if (!phoneConfirmationResult) { showErr("Session expired. Go back and try again."); return; }
    btn.disabled = true; btn.textContent = "Verifying…";
    try {
      await phoneConfirmationResult.confirm(smsCode);
    } catch (err: unknown) {
      const errCode = (err as { code?: string }).code ?? "";
      if (errCode === "auth/invalid-verification-code") {
        showErr("Wrong code. Please try again.");
      } else if (errCode === "auth/code-expired") {
        showErr("Code expired. Request a new one.");
        btn.disabled = true;
      } else {
        showErr(`Verification failed: ${(err as Error).message ?? "unknown"}`);
      }
      btn.disabled = false; btn.textContent = "Verify →";
    }
  });

  $<HTMLButtonElement>("resend-phone-otp").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("resend-phone-otp");
    hideErr(); btn.textContent = "Sending…";
    try {
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
      recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      phoneConfirmationResult = await signInWithPhoneNumber(auth, currentPhone, recaptchaVerifier);
      startPhoneOtpTimer(Date.now() + 5 * 60 * 1000);
      $<HTMLInputElement>("phone-otp-input").value = "";
      $<HTMLButtonElement>("verify-phone-btn").disabled = false;
      btn.textContent = "Sent!";
      setTimeout(() => { btn.textContent = "Resend code"; }, 2500);
    } catch (err: unknown) {
      showErr(`Could not send code: ${(err as Error).message ?? "unknown"}`);
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
      btn.textContent = "Resend code";
    }
  });

  $("back-from-phone").addEventListener("click", () => {
    showStep("email");
    $<HTMLInputElement>("phone-input").value = "";
    if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
  });

  $("back-from-phone-otp").addEventListener("click", () => {
    showStep("phone");
    $<HTMLInputElement>("phone-otp-input").value = "";
    phoneConfirmationResult = null;
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
            <div class="psub" id="note-count">Loading&#x2026;</div>
          </div>
        </div>
        <nav>
          <div class="ni on" data-filter="all">All Notes</div>
          <div class="ni" data-filter="pinned">Pinned</div>
          <div class="ndiv"></div>
          <div class="ni" data-filter="work"><span class="ndot" style="background:#a0a09a"></span>Work</div>
          <div class="ni" data-filter="ideas"><span class="ndot" style="background:#c09060"></span>Ideas</div>
          <div class="ni" data-filter="personal"><span class="ndot" style="background:#7080c0"></span>Personal</div>
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
              <span class="search-hint">/</span>
            </div>
            <button class="sort-btn" id="sort-btn">${SORT_LABELS.newest}</button>
          </div>
        </div>

        <div class="grid" id="grid"></div>

        <button class="fab" id="fab">+</button>

        <!-- Edit / create modal -->
        <div class="ov" id="ov">
          <div class="modal">
            <h3 id="modal-title">New note</h3>
            <div class="err-msg" id="err-msg"></div>
            <input  type="text" id="nt" placeholder="Title">
            <textarea           id="nb" placeholder="Write something&#x2026;"></textarea>
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

  // Clear pending delete on re-render
  if (pendingDeleteTimer) { clearTimeout(pendingDeleteTimer); pendingDeleteTimer = null; }
  pendingDelete = null;

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
           <span style="font-size:40px;opacity:.2">&#x1F4D3;</span>
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

  grid.innerHTML = list.map((n, i) => `
    <div class="card" data-id="${n.id}" style="animation-delay:${Math.min(i, 8) * 45}ms">
      <div class="card-actions">
        <button class="card-btn card-pin${n.pinned ? " pinned" : ""}" data-id="${n.id}" title="${n.pinned ? "Unpin" : "Pin"}">${n.pinned ? "&#x2605;" : "&#x2606;"}</button>
        <button class="card-btn card-edit" data-id="${n.id}" title="Edit">&#x270E;</button>
        <button class="card-btn card-del"  data-id="${n.id}" title="Delete">&#x2715;</button>
      </div>
      <div class="ctitle">${esc(n.title)}</div>
      <div class="cbody">${previewMd(n.body)}</div>
      <div class="cmeta">
        <span class="cdate">${fmtCardDate(n)}</span>
        <span class="ctag ${TC[n.tag] ?? "tw"}">${TL[n.tag] ?? n.tag}</span>
      </div>
    </div>
  `).join("");
}

// ── View modal ─────────────────────────────────────────────────────────────────
function openView(id: string): void {
  const n = notes.find(x => x.id === id);
  if (!n) return;
  viewId = id;
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
  $("ov-view").classList.add("open");
}

function closeView(): void {
  $("ov-view")?.classList.remove("open");
  viewId = null;
  if (viewDelTimer) { clearTimeout(viewDelTimer); viewDelTimer = null; }
  viewDelPending = false;
  const delBtn = $<HTMLButtonElement>("view-del-btn");
  if (delBtn) { delBtn.textContent = "Delete"; delBtn.classList.remove("pending"); }
}

function refreshView(): void {
  if (!viewId) return;
  const n = notes.find(x => x.id === viewId);
  if (!n) { closeView(); return; }
  $("view-title").textContent = n.title || "Untitled";
  $("view-body").innerHTML    = renderMd(n.body || "");
  const tagEl = $("view-tag");
  tagEl.className = `ctag ${TC[n.tag] ?? "tw"}`;
  tagEl.textContent = TL[n.tag] ?? n.tag;
  $("view-pin-badge").classList.toggle("show", n.pinned);
  const pinBtn2 = $<HTMLButtonElement>("view-pin-btn");
  pinBtn2.innerHTML = n.pinned ? "&#x2605; Pinned" : "&#x2606; Pin";
  pinBtn2.style.color = n.pinned ? "var(--pin)" : "";
  const edited = n.updatedAt && n.createdAt && n.updatedAt.toMillis() > n.createdAt.toMillis();
  $("view-date").textContent = edited
    ? `Edited ${fmtDate(n.updatedAt)}`
    : `Created ${fmtDate(n.createdAt)}`;
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
    ntEl.value = ""; nbEl.value = ""; ntagEl.value = "work"; npinEl.checked = false;
  }
  updateWordCount();
  $("ov").classList.add("open");
  setTimeout(() => ntEl.focus(), 210);
}

function closeModal(): void { $("ov").classList.remove("open"); editingId = null; }
function clearModalError(): void { const e = $("err-msg"); e.textContent = ""; e.classList.remove("show"); }
function showModalError(msg: string): void { const e = $("err-msg"); e.textContent = msg; e.classList.add("show"); }

function updateWordCount(): void {
  const el = $("wcount");
  if (!el) return;
  const text  = $<HTMLTextAreaElement>("nb")?.value ?? "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  el.textContent = chars > 0 ? `${words} word${words !== 1 ? "s" : ""} · ${chars} char${chars !== 1 ? "s" : ""}` : "";
}

// ── Delete with confirm ────────────────────────────────────────────────────────
function tryDelete(id: string): void {
  if (pendingDelete === id) {
    if (pendingDeleteTimer) { clearTimeout(pendingDeleteTimer); pendingDeleteTimer = null; }
    pendingDelete = null;
    deleteDoc(doc(db, "notes", id)).catch(console.error);
    return;
  }
  // Cancel previous pending
  if (pendingDelete) {
    const prev = document.querySelector<HTMLElement>(`.card-del[data-id="${pendingDelete}"]`);
    if (prev) { prev.innerHTML = "&#x2715;"; prev.classList.remove("pending"); }
    if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
  }
  pendingDelete = id;
  const btn = document.querySelector<HTMLElement>(`.card-del[data-id="${id}"]`);
  if (btn) { btn.textContent = "?"; btn.classList.add("pending"); }
  pendingDeleteTimer = setTimeout(() => {
    pendingDelete = null;
    pendingDeleteTimer = null;
    const b = document.querySelector<HTMLElement>(`.card-del[data-id="${id}"]`);
    if (b) { b.innerHTML = "&#x2715;"; b.classList.remove("pending"); }
  }, 2500);
}

// ── Save note ─────────────────────────────────────────────────────────────────
async function saveNote(user: User): Promise<void> {
  const title  = $<HTMLInputElement>("nt").value.trim()  || "Untitled";
  const body   = $<HTMLTextAreaElement>("nb").value.trim();
  const tag    = $<HTMLSelectElement>("ntag").value      as Tag;
  const pinned = $<HTMLInputElement>("npin").checked;
  const btn    = $<HTMLButtonElement>("save-btn");
  clearModalError();
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    if (editingId) {
      await updateDoc(doc(db, "notes", editingId), { title, body, tag, pinned, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "notes"), {
        uid: user.uid, title, body, tag, pinned, createdAt: serverTimestamp(),
      });
    }
    closeModal();
  } catch (err) {
    showModalError(`Failed to save: ${err instanceof Error ? err.message : "unknown"}`);
    btn.textContent = editingId ? "Save" : "Add note";
    btn.disabled = false;
  }
}

// ── Firestore listener ────────────────────────────────────────────────────────
function subscribeToNotes(user: User): void {
  const q = query(collection(db, "notes"), where("uid", "==", user.uid));
  unsubNotes = onSnapshot(
    q,
    (snap) => {
      notes = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Note, "id">) }));
      const el = $("note-count");
      if (el) el.textContent = `Free · ${notes.length} note${notes.length !== 1 ? "s" : ""}`;
      renderCards();
      refreshView();
    },
    (err) => console.error("Firestore:", err),
  );
}

// ── Filter / sort ─────────────────────────────────────────────────────────────
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
    if (keyboardHandler) { document.removeEventListener("keydown", keyboardHandler); keyboardHandler = null; }
    if (pendingDeleteTimer) { clearTimeout(pendingDeleteTimer); pendingDeleteTimer = null; }
    if (viewDelTimer) { clearTimeout(viewDelTimer); viewDelTimer = null; }
    pendingDelete = null; viewId = null; viewDelPending = false;
    unsubNotes?.(); unsubNotes = null;
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
    notes = []; filter = "all"; searchQuery = ""; sortOrder = "newest";
    signOut(auth);
  }

  $("signout-btn").addEventListener("click", () => doSignOut());
  $("mob-signout").addEventListener("click", () => { if (confirm("Sign out?")) doSignOut(); });

  $("sort-btn").addEventListener("click", cycleSortOrder);

  $<HTMLInputElement>("search-input").addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    renderCards();
  });

  $("fab").addEventListener("click", () => openModal());
  $("cancel-btn").addEventListener("click", () => closeModal());
  $("save-btn").addEventListener("click", () => { saveNote(user).catch(console.error); });

  $<HTMLTextAreaElement>("nb").addEventListener("input", updateWordCount);

  $("ov").addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { saveNote(user).catch(console.error); }
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
    const btn = $<HTMLButtonElement>("view-del-btn");
    if (viewDelPending) {
      if (viewDelTimer) { clearTimeout(viewDelTimer); viewDelTimer = null; }
      viewDelPending = false;
      const id = viewId;
      closeView();
      if (id) deleteDoc(doc(db, "notes", id)).catch(console.error);
    } else {
      viewDelPending = true;
      btn.textContent = "Sure?";
      btn.classList.add("pending");
      viewDelTimer = setTimeout(() => {
        viewDelPending = false;
        viewDelTimer = null;
        btn.textContent = "Delete";
        btn.classList.remove("pending");
      }, 2500);
    }
  });

  $<HTMLDivElement>("grid").addEventListener("click", (e) => {
    const t       = e.target as HTMLElement;
    const editBtn = t.closest<HTMLElement>(".card-edit");
    const delBtn  = t.closest<HTMLElement>(".card-del");
    const pinBtn  = t.closest<HTMLElement>(".card-pin");
    if (editBtn) {
      openModal(editBtn.dataset.id!);
    } else if (delBtn) {
      tryDelete(delBtn.dataset.id!);
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

// ── Entry ─────────────────────────────────────────────────────────────────────
function startApp(): void {
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) { setTimeout(startApp, 10); return; }

  initTheme();
  injectCSS();

  getRedirectResult(auth).catch((err: unknown) => {
    console.error("getRedirectResult:", err);
    const show = (): void => {
      const el = document.getElementById("login-err");
      if (el) { el.textContent = "Sign-in was interrupted — please try again."; el.style.display = "block"; }
      else setTimeout(show, 100);
    };
    show();
  });

  onAuthStateChanged(auth, (user) => {
    unsubNotes?.(); unsubNotes = null;
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = null; }
    if (user) { renderApp(root, user); }
    else      { renderLogin(root); }
  });
}

startApp();
