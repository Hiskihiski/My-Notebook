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
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastUndo:  (() => void) | null                  = null;

export function showToast(msg: string, undo?: () => void): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  toastUndo = undo ?? null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button id="toast-undo">Undo</button>` : ""}`;
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
  const html = document.documentElement;
  html.classList.add("theme-changing");
  const next = isDark() ? "light" : "dark";
  html.dataset.theme = next;
  localStorage.setItem("theme", next);
  updateThemeIcon();
  setTimeout(() => html.classList.remove("theme-changing"), 300);
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
