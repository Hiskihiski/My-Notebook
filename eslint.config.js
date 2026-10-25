import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // .audit and .claude/worktrees are local, gitignored workspaces (tool output, other checkouts).
  { ignores: ["dist", "dev-dist", "node_modules", "functions", "cloudflare-worker", ".audit", ".claude/worktrees"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node build scripts (run by CI after the build).
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
