// Vite emits the popup HTML at dist/src/popup/index.html (input path relative
// to root). Move it to dist/popup/ so the manifest's default_popup matches.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";

const from = "dist/src/popup";
const to = "dist/popup";

if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  rmSync("dist/src", { recursive: true, force: true });
  console.log("popup -> dist/popup");
} else {
  console.log("no dist/src/popup to move");
}