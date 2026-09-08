/**
 * Vault — the memory that maps redaction placeholders back to the secrets they stand for.
 *
 * The core principle of Prism: the AI only ever sees opaque placeholders; the real
 * values live client-side in the vault, and are re-inserted (restored) only after
 * the model responds. Swap `MemoryVault` for any encrypted / remote vault that
 * implements the same interface.
 */

export interface Vault {
  /** Returns a unique placeholder for `secret` and remembers the mapping. */
  seal(secret: string): string;
  /** Returns the original secret for a placeholder, or undefined if unknown. */
  open(token: string): string | undefined;
  /** Number of entries currently held. */
  readonly size: number;
  /** Drop every mapping. */
  clear(): void;
}

/** Placeholder format — ASCII-safe so LLMs pass it through untouched. */
export const TOKEN_PATTERN = /\[\[PRISM_[a-z0-9]+\]\]/g;

/**
 * In-memory vault with FIFO eviction once `max` entries are exceeded.
 * Intentionally dependency-free; swap in your own encrypted vault for production.
 */
export class MemoryVault implements Vault {
  private map = new Map<string, string>();
  private seq = 0;

  constructor(private max = 5000) {}

  seal(secret: string): string {
    const token = `[[PRISM_${(++this.seq).toString(36)}]]`;
    this.map.set(token, secret);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    return token;
  }

  open(token: string): string | undefined {
    return this.map.get(token);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.seq = 0;
  }
}