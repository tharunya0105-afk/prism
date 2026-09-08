# Publishing `@tharunya0105-afk/prism-sdk` — checklist

One-time setup, then a short ritual per release.

## One-time setup

1. **npm account** — create one at npmjs.com if you don't have it, and verify your email (publishing fails otherwise).
2. **Create an automation token** — npmjs.com → Avatar → Access Tokens → *Generate New Token* → **Classic**, type **Automation** (runs CI scripts without 2FA prompts).
3. **Add the token to GitHub** — repo Settings → Secrets and variables → Actions → New repository secret:
   - Name: `NPM_TOKEN`
   - Value: the token from step 2
4. **Verify the package name is yours** — publish once manually (below) or run `npm view @tharunya0105-afk/prism-sdk` (expect E404 = free).

## Per release

1. **Bump the version** — `npm version patch|minor|major` in `prism-sdk/` (updates package.json + creates a git tag).
2. **Dry-run first** — `npm publish --dry-run` and read the file list: only `dist/**`, `README.md` (root file copy is automatic for the *root* README only — for the SDK's own README see note), `LICENSE`, `package.json` should be in the tarball. **No** `src/`, `test/`, `node_modules/`.
3. **Publish**
   - CI (recommended): push the version bump to `main` — the release workflow publishes when the tag is pushed.
   - Manual: `cd prism-sdk && npm publish` (uses your local npm login; the `prepublishOnly` hook runs typecheck + tests + build automatically).
4. **Push tags** — `git push --follow-tags`.
5. **GitHub Release** — create one from the tag with release notes; the publish workflow does this automatically if `GITHUB_TOKEN` has release permissions configured.

## Package health notes

- `files: ["dist"]` keeps the tarball minimal; the ESM/CJS shims are inside `dist/`.
- `prepublishOnly` runs `typecheck → test → build`, so an unpublished broken build is impossible from a clean checkout.
- The `react` peer dependency is **optional** — core usage has zero dependencies. The `./react` entry point is only for React consumers.
- `publishConfig.access: "public"` is set — scoped packages default to restricted (paid) access otherwise.

## Current state (as of this commit)

- [x] Dual ESM + CJS build with declarations and source maps
- [x] `exports` map with `types` conditions for both entry points (`.` and `./react`)
- [x] Node smoke tests pass in both module systems (ESM + CJS, real tarball install)
- [x] TypeScript declarations resolve under `nodenext` (strict, skipLibCheck)
- [x] Tarball verified: 34 files, ~11.5 kB, only `dist/**` + README + LICENSE
- [x] `prepublishOnly` gate (typecheck → test → build)
- [x] Release workflow (`.github/workflows/release-sdk.yml`) publishing on `sdk-v*` tags
- [ ] npm account + `NPM_TOKEN` secret (yours to do — takes ~5 minutes)
- [ ] First publish
