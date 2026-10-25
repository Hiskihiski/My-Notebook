import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bruteForceGuard, LOCKOUT_MS, MAX_ATTEMPTS } from "./bruteforce";

describe("bruteForceGuard", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("counts failures and locks on the last allowed attempt", () => {
    const bf = bruteForceGuard();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(bf.fail("a@x.com")).toBe(false);
      expect(bf.count("a@x.com")).toBe(i);
    }
    expect(bf.fail("a@x.com")).toBe(true);
    expect(bf.secondsLeft("a@x.com")).toBe(LOCKOUT_MS / 1000);
    expect(bf.count("a@x.com")).toBe(0);
  });

  it("treats an address the same whatever its case or surrounding spaces", () => {
    const bf = bruteForceGuard();
    bf.fail("Ada@Example.com");
    bf.fail(" ada@example.com ");
    expect(bf.fail("ADA@EXAMPLE.COM")).toBe(true);
    expect(bf.secondsLeft("ada@example.com")).toBeGreaterThan(0);
  });

  it("keeps addresses separate", () => {
    const bf = bruteForceGuard();
    for (let i = 0; i < MAX_ATTEMPTS; i++) bf.fail("a@x.com");
    expect(bf.secondsLeft("b@x.com")).toBe(0);
    expect(bf.count("b@x.com")).toBe(0);
  });

  it("rounds the time left up and unlocks after the lockout", () => {
    const bf = bruteForceGuard();
    for (let i = 0; i < MAX_ATTEMPTS; i++) bf.fail("a@x.com");
    vi.advanceTimersByTime(LOCKOUT_MS - 1500);
    expect(bf.secondsLeft("a@x.com")).toBe(2);
    vi.advanceTimersByTime(1500);
    expect(bf.secondsLeft("a@x.com")).toBe(0);
    expect(bf.fail("a@x.com")).toBe(false);
    expect(bf.count("a@x.com")).toBe(1);
  });

  it("forgets an address after a successful sign-in", () => {
    const bf = bruteForceGuard();
    bf.fail("a@x.com");
    bf.reset("A@x.com");
    expect(bf.count("a@x.com")).toBe(0);
  });
});
