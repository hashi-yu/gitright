---
status: superseded by ADR-0014
---

# Use Apps SDK UI for standard app chrome

GitRight uses Apps SDK UI components and design tokens for its host-native chrome, including the inline launcher, headers, buttons, search, switches, badges, panels, notices, and loading, empty, unavailable, and error states. Custom rendering is limited to Git-specific visualizations such as the topology graph, lane tracks, and diff content; those visualizations still inherit the system typography and surfaces and must satisfy the same accessibility, resizing, and responsive requirements. This replaces the existing bespoke green visual theme because visual resemblance implemented through independent hard-coded CSS would continue to drift from the host design system.

## Considered options

- Keeping the existing component structure and only approximating system colors and spacing was rejected because it would preserve a second, ungoverned design system and would not establish a reliable visual baseline.
- Forcing generic Apps SDK UI components to render the topology graph and diff content was rejected because those are domain-specific data visualizations without equivalent standard components.

## Consequences

The Apps SDK UI dependency and its assets must be folded into the prebuilt plugin payload so installed-offline operation remains unchanged. Exceptions for custom chrome require an explicit specification change rather than an ad hoc CSS override.
