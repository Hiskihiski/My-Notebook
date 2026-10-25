import { describe, it, expect } from "vitest";
import {
  serializeSignInEmail, parseSignInEmail, cooldownSeconds, linkErrorMessage, dropExpiredSignInEmail, EMAIL_FOR_SIGN_IN_KEY,
  EMAIL_MAX_AGE_MS, RESEND_COOLDOWN_MS,
} from "./email-link";

const NOW = 1_800_000_000_000;

describe("parseSignInEmail", () => {
  it("round-trips a fresh entry", () => {
    expect(parseSignInEmail(serializeSignInEmail("a@b.co", NOW), NOW + 1000)).toBe("a@b.co");
  });

  it("drops entries older than the link can be valid", () => {
    const raw = serializeSignInEmail("a@b.co", NOW);
    expect(parseSignInEmail(raw, NOW + EMAIL_MAX_AGE_MS)).toBe("a@b.co");
    expect(parseSignInEmail(raw, NOW + EMAIL_MAX_AGE_MS + 1)).toBeNull();
    expect(parseSignInEmail(raw, NOW - 1)).toBeNull(); // clock went backwards / forged
  });

  it("treats missing, malformed and old-format values as absent", () => {
    expect(parseSignInEmail(null, NOW)).toBeNull();
    expect(parseSignInEmail("", NOW)).toBeNull();
    expect(parseSignInEmail("a@b.co", NOW)).toBeNull(); // bare address from older versions
    expect(parseSignInEmail("null", NOW)).toBeNull();
    expect(parseSignInEmail('{"email":"a@b.co"}', NOW)).toBeNull();
    expect(parseSignInEmail('{"email":1,"at":1}', NOW)).toBeNull();
  });
});

describe("cooldownSeconds", () => {
  it("allows the first link and blocks repeats for a minute, case-insensitively", () => {
    const sent = new Map<string, number>();
    expect(cooldownSeconds(sent, "A@b.co", NOW)).toBe(0);
    sent.set("a@b.co", NOW);
    expect(cooldownSeconds(sent, " A@B.co ", NOW + 1)).toBe(60);
    expect(cooldownSeconds(sent, "a@b.co", NOW + RESEND_COOLDOWN_MS - 500)).toBe(1);
    expect(cooldownSeconds(sent, "a@b.co", NOW + RESEND_COOLDOWN_MS)).toBe(0);
    expect(cooldownSeconds(sent, "other@b.co", NOW + 1)).toBe(0);
  });
});

describe("linkErrorMessage", () => {
  it("points to other sign-in methods when the daily quota is used up", () => {
    expect(linkErrorMessage("auth/quota-exceeded", "Firebase: Error")).toMatch(/Google or your password/);
  });

  it("keeps other errors visible", () => {
    expect(linkErrorMessage("auth/network-request-failed", "Network error")).toBe("Could not send link: Network error");
    expect(linkErrorMessage("", "")).toBe("Could not send link: unknown");
  });
});

describe("dropExpiredSignInEmail", () => {
  const mem = (v: string | null) => {
    const m = new Map<string, string>(v === null ? [] : [[EMAIL_FOR_SIGN_IN_KEY, v]]);
    return { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => { m.delete(k); }, m } as unknown as Storage & { m: Map<string, string> };
  };
  it("removes expired, old-format and malformed entries but keeps a fresh one", () => {
    const old = mem(serializeSignInEmail("a@b.co", NOW - EMAIL_MAX_AGE_MS - 1));
    dropExpiredSignInEmail(() => old, NOW);
    expect(old.m.has(EMAIL_FOR_SIGN_IN_KEY)).toBe(false);
    const bare = mem("a@b.co");
    dropExpiredSignInEmail(() => bare, NOW);
    expect(bare.m.has(EMAIL_FOR_SIGN_IN_KEY)).toBe(false);
    const fresh = mem(serializeSignInEmail("a@b.co", NOW - 1000));
    dropExpiredSignInEmail(() => fresh, NOW);
    expect(fresh.m.get(EMAIL_FOR_SIGN_IN_KEY)).toContain("a@b.co");
  });

  it("tolerates blocked storage", () => {
    expect(() => dropExpiredSignInEmail(() => { throw new DOMException("blocked", "SecurityError"); }, NOW)).not.toThrow();
  });
});
