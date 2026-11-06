import { describe, it, expect } from "vitest";

const config = Object.values(import.meta.glob("../vite.config.ts", { query: "?raw", import: "default", eager: true }))[0] as string;

describe("service worker updates", () => {
  // The plugin only sets these itself with injectRegister "auto".
  it("activate a new version without waiting for every tab to close", () => {
    expect(config).toMatch(/injectRegister:\s*"script-defer"/);
    expect(config).toMatch(/skipWaiting:\s*true/);
    expect(config).toMatch(/clientsClaim:\s*true/);
  });
});
