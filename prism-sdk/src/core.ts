import { MemoryVault, TOKEN_PATTERN, type Vault } from "./vault";
import { defaultPolicies, maskGeneric, type Policy } from "./policies";

export interface PrismConfig {
  /** Detection policies. Defaults to the built-in set. */
  policies?: Policy[];
  /** Vault to store placeholder → secret mappings. Defaults to in-memory. */
  vault?: Vault;
  /** Max vault entries when using the default in-memory vault. */
  maxVault?: number;
}

export interface Match {
  /** Policy id, e.g. "email". */
  policy: string;
  /** Human label, e.g. "Email address". */
  label: string;
  /** Placeholder the AI sees instead of the secret. */
  token: string;
  /** Masked display string (safe for UIs). */
  display: string;
  /** The original secret. Client-side only. */
  value: string;
  /** Character offsets in the original input. */
  start: number;
  end: number;
}

export interface ProtectResult {
  /** Input with every secret replaced by a placeholder. */
  text: string;
  /** One entry per redacted secret. */
  report: Match[];
  count: number;
}

export interface SendOptions {
  /** Restore placeholders in the model response. Defaults to true. */
  restore?: boolean;
}

export interface SendResult {
  /** The protected prompt that actually went to the model. */
  protected: string;
  /** Model response with placeholders restored (unless restore: false). */
  response: string;
  /** The raw model response (placeholders intact). */
  rawResponse: string;
  report: Match[];
}

export type Transport = (protectedText: string) => Promise<string> | string;

/**
 * Prism — the privacy layer between your data and any AI.
 *
 * ```ts
 * const prism = new Prism();
 * const { text, report } = prism.protect("call priya@example.com");
 * // text: "call [[PRISM_1]]"
 * prism.restore(text); // "call priya@example.com"
 * ```
 */
export class Prism {
  private vault: Vault;
  private policies: Policy[];

  constructor(config: PrismConfig = {}) {
    this.policies = config.policies ?? defaultPolicies;
    this.vault = config.vault ?? new MemoryVault(config.maxVault ?? 5000);
  }

  /** All active policies (copy, so callers can't mutate the engine). */
  get activePolicies(): Policy[] {
    return [...this.policies];
  }

  /** Number of secrets currently held in the vault. */
  get vaultSize(): number {
    return this.vault.size;
  }

  /** Drop every placeholder mapping. Restore() after this returns placeholders unchanged. */
  purge(): void {
    this.vault.clear();
  }

  /** Replace every detected secret with a placeholder. */
  protect(input: string): ProtectResult {
    const found: Omit<Match, "token">[] = [];
    for (const p of this.policies) {
      p.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.pattern.exec(input)) !== null) {
        const value = m[0];
        if (value.length === 0) {
          p.pattern.lastIndex += 1;
          continue;
        }
        if (p.test && !p.test(value, input, m.index)) {
          p.pattern.lastIndex = m.index + 1;
          continue;
        }
        found.push({
          policy: p.id,
          label: p.label,
          start: m.index,
          end: m.index + value.length,
          value,
          display: p.mask ? p.mask(value) : maskGeneric(value),
        });
      }
    }

    // deterministic order: earliest first, longest wins ties
    found.sort((a, b) => a.start - b.start || b.end - a.end);

    // drop overlapping matches (earliest occurrence wins)
    const kept: Omit<Match, "token">[] = [];
    for (const m of found) {
      const prev = kept[kept.length - 1];
      if (prev && m.start < prev.end) continue;
      kept.push(m);
    }

    const matches: Match[] = kept.map((m) => ({ ...m, token: this.vault.seal(m.value) }));
    let out = input;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      out = out.slice(0, m.start) + m.token + out.slice(m.end);
    }

    return { text: out, report: matches, count: matches.length };
  }

  /** Replace every known placeholder with its original secret. */
  restore(text: string): string {
    return text.replace(TOKEN_PATTERN, (tok) => this.vault.open(tok) ?? tok);
  }

  /**
   * Full pipeline: protect → send to the model → restore the response.
   * The model only ever sees placeholders.
   */
  async send(input: string, transport: Transport, options: SendOptions = {}): Promise<SendResult> {
    const { text, report } = this.protect(input);
    const rawResponse = await transport(text);
    const response =
      options.restore === false ? rawResponse : this.restore(rawResponse);
    return { protected: text, response, rawResponse, report };
  }
}