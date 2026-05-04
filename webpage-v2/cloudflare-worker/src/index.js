const MAX_ATTEMPTS    = 5;
const OTP_TTL_SECONDS = 5 * 60;
const RATE_LIMIT_SECS = 60;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")    return reply({ error: "Method not allowed" }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return reply({ error: "Invalid JSON" }, 400, cors); }

    if (body?.action === "send")   return handleSend(body, env, cors);
    if (body?.action === "verify") return handleVerify(body, env, cors);
    return reply({ error: "Unknown action" }, 400, cors);
  },
};

// ── Send ──────────────────────────────────────────────────────────────────────
// Generates a cryptographically random OTP, stores its SHA-256 hash in KV,
// and returns the plaintext code to the client so EmailJS can deliver it.
async function handleSend(body, env, cors) {
  const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : null;
  if (!email) return reply({ error: "Missing email" }, 400, cors);

  // Rate limit: one send per 60 seconds per email
  const rlKey    = `rl:${email}`;
  const lastSent = await env.OTP_ATTEMPTS.get(rlKey);
  if (lastSent) {
    const secsLeft = RATE_LIMIT_SECS - Math.floor((Date.now() - Number(lastSent)) / 1000);
    if (secsLeft > 0) {
      return reply({ error: `Please wait ${secsLeft}s before requesting another code.` }, 429, cors);
    }
  }

  const otp      = genOtp();
  const hash     = await sha256(otp);
  const expiresAt = Date.now() + OTP_TTL_SECONDS * 1000;

  await env.OTP_ATTEMPTS.put(
    `otp:${email}`,
    JSON.stringify({ hash, expiresAt, fails: 0 }),
    { expirationTtl: OTP_TTL_SECONDS },
  );
  await env.OTP_ATTEMPTS.put(rlKey, String(Date.now()), { expirationTtl: RATE_LIMIT_SECS });

  // Return plaintext OTP — client hands it to EmailJS for delivery
  return reply({ otp, expiresAt }, 200, cors);
}

// ── Verify ────────────────────────────────────────────────────────────────────
// All comparison happens here; the hash never leaves the Worker.
async function handleVerify(body, env, cors) {
  const email = typeof body?.email === "string" ? body.email.toLowerCase().trim() : null;
  const code  = typeof body?.code  === "string" ? body.code.trim()               : null;
  if (!email || !code) return reply({ error: "Missing email or code" }, 400, cors);

  const kvKey = `otp:${email}`;
  const raw   = await env.OTP_ATTEMPTS.get(kvKey);
  if (!raw) return reply({ result: "notfound" }, 200, cors);

  const { hash, expiresAt, fails } = JSON.parse(raw);

  if (Date.now() > expiresAt) {
    await env.OTP_ATTEMPTS.delete(kvKey);
    return reply({ result: "expired" }, 200, cors);
  }

  if (fails >= MAX_ATTEMPTS) {
    await env.OTP_ATTEMPTS.delete(kvKey);
    return reply({ result: "maxattempts" }, 200, cors);
  }

  if (await sha256(code) !== hash) {
    const newFails = fails + 1;
    if (newFails >= MAX_ATTEMPTS) {
      await env.OTP_ATTEMPTS.delete(kvKey);
      return reply({ result: "maxattempts" }, 200, cors);
    }
    const ttlLeft = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
    await env.OTP_ATTEMPTS.put(kvKey, JSON.stringify({ hash, expiresAt, fails: newFails }), {
      expirationTtl: ttlLeft,
    });
    return reply({ result: "wrong" }, 200, cors);
  }

  await env.OTP_ATTEMPTS.delete(kvKey);
  return reply({ result: "ok" }, 200, cors);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function genOtp() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function reply(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
