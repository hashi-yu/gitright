---
status: accepted
---

# Require a visual acceptance gate

GitRight's visual redesign is not complete until its accepted appearance is reviewed from reference screenshots and in the real Codex right pane. The evidence set covers the inline launcher, history, commit detail, diff, and loading, empty, unavailable, and error states at the supported 380 CSS pixel minimum and a representative wider pane. It also covers light and dark themes and English and Japanese chrome.

The gate combines three kinds of evidence: an audit that standard chrome uses the accepted visual system — Apps SDK UI components and tokens originally, the GitRight visual layer since ADR-0014 — deterministic visual captures for regression review, and human inspection of the installed widget in Codex Desktop. DOM tests, accessibility automation, and image diffs remain necessary supporting checks but do not independently establish visual quality.

## Considered options

- Accepting the redesign from component and DOM tests alone was rejected because those checks cannot show whether hierarchy, density, spacing, or host integration feels native.
- Accepting browser-fixture screenshots without an installed Codex observation was rejected because the actual host controls pane geometry, theme context, safe areas, and surrounding chrome.

## Consequences

The first conforming visual pass establishes reviewed reference captures. Later changes compare against those references and still require human review when they materially alter layout, typography, color, or interaction hierarchy.
