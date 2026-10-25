// Fails the build check when the shipped JavaScript grows past its budget.
// The entry chunk is what a first-time visitor downloads before "Get started"
// (no Firebase, see CLAUDE.md); the session chunk carries Firebase and the app.
// Run after `npm run build`: node scripts/check-bundle.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUDGETS_GZIP_KB = { index: 10, session: 175 };

const dir = "dist/assets";
let failed = false;
for (const [prefix, budget] of Object.entries(BUDGETS_GZIP_KB)) {
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${prefix}-`) && f.endsWith(".js"));
  if (files.length !== 1) {
    console.error(`expected one ${prefix}-*.js chunk in ${dir}, found ${files.length}`);
    failed = true;
    continue;
  }
  const kb = zlib.gzipSync(fs.readFileSync(path.join(dir, files[0]))).length / 1024;
  const ok = kb <= budget;
  console.log(`${ok ? "ok  " : "FAIL"} ${files[0]}: ${kb.toFixed(1)} kB gzip (budget ${budget} kB)`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
