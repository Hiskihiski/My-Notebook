import type { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import type { Note } from "./types";
import { store } from "./storage";

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
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastUndo:  (() => void) | null                  = null;

export function showToast(msg: string, undo?: () => void, actionLabel = "Undo"): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  toastUndo = undo ?? null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button id="toast-undo">${esc(actionLabel)}</button>` : ""}`;
  document.getElementById("toast-undo")?.addEventListener("click", () => {
    const fn = toastUndo;
    hideToast();
    fn?.();
  });
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

export function hideToast(): void {
  document.getElementById("toast")?.classList.remove("show");
  toastUndo = null;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

// ── Theme ─────────────────────────────────────────────────────────────────────
export function initTheme(): void {
  const saved = store.get("theme");
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
  store.set("theme", next);
  updateThemeIcon();
  if (themeFadeTimer) clearTimeout(themeFadeTimer);
  themeFadeTimer = setTimeout(() => { html.classList.remove("theme-changing"); themeFadeTimer = null; }, 300);
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
