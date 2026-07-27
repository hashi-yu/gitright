---
status: accepted
amended: 2026-07-11
---

# Pin the repository from trusted Codex repository context

## Decision

GitRight MVP supports only Git repository-linked Codex tasks for which the host supplies trusted repository context directly to the bundled app or MCP server. Exactly one absolute host-owned repository-context path is required. GitRight uses Git worktree discovery from that path and pins the containing repository for the lifetime of that task's bundled MCP server repository binding.

One supported task has one repository binding. The binding begins without a pin, discovers at most once, and reuses the pin for later calls. Widget mounts and remounts within that task consume the existing binding and cannot trigger repository discovery or switching. A separate task begins with a separate server binding and null pin; it never inherits another task's repository.

This lifetime is not the lifetime of an individual UI component mount. The decision does not assume a one-to-one relationship between a widget mount and a server process.

Zero, missing, or multiple context paths produce `Current task repository is unavailable` and no repository read. Projectless tasks and other tasks without trusted repository context, including repo-outside task directories, are unsupported and produce the same result without repository discovery.

GitRight accepts no repository path from the model, widget, tool input, environment fallback, MCP process cwd, or remembered state. It never scans for another repository or runs `git init`.

## Amendment history

The original decision required a trusted task working directory on repository and non-repository tasks, with a distinct `Git repository not found` result outside Git. The 2026-07-11 installed-plugin proof showed that current Desktop supplies a host-owned repository workspace path for repository-linked tasks but omits projectless cwd from MCP roots, initialization, call metadata, and launch context.

The user explicitly approved limiting MVP support to repository-linked tasks rather than weakening the trust boundary with a fallback. A later independent review clarified that the real proof establishes same-task/server reuse and cross-task/server isolation, so the formal pin lifetime is the task's bundled MCP server repository binding rather than a mounted view. Read-only, no-network, no-`git init`, and pin-once requirements are unchanged. The then-current zero-setup distribution requirement was later superseded by ADR-0005.
