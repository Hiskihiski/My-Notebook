// Client-side brute-force guard for the password form — UX only, Firebase
// enforces the real rate limit. MAX_ATTEMPTS failures lock an address for
// LOCKOUT_MS.
export const MAX_ATTEMPTS = 3;
export const LOCKOUT_MS   = 60_000;

export interface BruteForceGuard {
  secondsLeft(email: string): number;
  fail(email: string): boolean; // true when this failure locked the address
  reset(email: string): void;
  count(email: string): number;
}

export function bruteForceGuard(): BruteForceGuard {
  const tries = new Map<string, { count: number; lockedUntil: number }>();
  // Firebase matches addresses case-insensitively, so "Ada@x.com" and
  // "ada@x.com" must share a counter or retyping the case resets it.
  const key = (email: string): string => email.trim().toLowerCase();
  return {
    secondsLeft(email) {
      const e = tries.get(key(email));
      if (!e || e.lockedUntil <= Date.now()) return 0;
      return Math.ceil((e.lockedUntil - Date.now()) / 1000);
    },
    fail(email) {
      const e = tries.get(key(email)) ?? { count: 0, lockedUntil: 0 };
      e.count++;
      if (e.count >= MAX_ATTEMPTS) { e.lockedUntil = Date.now() + LOCKOUT_MS; e.count = 0; }
      tries.set(key(email), e);
      return e.lockedUntil > Date.now();
    },
    reset(email) { tries.delete(key(email)); },
    count(email) { return tries.get(key(email))?.count ?? 0; },
  };
}
