import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createHash, randomInt } from "crypto";

initializeApp();
const db = getFirestore();

const resendApiKey = defineSecret("RESEND_API_KEY");

// ── Config ────────────────────────────────────────────────────────────────────
// Replace with your verified Resend sender domain once you've set one up.
// During development, Resend allows "onboarding@resend.dev" as the from address.
const RESEND_FROM    = "Notebook <onboarding@resend.dev>";
const OTP_TTL_MS     = 5 * 60 * 1000;  // 5 minutes
const RATE_LIMIT_MS  = 60 * 1000;      // 1 send per 60 seconds per email

// ── Helpers ───────────────────────────────────────────────────────────────────
function genOtp(): string {
  // randomInt is cryptographically secure (Node built-in)
  return String(100000 + randomInt(900000));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// ── sendOtp ───────────────────────────────────────────────────────────────────
// Generates a 6-digit code, stores its SHA-256 hash in Firestore, and sends
// the plaintext code via Resend. The hash never leaves the server.
// Enforces a 60-second cooldown between sends for the same email address.
export const sendOtp = onCall(
  { secrets: [resendApiKey], cors: true },
  async (request) => {
    const email = (request.data.email as string | undefined)?.toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "Invalid email address.");
    }

    // Rate limit: reject if a code was sent within the last 60 seconds
    const ref  = db.collection("otps").doc(email);
    const snap = await ref.get();
    if (snap.exists) {
      const sentAt = (snap.data()?.sentAt as number) ?? 0;
      const msLeft = RATE_LIMIT_MS - (Date.now() - sentAt);
      if (msLeft > 0) {
        const wait = Math.ceil(msLeft / 1000);
        throw new HttpsError(
          "resource-exhausted",
          `Please wait ${wait}s before requesting another code.`,
        );
      }
    }

    const code      = genOtp();
    const hash      = sha256(code);
    const expiresAt = Date.now() + OTP_TTL_MS;

    // Write hash + metadata to Firestore before attempting delivery
    await ref.set({ hash, expiresAt, sentAt: Date.now() });

    // Attempt email delivery; clean up Firestore doc on failure
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${resendApiKey.value()}`,
        },
        body: JSON.stringify({
          from:    RESEND_FROM,
          to:      email,
          subject: "Your Notebook sign-in code",
          html: `
            <div style="font-family:sans-serif;max-width:400px;margin:0 auto">
              <p style="font-size:15px;color:#333">Your sign-in code is:</p>
              <p style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1a1a1a;margin:16px 0">${code}</p>
              <p style="font-size:13px;color:#666">
                This code expires in 5 minutes.<br>
                If you didn't request it, you can safely ignore this email.
              </p>
            </div>`,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error("Resend API error:", res.status, body);
        throw new Error(`Email delivery failed (HTTP ${res.status})`);
      }
    } catch (err) {
      // Remove the OTP doc so the user can retry without hitting the rate limit
      await ref.delete().catch(() => {});
      throw new HttpsError(
        "internal",
        err instanceof Error ? err.message : "Failed to send OTP email.",
      );
    }

    return { expiresAt };
  },
);

// ── verifyOtp ─────────────────────────────────────────────────────────────────
// Reads and compares the stored hash entirely server-side.
// The hash is never returned to the client under any code path.
export const verifyOtp = onCall({ cors: true }, async (request) => {
  const email = (request.data.email as string | undefined)?.toLowerCase().trim();
  const code  = (request.data.code  as string | undefined)?.trim();

  if (!email || !code) {
    throw new HttpsError("invalid-argument", "Missing email or code.");
  }

  const ref  = db.collection("otps").doc(email);
  const snap = await ref.get();

  if (!snap.exists) return { result: "notfound" as const };

  const { hash, expiresAt } = snap.data() as { hash: string; expiresAt: number };

  if (expiresAt < Date.now()) {
    await ref.delete();
    return { result: "expired" as const };
  }

  if (sha256(code) !== hash) {
    const failCount = ((snap.data() as { failCount?: number }).failCount ?? 0) + 1;
    if (failCount >= 5) {
      await ref.delete();
      return { result: "maxattempts" as const };
    }
    await ref.update({ failCount });
    return { result: "wrong" as const };
  }

  await ref.delete();
  return { result: "ok" as const };
});
