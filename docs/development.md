# Development

## Prerequisites

Development and verification use:

- macOS;
- Node.js and npm for dependency installation and test orchestration;
- Bun 1.3.14 for reproducible builds; and
- Git 2.30.0 or later.

Node.js is a development tool, not a supported GitRight runtime. The installed
plugin runs on the user-provided supported Bun 1.x runtime.

## Set up

Install the locked dependencies:

```sh
npm ci
```

Build the widget and Bun server:

```sh
npm run build:dist
```

The generated files in `plugins/gitright/dist/` are part of the installable
plugin. Commit an updated payload when its source inputs change.

## Run checks

Run static checking and the complete public test suite:

```sh
npm run typecheck
npm test
```

For a faster browser-free loop:

```sh
npm run test:non-browser
```

The browser test requires a compatible local Chromium executable:

```sh
npm run test:browser
```

Additional proof commands are documented in
[Verification](./verification.md).

## Contribution shape

Keep changes focused and add tests at the observable boundary. Update the
README or focused guides whenever installation, compatibility, privacy,
security, contribution, or user-visible behavior changes. Follow
[Contributing](../CONTRIBUTING.md) for Issue-first contract changes and
submission-rights requirements.
