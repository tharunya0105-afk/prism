# Prism

**AI privacy layer** — redacts personal data before it reaches AI models, then restores it in the replies.

## Projects in this repo

| Path | What it is |
| --- | --- |
| [`prism-sdk/`](./prism-sdk) | The engine: zero-dependency TypeScript SDK. 9 built-in PII detectors (email, phone, Aadhaar, PAN, cards with Luhn, API keys, bearer tokens, URL secrets, IPv4), a session vault, and React bindings. 14 unit tests. |
| [`prism-extension/`](./prism-extension) | Chrome (Manifest V3) extension wrapping the SDK. Protects typing in AI chat apps, patches `WebSocket.prototype.send` in the page's main world for socket-based transports, restores values in rendered replies, session-only vault. Verified end-to-end in real Chrome against LMArena. |

> The blueprint-styled portfolio lives in its own repository: [`tharunya0105-afk/portfolio`](https://github.com/tharunya0105-afk/portfolio).

## Repository layout

```
├── prism-sdk/         # SDK (engine) — imports nothing, exports everything
└── prism-extension/   # Chrome extension (bundles the SDK via @prism-sdk alias)
```

The extension aliases `@prism-sdk` → `../prism-sdk/src/index.ts`, so the SDK is compiled straight into the extension bundle — no npm publishing needed for local use.

## Quick start

```bash
# SDK tests
cd prism-sdk && npm install && npm test

# Extension (build, then load dist/ unpacked in chrome://extensions)
cd prism-extension && npm install && npm run build

# Extension end-to-end suite (real Chrome via Puppeteer)
cd prism-extension && npm run e2e
```

See each subproject's README for full docs.
