---
status: accepted
---

# Persist only minimal widget state

GitRight persists only the graph-or-text view mode, search query, and selected commit SHA through the host widget-state facility. The persisted object has a small, versioned schema. On restoration, GitRight validates the object before use and restores the selected SHA only if that commit exists in the current history snapshot.

Repository history, diffs, commit messages, paths, selected parent or file drill-down, and scroll position are not persisted. They are reconstructed from the pinned repository and current history snapshot so widget remounts cannot revive stale repository payloads or brittle presentation coordinates.

## Considered options

- Persisting the complete UI and repository payload was rejected because it duplicates source data, increases privacy exposure, and can disagree with the current snapshot.
- Persisting no state was rejected because remounting would unnecessarily discard the user's basic view, search, and selection context.

## Consequences

Changes to the persisted shape require an explicit schema-version migration or a safe fallback to defaults. Invalid state and selections absent from the current snapshot are discarded without preventing the widget from opening.
