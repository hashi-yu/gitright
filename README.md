# GitRight

GitRight is a read-only Git history viewer for Codex. It opens the repository
attached to the current task in a right-pane view with searchable graph and text
history, commit details, changed files, and bounded file diffs.

GitRight is beta software. Interfaces and installation details may change
between beta releases.

## Requirements

- macOS on Apple silicon (`arm64`) or Intel (`x86_64`)
- Codex with plugin and fullscreen MCP Apps support
- Git 2.30.0 or later
- A user-provided Bun runtime in the range `>=1.3.14 <2.0.0`

GitRight does not bundle, download, install, or update Bun. Install a supported
Bun 1.x release using the [official Bun installation
instructions](https://bun.sh/docs/installation) before starting GitRight.

See [Compatibility](./docs/compatibility.md) for the complete beta support
boundary.

## Install

Add the GitRight beta marketplace and install the plugin:

```sh
codex plugin marketplace add hashi-yu/gitright --ref beta --json
codex plugin add gitright@gitright-beta --json
```

Open a Codex task that is attached to one Git repository, then ask Codex to
open GitRight or select the GitRight plugin. GitRight requests the right pane
and loads the available history for that task repository.

The marketplace operation and plugin installation may use the network. After
the prerequisite and installation are complete, the GitRight runtime, including
its first launch, makes no network requests.

## Upgrade

If the `gitright-beta` marketplace is already registered, refresh its Git
snapshot first, then install the plugin again:

```sh
codex plugin marketplace upgrade gitright-beta --json
codex plugin add gitright@gitright-beta --json
```

Without the upgrade step, `codex plugin add` reinstalls the previously fetched
snapshot instead of the latest beta release. Like installation, the upgrade may
use the network.

## Privacy and safety

GitRight uses read-only Git operations. It does not modify the repository,
working tree, Git configuration, hooks, or credentials. Repository content is
kept inside the app surface. Selecting or browsing a commit does not send it to
the conversation; an explicit handoff shares only the selected full commit SHA.

The Codex model transport is outside GitRight's runtime network boundary and
may remain online.

## Beta support

Reproducible bug reports and feature proposals are welcome through GitHub
Issues. Support is best effort: there is no response, resolution, merge, or
roadmap deadline. GitHub Discussions, direct support, and email support are not
offered for the beta.

Do not report security concerns or conduct incidents in a public Issue. Follow
the [Security Policy](./SECURITY.md) and
[Code of Conduct](./CODE_OF_CONDUCT.md) instead. Contributors should read
[Contributing](./CONTRIBUTING.md).

## Documentation

- [Architecture](./docs/architecture.md)
- [Architecture decision records](./docs/adr/)
- [Compatibility](./docs/compatibility.md)
- [Development](./docs/development.md)
- [Verification](./docs/verification.md)

## License

GitRight is available under the [MIT License](./LICENSE).

GitRight is not affiliated with or endorsed by the Git Project or Software Freedom Conservancy.
