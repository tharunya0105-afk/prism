/**
 * Renders the real built popup (dist/popup) in headless Chrome and captures
 * docs/popup.png for the README.
 *
 * chrome.runtime.sendMessage is stubbed with representative masked data —
 * no real secrets are ever used.
 *
 * Usage: node docs/screenshot.mjs   (run from prism-extension/)
 */
import { createServer } from "node:http";
import { readFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = dirname(fileURLToPath(import.meta.url)); // prism-extension/docs
const ext = dirname(root); // prism-extension/
const tmp = join(root, "_shot");
const out = join(root, "popup.png");

/* ---------- build a servable copy with relative asset paths ---------- */
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
await cp(join(ext, "dist", "assets"), join(tmp, "assets"), { recursive: true });
const html = await readFile(join(ext, "dist", "popup", "index.html"), "utf8");
await writeFile(
  join(tmp, "index.html"),
  html.replaceAll('"/assets/', '"./assets/')
);

/* ---------- static file server ---------- */
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const extOf = (p) => (p.match(/\.(html|js|css)$/) ?? [])[1];
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url;
  try {
    const data = await readFile(join(tmp, path));
    const type = mime["." + extOf(path)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8939, r));

/* ---------- representative masked stub data ---------- */
const now = Date.now();
const stub = {
  getConfig: { ok: true, config: { enabled: true, policyIds: ["email", "phone_in", "aadhaar", "pan", "card", "api_key", "bearer", "url_secret", "ipv4"] } },
  getStats: {
    ok: true,
    stats: {
      protected: 6,
      recent: [
        { label: "email", display: "pr••••••@gm•••.com", at: now - 12_000 },
        { label: "card", display: "•••• •••• •••• 4242", at: now - 25_000 },
        { label: "api_key", display: "sk-••••••••••3f9a", at: now - 41_000 },
        { label: "pan", display: "ABC•••••9F", at: now - 58_000 },
        { label: "phone", display: "+91 ••••• 4321", at: now - 77_000 },
      ],
    },
  },
};

/* ---------- render + capture ---------- */
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("requestfailed", (r) => console.error("REQ FAILED:", r.url(), r.failure()?.errorText));
  page.on("console", (m) => { if (m.type() === "error") console.error("PAGE ERR:", m.text()); });
  await page.setViewport({ width: 320, height: 600, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((data) => {
    // @ts-expect-error stub the extension API before any module runs
    window.chrome = {
      runtime: {
        sendMessage: (msg) => Promise.resolve(data[msg.type] ?? { ok: true }),
      },
    };
  }, stub);
  await page.goto("http://127.0.0.1:8939/", { waitUntil: "domcontentloaded" }).catch(() => {});
  try {
    await page.waitForSelector(".chips .chip", { timeout: 10_000 });
  } catch {
    const state = await page
      .evaluate(() => ({
        url: location.href,
        text: document.body?.innerText?.slice(0, 200) ?? "(no body)",
      }))
      .catch(() => ({ url: "(evaluate failed)", text: "" }));
    throw new Error(`popup did not load — url=${state.url}, body text: ${JSON.stringify(state.text)}`);
  }
  await new Promise((r) => setTimeout(r, 300));
  const text = await page.evaluate(() => document.body.innerText);
  if (!/prism/i.test(text) || !/secrets protected/i.test(text) || !/active policies/i.test(text)) {
    throw new Error(`unexpected popup content: ${JSON.stringify(text.slice(0, 150))}`);
  }

  const height = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewport({ width: 320, height, deviceScaleFactor: 2 });
  await page.screenshot({ path: out });
  console.log(`captured ${out} (320×${height} @2x)`);
} finally {
  await browser.close();
  server.close();
  await rm(tmp, { recursive: true, force: true });
}
