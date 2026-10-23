const FEATURES = [
  { icon: "✎", title: "Markdown", desc: "Bold, italic, lists — lightweight formatting that stays out of your way." },
  { icon: "#", title: "Tags", desc: "Work, ideas, personal. One tap isolates exactly what you need." },
  { icon: "★", title: "Pins", desc: "Keep your most-referenced notes locked to the top." },
  { icon: "⌕", title: "Instant search", desc: "Any note, by title or content, in milliseconds." },
];

// No Firebase here: first-time visitors see this page before anything loads
// it. `onGetStarted` starts Firebase (main.ts) or, once running, shows login.
export function renderLanding(root: HTMLElement, onGetStarted: () => void): void {
  root.innerHTML = `
    <div class="landing">
      <main class="landing-inner">
        <div class="landing-mark">📓</div>
        <h1 class="landing-title">Notebook</h1>
        <p class="landing-tagline">
          A calm, focused place for your thoughts — markdown notes with tags,
          pinning, and instant search, synced across every device you own.
        </p>
        <button class="landing-cta">Get started</button>

        <ul class="landing-features">
          ${FEATURES.map((f) => `
            <li class="landing-feature">
              <span class="landing-feature-icon">${f.icon}</span>
              <div>
                <h3>${f.title}</h3>
                <p>${f.desc}</p>
              </div>
            </li>
          `).join("")}
        </ul>
        <p class="legal-links"><a href="/datenschutz.html">Datenschutz</a> · <a href="/impressum.html">Impressum</a></p>
      </main>
    </div>
  `;

  root.querySelector<HTMLButtonElement>(".landing-cta")?.addEventListener("click", onGetStarted);
}
