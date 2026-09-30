import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import type { Note } from "./types";
import {
  esc, fmtDate, fmtCardDate, initials, firstName, onBackdropClick, showToast, hideToast, initTheme,
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
    ["400 days ago", NOW - 400 * 86_400_000, "May 11, 2025"],
    ["a slightly future time (clock skew)", NOW + 5_000, "Just now"],
  ])("formats %s", (_label, ms, expected) => {
    expect(fmtDate(ms === null ? null : ts(ms))).toBe(expected);
  });

  it("treats a value that isn't a Timestamp as just now", () => {
    expect(fmtDate(1_700_000_000_000 as unknown as Timestamp)).toBe("Just now");
  });
});

describe("fmtCardDate", () => {
  const NOW = new Date("2026-06-15T12:00:00Z").getTime();
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const n = (createdAt: Timestamp | null, updatedAt?: Timestamp | null) =>
    ({ id: "a", uid: "u", title: "", body: "", tag: "work", pinned: false, createdAt, updatedAt }) as Note;

  it("shows the edit time when the note was edited after it was made", () => {
    expect(fmtCardDate(n(ts(NOW - 3 * 3_600_000), ts(NOW - 5 * 60_000)))).toBe("edited 5m ago");
  });

  it("shows the creation time otherwise", () => {
    expect(fmtCardDate(n(ts(NOW - 3 * 3_600_000)))).toBe("3h ago");
    expect(fmtCardDate(n(ts(NOW - 3 * 3_600_000), null))).toBe("3h ago");
    expect(fmtCardDate(n(ts(NOW - 3 * 3_600_000), ts(NOW - 3 * 3_600_000)))).toBe("3h ago");
    expect(fmtCardDate(n(null, ts(NOW - 60_000)))).toBe("Just now");
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

  it("treat a blank display name as missing", () => {
    expect(initials(user({ displayName: "   ", email: "grace@example.com" }))).toBe("G");
    expect(firstName(user({ displayName: "   ", email: "grace@example.com" }))).toBe("grace");
    expect(initials(user({ displayName: "", email: null }))).toBe("?");
    expect(firstName(user({ displayName: " ", email: "@example.com" }))).toBe("User");
  });

  it("keep an emoji whole", () => {
    expect(initials(user({ displayName: "😀 Smith" }))).toBe("😀S");
    expect(initials(user({ displayName: null, email: "😀@example.com" }))).toBe("😀");
  });
});

describe("onBackdropClick", () => {
  let ov: HTMLDivElement, inner: HTMLTextAreaElement, fn: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    document.body.innerHTML = `<div id="ov"><div class="modal"><textarea></textarea></div></div>`;
    ov = document.querySelector("#ov")!;
    inner = document.querySelector("textarea")!;
    fn = vi.fn<() => void>();
    onBackdropClick(ov, fn);
  });
  const press = (down: Element, up: Element) => {
    down.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };

  it("closes on a click on the backdrop", () => {
    press(ov, ov);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("stays open for clicks inside the dialog", () => {
    press(inner, inner);
    expect(fn).not.toHaveBeenCalled();
  });

  it("stays open when a text selection is dragged out onto the backdrop", () => {
    // The browser fires click on the nearest common ancestor: the backdrop.
    press(inner, ov);
    expect(fn).not.toHaveBeenCalled();
    press(ov, ov);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("theme", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete document.documentElement.dataset.theme;
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it("uses the saved theme, else the system one, and remembers a toggle", () => {
    localStorage.setItem("theme", "light");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    document.getElementById("theme-toggle")!.click();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");

    localStorage.setItem("theme", "<bogus>");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.querySelectorAll("#theme-toggle")).toHaveLength(1);
  });

  it("keeps the colour transition running through quick repeated toggles", () => {
    vi.useFakeTimers();
    initTheme();
    const html = document.documentElement;
    const btn = document.getElementById("theme-toggle")!;
    btn.click();
    vi.advanceTimersByTime(200);
    btn.click();
    vi.advanceTimersByTime(150); // 350ms after the first click, 150ms into the second fade
    expect(html.classList.contains("theme-changing")).toBe(true);
    vi.advanceTimersByTime(150);
    expect(html.classList.contains("theme-changing")).toBe(false);
    vi.useRealTimers();
  });

  it("still works when the browser blocks site data", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    expect(() => initTheme()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(() => document.getElementById("theme-toggle")!.click()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});

describe("showToast", () => {
  beforeEach(() => { document.body.innerHTML = ""; vi.useFakeTimers(); });
  afterEach(() => { hideToast(); vi.useRealTimers(); });
  const toast = () => document.getElementById("toast")!;
  const undoBtn = () => document.getElementById("toast-undo");

  it("escapes the message and hides after 5 seconds", () => {
    showToast("<b>hi</b>");
    expect(toast().textContent).toBe("<b>hi</b>");
    expect(toast().classList.contains("show")).toBe(true);
    expect(undoBtn()).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(toast().classList.contains("show")).toBe(false);
  });

  it("runs Undo once, even if clicked again while fading out", () => {
    const undo = vi.fn();
    showToast("Note deleted", undo);
    undoBtn()!.click();
    undoBtn()!.click();
    expect(undo).toHaveBeenCalledOnce();
    expect(toast().classList.contains("show")).toBe(false);
  });

  it("doesn't run Undo after the toast timed out", () => {
    const undo = vi.fn();
    showToast("Note deleted", undo);
    vi.advanceTimersByTime(5000);
    undoBtn()!.click();
    expect(undo).not.toHaveBeenCalled();
  });

  it("a newer toast replaces the older one's action and restarts the timer", () => {
    const first = vi.fn(), second = vi.fn();
    showToast("one", first);
    vi.advanceTimersByTime(4000);
    showToast("two", second, "Open");
    expect(undoBtn()!.textContent).toBe("Open");
    vi.advanceTimersByTime(4000);
    expect(toast().classList.contains("show")).toBe(true);
    undoBtn()!.click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
