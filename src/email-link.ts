// Passwordless sign-in links: the remembered address and a resend cooldown.
// Pure helpers (no Firebase, no DOM) so they can be unit-tested.

// localStorage key the email-link completion step (session.ts) reads back.
export const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";
// A sign-in link is only useful for a short while; after that the stored
// address is ignored and removed instead of lingering on the device.
export const EMAIL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Spark projects may only send a handful of link emails per day, so the same
// address gets at most one new link per minute.
export const RESEND_COOLDOWN_MS = 60_000;

export function serializeSignInEmail(email: string, now: number): string {
  return JSON.stringify({ email, at: now });
}

// The stored address, or null when it is missing, malformed, older than
// EMAIL_MAX_AGE_MS or in the old format (a bare address without a time).
export function parseSignInEmail(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { email?: unknown; at?: unknown } | null;
    if (typeof v?.email !== "string" || typeof v.at !== "number") return null;
    return v.at <= now && now - v.at <= EMAIL_MAX_AGE_MS ? v.email : null;
  } catch { return null; } // bare address from an older version: treat as expired
}

// Seconds until `email` may get another link (0 = now).
export function cooldownSeconds(sentAt: ReadonlyMap<string, number>, email: string, now: number): number {
  const at = sentAt.get(email.trim().toLowerCase());
  if (at === undefined) return 0;
  return Math.max(0, Math.ceil((at + RESEND_COOLDOWN_MS - now) / 1000));
}

// Error text for a failed send. The project-wide daily quota gets a hint
// towards the sign-in methods that don't need an email.
export function linkErrorMessage(code: string, message: string): string {
  if (code === "auth/quota-exceeded") {
    return "No more sign-in emails can be sent today. Continue with Google or your password instead, or try again tomorrow.";
  }
  return `Could not send link: ${message || "unknown"}`;
}
