/**
 * Detection policies. Each policy knows how to find a kind of sensitive data
 * and how to build a masked display string for UI. Order in the array matters:
 * earlier policies win when matches overlap.
 */

export interface Policy {
  /** Stable machine id, e.g. "email". */
  id: string;
  /** Human label, e.g. "Email address". */
  label: string;
  /** Global regex with /g flag. */
  pattern: RegExp;
  /** Optional extra validation beyond the regex (e.g. Luhn for card numbers). */
  test?: (value: string, input?: string, index?: number) => boolean;
  /** Builds the masked display shown in reports / UIs. */
  mask?: (value: string) => string;
}

/* ---------- mask helpers ---------- */

function maskEmail(value: string): string {
  return value.replace(/^(.{1,2})[^@]*@/, "$1•••@");
}

/** Keep the last `keep` digits of the value, mask every other digit in place. */
function maskLastDigits(value: string, keep: number): string {
  const digits = value.replace(/\D/g, "");
  let i = 0;
  return value.replace(/\d/g, () => {
    const at = i;
    i += 1;
    return at >= digits.length - keep ? digits[at] : "•";
  });
}

/** Luhn checksum — gates the credit-card policy so random long numbers aren't flagged. */
function luhn(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "").split("").reverse().map(Number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  digits.forEach((d, i) => {
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  });
  return sum % 10 === 0;
}

/**
 * Card validation: Luhn + the match must cover the ENTIRE contiguous digit group.
 * Without the second check, a truncated slice of a longer number (e.g. 15 of 16
 * digits) can pass Luhn and leak the rest as plain text.
 */
function cardTest(value: string, input?: string, index?: number): boolean {
  if (!luhn(value)) return false;
  if (input === undefined || index === undefined) return true;
  let left = index - 1;
  while (left >= 0 && /[\d\s-]/.test(input[left])) left -= 1;
  let right = index + value.length;
  while (right < input.length && /[\d\s-]/.test(input[right])) right += 1;
  const groupDigits = (input.slice(left + 1, right).match(/\d/g) ?? []).length;
  const matchDigits = (value.match(/\d/g) ?? []).length;
  return groupDigits === matchDigits;
}

const maskAadhaar = (v: string) => v.replace(/\d/g, (d, i, s) => (i >= s.length - 4 ? d : "X"));
const maskPan = (v: string) => (v.length >= 4 ? v.slice(0, 2) + "••••••" + v.slice(-2) : "••••••");
const maskCard = (v: string) => maskLastDigits(v, 4);
const maskPhone = (v: string) => maskLastDigits(v, 4);
const maskApiKey = (v: string) => (v.length > 8 ? v.slice(0, 4) + "••••••" + v.slice(-4) : "••••••");
const maskBearer = (v: string) => v.replace(/Bearer\s+\S+/i, "Bearer ••••••");
const maskUrlSecret = (v: string) => v.replace(/=.*$/, "=••••••");
const maskIp = (v: string) => v.replace(/\d{1,3}(?=\.)/g, "•••");

/* ---------- built-in policies ---------- */

export const defaultPolicies: Policy[] = [
  {
    id: "email",
    label: "Email address",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    mask: maskEmail,
  },
  {
    id: "phone_in",
    label: "Phone number (IN)",
    pattern: /(?<![\d.])(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\s-]*\d)/g,
    mask: maskPhone,
  },
  {
    id: "aadhaar",
    label: "Aadhaar number",
    pattern: /(?<![\d.])\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?![\s-]*\d)/g,
    mask: maskAadhaar,
  },
  {
    id: "pan",
    label: "PAN (India)",
    pattern: /(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])/g,
    mask: maskPan,
  },
  {
    id: "card",
    label: "Payment card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    test: cardTest,
    mask: maskCard,
  },
  {
    id: "api_key",
    label: "API key / token",
    pattern: /\b(?:sk|pk|rk|ghp|gho|AKIA|ASIA|EAAC|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/g,
    mask: maskApiKey,
  },
  {
    id: "bearer",
    label: "Bearer token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    mask: maskBearer,
  },
  {
    id: "url_secret",
    label: "Secret in URL / query",
    pattern: /\b(?:api[_-]?key|apikey|token|secret|password|passwd|auth|key)=[^&\s"'<>]+/gi,
    mask: maskUrlSecret,
  },
  {
    id: "ipv4",
    label: "IP address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    mask: maskIp,
  },
];

/** Mask fallback when a policy provides none. */
export function maskGeneric(value: string): string {
  if (value.length <= 4) return "••••";
  return value.slice(0, 2) + "••••" + value.slice(-2);
}