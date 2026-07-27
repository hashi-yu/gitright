---
status: superseded by ADR-0015
---

# Use history-to-detail drill-down in the right pane

GitRight presents the searchable graph or text history as the primary right-pane surface. Selecting a commit replaces that surface with the selected commit's detail, including metadata, parents, changed files, and file diff. A host-native back action returns to the history and restores its current in-memory search, selection, and scroll position.

History, commit detail, and diff are not vertically stacked into one long page, and the supported experience does not depend on a permanent side-by-side split. This gives the narrow right pane one clear reading task at a time and preserves enough width for file paths and diff content.

## Considered options

- Keeping history and detail vertically stacked was rejected because selecting a commit creates a long document with competing scroll regions and moves the selected content away from the user's action.
- Requiring a permanent master-detail split was rejected because the supported 380 CSS pixel pane cannot give both surfaces a useful reading width.

## Consequences

Returning to history must restore the current in-memory reading position without adding scroll coordinates to persisted widget state. Keyboard focus moves to the detail heading after selection and returns to the originating commit row when the user goes back.
