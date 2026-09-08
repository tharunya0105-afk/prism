# Prism — AI Privacy Layer (Chrome Extension)

> Redacts personal data **before** it reaches AI chat apps, then restores it in
> the replies. The model never sees your secrets.

Built on the [prism-sdk](../prism-sdk) core. Zero runtime dependencies beyond
the SDK itself.

## How it works

```
 you type → content script intercepts Enter
         → text sent to background → prism.protect() → placeholders
         → placeholders sent to the AI app (what the model actually receives)
         → AI reply streams in → MutationObserver spots [[PRISM_…]]
         → background resolves from the vault → your data restored in the reply
```

- **Content script** intercepts Enter on chat inputs in supported apps
  (ChatGPT, Claude, Gemini, Copilot, Perplexity, Grok, Poe, HuggingFace,
  Mistral, You.com…), swaps in the protected text, then triggers the app's
  normal submit path so the app sends the placeholder text.
- **WebSocket bridge** (`ws-bridge.js`, main world) patches
  `WebSocket.prototype.send` in the page's own JavaScript context (injected
  via `chrome.scripting` with `world: "MAIN"`, which bypasses page CSP).
  Outbound frames containing PII are redacted synchronously before the app's
  socket ever sees them, and the placeholder → secret mapping is relayed into
  the background session vault. This catches transports that skip fetch/XHR
  entirely — and doubles as a safety net if a site's submit path evades the
  Enter/button interception. Text frames and binary frames (decoded as UTF-8)
  are covered; Blob frames are passed through untouched.
- **Background service worker** owns a single `Prism` instance. Secrets live
  only in a **session vault** backed by `chrome.storage.session` — memory-only,
  wiped when the browser closes, never written to disk.
- **Restoration** is a MutationObserver that replaces `[[PRISM_…]]`
  placeholders in the page as replies (and your echoed message) render.
- **Popup** shows a master switch, per-policy toggles, a session redaction
  counter with masked previews, and a vault-clear button.

## Install (unpacked)

1. `npm install`
2. `npm run build` → produces `dist/`
3. Open `chrome://extensions`
4. Enable **Developer mode** (top-right)
5. **Load unpacked** → select the `prism-extension/dist` folder

The toolbar badge shows how many secrets were redacted this session.

## Configuration

- **Master switch** (popup) — turns interception off entirely.
- **Policy chips** (popup) — which detectors are active (email, phone IN,
  Aadhaar, PAN, cards, API keys, bearer tokens, URL secrets, IPv4).
- **Supported sites** are hardcoded in `src/content.ts` (`AI_HOSTS`) — edit
  and rebuild to add or remove hosts.

## E2E verification (real Chrome, Puppeteer)

`npm run e2e` drives a real Chrome window with the unpacked extension and tests
against live sites. Results (Sep 2026):

| Site | Status | Notes |
| --- | --- | --- |
| local contenteditable harness | ✅ works | protect → send → restore, zero PII leaked |
| local WebSocket harness | ✅ works | `ws.send()` frame captured on the wire containing only `[[PRISM_ws…]]` tokens, no PII; echoed frame restored in the DOM |
| lmarena.ai / arena.ai | ✅ works | Enter interception swaps composer to `[[PRISM_…]]`, force-click on the disabled send button submits **tokenized** text — verified the outbound POST contains tokens and **no PII**; echoed message restored |
| huggingface.co/chat | ⚠️ untested anonymously | a welcome modal swallows keystrokes for anonymous visitors (no close button found); needs a logged-in session to verify |
| copilot.microsoft.com | ⚠️ untested anonymously | composer never renders without login in this environment |
| chatgpt.com | 🔒 login-gated | content script injects, composer exists, walled |
| claude.ai | 🔒 login-gated | content script injects, composer not found pre-login |
| gemini.google.com | 🔒 login-gated | content script injects, walled |

Verified on the wire: the request body sent to `arena.ai` contained the
`[[PRISM_1]]` / `[[PRISM_2]]` placeholders and **no** email or phone number.

## Development

```bash
npm run dev        # rebuild on change
npm run build      # typecheck + full build
npm run icons      # regenerate PNG icons (zero-dep script)
npm run e2e        # Puppeteer harness (needs a logged-in machine for gated sites)
```

## Notes & limitations

- Interception hooks the Enter key on supported hosts. If the app ignores
  synthetic events (many check `isTrusted`), the extension force-enables the
  send button and clicks it — verified working on LMArena, whose submit
  handler reads the DOM value (the tokenized text) rather than framework
  state.
- LMArena intermittently shows a consent gate ("Agree") that blocks anonymous
  submissions; the e2e suite dismisses it and retries. Not an extension
  issue, but expect that flow when testing manually.
- Contenteditable editors (ProseMirror-based, e.g. ChatGPT) are handled via
  `document.execCommand("insertText")`; behavior can vary as apps change.
- WebSocket coverage applies to `send()`; frames the page *receives* are not
  scanned (the DOM observer handles restoring tokens that come back rendered).
- `host_permissions: <all_urls>` is broad — acceptable for a local dev
  extension; tighten it before publishing.
- This is a client-side guardrail. Use TLS and proper auth on your transport
  too. Regex policies are heuristics — review `prism-sdk/src/policies.ts`.

## Project structure

```
prism-extension/
├── public/manifest.json      # MV3 manifest (copied to dist)
├── scripts/
│   ├── gen-icons.mjs         # dependency-free PNG icon generator
│   └── fix-dist.mjs          # popup → dist/popup relocation
├── src/
│   ├── background.ts         # service worker: Prism + session vault + stats
│   ├── content.ts            # Enter interception + token restoration
│   ├── ws-bridge.ts          # main-world WebSocket.prototype.send patch
│   ├── types.ts              # message protocol
│   └── popup/                # React popup UI
└── dist/                     # load this folder in Chrome
```