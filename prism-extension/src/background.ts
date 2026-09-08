import { Prism, defaultPolicies, maskGeneric, type Vault } from "@prism-sdk";
import type { Config, Message, Response, Stats } from "./types";

/**
 * Vault persisted to chrome.storage.session: memory-backed, survives service
 * worker restarts within a browser session, and is wiped when the browser
 * closes. Secrets never touch disk and never leave the extension process.
 */
class SessionVault implements Vault {
  private map = new Map<string, string>();
  private seq = 0;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private hydration: Promise<void>;

  constructor() {
    this.hydration = this.hydrate();
  }

  private async hydrate() {
    try {
      const stored = await chrome.storage.session.get("vault");
      const data = stored.vault as Record<string, string> | undefined;
      // merge, don't overwrite: messages can arrive before hydration completes
      // (the onMessage listener is registered first so cold-start requests
      // aren't dropped), and those early registrations must survive
      if (data) {
        for (const [k, v] of Object.entries(data)) {
          if (!this.map.has(k)) this.map.set(k, v);
        }
      }
    } catch {
      /* session storage unavailable — start empty */
    }
  }

  async ready() {
    await this.hydration;
  }

  seal(secret: string): string {
    const token = `[[PRISM_${(++this.seq).toString(36)}]]`;
    this.map.set(token, secret);
    this.schedulePersist();
    return token;
  }

  open(token: string): string | undefined {
    return this.map.get(token);
  }

  /**
   * Insert a mapping generated elsewhere (the main-world WebSocket bridge).
   * Returns false when the token already exists — never clobber an older
   * mapping, since restoring the older secret would leak the newer one.
   */
  register(token: string, secret: string): boolean {
    if (this.map.has(token)) return false;
    this.map.set(token, secret);
    this.schedulePersist();
    return true;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.seq = 0;
    this.schedulePersist();
  }

  private schedulePersist() {
    if (this.writeTimer !== undefined) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      void chrome.storage.session
        .set({ vault: Object.fromEntries(this.map) })
        .catch(() => {});
    }, 200);
  }
}

const vault = new SessionVault();
const DEFAULT_CONFIG: Config = {
  enabled: true,
  policyIds: defaultPolicies.map((p) => p.id),
};

let config: Config = { ...DEFAULT_CONFIG };
let stats: Stats = { protected: 0, recent: [] };
let prism = new Prism({ vault, policies: defaultPolicies });

function rebuildPrism() {
  prism = new Prism({
    vault,
    policies: defaultPolicies.filter((p) => config.policyIds.includes(p.id)),
  });
}

async function persistConfig() {
  await chrome.storage.local.set({ config });
}

async function persistStats() {
  await chrome.storage.local.set({ stats });
}

function updateBadge() {
  const text = stats.protected > 0 ? String(stats.protected) : "";
  void chrome.action.setBadgeText({ text });
  if (stats.protected > 0) {
    void chrome.action.setBadgeBackgroundColor({ color: "#2dd4a7" });
  }
}

async function handle(
  message: Message,
  sender: chrome.runtime.MessageSender
): Promise<Response> {
  switch (message.type) {
    case "protect": {
      if (!config.enabled) return { ok: true, text: message.text, count: 0 };
      const result = prism.protect(message.text);
      if (result.count > 0) {
        stats.protected += result.count;
        const added = result.report
          .slice(0, 4)
          .map((m) => ({ label: m.label, display: m.display, at: Date.now() }));
        stats.recent = [...added, ...stats.recent].slice(0, 30);
        void persistStats();
        updateBadge();
      }
      return { ok: true, text: result.text, count: result.count };
    }

    case "restore": {
      return { ok: true, text: prism.restore(message.text) };
    }

    case "restoreTokens": {
      const map: Record<string, string> = {};
      for (const token of new Set(message.tokens)) {
        const secret = vault.open(token);
        if (secret !== undefined) map[token] = secret;
      }
      return { ok: true, map };
    }

    case "registerTokens": {
      let added = 0;
      for (const [token, value] of message.entries) {
        if (vault.register(token, value)) added += 1;
      }
      if (added > 0) {
        stats.protected += added;
        const recent = message.entries
          .slice(0, 4)
          .map(([, value]) => ({
            label: "WebSocket frame",
            display: maskGeneric(value),
            at: Date.now(),
          }));
        stats.recent = [...recent, ...stats.recent].slice(0, 30);
        void persistStats();
        updateBadge();
      }
      return { ok: true };
    }

    case "bridgeReady": {
      const tabId = sender?.tab?.id;
      if (tabId !== undefined) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["ws-bridge.js"],
            world: "MAIN",
          });
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      return { ok: true };
    }

    case "getConfig":
      return { ok: true, config };

    case "setConfig": {
      config = { ...config, ...message.config };
      rebuildPrism();
      void persistConfig();
      return { ok: true, config };
    }

    case "getStats":
      return { ok: true, stats };

    case "purge": {
      vault.clear();
      stats = { protected: 0, recent: [] };
      void persistStats();
      updateBadge();
      return { ok: true };
    }
  }
}

async function init() {
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    handle(message, sender)
      .then(sendResponse)
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true; // async response
  });

  await vault.ready();
  const stored = await chrome.storage.local.get(["config", "stats"]);
  if (stored.config) config = { ...DEFAULT_CONFIG, ...stored.config };
  if (stored.stats) stats = stored.stats;
  rebuildPrism();
  updateBadge();
}

void init();