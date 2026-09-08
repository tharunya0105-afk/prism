# Prism SDK — AI Privacy Layer

> Protect sensitive data **before** it touches any AI. Redact, vault, and restore.

Prism sits between your data and any LLM/API. It detects sensitive values
(emails, phone numbers, Aadhaar, PAN, payment cards, API keys…), swaps them
for opaque placeholders before the request leaves your side, and restores the
real values in the response afterward. **The model never sees a secret.**

Zero dependencies. ~2 KB of source. Framework-agnostic core + optional React
bindings.

## Why

Every prompt you send to an AI — support bot, code assistant, document
summarizer — is data you don't control anymore. Prism gives you a
policy-driven layer where *what the model sees is what you allow*, and
everything else travels as unreadable placeholders.

## Install

```bash
npm install prism-sdk
```

React bindings are optional (`react >= 18`).

## Quick start

```ts
import { Prism } from "prism-sdk";

const prism = new Prism(); // built-in policies: email, phone, Aadhaar, PAN, cards, API keys…

// 1. Protect — secrets become placeholders
const { text, report } = prism.protect(
  "Reach Priya at priya.sharma@example.com or +91 98765 43210."
);
// text:   "Reach Priya at [[PRISM_1]] or [[PRISM_2]]."
// report: [{ policy: "email", value: "priya.sharma@example.com", display: "pr•••@example.com", … }]

// 2. Send the PROTECTED text to your AI
const reply = await prism.send(
  "Email priya.sharma@example.com the invoice",
  async (protectedPrompt) => callMyAI(protectedPrompt)
);
// reply.protected: prompt the model actually saw (placeholders only)
// reply.response:  model reply with secrets restored

// 3. Or restore manually
prism.restore(text); // back to the original string
```

## API

### `new Prism(config?)`

| option      | default           | description                                             |
| ----------- | ----------------- | ------------------------------------------------------- |
| `policies`  | built-in set      | custom `Policy[]` — replaces the defaults entirely      |
| `vault`     | in-memory `MemoryVault` | any object implementing `{ seal, open, size, clear }` |
| `maxVault`  | `5000`            | FIFO eviction cap for the default vault                 |

### `prism.protect(input) → { text, report, count }`

Returns the input with every secret replaced by a `[[PRISM_…]]` placeholder,
plus a report: policy id/label, the secret (`value` — client-side only), a
masked `display` string safe for UIs, and offsets.

### `prism.restore(text) → string`

Replaces known placeholders with their originals. Unknown placeholders pass
through untouched.

### `prism.send(input, transport, opts?) → Promise<SendResult>`

Runs protect → `transport(protectedText)` → restore on the response.
`opts.restore === false` skips restoring the response.

### `prism.purge()`, `prism.vaultSize`

Drop all placeholder mappings / inspect vault size.

## Built-in policies

| id           | detects                          |
| ------------ | -------------------------------- |
| `email`      | email addresses                  |
| `phone_in`   | Indian phone numbers (`+91 …`)   |
| `aadhaar`    | 12-digit Aadhaar numbers         |
| `pan`        | Indian PAN (`ABCDE1234F`)        |
| `card`       | payment card numbers (Luhn-verified, full-run aware) |
| `api_key`    | `sk-…`, `ghp_…`, `AKIA…` tokens |
| `bearer`     | `Bearer <token>`                 |
| `url_secret` | `?token=…&key=…&password=…`      |
| `ipv4`       | IPv4 addresses                   |

## Custom policies

```ts
import { Prism, type Policy } from "prism-sdk";

const projectCodes: Policy = {
  id: "project_codes",
  label: "Project code",
  pattern: /\bPRJ-\d{4}\b/g,
  mask: () => "PRJ-••••",
};

const prism = new Prism({ policies: [projectCodes] });
```

`Policy.test(value, input, index)` adds extra validation beyond the regex —
e.g. a checksum — and can inspect surrounding text to avoid partial matches.

## Vaults

The default `MemoryVault` is deliberately simple. For production, implement
the `Vault` interface with your own encrypted storage so restores survive page
reloads:

```ts
import type { Vault } from "prism-sdk";

const encryptedVault: Vault = {
  seal: (secret) => /* encrypt, store, return token */,
  open: (token) => /* decrypt, return secret */,
  size: 0,
  clear: () => {},
};
```

## React

```tsx
import { PrismProvider, usePrism, PrismTextArea } from "prism-sdk/react";

function App() {
  return (
    <PrismProvider>
      <Composer />
    </PrismProvider>
  );
}

function Composer() {
  const { send, protect, reportOf } = usePrism();
  // protect(text), restore(text), send(text, transport, opts), reportOf(text)
}
```

`<PrismTextArea>` renders a textarea with a live "what the model would see"
preview.

## Security notes

- Prism is a **client-side guardrail**, not a substitute for end-to-end
  transport security — keep using TLS and proper auth.
- The default vault is in-memory; secrets are not persisted anywhere unless
  you implement a vault that does.
- Regex policies are heuristics. Review the active policy set for your
  domain, and add `test` hooks where precision matters (see `card`).

## License

MIT