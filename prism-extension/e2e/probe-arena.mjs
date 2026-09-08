// Focused experiment: after Prism's interception swaps the LMArena composer
// to [[PRISM_]] tokens, which synthetic event re-enables their send button?
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(__dirname, "..", "dist");
const HARNESS_PORT = 8931;
const HARNESS_URL = `http://127.0.0.1:${HARNESS_PORT}/?prism_test=1`;

const PII_MARKER = "PRISME2E-2026";
const PII_EMAIL = `e2e.priya.${PII_MARKER}@example.com`;
const PII_PHONE = "+91 90123 45678";
const PROMPT = `Hi, contact ${PII_EMAIL} or ${PII_PHONE} please. This is ${PII_MARKER}.`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(readFileSync(join(__dirname, "harness.html")));
});
await new Promise((r) => server.listen(HARNESS_PORT, "127.0.0.1", r));

const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_DIST}`,
    `--load-extension=${EXT_DIST}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
  ],
  defaultViewport: { width: 1280, height: 860 },
});

const results = {};
const report = (k, v) => {
  results[k] = v;
  console.log(`  ${k}:`, typeof v === "object" ? JSON.stringify(v) : v);
};

// boolean: is a visible composer present?
const HAS_COMPOSER = `
  (() => {
    const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    return cands.some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 30;
    });
  })()
`;
// focus the largest visible editor and report its tag
const FOCUS_COMPOSER = `
  (() => {
    const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    const vis = cands.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 30;
    });
    if (vis.length === 0) return null;
    const best = vis.reduce((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height > b.getBoundingClientRect().width * b.getBoundingClientRect().height ? a : b));
    best.focus();
    return { tag: best.tagName, editable: best.isContentEditable, w: Math.round(best.getBoundingClientRect().width), h: Math.round(best.getBoundingClientRect().height) };
  })()
`;
// read the composer's current text
const READ_COMPOSER = `
  (() => {
    const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
    const vis = cands.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 30;
    });
    if (vis.length === 0) return null;
    const best = vis.reduce((a, b) => (a.getBoundingClientRect().width * a.getBoundingClientRect().height > b.getBoundingClientRect().width * b.getBoundingClientRect().height ? a : b));
    return { text: (best.value ?? best.innerText ?? "").slice(0, 60), tokenized: (best.value ?? best.innerText ?? "").includes("[[PRISM_") };
  })()
`;
// find the send button and return its state
const SEND_BTN = `
  (() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const b = btns.find((x) => {
      const aria = x.getAttribute("aria-label") ?? "";
      return /^send( message)?$/i.test(aria) && x.getBoundingClientRect().width > 0;
    }) ?? null;
    return b ? { disabled: b.disabled, w: Math.round(b.getBoundingClientRect().width) } : null;
  })()
`;

const POSTS = [];
try {
  await new Promise((r) => setTimeout(r, 1500));
  const targets = await browser.targets();
  const sw = targets.find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
  report("extensionId", sw ? new URL(sw.url()).host : null);

  const page = await browser.newPage();
  page.on("request", (req) => {
    if (req.method() !== "POST") return;
    const body = req.postData() ?? "";
    POSTS.push({
      url: req.url().slice(0, 90),
      len: body.length,
      marker: body.includes(PII_MARKER),
      token: body.includes("[[PRISM_"),
      leaked: body.includes(PII_EMAIL) || body.includes("9012345678"),
    });
  });

  await page.goto("https://lmarena.ai/", { waitUntil: "domcontentloaded", timeout: 45000 });
  // lmarena redirects to arena.ai via a slow SPA navigation — wait until the
  // URL is stable (unchanged for 2 consecutive polls) so evaluates don't hit a
  // detached frame mid-redirect
  let lastHref = "";
  let stableCount = 0;
  const settleStart = Date.now();
  while (stableCount < 2 && Date.now() - settleStart < 60000) {
    const href = await page.evaluate(() => location.href).catch(() => lastHref);
    stableCount = href === lastHref ? stableCount + 1 : 0;
    lastHref = href;
    await new Promise((r) => setTimeout(r, 1000));
  }
  report("settledUrl", lastHref);
  await page.waitForNetworkIdle({ idleTime: 1200, timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => document.documentElement.dataset.prism !== undefined, { timeout: 30000 }).catch(() => {});
  report("marker", await page.evaluate(() => document.documentElement.dataset.prism).catch(() => "none"));

  // wait for a visible composer (boolean poll inside the page — no serialization issues)
  const t0 = Date.now();
  const found = await page
    .waitForFunction(HAS_COMPOSER, { timeout: 120000, polling: 1000 })
    .then(() => true)
    .catch(() => false);
  report("composerFoundAtMs", Date.now() - t0);
  report("composerFound", found);
  if (!found) {
    const dom = await page.evaluate(() => {
      const teas = Array.from(document.querySelectorAll("textarea")).map((t) => ({ w: Math.round(t.getBoundingClientRect().width), h: Math.round(t.getBoundingClientRect().height) }));
      const ce = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]')).map((t) => ({ tag: t.tagName, w: Math.round(t.getBoundingClientRect().width), h: Math.round(t.getBoundingClientRect().height) }));
      return { url: location.href, textareas: teas, contentEditables: ce };
    }).catch(() => null);
    report("domDump", dom);
    throw new Error("no composer");
  }

  const focused = await page.evaluate(FOCUS_COMPOSER).catch(() => null);
  report("composerFocused", focused);
  // type with retries — a mid-redirect detach kills keyboard.type
  let typed = null;
  for (let attempt = 0; attempt < 3 && (!typed || !typed.text.includes(PII_MARKER)); attempt++) {
    try {
      await page.evaluate(FOCUS_COMPOSER).catch(() => {});
      await page.keyboard.type(PROMPT);
      typed = await page.evaluate(READ_COMPOSER).catch(() => null);
    } catch {
      typed = null;
    }
    if (!typed || !typed.text.includes(PII_MARKER)) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  report("typingLanded", typed !== null && typed.text.includes(PII_MARKER));
  try {
    await page.keyboard.press("Enter");
  } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 2500));

  const afterEnter = await page.evaluate(READ_COMPOSER).catch(() => null);
  report("composerAfterEnter", afterEnter);
  report("sendBtnState", await page.evaluate(SEND_BTN).catch(() => null));

  // The extension's own triggerSubmit now runs automatically after our Enter
  // (swap -> force-enable disabled send button -> click). Just watch the wire.
  const tWait = Date.now();
  while (Date.now() - tWait < 30000 && !POSTS.some((p) => p.marker || p.token)) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const interesting = POSTS.filter((p) => p.marker || p.token || p.leaked);
  report("matchingPosts", interesting);
  const submitted = interesting.find((p) => p.token);
  report("autoSubmitWorked", !!submitted);
  if (submitted) {
    report("payloadProtected", submitted.token && !submitted.leaked);
    report("payloadLeakedPII", submitted.leaked);
  } else if (POSTS.length > 0) {
    report("payloadCapture", `captured ${POSTS.length} POSTs, none with marker/tokens`);
  } else {
    report("payloadCapture", "no POST captured — likely websocket transport");
  }
  // did the model reply come back, and did restoration fix the echo?
  await new Promise((r) => setTimeout(r, 6000));
  const body = await page.evaluate(() => document.body.textContent).catch(() => "");
  report("bodyHasTokens", body.includes("[[PRISM_"));
  report("bodyHasPII", body.includes(PII_EMAIL));
} catch (err) {
  report("error", String(err).slice(0, 300));
}

console.log("===== PROBE SUMMARY =====");
console.log(JSON.stringify(results, null, 2));

try {
  await browser.close();
} catch { /* ignore */ }
process.exit(0);