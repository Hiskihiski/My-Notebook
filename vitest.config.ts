import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], environment: "jsdom" } },
      // Needs the Firestore emulator — run via `npm run test:rules`.
      { test: { name: "rules", include: ["tests/**/*.test.ts"], environment: "node" } },
    ],
  },
});
