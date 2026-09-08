/**
 * Post-build step for the ESM output: Node ESM requires explicit extensions
 * on relative imports, but TypeScript emits extensionless specifiers from
 * our bundler-style source. This rewrites `./x` → `./x.js` (and appends
 * .js to .d.ts specifiers) in dist/esm so the package works natively.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const esmDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "esm");

const files = readdirSync(esmDir).filter((f) => f.endsWith(".js") || f.endsWith(".d.ts"));
let touched = 0;
for (const f of files) {
  const p = join(esmDir, f);
  let src = readFileSync(p, "utf8");
  // relative specifiers only: ./core, ../core — leave bare specifiers (react) alone
  const next = src.replace(
    /(from\s*|import\s*\(\s*|require\s*\(\s*)(["'])(\.\.?\/[^"']+)\/?(["'])/g,
    (m, pre, q, spec, q2) => {
      // keep .d.ts references pointing at the emitted .d.ts files
      const ext = f.endsWith(".d.ts") && !spec.endsWith(".d.ts") ? ".d.js" : ".js";
      return `${pre}${q}${spec}${ext}${q2}`;
    }
  );
  if (next !== src) {
    writeFileSync(p, next);
    touched++;
  }
}
console.log(`fix-esm: rewrote specifiers in ${touched}/${files.length} files`);
