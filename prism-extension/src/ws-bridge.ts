/**
 * ws-bridge.ts — outbound WebSocket redaction.
 *
 * Runs in the page's MAIN world (injected by the background service worker via
 * chrome.scripting.executeScript with world: "MAIN"), so it shares the page's
 * WebSocket constructor — patching it here actually intercepts the app's
 * frames, which is impossible from the content script's isolated world.
 *
 * On every outbound frame it runs the same Prism protection the DOM
 * interception uses, synchronously (send() can't await anything). Frames that
 * contain PII go out as [[PRISM_ws_…]] placeholders, and the placeholder →
 * secret mapping is posted to the content script (isolated world) which relays
 * it into the background's session vault, so restoration later works exactly
 * like DOM-level redaction.
 *
 * This is defense-in-depth: sites whose submit path slips past the Enter /
 * button interception still get their WebSocket payloads redacted here.
 */
import { Prism, type Vault } from "@prism-sdk";

/** Local vault: seal() must be synchronous, and we drain new entries after each protect(). */
class BridgeVault implements Vault {
  private map = new Map<string, string>();
  private seq = 0;

  seal(secret: string): string {
    // must match the SDK's TOKEN_PATTERN ([[PRISM_<lowercase alnum>]]) — no
    // underscores inside the body. "ws" prefix namespaces bridge tokens away
    // from the background vault's plain numeric tokens.
    const token = `[[PRISM_ws${(++this.seq).toString(36)}]]`;
    this.map.set(token, secret);
    return token;
  }

  open(token: string): string | undefined {
    return this.map.get(token);
  }

  get size(): number {
    return this.map.size;
  }

  /** Entries added since the vault held `since` entries (used to drain a protect() round). */
  snapshotNew(since: number): [string, string][] {
    return [...this.map.entries()].slice(since);
  }

  clear(): void {
    this.map.clear();
    this.seq = 0;
  }
}

const vault = new BridgeVault();
const prism = new Prism({ vault });

/** Respect the popup's master switch, which the content script mirrors into a data attribute. */
function isEnabled(): boolean {
  return document.documentElement.dataset.prismEnabled !== "0";
}

/** Protect a string frame; returns the same string when nothing sensitive was found. */
function protectText(text: string): string {
  if (!isEnabled() || text.length === 0) return text;
  const before = vault.size;
  const result = prism.protect(text);
  if (result.count === 0) return text;
  const entries = vault.snapshotNew(before);
  if (entries.length > 0) {
    // postMessage crosses the world boundary — the content script relays into
    // the background vault
    window.postMessage(
      { source: "prism-ws-bridge", type: "mappings", entries },
      "*"
    );
  }
  return result.text;
}

/** The content script marks AI chat hosts with dataset.prism === "active".
 * The bridge must NOT rewrite frames on arbitrary sites (a bank's WS traffic
 * getting redacted would corrupt real transactions), so we no-op elsewhere. */
function isAIChatHost(): boolean {
  return document.documentElement.dataset.prism === "active";
}

declare global {
  interface Window {
    /** Set once the bridge is installed — also lets harness pages wait for us. */
    __prismWsPatched?: boolean;
  }
}

if (!window.__prismWsPatched) {
  window.__prismWsPatched = true;
  const nativeSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (
    this: WebSocket,
    data: unknown
  ): void {
    if (typeof data === "string" && isAIChatHost()) {
      const out = protectText(data);
      if (out !== data) {
        nativeSend.call(this, out);
        return;
      }
    }
    // binary frames and non-chat hosts: pass through untouched
    nativeSend.call(this, data as Parameters<typeof nativeSend>[0]);
  } as typeof WebSocket.prototype.send;
}