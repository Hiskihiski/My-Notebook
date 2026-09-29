import {
  signInWithPopup, signInWithRedirect, signInWithEmailAndPassword,
  sendSignInLinkToEmail, RecaptchaVerifier, signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { auth, gProvider } from "./firebase";
import { $ } from "./ui";

// localStorage key the email-link completion step (main.ts) reads back.
export const EMAIL_FOR_SIGN_IN_KEY = "emailForSignIn";

// ── Brute-force guard (client-side UX only — Firebase enforces real limits) ──
const bfMap = new Map<string, { count: number; lockedUntil: number }>();
let lockoutTimer: ReturnType<typeof setInterval> | null = null;

function bfSecondsLeft(email: string): number {
  const e = bfMap.get(email);
  if (!e || e.lockedUntil <= Date.now()) return 0;
  return Math.ceil((e.lockedUntil - Date.now()) / 1000);
}
function bfFail(email: string): boolean {
  const e = bfMap.get(email) ?? { count: 0, lockedUntil: 0 };
  e.count++;
  if (e.count >= 3) { e.lockedUntil = Date.now() + 60_000; e.count = 0; }
  bfMap.set(email, e);
  return e.lockedUntil > Date.now();
}
function bfReset(email: string): void { bfMap.delete(email); }
function bfCount(email: string): number { return bfMap.get(email)?.count ?? 0; }

// ── Login screen ──────────────────────────────────────────────────────────────
export function renderLogin(root: HTMLElement): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-icon">&#x1F4D3;</div>
        <h1>Notebook</h1>
        <p>Sign in or create an account</p>
        <div class="login-err" id="login-err"></div>

        <div id="step-email">
          <button class="g-btn email-btn" id="google-signin">
            <svg width="17" height="17" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
          <button class="g-btn email-btn" id="phone-option-btn" style="margin-top:8px">&#x1F4F1; Continue with phone</button>
          <div class="or-row"><span>or</span></div>
          <input class="email-input" type="email" id="email-input" placeholder="your@email.com" autocomplete="email">
          <button class="g-btn email-btn" id="continue-btn">Continue &#x2192;</button>
        </div>

        <div id="step-password" style="display:none">
          <div class="email-badge" id="badge-password"></div>
          <input class="email-input" type="password" id="pw-input" placeholder="Password" autocomplete="current-password">
          <div class="attempt-dots">
            <span class="attempt-dot" id="dot-1"></span>
            <span class="attempt-dot" id="dot-2"></span>
            <span class="attempt-dot" id="dot-3"></span>
          </div>
          <div class="lockout-msg" id="lockout-msg" style="display:none"></div>
          <button class="g-btn email-btn" id="signin-btn">Sign in &#x2192;</button>
          <div class="or-row"><span>or</span></div>
          <button class="g-btn email-btn" id="send-link-btn">&#x2709;&#xFE0F; Email me a sign-in link</button>
          <p class="otp-hint" style="margin:10px 0 0">New here? The sign-in link creates<br>your account automatically.</p>
          <button class="back-link" id="back-from-password">&#x2190; Use a different email</button>
        </div>

        <div id="step-link-sent" style="display:none">
          <div class="link-sent-icon">&#x2709;&#xFE0F;</div>
          <div class="email-badge" id="badge-link-sent"></div>
          <p class="otp-hint">We sent a sign-in link to your email.<br>
             Open it on this device to finish signing in.<br>
             Check your spam folder too.</p>
          <button class="back-link" id="resend-link" style="margin-top:8px">Resend link</button>
          <button class="back-link" id="back-from-link-sent">&#x2190; Use a different email</button>
        </div>

        <div id="step-phone" style="display:none">
          <p class="otp-hint" style="margin-bottom:10px">Enter your number with country code.</p>
          <input class="email-input" type="tel" id="phone-input" placeholder="+1 234 567 8900"
                 autocomplete="tel" inputmode="tel">
          <button class="g-btn email-btn" id="send-code-btn" style="margin-top:8px">Send code &#x2192;</button>
          <button class="back-link" id="back-from-phone">&#x2190; Use a different method</button>
        </div>

        <div id="step-phone-otp" style="display:none">
          <div class="email-badge" id="badge-phone-otp"></div>
          <p class="otp-hint">We sent a 6-digit code to your phone.<br>Check that the number is correct.</p>
          <input class="email-input otp-input" type="text" id="phone-otp-input"
                 placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
          <div class="otp-timer" id="phone-otp-timer"></div>
          <button class="g-btn email-btn" id="verify-phone-btn">Verify &#x2192;</button>
          <button class="back-link" id="resend-phone-otp" style="margin-top:8px">Resend code</button>
          <button class="back-link" id="back-from-phone-otp">&#x2190; Change phone number</button>
        </div>

        <div id="recaptcha-container"></div>
      </div>
    </div>
  `;

  const errEl = $("login-err");
  function showErr(msg: string): void { errEl.textContent = msg; errEl.style.display = "block"; }
  function hideErr(): void { errEl.style.display = "none"; }

  let currentEmail = "";
  let currentPhone = "";
  let phoneConfirmationResult: ConfirmationResult | null = null;
  let recaptchaVerifier: RecaptchaVerifier | null = null;
  let phoneTimerInterval: ReturnType<typeof setInterval> | null = null;

  function showStep(step: "email" | "password" | "link-sent" | "phone" | "phone-otp"): void {
    $("step-email").style.display     = step === "email"     ? "" : "none";
    $("step-password").style.display  = step === "password"  ? "" : "none";
    $("step-link-sent").style.display = step === "link-sent" ? "" : "none";
    $("step-phone").style.display     = step === "phone"     ? "" : "none";
    $("step-phone-otp").style.display = step === "phone-otp" ? "" : "none";
    if (step !== "phone-otp" && phoneTimerInterval) { clearInterval(phoneTimerInterval); phoneTimerInterval = null; }
    hideErr();
  }

  function startPhoneOtpTimer(expiresAt: number): void {
    if (phoneTimerInterval) clearInterval(phoneTimerInterval);
    const timerEl = $("phone-otp-timer");
    const verBtn  = $<HTMLButtonElement>("verify-phone-btn");
    function tick(): void {
      if (!timerEl.isConnected) { // login screen was torn down — stop ticking
        if (phoneTimerInterval) { clearInterval(phoneTimerInterval); phoneTimerInterval = null; }
        return;
      }
      const secs = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (secs <= 0) {
        timerEl.textContent = "Code expired — request a new one";
        timerEl.style.color = "var(--err)";
        verBtn.disabled = true;
        if (phoneTimerInterval) { clearInterval(phoneTimerInterval); phoneTimerInterval = null; }
      } else {
        const m  = Math.floor(secs / 60);
        const sc = secs % 60;
        timerEl.textContent = `Expires in ${m}:${String(sc).padStart(2, "0")}`;
        timerEl.style.color = secs < 60 ? "var(--err)" : "var(--text-m)";
      }
    }
    tick();
    phoneTimerInterval = setInterval(tick, 1000);
  }

  // ── Google ──────────────────────────────────────────────────────────────────
  $<HTMLButtonElement>("google-signin").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("google-signin");
    btn.disabled = true; btn.textContent = "Signing in…";
    hideErr();
    try {
      await signInWithPopup(auth, gProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        signInWithRedirect(auth, gProvider).catch((e: unknown) => {
          showErr((e as Error).message ?? "Sign-in failed");
          btn.disabled = false; btn.textContent = "Continue with Google";
        });
      } else if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        btn.disabled = false; btn.textContent = "Continue with Google";
      } else {
        showErr(`Sign-in failed: ${(err as Error).message ?? code}`);
        btn.disabled = false; btn.textContent = "Continue with Google";
      }
    }
  });

  // ── Email: continue → password / sign-in link ───────────────────────────────
  $<HTMLButtonElement>("continue-btn").addEventListener("click", () => {
    const emailEl = $<HTMLInputElement>("email-input");
    const email   = emailEl.value.trim();
    hideErr();
    if (!email || !/\S+@\S+\.\S+/.test(email)) { showErr("Enter a valid email address."); emailEl.focus(); return; }
    currentEmail = email;
    $<HTMLElement>("badge-password").textContent = email;
    updateDots(email);
    showStep("password");
    $<HTMLInputElement>("pw-input").focus();
  });

  $<HTMLInputElement>("email-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("continue-btn").click();
  });

  function updateDots(email: string): void {
    const count = bfCount(email);
    for (let i = 1; i <= 3; i++) $(`dot-${i}`).classList.toggle("used", i <= count);
    const secs = bfSecondsLeft(email);
    const lockEl = $("lockout-msg");
    if (secs > 0) { lockEl.style.display = ""; lockEl.textContent = `Too many attempts. Try again in ${secs}s.`; }
    else lockEl.style.display = "none";
  }

  $<HTMLButtonElement>("signin-btn").addEventListener("click", async () => {
    const pwEl  = $<HTMLInputElement>("pw-input");
    const btn   = $<HTMLButtonElement>("signin-btn");
    const email = currentEmail;
    hideErr();
    if (bfSecondsLeft(email) > 0) { showErr(`Locked out. Try again in ${bfSecondsLeft(email)}s.`); return; }
    const pw = pwEl.value;
    if (!pw) { showErr("Enter your password."); pwEl.focus(); return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      bfReset(email);
      if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/user-not-found") {
        const locked = bfFail(email);
        updateDots(email);
        if (locked) {
          lockoutTimer = setInterval(() => {
            updateDots(email);
            if (bfSecondsLeft(email) <= 0) { clearInterval(lockoutTimer!); lockoutTimer = null; }
          }, 1000);
          showErr("Too many failed attempts. Locked for 1 minute.");
        } else {
          showErr("Wrong password — or this account has no password. You can use the sign-in link instead.");
        }
      } else {
        showErr(`Sign-in failed: ${(err as Error).message ?? code}`);
      }
      btn.disabled = false; btn.textContent = "Sign in →";
    }
  });

  $<HTMLInputElement>("pw-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("signin-btn").click();
  });
  $("back-from-password").addEventListener("click", () => { showStep("email"); $<HTMLInputElement>("pw-input").value = ""; });

  // ── Email sign-in link (passwordless; creates the account on first use) ─────
  async function doSendLink(email: string): Promise<void> {
    await sendSignInLinkToEmail(auth, email, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    });
    // Remembered so the link can be completed without re-typing the email.
    localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email);
    $<HTMLElement>("badge-link-sent").textContent = email;
    showStep("link-sent");
  }

  $<HTMLButtonElement>("send-link-btn").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("send-link-btn");
    hideErr();
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      await doSendLink(currentEmail);
    } catch (err: unknown) {
      showErr(`Could not send link: ${(err as Error).message ?? "unknown"}`);
    } finally {
      btn.disabled = false; btn.innerHTML = "&#x2709;&#xFE0F; Email me a sign-in link";
    }
  });

  $<HTMLButtonElement>("resend-link").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("resend-link");
    hideErr(); btn.textContent = "Sending…";
    try {
      await doSendLink(currentEmail);
      btn.textContent = "Sent!";
      setTimeout(() => { btn.textContent = "Resend link"; }, 2500);
    } catch (err: unknown) {
      showErr(`Could not send link: ${(err as Error).message ?? "unknown"}`);
      btn.textContent = "Resend link";
    }
  });

  $("back-from-link-sent").addEventListener("click", () => showStep("email"));

  // ── Phone ───────────────────────────────────────────────────────────────────
  $("phone-option-btn").addEventListener("click", () => {
    showStep("phone");
    $<HTMLInputElement>("phone-input").focus();
  });

  $<HTMLInputElement>("phone-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("send-code-btn").click();
  });

  $<HTMLButtonElement>("send-code-btn").addEventListener("click", async () => {
    const phoneEl = $<HTMLInputElement>("phone-input");
    const btn     = $<HTMLButtonElement>("send-code-btn");
    const phone   = phoneEl.value.trim().replace(/\s/g, "");
    hideErr();
    if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
      showErr("Enter a valid phone number with country code (e.g. +1 234 567 8900).");
      phoneEl.focus();
      return;
    }
    currentPhone = phone;
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
      recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      phoneConfirmationResult = await signInWithPhoneNumber(auth, currentPhone, recaptchaVerifier);
      $<HTMLElement>("badge-phone-otp").textContent = currentPhone;
      showStep("phone-otp");
      startPhoneOtpTimer(Date.now() + 5 * 60 * 1000);
      $<HTMLInputElement>("phone-otp-input").focus();
    } catch (err: unknown) {
      showErr(`Could not send code: ${(err as Error).message ?? "unknown"}`);
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
    } finally {
      btn.disabled = false; btn.textContent = "Send code →";
    }
  });

  $<HTMLInputElement>("phone-otp-input").addEventListener("input", () => {
    const el = $<HTMLInputElement>("phone-otp-input");
    el.value = el.value.replace(/\D/g, "").slice(0, 6);
  });
  $<HTMLInputElement>("phone-otp-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $<HTMLButtonElement>("verify-phone-btn").click();
  });

  $<HTMLButtonElement>("verify-phone-btn").addEventListener("click", async () => {
    const smsCode = $<HTMLInputElement>("phone-otp-input").value.trim();
    const btn     = $<HTMLButtonElement>("verify-phone-btn");
    hideErr();
    if (!/^\d{6}$/.test(smsCode)) { showErr("Enter the 6-digit code from your SMS."); return; }
    if (!phoneConfirmationResult) { showErr("Session expired. Go back and try again."); return; }
    btn.disabled = true; btn.textContent = "Verifying…";
    try {
      await phoneConfirmationResult.confirm(smsCode);
    } catch (err: unknown) {
      const errCode = (err as { code?: string }).code ?? "";
      if (errCode === "auth/invalid-verification-code") {
        showErr("Wrong code. Please try again.");
      } else if (errCode === "auth/code-expired") {
        showErr("Code expired. Request a new one.");
        btn.disabled = true;
      } else {
        showErr(`Verification failed: ${(err as Error).message ?? "unknown"}`);
      }
      btn.disabled = false; btn.textContent = "Verify →";
    }
  });

  $<HTMLButtonElement>("resend-phone-otp").addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("resend-phone-otp");
    hideErr(); btn.textContent = "Sending…";
    try {
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
      recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      phoneConfirmationResult = await signInWithPhoneNumber(auth, currentPhone, recaptchaVerifier);
      startPhoneOtpTimer(Date.now() + 5 * 60 * 1000);
      $<HTMLInputElement>("phone-otp-input").value = "";
      $<HTMLButtonElement>("verify-phone-btn").disabled = false;
      btn.textContent = "Sent!";
      setTimeout(() => { btn.textContent = "Resend code"; }, 2500);
    } catch (err: unknown) {
      showErr(`Could not send code: ${(err as Error).message ?? "unknown"}`);
      if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
      btn.textContent = "Resend code";
    }
  });

  $("back-from-phone").addEventListener("click", () => {
    showStep("email");
    $<HTMLInputElement>("phone-input").value = "";
    if (recaptchaVerifier) { recaptchaVerifier.clear(); recaptchaVerifier = null; }
  });

  $("back-from-phone-otp").addEventListener("click", () => {
    showStep("phone");
    $<HTMLInputElement>("phone-otp-input").value = "";
    phoneConfirmationResult = null;
  });
}
