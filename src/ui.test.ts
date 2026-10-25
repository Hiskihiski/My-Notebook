import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import {
  esc, fmtDate, initials, firstName, initTheme,
  showToast, hideToast, mountToast, undoFromToast, TOAST_MS, ACTION_TOAST_MS,
} from "./ui";

const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) }) as unknown as Timestamp;
const user = (u: Partial<User>) => u as User;

describe("esc", () => {
  it("escapes the characters that matter in HTML text and attributes", () => {
    expect(esc(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("stops a value from breaking out of an attribute", () => {
    const evil = 'x"><img src=x onerror=alert(1)>';
    const el = document.createElement("div");
    el.innerHTML = `<div data-id="${esc(evil)}"></div>`;
    expect(el.querySelector("img")).toBeNull();
    expect((el.firstElementChild as HTMLElement).dataset.id).toBe(evil);
  });
});

describe("fmtDate", () => {
  const NOW = new Date("2026-06-15T12:00:00Z").getTime();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it.each([
    ["a missing timestamp", null, "Just now"],
    ["30 seconds ago", NOW - 30_000, "Just now"],
    ["5 minutes ago", NOW - 5 * 60_000, "5m ago"],
    ["3 hours ago", NOW - 3 * 3_600_000, "3h ago"],
    ["30 hours ago", NOW - 30 * 3_600_000, "Yesterday"],
    ["10 days ago", NOW - 10 * 86_400_000, "Jun 5"],
  ])("formats %s", (_label, ms, expected) => {
    expect(fmtDate(ms === null ? null : ts(ms))).toBe(expected);
  });
});

describe("initials / firstName", () => {
  it("use the display name when there is one", () => {
    expect(initials(user({ displayName: "Ada Lovelace" }))).toBe("AL");
    expect(initials(user({ displayName: "  ada  " }))).toBe("A");
    expect(firstName(user({ displayName: "Ada Lovelace" }))).toBe("Ada");
  });

  it("fall back to the email address", () => {
    expect(initials(user({ displayName: null, email: "grace@example.com" }))).toBe("G");
    expect(firstName(user({ displayName: null, email: "grace@example.com" }))).toBe("grace");
  });

  it("have a placeholder when there's neither", () => {
    expect(initials(user({ displayName: null, email: null }))).toBe("?");
    expect(firstName(user({ displayName: null, email: null }))).toBe("User");
  });
});

describe("toast", () => {
  const toast = () => document.getElementById("toast")!;
  const undoBtn = () => document.getElementById("toast-undo") as HTMLButtonElement | null;
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ""; });
  afterEach(() => { hideToast(); vi.useRealTimers(); });

  it("is a persistent polite live region that exists before the first message", () => {
    mountToast();
    expect(toast().getAttribute("role")).toBe("status");
    expect(toast().getAttribute("aria-live")).toBe("polite");
    expect(toast().getAttribute("aria-atomic")).toBe("true");
    expect(toast().textContent).toBe("");
    showToast("Saved");
    expect(document.querySelectorAll("#toast")).toHaveLength(1);
    expect(toast().textContent).toContain("Saved");
  });

  it("keeps a plain message for TOAST_MS and an undo message for ACTION_TOAST_MS", () => {
    showToast("Saved offline");
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toast().classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast().classList.contains("show")).toBe(false);

    showToast("Note deleted", () => {});
    expect(ACTION_TOAST_MS).toBeGreaterThanOrEqual(10_000);
    vi.advanceTimersByTime(ACTION_TOAST_MS - 1);
    expect(toast().classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast().classList.contains("show")).toBe(false);
  });

  it("announces the undo shortcut and exposes it on the Undo button", () => {
    showToast("Note deleted", () => {});
    expect(toast().querySelector(".sr-only")?.textContent).toMatch(/^Press (Control|Command)\+Z to undo\.$/);
    expect(undoBtn()?.getAttribute("aria-keyshortcuts")).toBe("Control+Z Meta+Z");
    showToast("Couldn't save", () => {}, "Open");
    expect(toast().querySelector(".sr-only")).toBeNull();
    expect(undoBtn()?.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  it("does not hide while focus is inside, and returns focus when Undo is used", () => {
    const before = document.createElement("button");
    document.body.appendChild(before);
    before.focus();
    const undo = vi.fn();
    showToast("Note deleted", undo);
    undoBtn()!.focus();
    vi.advanceTimersByTime(ACTION_TOAST_MS * 3);
    expect(toast().classList.contains("show")).toBe(true);
    undoBtn()!.click();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toast().classList.contains("show")).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("restarts the timer when focus leaves the toast", () => {
    const other = document.createElement("button");
    document.body.appendChild(other);
    showToast("Note deleted", () => {});
    undoBtn()!.focus();
    vi.advanceTimersByTime(ACTION_TOAST_MS * 2);
    other.focus();
    vi.advanceTimersByTime(ACTION_TOAST_MS - 1);
    expect(toast().classList.contains("show")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toast().classList.contains("show")).toBe(false);
  });

  it("pauses while the mouse is over it", () => {
    showToast("Note deleted", () => {});
    const ev = (type: string) => Object.assign(new Event(type), { pointerType: "mouse" });
    toast().dispatchEvent(ev("pointerenter"));
    vi.advanceTimersByTime(ACTION_TOAST_MS * 2);
    expect(toast().classList.contains("show")).toBe(true);
    toast().dispatchEvent(ev("pointerleave"));
    vi.advanceTimersByTime(ACTION_TOAST_MS);
    expect(toast().classList.contains("show")).toBe(false);
  });

  it("undoFromToast runs only an Undo action, once", () => {
    expect(undoFromToast()).toBe(false);
    const open = vi.fn();
    showToast("Couldn't save", open, "Open");
    expect(undoFromToast()).toBe(false);
    expect(open).not.toHaveBeenCalled();
    const undo = vi.fn();
    showToast("Note deleted", undo);
    expect(undoFromToast()).toBe(true);
    expect(undoFromToast()).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toast().classList.contains("show")).toBe(false);
  });

  it("makes the hidden content inert but keeps the live region", () => {
    showToast("Note deleted", () => {});
    hideToast();
    expect(toast().getAttribute("role")).toBe("status");
    expect([...toast().children].every((c) => (c as HTMLElement).inert)).toBe(true);
  });
});

describe("theme toggle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }) as MediaQueryList);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is named 'Dark mode', exposes its state with aria-pressed and hides the glyph", () => {
    initTheme();
    const btn = document.getElementById("theme-toggle")!;
    expect(btn.getAttribute("aria-label")).toBe("Dark mode");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.querySelector("[aria-hidden=true]")?.textContent).toBe("\u263E");
    btn.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.querySelector("[aria-hidden=true]")?.textContent).toBe("\u263C");
  });
});
