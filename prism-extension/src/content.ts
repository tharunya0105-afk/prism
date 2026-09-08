import { TOKEN_PATTERN } from "@prism-sdk";
import type { Config, Message, Response } from "./types";

/* ------------------------------------------------------------------ */
/* Config cache                                                        */
/* ------------------------------------------------------------------ */

let enabled = true;

/** Mirror the master switch into a data attribute the main-world WS bridge can read. */
function mirrorEnabled() {
  document.documentElement.dataset.prismEnabled = enabled ? "1" : "0";
}

async function refreshConfig() {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "getConfig" } as Message)) as Response;
    if (res.ok && "config" in res) enabled = res.config.enabled;
  } catch {
    /* extension context invalidated — fall back to current state */
  }
  mirrorEnabled();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.config?.newValue) {
    enabled = (changes.config.newValue as Config).enabled;
    mirrorEnabled();
  }
});

void refreshConfig();

// Ask the background to inject the main-world WebSocket bridge. This runs at
// document_start so the page's WebSocket.prototype.send is patched before the
// app wires up its chat transport.
chrome.runtime.sendMessage({ type: "bridgeReady" } as Message).catch(() => {});

// Relay placeholder → secret mappings from the main-world bridge into the
// background vault (postMessage crosses the isolated/main world boundary).
window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window) return;
  const data = e.data as
    | { source?: string; type?: string; entries?: [string, string][] }
    | null;
  if (!data || data.source !== "prism-ws-bridge" || data.type !== "mappings") return;
  if (!Array.isArray(data.entries) || data.entries.length === 0) return;
  chrome.runtime
    .sendMessage({ type: "registerTokens", entries: data.entries } as Message)
    .catch(() => {});
});

/* ------------------------------------------------------------------ */
/* Chat input detection                                                */
/* ------------------------------------------------------------------ */

const AI_HOSTS = new Set([
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "aistudio.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "grok.com",
  "huggingface.co",
  "poe.com",
  "mistral.ai",
  "you.com",
  "lmarena.ai",
  "arena.ai",
]);

function isAIChatHost(): boolean {
  const host = location.hostname.replace(/^www\./, "");
  if (AI_HOSTS.has(host) || host.endsWith(".chatgpt.com")) return true;
  // local test harness hook: only on localhost with an explicit query flag
  if (["localhost", "127.0.0.1"].includes(location.hostname) && location.search.includes("prism_test")) {
    return true;
  }
  return false;
}

function isEditable(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const input = el as HTMLInputElement;
    const kind = input instanceof HTMLTextAreaElement ? "textarea" : input.type;
    if (kind === "textarea" || kind === "text" || kind === "search") return el;
    return null;
  }
  if (el.isContentEditable) return el;
  return null;
}

function readValue(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  return el.innerText ?? "";
}

// React-controlled inputs instrument the instance's value setter, so a plain
// `el.value = x` never reaches React's internal state (send buttons stay
// disabled, React overwrites the text on next render). Calling the prototype's
// native setter bypasses the tracker; the input event then syncs React.
const NATIVE_TEXTAREA_SET = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
const NATIVE_INPUT_SET = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

function writeValue(el: HTMLElement, text: string): boolean {
  try {
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = el instanceof HTMLTextAreaElement ? NATIVE_TEXTAREA_SET : NATIVE_INPUT_SET;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    // contenteditable (ProseMirror & friends): replace content via execCommand,
    // which the editor actually understands
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const ok = document.execCommand("insertText", false, text);
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Enter interception                                                  */
/* ------------------------------------------------------------------ */

let intercepting = false;

/**
 * Find the composer's send button, if any.
 * When allowDisabled is true, also match buttons whose disabled attribute is
 * set — some frameworks keep the button disabled because React never learned
 * about our programmatic swap, yet their submit handler reads the DOM value.
 */
function findSendButton(allowDisabled = false): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((b) => {
      const aria = b.getAttribute("aria-label") ?? "";
      const label = (aria || b.title || (b.textContent ?? "")).trim();
      const match = SEND_BTN_RE.test(label) || /^send( message)?$/i.test(aria);
      if (!match) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (allowDisabled || !b.disabled);
    }) ?? null
  );
}

/**
 * Trigger the app's submit. Order of preference:
 *  1. click the enabled send button (React synced the swap — ideal)
 *  2. force-enable a disabled send button and click it (verified on LMArena:
 *     the submit handler reads the DOM value, so the tokenized text goes out
 *     and PII never leaves the page)
 *  3. re-dispatch Enter on the composer (apps with trusted-event checks
 *     ignore this, so it's the weakest option)
 * Wait a tick first so React-controlled composers sync the swapped value.
 */
async function triggerSubmit(el: HTMLElement) {
  await new Promise((r) => setTimeout(r, 80));
  const send = findSendButton();
  if (send) {
    send.click();
    return;
  }
  const disabledSend = findSendButton(true);
  if (disabledSend) {
    disabledSend.disabled = false;
    disabledSend.click();
    return;
  }
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

async function protectAndResend(el: HTMLElement, original: string) {
  const res = (await chrome.runtime.sendMessage({ type: "protect", text: original } as Message)) as Response;
  if (!res.ok || !("text" in res)) return;
  if (res.text === original) return; // nothing sensitive — let it send as-is
  const written = writeValue(el, res.text);
  if (!written) return; // couldn't swap — fail open
  intercepting = true;
  try {
    await triggerSubmit(el);
  } finally {
    intercepting = false;
  }
}

document.addEventListener(
  "keydown",
  (e) => {
    if (!enabled || intercepting) return;
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.isComposing) return; // IME confirmation — not a send
    if (!isAIChatHost()) return;
    const el = isEditable(e.target);
    if (!el) return;
    const original = readValue(el);
    if (!original || !original.trim()) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    protectAndResend(el, original).catch((err) => {
      // fail open: put the user's text back; they can press Enter again
      console.warn("[prism] interception failed, sending as-is:", err);
      writeValue(el, original);
    });
  },
  true
);

/* ------------------------------------------------------------------ */
/* Send-button interception (for apps that submit via a button)         */
/* ------------------------------------------------------------------ */

let lastEditable: HTMLElement | null = null;
document.addEventListener("focusin", (e) => {
  const el = isEditable(e.target);
  if (el) lastEditable = el;
});

const SEND_BTN_RE = /^(send|submit|ask|go|generate)( message)?$/i;

async function protectAndResendViaButton(el: HTMLElement, original: string, btn: HTMLButtonElement) {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "protect", text: original } as Message)) as Response;
    if (!res.ok || !("text" in res)) return;
    if (res.text !== original) {
      writeValue(el, res.text); // swap before re-clicking
    }
  } catch {
    /* fail open — re-click sends the original */
  }
  // tick for React to sync the swapped value, then re-click the button;
  // force-enable it defensively in case the framework disabled it after the swap
  await new Promise((r) => setTimeout(r, 80));
  intercepting = true;
  try {
    btn.disabled = false;
    btn.click();
  } finally {
    intercepting = false;
  }
}

document.addEventListener(
  "click",
  (e) => {
    if (!enabled || intercepting || !isAIChatHost()) return;
    const target = e.target as HTMLElement;
    const btn = target.closest("button") as HTMLButtonElement | null;
    if (!btn) return;
    const aria = btn.getAttribute("aria-label") ?? "";
    const label = (aria || btn.title || (btn.textContent ?? "")).trim();
    if (!(SEND_BTN_RE.test(label) || /^send$/i.test(aria))) return;
    const el = lastEditable;
    if (!el) return;
    const original = readValue(el);
    if (!original || !original.trim()) return;
    if (original.includes("[[PRISM_")) return; // already protected
    e.preventDefault();
    e.stopImmediatePropagation();
    void protectAndResendViaButton(el, original, btn);
  },
  true
);

/* ------------------------------------------------------------------ */
/* Restore placeholders in page text                                   */
/* ------------------------------------------------------------------ */

const pendingTokens = new Set<string>();
let restoreTimer: number | undefined;

function collectTokens(node: Node): string[] {
  const tokens: string[] = [];
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    const matches = text.match(TOKEN_PATTERN);
    if (matches) tokens.push(...matches);
    return tokens;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return tokens;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT") return tokens;
  el.childNodes.forEach((child) => tokens.push(...collectTokens(child)));
  return tokens;
}

function scheduleRestore() {
  if (pendingTokens.size === 0) return;
  if (restoreTimer !== undefined) return;
  restoreTimer = window.setTimeout(async () => {
    restoreTimer = undefined;
    const tokens = [...pendingTokens];
    pendingTokens.clear();
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "restoreTokens",
        tokens,
      } as Message)) as Response;
      if (!res.ok || !("map" in res)) return;
      const map = res.map;
      const replaceIn = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? "";
          const next = text.replace(TOKEN_PATTERN, (tok) => map[tok] ?? tok);
          if (next !== text) node.textContent = next;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        const tag = el.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA" || tag === "INPUT") return;
        el.childNodes.forEach(replaceIn);
      };
      replaceIn(document.body);
    } catch {
      /* context invalidated — give up quietly */
    }
  }, 350);
}

// watch every mutation; scan added subtrees for placeholders
const observer = new MutationObserver((mutations) => {
  if (pendingTokens.size > 400) return; // pathological case — back off
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      for (const tok of collectTokens(node)) pendingTokens.add(tok);
    }
  }
  scheduleRestore();
});

// sweep existing content once (tokens from earlier in this browser session)
// and start the observer; at document_start the body may not exist yet
function startRestore() {
  if (!document.body) return false;
  observer.observe(document.body, { childList: true, subtree: true });
  const existing = collectTokens(document.body);
  existing.forEach((t) => pendingTokens.add(t));
  scheduleRestore();
  return true;
}
void (async () => {
  await refreshConfig();
  if (!startRestore()) {
    document.addEventListener("DOMContentLoaded", () => startRestore(), { once: true });
  }
})();

// diagnostic marker: DOM is shared between worlds, so tests can confirm
// this script injected by reading documentElement.dataset.prism
if (document.documentElement) {
  document.documentElement.dataset.prism = isAIChatHost() ? "active" : "injected";
}