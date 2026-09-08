import { describe, expect, it } from "vitest";
import { Prism } from "../src/index";
import type { Policy } from "../src/policies";

const SAMPLE = [
  "priya.sharma@example.com",
  "+91 98765 43210",
  "2345 6789 0123",
  "ABCDE1234F",
  "4111 1111 1111 1111",
  "sk-abcdefghijklmnopqrstuvwxyz123456",
].join(" · ");

function tokensIn(text: string): string[] {
  return text.match(/\[\[PRISM_[a-z0-9]+\]\]/g) ?? [];
}

describe("Prism.protect", () => {
  it("replaces every known secret with a placeholder", () => {
    const prism = new Prism();
    const { text, count } = prism.protect(SAMPLE);
    expect(count).toBe(6);
    expect(text).not.toContain("@");
    expect(text).not.toContain("98765");
    expect(tokensIn(text)).toHaveLength(6);
  });

  it("returns a report with policy ids and masked displays", () => {
    const prism = new Prism();
    const { report } = prism.protect(SAMPLE);
    const byId = Object.fromEntries(report.map((m) => [m.policy, m]));
    expect(byId.email.display).toBe("pr•••@example.com");
    expect(byId.card.display).toBe("•••• •••• •••• 1111");
    expect(byId.aadhaar.display).toContain("XXXX XXXX");
    expect(byId.pan.value).toBe("ABCDE1234F");
  });

  it("gives each occurrence its own token", () => {
    const prism = new Prism();
    const { text } = prism.protect("a@x.com and b@x.com");
    const tokens = tokensIn(text);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(2);
  });

  it("does not flag numbers that fail the Luhn check", () => {
    const prism = new Prism();
    const { text } = prism.protect("4111 1111 1111 1112"); // invalid checksum
    expect(text).toContain("4111 1111 1111 1112");
    expect(tokensIn(text)).toHaveLength(0);
  });

  it("keeps the earliest match when policies overlap", () => {
    const prism = new Prism();
    // a Bearer token also matches the api_key-ish pattern — bearer wins (earlier in list)
    const { report } = prism.protect("Authorization: Bearer abcdefghijklmnopqrst");
    expect(report[0].policy).toBe("bearer");
  });
});

describe("Prism.restore", () => {
  it("round-trips protected text back to the original", () => {
    const prism = new Prism();
    const { text } = prism.protect(SAMPLE);
    expect(prism.restore(text)).toBe(SAMPLE);
  });

  it("leaves unknown placeholders untouched", () => {
    const prism = new Prism();
    expect(prism.restore("no secrets here [[PRISM_zzz]]")).toBe("no secrets here [[PRISM_zzz]]");
  });

  it("restores multiple occurrences in any order", () => {
    const prism = new Prism();
    const { text } = prism.protect("email a@x.com, phone +91 98765 43210, email again b@x.com");
    const shuffled = tokensIn(text).reverse().join(" and ");
    const restored = prism.restore(shuffled);
    expect(restored).toContain("a@x.com");
    expect(restored).toContain("+91 98765 43210");
  });
});

describe("Prism.send", () => {
  it("protects the prompt, then restores the response", async () => {
    const prism = new Prism();
    const transport = async (protectedText: string) =>
      `Understood. I'll write to ${tokensIn(protectedText)[0]} today.`;
    const result = await prism.send("contact priya@example.com please", transport);
    expect(result.protected).not.toContain("priya@example.com");
    expect(result.response).toContain("priya@example.com");
    expect(result.rawResponse).toContain("[[PRISM_");
  });

  it("can skip restoring with restore:false", async () => {
    const prism = new Prism();
    const result = await prism.send("email a@x.com", async (p) => `got ${p}`, { restore: false });
    expect(result.response).toContain("[[PRISM_");
  });

  it("works with synchronous transports", async () => {
    const prism = new Prism();
    const result = await prism.send("call +91 98765 43210", (p) => `dialing ${p}`);
    expect(result.response).toContain("98765");
  });
});

describe("custom policies", () => {
  it("honors user-supplied policies only", () => {
    const custom: Policy = {
      id: "project_codes",
      label: "Project code",
      pattern: /\bPRJ-\d{4}\b/g,
      mask: () => "PRJ-••••",
    };
    const prism = new Prism({ policies: [custom] });
    const { text, report } = prism.protect("ship PRJ-2042 today, call +91 98765 43210");
    expect(text).toContain("[[PRISM_");
    expect(report[0].policy).toBe("project_codes");
    expect(report[0].display).toBe("PRJ-••••");
    // default email policy is NOT active
    expect(text).toContain("+91 98765 43210");
  });

  it("runs an extra validation hook from custom policies", () => {
    const onlyShort: Policy = {
      id: "short_tokens",
      label: "Short token",
      pattern: /\b[a-z]{3,6}\b/g,
      test: (v) => v.length <= 4,
    };
    const prism = new Prism({ policies: [onlyShort] });
    const { text } = prism.protect("cat elephant dog");
    expect(text).toContain("elephant");
    expect(tokensIn(text)).toHaveLength(2);
  });
});

describe("vault", () => {
  it("purges all mappings", () => {
    const prism = new Prism();
    const { text } = prism.protect("a@x.com");
    prism.purge();
    expect(prism.vaultSize).toBe(0);
    expect(prism.restore(text)).toBe(text); // placeholders stay put
  });
});