import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { esc, fmtDate, initials, firstName } from "./ui";

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
