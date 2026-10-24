import type { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import type { Note } from "./types";

// ── DOM / text helpers ────────────────────────────────────────────────────────
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtDate(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toMillis !== "function") return "Just now";
  const d = Date.now() - ts.toMillis();
  if (d < 60_000)      return "Just now";
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 172_800_000) return "Yesterday";
  return ts.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtCardDate(n: Note): string {
  if (n.updatedAt && n.createdAt && n.updatedAt.toMillis() > n.createdAt.toMillis()) {
    return `edited ${fmtDate(n.updatedAt)}`;
  }
  return fmtDate(n.createdAt);
}

export function initials(u: User): string {
  if (u.displayName) {
    const p = u.displayName.trim().split(/\s+/);
    return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase();
  }
  return (u.email?.[0] ?? "?").toUpperCase();
}

export function firstName(u: User): string {
  if (u.displayName) return u.displayName.trim().split(/\s+/)[0];
  return u.email?.split("@")[0] ?? "User";
}

// ── Toast ─────────────────────────────────────────────────────────────────────
// #toast is one persistent live region (role=status): screen readers announce
// each message. It stays in the accessibility tree while hidden (only its
// content is inert), because a region that appears together with its text is
// often not announced. Messages with an action stay longer, and the timer
// pauses while the pointer is over the toast or focus is inside it.
export const TOAST_MS        = 5_000;
export const ACTION_TOAST_MS = 10_000;

let toastTimer:  ReturnType<typeof setTimeout> | null = null;
let toastAction: (() => void) | null                  = null;
let toastUndo    = false;        // the action is an undo (Ctrl/Cmd+Z runs it)
let toastMs      = TOAST_MS;
let toastHover   = false;
let toastFocus   = false;
let toastReturn: HTMLElement | null = null; // focused before focus entered the toast

// How the undo shortcut is spoken / shown on this platform.
export function undoShortcut(): string {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "Command+Z" : "Control+Z";
}

function toastRoot(): HTMLElement {
  const existing = document.getElementById("toast");
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = "toast";
  el.className = "toast";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-atomic", "true");
  // Mouse hover holds the toast; touch "hover" would stick after a tap.
  el.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { toastHover = true; holdToast(); } });
  el.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { toastHover = false; armToast(); } });
  el.addEventListener("focusin", (e) => {
    const from = e.relatedTarget;
    if (!toastFocus && from instanceof HTMLElement && !el.contains(from)) toastReturn = from;
    toastFocus = true;
    holdToast();
  });
  el.addEventListener("focusout", (e) => {
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    toastFocus = false;
    armToast();
  });
  el.addEventListener("click", (e) => {
    if (e.target instanceof Element && e.target.closest("#toast-undo")) runToastAction();
  });
  document.body.appendChild(el);
  return el;
}

// Creates the (empty) live region ahead of the first message.
export function mountToast(): void { toastRoot(); }

export function showToast(msg: string, action?: () => void, actionLabel = "Undo"): void {
  const el = toastRoot();
  const hadFocus = el.contains(document.activeElement);
  toastAction = action ?? null;
  toastUndo   = !!action && actionLabel === "Undo";
  toastMs     = action ? ACTION_TOAST_MS : TOAST_MS;
  const hint  = toastUndo ? `<span class="sr-only">Press ${undoShortcut()} to undo.</span>` : "";
  const keys  = toastUndo ? ` aria-keyshortcuts="Control+Z Meta+Z"` : "";
  el.innerHTML = `<span>${esc(msg)}</span>${hint}`
    + (action ? `<button type="button" id="toast-undo"${keys}>${esc(actionLabel)}</button>` : "");
  el.classList.add("show");
  // The replaced content took focus with it: stay in the toast or go back.
  if (hadFocus) {
    const btn = document.getElementById("toast-undo");
    if (btn) btn.focus(); else returnFromToast();
  }
  toastFocus = el.contains(document.activeElement);
  armToast();
}

// Ctrl/Cmd+Z while an undo toast is shown. Returns false if there is nothing to undo.
export function undoFromToast(): boolean {
  if (!toastUndo || !toastAction) return false;
  runToastAction();
  return true;
}

function runToastAction(): void {
  const fn = toastAction;
  hideToast();
  fn?.();
}

function holdToast(): void {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

// (Re)starts the full timer unless the toast is hidden or held.
function armToast(): void {
  holdToast();
  const el = document.getElementById("toast");
  if (!el?.classList.contains("show") || toastHover || toastFocus) return;
  toastTimer = setTimeout(hideToast, toastMs);
}

function returnFromToast(): void {
  const back = toastReturn;
  toastReturn = null;
  if (back?.isConnected && !back.closest("[inert]")) back.focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

// Content inert right away: the fade-out keeps the old Undo button visible
// (and, without it, focusable) for another 200 ms.
export function hideToast(): void {
  holdToast();
  toastAction = null;
  toastUndo   = false;
  const el = document.getElementById("toast");
  if (!el) return;
  const hadFocus = el.contains(document.activeElement);
  el.classList.remove("show");
  for (const child of el.children) (child as HTMLElement).inert = true;
  toastFocus = false;
  if (hadFocus) returnFromToast(); else toastReturn = null;
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// localStorage throws when the browser blocks site data; the theme then just
// follows the OS setting and isn't remembered.
function savedTheme(): string | null {
  try { return localStorage.getItem("theme"); }
  catch { return null; }
}

function storeTheme(theme: string): void {
  try { localStorage.setItem("theme", theme); }
  catch { console.warn("Theme not saved: site data is blocked"); }
}

export function initTheme(): void {
  const saved = savedTheme();
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
  const html = document.documentElement;
  html.classList.add("theme-changing");
  const next = isDark() ? "light" : "dark";
  html.dataset.theme = next;
  storeTheme(next);
  updateThemeIcon();
  setTimeout(() => html.classList.remove("theme-changing"), 300);
}

// A toggle: the name stays "Dark mode", aria-pressed says whether it is on;
// the sun/moon glyph is decoration.
function renderThemeToggle(): void {
  if (document.getElementById("theme-toggle")) { updateThemeIcon(); return; }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "theme-toggle";
  btn.title = "Toggle dark mode";
  btn.setAttribute("aria-label", "Dark mode");
  btn.addEventListener("click", toggleTheme);
  document.body.appendChild(btn);
  updateThemeIcon();
}

function updateThemeIcon(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.innerHTML = `<span aria-hidden="true">${isDark() ? "&#9788;" : "&#9790;"}</span>`;
  btn.setAttribute("aria-pressed", String(isDark()));
}
