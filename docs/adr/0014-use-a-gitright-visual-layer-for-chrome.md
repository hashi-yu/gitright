---
status: accepted
---

# Use a GitRight visual layer for chrome

GitRight renders its host-native chrome through its own visual layer instead of Apps SDK UI components and design tokens. The layer follows Apple Human Interface Guidelines-style restraint: system typography, a small accent palette, and layered surfaces with hairline separators instead of ruled borders and badges. Host context still drives theme and locale selection; where a host-provided value maps cleanly to a needed token, the layer derives from it, and every remaining value is a GitRight-defined token documented with the widget styles. The visual truth for acceptance is the reviewed reference capture set required by ADR-0011.

This supersedes ADR-0007 because the redesign approved on 2026-07-16 — the route-map graph treatment, the persistent commit sheet, the search-first header, and the status bar — could not reach the accepted visual quality within Apps SDK UI's component and token vocabulary. Styling that system's components against their own grain would recreate the two-design-system drift ADR-0007 tried to remove, this time with the ungoverned half in charge.

## Considered options

- Keeping Apps SDK UI components and restyling them with overrides was rejected because the approved layout and states do not correspond to the components' structure, so overrides would accumulate into an ad hoc third system that neither the host nor GitRight governs.
- Keeping the Apps SDK token values while replacing the components was rejected because the approved palette and type scale depart from those tokens themselves; tokens alone cannot produce the accepted appearance.

## Consequences

The `@openai/apps-sdk-ui` dependency is removed from the widget payload; reintroducing it or adopting another UI dependency requires a new decision. Bundle size, deterministic `dist`, empty CSP allowlists, and installed-offline behavior are re-verified after the swap. Accessibility, theme, localization, resizing, and the ADR-0011 visual acceptance gate apply unchanged. Additions or exceptions to the GitRight token set require a specification change rather than ad hoc CSS values.

Amendment 2026-08-03: the visual truth for acceptance now reads against ADR-0018's five reviewed reference captures and its visual-impact regeneration condition instead of ADR-0011; the product decision recorded here is unchanged.
