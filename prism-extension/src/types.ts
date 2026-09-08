/** Extension-wide shared types and message protocol. */

export interface Config {
  /** Master switch — when off, nothing is intercepted. */
  enabled: boolean;
  /** Active policy ids (subset of prism-sdk's defaultPolicies). */
  policyIds: string[];
}

export interface RecentRedaction {
  label: string;
  /** Masked display — never the raw secret. */
  display: string;
  at: number;
}

export interface Stats {
  protected: number;
  recent: RecentRedaction[];
}

export type Message =
  | { type: "protect"; text: string }
  | { type: "restore"; text: string }
  | { type: "restoreTokens"; tokens: string[] }
  | { type: "registerTokens"; entries: [string, string][] }
  | { type: "bridgeReady" }
  | { type: "getConfig" }
  | { type: "setConfig"; config: Partial<Config> }
  | { type: "getStats" }
  | { type: "purge" };

export type Response =
  | { ok: true; text: string; count: number }
  | { ok: true; text: string }
  | { ok: true; map: Record<string, string> }
  | { ok: true; config: Config }
  | { ok: true; stats: Stats }
  | { ok: true }
  | { ok: false; error: string };