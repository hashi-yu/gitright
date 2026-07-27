---
status: accepted
amended: 2026-07-17
---

# Use a persistent commit sheet under the history graph

GitRight keeps the history graph visible at all times and presents the selected commit's metadata and changed files in a persistent bottom sheet layered over the lower part of the pane. Selection starts at `HEAD` when history mounts, so the sheet is populated from the start and the layout never jumps. Selecting a row updates the sheet in place; selecting a changed file opens that file's diff in a dedicated layer covering the history-graph region while the sheet — detail and changed files — stays visible below it. The graph and the sheet are fixed-height, independently scrolling regions.

This supersedes ADR-0010. The drill-down traded continuous orientation for one reading task at a time; the sheet keeps both: arrow keys walk the topology while the detail follows, and search with full-topology visibility keeps the graph as the constant frame of reference. The layouts ADR-0010 rejected are not this layout. Vertically stacked history-plus-detail was rejected as one long document with competing scroll regions — the sheet is a fixed-height region with its own scrolling, not part of a longer page. A permanent side-by-side split was rejected because 380 CSS px cannot give two surfaces useful reading width — the sheet takes height rather than width, and the diff layer covers the graph region at full pane width, so file paths and diff content keep the full pane width.

## Considered options

- Keeping the history-detail drill-down was rejected because every inspection costs a navigation round trip, selection feedback is invisible until the transition completes, and the restored-position machinery exists only to undo the navigation the model itself imposed.
- A permanent side-by-side master-detail split remains rejected for the original width reason at the supported 380 CSS px minimum.

## Consequences

The host-native back action between history and detail disappears, along with its focus-restoration contract; there is no back action at all — the diff layer closes in place. The layer closes four ways: its close button, the Escape key, re-selecting the same changed-file entry as a toggle, and selecting another commit or parent, which closes it immediately. Keyboard focus stays in the history list while the sheet follows selection, so rapid selection movement must debounce detail requests. Selecting a commit at mount means a detail request happens without user action; the sheet must render bounded loading and error states without collapsing the layout.
## Amendment history

As accepted, selecting a changed file switched the entire sheet to that file's diff, with an explicit back action returning to detail and changed files. On 2026-07-17, during the approved visual iteration, the diff moved out of the sheet into a layer covering the history-graph region. Swapping the sheet's content re-created the drill-down's round trip in miniature: reading several files meant diff → back → next file, with the changed-file list disappearing each time. With the layer, the sheet stays visible while a diff is open, so the changed-file list remains the navigation surface and switching files is one click; the graph — not the detail — is what temporarily gives up its space, and the diff gains the graph region's height on top of the full pane width. The back action was replaced by the four close paths above, and the consequences were updated accordingly. The persistent-sheet decision itself and the supersession of ADR-0010 are unchanged.
