// Prism extension E2E — drives a real Chrome with the extension loaded.
// Tests:
//   1. local contenteditable chat harness (localhost + ?prism_test)
//   2. HuggingFace Chat (real AI app, works anonymously)
//   3. login-gated AI sites — verify injection, report reachability
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIST = resolve(__dirname, "..", "dist");
const HARNESS_PORT = 8931;
const HARNESS_URL = `http://127.0.0.1:${HARNESS_PORT}/?prism_test=1`;

const PII_MARKER = "PRISME2E-2026";
const PII_EMAIL = `e2e.priya.${PII_MARKER}@example.com`;
const PII_PHONE = "+91 90123 45678";
const PROMPT = `Hi, contact ${PII_EMAIL} or ${PII_PHONE} please. This is ${PII_MARKER}.`;

const results = {};
let ns = "";
const report = (key, value) => {
  results[`${ns}${key}`] = value;
  console.log(`  ${key}:`, typeof value === "object" ? JSON.stringify(value) : value);
};

// ---------- local static server for the harness ----------
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  const file = req.url?.startsWith("/ws") ? "harness-ws.html" : "harness.html";
  res.end(readFileSync(join(__dirname, file)));
});
await new Promise((r) => server.listen(HARNESS_PORT, "127.0.0.1", r));

// ---------- local WebSocket echo server (outbound-frame capture) ----------
const WS_PORT = 8932;
const wsFrames = [];
const wss = new WebSocketServer({ port: WS_PORT, host: "127.0.0.1" });
wss.on("connection", (socket) => {
  socket.on("message", (data) => {
    const text = data.toString();
    wsFrames.push(text);
    socket.send(text); // echo — the page renders it, the observer restores it
  });
});

const browser = await puppeteer.launch({
  headless: false, // Chrome 137+ dropped --load-extension in headless
  args: [
    `--disable-extensions-except=${EXT_DIST}`,
    `--load-extension=${EXT_DIST}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
  ],
  defaultViewport: { width: 1280, height: 860 },
});

try {
  // ---------- find the extension id ----------
  await new Promise((r) => setTimeout(r, 1500));
  const targets = await browser.targets();
  const sw = targets.find((t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"));
  const extId = sw ? new URL(sw.url()).host : null;
  report("extensionLoaded", extId !== null);
  report("extensionId", extId);

  // ---------- helper ----------
  async function waitForPrismMarker(page, timeoutMs = 15000) {
    await page.waitForFunction(
      () => document.documentElement.dataset.prism !== undefined,
      { timeout: timeoutMs }
    );
    return page.evaluate(() => document.documentElement.dataset.prism);
  }

  // ============================================================
  // TEST 1 — contenteditable harness (localhost)
  // ============================================================
  console.log("\n[1] contenteditable harness (localhost)");
  const page1 = await browser.newPage();
  await page1.goto(HARNESS_URL, { waitUntil: "domcontentloaded" });
  const marker1 = await waitForPrismMarker(page1);
  report("contentScriptMarker", marker1);
  await page1.waitForSelector("#composer");
  await page1.click("#composer");
  await page1.keyboard.type(PROMPT);
  await page1.keyboard.press("Enter");
  // what the harness "sent" (protected) — captured at submit time
  await page1.waitForFunction(() => window.__received !== "", { timeout: 5000 });
  const sentRaw = await page1.evaluate(() => window.__received);
  report("harnessReceivedProtected", sentRaw.includes("[[PRISM_"));
  report("harnessReceivedLeakedPII", sentRaw.includes(PII_EMAIL) || sentRaw.includes("9012345678"));
  // the echoed history entry gets restored by the observer
  await new Promise((r) => setTimeout(r, 1200));
  const historyText = await page1.evaluate(() => document.querySelector("#log").textContent);
  report("historyRestored", historyText.includes(PII_EMAIL) && !historyText.includes("[[PRISM_"));  await page1.close();

  // ============================================================
  // TEST 1b — WebSocket harness (localhost): frames protected on the wire
  // ============================================================
  console.log("\n[1b] WebSocket harness (localhost, ws.send bypasses DOM)");
  ns = "ws_";
  const page1b = await browser.newPage();
  const pageConsole = [];
  page1b.on("console", (msg) => {
    const t = msg.text();
    if (t.includes("[prism]")) pageConsole.push(t);
  });
  await page1b.goto(`http://127.0.0.1:${HARNESS_PORT}/ws?prism_test=1`, { waitUntil: "domcontentloaded" });
  const wsMarker = await waitForPrismMarker(page1b).catch(() => "gone");
  report("contentScriptMarker", wsMarker);
  await page1b.waitForSelector("#ws-input");
  await page1b.click("#ws-input");
  await page1b.keyboard.type(PROMPT);
  await page1b.click("#ws-send");
  // wait for the echo frame to arrive back and be rendered
  await page1b.waitForFunction(() => window.__wsReceived && window.__wsReceived.length > 0, { timeout: 10000 }).catch(() => {});
  const received = await page1b.evaluate(() => window.__wsReceived ?? []);
  report("echoReceived", received.length > 0);
  const sentFrame = wsFrames.find((f) => f.includes(PII_MARKER));
  report("wsFrameCaptured", !!sentFrame);
  report("wsFrameProtected", !!sentFrame && sentFrame.includes("[[PRISM_"));
  report("wsFrameLeakedPII", !!sentFrame && (sentFrame.includes(PII_EMAIL) || sentFrame.includes("9012345678")));
  report("wsFrameSample", sentFrame ? sentFrame.slice(0, 90) : null);
  // the echoed frame renders in the DOM — the observer should restore real values
  await new Promise((r) => setTimeout(r, 1400));
  const wsLogText = await page1b.evaluate(() => document.getElementById("ws-log").textContent);
  report("wsEchoRestored", wsLogText.includes(PII_EMAIL) && !wsLogText.includes("[[PRISM_"));
  report("pageConsole", pageConsole.slice(0, 12));
  await page1b.close();


  // ============================================================
  // TEST 2 — HuggingFace Chat (real AI app, anonymous)
  // ============================================================
  const ONLY = process.env.ONLY;
  console.log("\n[2] HuggingFace Chat (real AI)");
  ns = "hf_";
  const page2 = await browser.newPage();
  let hfPayload = null;
  let hfRequestUrl = null;
  page2.on("request", (req) => {
    if (req.method() === "POST" && (req.url().includes("/chat/") || req.url().includes("/api/"))) {
      const body = req.postData() ?? "";
      if (body.includes(PII_MARKER) || body.includes("[[PRISM_")) {
        hfRequestUrl = req.url();
        hfPayload = body;
      }
    }
  });
  const postLog = [];
  page2.on("request", (req) => {
    if (req.method() !== "POST") return;
    const body = req.postData() ?? "";
    postLog.push({
      url: req.url().slice(0, 80),
      len: body.length,
      marker: body.includes(PII_MARKER),
      token: body.includes("[[PRISM_"),
      leaked: body.includes(PII_EMAIL) || body.includes("9012345678"),
    });
  });

  const FIND_COMPOSER = `
    (() => {
      const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
      const vis = cands.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 20;
      });
      return vis[vis.length - 1] ?? null;
    })()
  `;
  const composerJSON = `
    (() => {
      const c = ${FIND_COMPOSER};
      return c ? { tag: c.tagName, editable: c.isContentEditable } : null;
    })()
  `;

  async function poll(expr, timeoutMs, interval = 400) {
    const t0 = Date.now();
    for (;;) {
      const val = await page2.evaluate(expr).catch(() => null);
      if (val) return val;
      if (Date.now() - t0 > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  try {
    await page2.goto("https://huggingface.co/chat", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page2.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
    const marker2 = await waitForPrismMarker(page2, 20000);
    report("contentScriptMarker", marker2);

    // HF's anonymous landing shows a model-picker dialog — dismiss it if present
    const modalDismissed = await page2
      .evaluate(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return "no-dialog";
        const close = dlg.querySelector('[aria-label*="close" i], [aria-label*="Close"], [data-testid*="close" i], button svg[aria-label*="close" i]');
        if (close) { const b = close.closest("button") || close; b.click(); return "closed"; }
        return "no-close-button";
      })()`)
      .catch(() => "unknown");
    report("modalDismissal", modalDismissed);
    await new Promise((r) => setTimeout(r, 1200));

    // HF's anonymous landing can be a model picker — try picking the first model
    const pickedModel = await page2
      .evaluate(`(() => {
        const pick = (el) => el && el.click ? (el.click(), true) : false;
        const opt = document.querySelector('[role="option"]');
        if (opt && pick(opt)) return true;
        const cards = Array.from(document.querySelectorAll('button, [class*="card" i], [class*="model" i]'));
        const card = cards.find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 100 && r.height > 30 && /\b(7b|8b|70b|instruct|chat|gpt|llama|mistral|qwen)\b/i.test(el.textContent || "") && el.textContent.length < 120;
        });
        return card ? pick(card) : false;
      })()`)
      .catch(() => false);
    report("modelPicked", pickedModel);
    await new Promise((r) => setTimeout(r, 2000));

    const composerInfo = await poll(composerJSON, 15000);
    report("composer", composerInfo);

    const focused = await page2
      .evaluate(`(() => { const c = ${FIND_COMPOSER}; if (!c) return false; c.focus(); return true; })()`)
      .catch(() => false);
    report("composerFocused", focused);

    await page2.keyboard.type(PROMPT);
    const typedValue = await page2
      .evaluate(`(() => { const c = ${FIND_COMPOSER}; return c ? (c.value ?? c.innerText) : null; })()`)
      .catch(() => null);
    report("typingLanded", typedValue !== null && typedValue.includes(PII_MARKER));

    await page2.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 4000));
    report("urlAfterEnter", page2.url().slice(0, 90));
    const composerState = await page2
      .evaluate(`(() => { const c = ${FIND_COMPOSER}; if (!c) return null; const v = c.value ?? c.innerText; return { text: v.slice(0, 60), tokenized: v.includes("[[PRISM_") }; })()`)
      .catch(() => null);
    report("composerAfterEnter", composerState);

    // if Enter didn't submit, try the Send button (tests the button-click path)
    if (!(composerState && composerState.text === "") && !postLog.some((p) => p.marker || p.token)) {
      const clickedSend = await page2
        .evaluate(`(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const send = btns.find((b) =>
            /send|submit/i.test(b.getAttribute("aria-label") || "") ||
            (b.querySelector('svg') && /send/i.test(b.outerHTML.slice(0, 400)))
          );
          if (send) { send.click(); return true; }
          return false;
        })()`)
        .catch(() => false);
      report("sendButtonClicked", clickedSend);
      await new Promise((r) => setTimeout(r, 4000));
    }

    // wait for a matching request (model reply can take a while)
    const replied = await new Promise((resolveReply) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (postLog.some((p) => p.marker || p.token)) { clearInterval(iv); resolveReply(true); return; }
        if (Date.now() - t0 > 60000) { clearInterval(iv); resolveReply(false); }
      }, 500);
    });
    report("requestSeen", replied);

    const interesting = postLog.filter((p) => p.marker || p.token || p.leaked);
    report("matchingRequests", interesting);
    const payload = interesting.find((p) => p.token || p.marker);
    if (payload) {
      report("payloadProtected", payload.token && !payload.leaked);
      report("payloadLeakedPII", payload.leaked);
    } else if (postLog.length > 0) {
      report("payloadCapture", `captured ${postLog.length} POSTs, none with marker/tokens`);
    } else {
      report("payloadCapture", "no POST requests captured — likely websocket transport");
    }

    await new Promise((r) => setTimeout(r, 3000));
    const hfBody = await page2.evaluate(() => document.body.textContent).catch(() => "");
    report("echoRestored", hfBody.includes(PII_EMAIL));
    report("echoStillTokenized", hfBody.includes("[[PRISM_"));
  } catch (err) {
    report("hfError", String(err).slice(0, 200));
  }
  try {
    await page2.close();
  } catch {
    /* already gone */
  }
  if (ONLY && ONLY !== "arena") {
    console.log(`  (skipped: ONLY=${ONLY})`);
  } else {

  // ============================================================
  // TEST 2b — LM Arena (lmarena.ai) — real AI chat, anonymous
  // ============================================================
  console.log("\n[2b] LM Arena (real AI, anonymous)");
  ns = "arena_";
  const page3 = await browser.newPage();
  const arenaPosts = [];
  page3.on("request", (req) => {
    if (req.method() !== "POST") return;
    const body = req.postData() ?? "";
    arenaPosts.push({
      url: req.url().slice(0, 90),
      len: body.length,
      marker: body.includes(PII_MARKER),
      token: body.includes("[[PRISM_"),
      leaked: body.includes(PII_EMAIL) || body.includes("9012345678"),
    });
  });
  const ARENA_COMPOSER = `
    (() => {
      const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
      const vis = cands.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 200 && r.height > 30;
      });
      return vis[vis.length - 1] ?? null;
    })()
  `;
  const arenaComposerJSON = `
    (() => {
      const c = ${ARENA_COMPOSER};
      return c ? { tag: c.tagName, editable: c.isContentEditable } : null;
    })()
  `;
  try {
    await page3.goto("https://lmarena.ai/", { waitUntil: "domcontentloaded", timeout: 45000 });
    // lmarena redirects to arena.ai via a slow SPA navigation — wait until the
    // URL is stable so evaluates don't hit a detached frame mid-redirect
    let lastHref = "";
    let stableCount = 0;
    const settleStart = Date.now();
    while (stableCount < 2 && Date.now() - settleStart < 60000) {
      const href = await page3.evaluate(() => location.href).catch(() => lastHref);
      stableCount = href === lastHref ? stableCount + 1 : 0;
      lastHref = href;
      await new Promise((r) => setTimeout(r, 1000));
    }
    report("settledUrl", lastHref);
    await page3.waitForNetworkIdle({ idleTime: 1200, timeout: 30000 }).catch(() => {});
    report("contentScriptMarker", await waitForPrismMarker(page3, 20000).catch(() => "gone"));

    let composerInfo = null;
    const t0 = Date.now();
    while (!composerInfo && Date.now() - t0 < 25000) {
      composerInfo = await page3.evaluate(arenaComposerJSON).catch(() => null);
      if (!composerInfo) await new Promise((r) => setTimeout(r, 600));
    }
    report("composer", composerInfo);
    if (!composerInfo) throw new Error("no composer found on lmarena");

    const focused = await page3
      .evaluate(`(() => { const c = ${ARENA_COMPOSER}; if (!c) return false; c.focus(); return true; })()`)
      .catch(() => false);
    report("composerFocused", focused);
    await page3.keyboard.type(PROMPT);
    const typedValue = await page3
      .evaluate(`(() => { const c = ${ARENA_COMPOSER}; return c ? (c.value ?? c.innerText) : null; })()`)
      .catch(() => null);
    report("typingLanded", typedValue !== null && typedValue.includes(PII_MARKER));

    await page3.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 2500));
    // arena.ai sometimes shows a consent gate ("Agree"/"Close") right after the
    // first submit attempt — dismiss it and press Enter again
    const gateDismissed = await page3
      .evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const b = btns.find((x) => {
          const t = (x.textContent || "").trim().toLowerCase();
          return /^(agree|i agree|accept|got it|okay|ok|close)$/.test(t) && x.getBoundingClientRect().width > 0;
        });
        if (!b) return false;
        b.click();
        return true;
      })
      .catch(() => false);
    report("gateDismissed", gateDismissed);
    if (gateDismissed) {
      await new Promise((r) => setTimeout(r, 1200));
      try {
        await page3.keyboard.press("Enter");
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 2500));
    }
    const arenaComposerState = await page3
      .evaluate(`(() => { const c = ${ARENA_COMPOSER}; if (!c) return null; const v = c.value ?? c.innerText; return { text: v.slice(0, 60), tokenized: v.includes("[[PRISM_") }; })()`)
      .catch(() => null);
    report("composerAfterEnter", arenaComposerState);

    // deep diagnostic: every button near the composer + clickable candidates
    const arenaButtons = await page3
      .evaluate(`(() => {
        const c = ${ARENA_COMPOSER};
        const near = c ? Array.from(c.parentElement?.querySelectorAll("button") ?? []) : [];
        const all = Array.from(document.querySelectorAll("button"));
        const describe = (b) => ({
          aria: b.getAttribute("aria-label") ?? "",
          title: b.title ?? "",
          text: (b.textContent || "").trim().slice(0, 16),
          cls: (b.className || "").toString().slice(0, 30),
          disabled: b.disabled,
          w: Math.round(b.getBoundingClientRect().width),
          h: Math.round(b.getBoundingClientRect().height),
        });
        return {
          nearComposer: near.map(describe),
          allVisible: all.filter((b) => b.getBoundingClientRect().width > 0).map(describe),
        };
      })()`)
      .catch(() => null);
    report("buttonsNearComposer", arenaButtons?.nearComposer);
    report("allButtons", arenaButtons?.allVisible);
    if (arenaComposerState && arenaComposerState.tokenized) {
      const manualClick = await page3
        .evaluate(`(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const b = btns.find((x) => {
            const aria = x.getAttribute("aria-label") ?? "";
            const label = (aria || x.title || (x.textContent ?? "")).trim();
            return /^(send|submit|ask)( message)?$/i.test(label) && x.getBoundingClientRect().width > 0 && !x.disabled;
          });
          if (!b) return false;
          b.click();
          return true;
        })()`)
        .catch(() => false);
      report("manualSendClicked", manualClick);
      await new Promise((r) => setTimeout(r, 6000));
      const afterManual = arenaPosts.filter((p) => p.marker || p.token);
      report("postsAfterManualSend", afterManual);
    }
    // quick poll for transient placeholders in the DOM (definitive if payload missed)
    let sawTokens = false;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 10000) {
      const has = await page3.evaluate(() => document.body.textContent.includes("[[PRISM_")).catch(() => false);
      if (has) { sawTokens = true; break; }
      await new Promise((r) => setTimeout(r, 60));
    }
    report("tokensSeenTransiently", sawTokens);

    // wait for a matching POST (model reply round-trip)
    const replied = await new Promise((resolveReply) => {
      const t2 = Date.now();
      const iv = setInterval(() => {
        if (arenaPosts.some((p) => p.marker || p.token)) { clearInterval(iv); resolveReply(true); return; }
        if (Date.now() - t2 > 60000) { clearInterval(iv); resolveReply(false); }
      }, 500);
    });
    report("requestSeen", replied);

    const interesting = arenaPosts.filter((p) => p.marker || p.token || p.leaked);
    report("matchingRequests", interesting);
    const payload = interesting.find((p) => p.token || p.marker);
    if (payload) {
      report("payloadProtected", payload.token && !payload.leaked);
      report("payloadLeakedPII", payload.leaked);
    } else if (arenaPosts.length > 0) {
      report("payloadCapture", `captured ${arenaPosts.length} POSTs, none with marker/tokens`);
    } else {
      report("payloadCapture", "no POST captured — likely websocket transport");
    }

    // restoration check: the echoed user message should eventually show the real values
    await new Promise((r) => setTimeout(r, 4000));
    const arenaBody = await page3.evaluate(() => document.body.textContent).catch(() => "");
    report("echoRestored", arenaBody.includes(PII_EMAIL));
    report("echoStillTokenized", arenaBody.includes("[[PRISM_"));
  } catch (err) {
    report("arenaError", String(err).slice(0, 200));
  }
  try {
    await page3.close();
  } catch {
    /* already gone */
  }
  } // end ONLY guard for arena

  // ============================================================
  // TEST 2c — Microsoft Copilot (copilot.microsoft.com) — anonymous
  // ============================================================
  if (ONLY && ONLY !== "copilot") {
    console.log(`  (skipped: ONLY=${ONLY})`);
  } else {
  console.log("\n[2c] Microsoft Copilot (real AI, anonymous)");
  ns = "copilot_";
  const page4 = await browser.newPage();
  const copilotPosts = [];
  page4.on("request", (req) => {
    if (req.method() !== "POST") return;
    const body = req.postData() ?? "";
    copilotPosts.push({
      url: req.url().slice(0, 90),
      marker: body.includes(PII_MARKER),
      token: body.includes("[[PRISM_"),
      leaked: body.includes(PII_EMAIL) || body.includes("9012345678"),
    });
  });
  const COPILOT_COMPOSER = `
    (() => {
      const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]'));
      const vis = cands.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 200 && r.height > 30;
      });
      return vis[vis.length - 1] ?? null;
    })()
  `;
  const copilotComposerJSON = `
    (() => {
      const c = ${COPILOT_COMPOSER};
      return c ? { tag: c.tagName, editable: c.isContentEditable } : null;
    })()
  `;
  try {
    await page4.goto("https://copilot.microsoft.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page4.waitForNetworkIdle({ idleTime: 1200, timeout: 30000 }).catch(() => {});
    report("contentScriptMarker", await waitForPrismMarker(page4, 20000).catch(() => "gone"));

    let composerInfo = null;
    const t3 = Date.now();
    while (!composerInfo && Date.now() - t3 < 25000) {
      composerInfo = await page4.evaluate(copilotComposerJSON).catch(() => null);
      if (!composerInfo) await new Promise((r) => setTimeout(r, 600));
    }
    report("composer", composerInfo);
    if (!composerInfo) throw new Error("no composer found on copilot");

    await page4.evaluate(`(() => { const c = ${COPILOT_COMPOSER}; if (!c) return false; c.focus(); return true; })()`).catch(() => {});
    await page4.keyboard.type(PROMPT);
    const typedValue = await page4
      .evaluate(`(() => { const c = ${COPILOT_COMPOSER}; return c ? (c.value ?? c.innerText) : null; })()`)
      .catch(() => null);
    report("typingLanded", typedValue !== null && typedValue.includes(PII_MARKER));

    await page4.keyboard.press("Enter");
    let sawTokens = false;
    const p2 = Date.now();
    while (Date.now() - p2 < 10000) {
      const has = await page4.evaluate(() => document.body.textContent.includes("[[PRISM_")).catch(() => false);
      if (has) { sawTokens = true; break; }
      await new Promise((r) => setTimeout(r, 60));
    }
    report("tokensSeenTransiently", sawTokens);

    const replied = await new Promise((resolveReply) => {
      const t4 = Date.now();
      const iv = setInterval(() => {
        if (copilotPosts.some((p) => p.marker || p.token)) { clearInterval(iv); resolveReply(true); return; }
        if (Date.now() - t4 > 60000) { clearInterval(iv); resolveReply(false); }
      }, 500);
    });
    report("requestSeen", replied);

    const interesting = copilotPosts.filter((p) => p.marker || p.token || p.leaked);
    report("matchingRequests", interesting);
    const payload = interesting.find((p) => p.token || p.marker);
    if (payload) {
      report("payloadProtected", payload.token && !payload.leaked);
      report("payloadLeakedPII", payload.leaked);
    } else if (copilotPosts.length > 0) {
      report("payloadCapture", `captured ${copilotPosts.length} POSTs, none with marker/tokens`);
    } else {
      report("payloadCapture", "no POST captured — likely websocket transport");
    }

    await new Promise((r) => setTimeout(r, 4000));
    const copBody = await page4.evaluate(() => document.body.textContent).catch(() => "");
    report("echoRestored", copBody.includes(PII_EMAIL));
    report("echoStillTokenized", copBody.includes("[[PRISM_"));
  } catch (err) {
    report("copilotError", String(err).slice(0, 200));
  }
  try {
    await page4.close();
  } catch {
    /* already gone */
  }
  } // end ONLY guard for copilot

  // ============================================================
  // TEST 3 — login-gated AI sites: injection + reachability
  // ============================================================
  ns = "";
  if (ONLY && ONLY !== "sites") {
    console.log("  (skipped: ONLY=" + ONLY + ")");
  } else {
  console.log("\n[3] login-gated AI sites");
  for (const url of ["https://chatgpt.com/", "https://claude.ai/", "https://gemini.google.com/"]) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      const marker = await waitForPrismMarker(page, 15000);
      const hasComposer = await page.evaluate(() => {
        const c = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
        return c ? { tag: c.tagName, editable: c.isContentEditable, visible: (c.getBoundingClientRect().width > 50) } : false;
      });
      const hasLogin = await page.evaluate(() =>
        document.body.textContent.toLowerCase().includes("log in") ||
        document.body.textContent.toLowerCase().includes("sign in")
      );
      report(new URL(url).hostname, { marker, composer: hasComposer, loginWall: hasLogin });
    } catch (err) {
      report(new URL(url).hostname, { error: String(err).slice(0, 120) });
    }
    await page.close();
  }
  } // end ONLY guard for sites
} finally {
  try {
    await browser.close();
  } catch {
    /* browser already gone */
  }
  server.close();
}

console.log("\n===== SUMMARY =====");
console.log(JSON.stringify(results, null, 2));