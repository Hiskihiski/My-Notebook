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

// App logo, sized by its container. Colors come from the theme (.logo-* in
// style.css); public/favicon.svg is the same mark with fixed colors.
export function logoMark(): string {
  return `<svg class="logo-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect class="logo-tile" width="32" height="32" rx="8"/>
    <path class="logo-page" d="M9.5 8.5A1.5 1.5 0 0 1 11 7h10.5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H11a1.5 1.5 0 0 1-1.5-1.5z"/>
    <path class="logo-spine" d="M12.5 7v18" stroke-width="1.4"/>
    <path class="logo-ribbon" d="M17.5 7v7l2-1.5 2 1.5V7z"/>
  </svg>`;
}

export function fmtDate(ts: Timestamp | null | undefined): string {
  if (!ts || typeof ts.toMillis !== "function") return "Just now";
  const d = Date.now() - ts.toMillis();
  if (d < 60_000)      return "Just now";
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 172_800_000) return "Yesterday";
  const date = ts.toDate();
  // Older than this year: add the year, or last June reads like this June.
  const year = date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } as const : {};
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...year });
}

export function fmtCardDate(n: Note): string {
  if (n.updatedAt && n.createdAt && n.updatedAt.toMillis() > n.createdAt.toMillis()) {
    return `edited ${fmtDate(n.updatedAt)}`;
  }
  return fmtDate(n.createdAt);
}

// First character by code point, so an emoji isn't cut in half.
const firstChar = (s?: string | null): string => [...(s ?? "")][0] ?? "";

// A display name can be all whitespace, so fall back to the email when the
// name has no words rather than rendering "UNDEFINED".
function nameWords(u: User): string[] {
  return u.displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
}

export function initials(u: User): string {
  const p = nameWords(u);
  if (p.length) return (firstChar(p[0]) + firstChar(p[1])).toUpperCase();
  return firstChar(u.email).toUpperCase() || "?";
}

export function firstName(u: User): string {
  return nameWords(u)[0] || u.email?.split("@")[0] || "User";
}

// Closes on a click that starts *and* ends on the backdrop. Selecting text in
// the dialog and letting go outside it fires click on the backdrop too, which
// used to throw away the edit.
export function onBackdropClick(el: HTMLElement, fn: () => void): void {
  let downOnBackdrop = false;
  el.addEventListener("mousedown", (e) => { downOnBackdrop = e.target === el; });
  el.addEventListener("click", (e) => {
    if (e.target === el && downOnBackdrop) fn();
    downOnBackdrop = false;
  });
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
  // Right after the theme toggle (first in <body>), so Undo is one Tab from
  // the top of the page.
  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.after(el); else document.body.prepend(el);
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

// One timer, restarted per toggle: an earlier toggle's timer would otherwise
// cut a quick second toggle's colour fade short.
let themeFadeTimer: ReturnType<typeof setTimeout> | null = null;

function toggleTheme(): void {
  const html = document.documentElement;
  html.classList.add("theme-changing");
  const next = isDark() ? "light" : "dark";
  html.dataset.theme = next;
  storeTheme(next);
  updateThemeIcon();
  if (themeFadeTimer) clearTimeout(themeFadeTimer);
  themeFadeTimer = setTimeout(() => { html.classList.remove("theme-changing"); themeFadeTimer = null; }, 300);
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
  document.body.prepend(btn); // first in the Tab order, as it is top-most on screen
  updateThemeIcon();
}

function updateThemeIcon(): void {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.innerHTML = `<span aria-hidden="true">${isDark() ? "&#9788;" : "&#9790;"}</span>`;
  btn.setAttribute("aria-pressed", String(isDark()));
}
