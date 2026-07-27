# Architecture

GitRight is a Codex plugin composed of a marketplace entry, a runtime preflight,
a Bun MCP server, and an Apps SDK widget.

## Installation and startup

The marketplace entry installs one architecture-neutral plugin package with a
prebuilt server bundle and widget assets. The handwritten launcher lives at
`plugins/gitright/launcher/launch` in source and is copied to
`plugins/gitright/dist/launch` for the installable package. It locates a
user-provided Bun runtime, verifies `>=1.3.14 <2.0.0`, and starts the bundled
server. Users do not install plugin dependencies or build the widget.

## Repository binding

The server accepts repository context supplied by the host for the current
repository-linked task. It discovers and pins one containing Git repository for
that task. Paths supplied through model-visible tool arguments do not select or
change the repository.

Repository history is loaded as a stable snapshot. It remains unchanged until
the user explicitly refreshes it.

## Read-only server

The MCP server exposes bounded operations for launch status, history pages,
repository state, commit details, and file diffs. Repository access uses
read-only Git plumbing with isolated configuration. GitRight does not run
repository hooks or external filters and does not write the worktree,
repository, configuration, credentials, or persistent app data.

The server sends structured app data to the widget. Model-visible launch output
is limited to a bounded opened, unavailable, or unsupported status and does not
include repository content.

## Right-pane widget

The launcher requests fullscreen once. The complete experience renders only
after the host grants the fullscreen surface; otherwise the launcher remains
available with a concise status.

The widget presents graph and text history views, search, explicit refresh,
commit metadata, changed files, and bounded unified diffs. The selected commit
sheet stays separate from the scrolling history. Widget state persists only the
view mode, search query, and selected SHA; history and diffs are reconstructed.

Browsing and selection remain inside GitRight. The user may explicitly hand the
selected full SHA to the Codex conversation; commit messages, diffs, and author
data are not included in that handoff.

## Network boundary

Marketplace setup and plugin installation may use the network. Once the Bun
prerequisite and GitRight plugin are installed, the GitRight runtime, including
first launch, makes no network request. Codex model transport is outside this
runtime boundary.
