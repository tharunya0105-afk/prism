/**
 * Marks dist/cjs as CommonJS — the package root sets "type": "module"
 * (needed for the src tooling), so the CJS output needs an explicit override.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cjsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cjs");
mkdirSync(cjsDir, { recursive: true });
writeFileSync(join(cjsDir, "package.json"), JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
console.log("make-cjs-shim: wrote dist/cjs/package.json (type: commonjs)");
