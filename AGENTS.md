# GitRight Development Guide

GitRight is a Codex plugin (an MCP app) that shows read-only Git history for
the repository attached to a Codex task, rendered in the Codex right pane.

## Repository layout

- `plugins/gitright/launcher/` — handwritten POSIX launcher script.
- `plugins/gitright/contract/` — the shapes that cross the server↔widget seam,
  and the advertised schema, validation, and null restoration derived from them.
- `plugins/gitright/server/` — MCP server source (TypeScript, runs on Bun).
- `plugins/gitright/widget/` — widget source and its esbuild build script.
- `plugins/gitright/dist/` — installable payload; ignored on `main`, committed
  on release refs only.
- `test/` — the public test suite (`node --test`).
- `test-support/` — test orchestration helpers.
- `docs/` — architecture, compatibility, development, and verification guides.
- `docs/adr/` — architecture decision records; read these before changing a
  documented contract, and record new decisions here.
- `docs/proofs/fixtures/` — reproducible proof scripts and fixtures.

## Commands

```sh
npm ci                    # install locked dependencies
npm run typecheck         # tsc --noEmit
npm test                  # full suite (builds dist first)
npm run test:non-browser  # faster browser-free loop
npm run test:browser      # requires a local Chromium executable
npm run build:dist        # rebuild plugins/gitright/dist/
```

Node.js and npm are development tools only; the installed plugin runs on a
user-provided Bun runtime (`>=1.3.14 <2.0.0`), and release builds are pinned
to Bun 1.3.14. See `docs/development.md` and `docs/compatibility.md`.

## Binding product constraints

These are accepted decisions with ADRs; do not change them casually:

- GitRight is strictly read-only against Git. It never modifies the
  repository, its configuration, hooks, or credentials, and it does not
  override Git's ownership refusal (ADR-0002).
- The runtime makes no network requests after installation (ADR-0005).
- The complete experience targets a 380 CSS pixel minimum pane width
  (ADR-0001) and lives in the right pane, not inline (ADR-0012).
- Selecting or browsing a commit never sends repository content to the
  conversation; only an explicit handoff shares a commit SHA (ADR-0006,
  ADR-0008).

## Conventions

- Changes land through pull requests to `main`; the `Tests / non-browser` and
  `Tests / browser` checks are required.
- `main` stays free of build output; release refs (`beta`, tags) carry a
  freshly built `dist/`.
- Test fixtures use neutral identities such as `example`.
