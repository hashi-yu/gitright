---
status: accepted
---

# Derive the surface from the host and use a wordmark launcher

GitRight's surface color is derived from the host: the light and dark
`--gr-surface` tokens resolve to the host-published surface background when the
host provides one, falling back to GitRight-defined values when it does not.
The inline launcher card, the pane entrance card, and the right-pane background
all read this one token, so GitRight sits on the host's own surface color in
both themes and follows the host through runtime theme changes. This stays
within the ADR-0014 rule that the visual layer derives a token from a
host-provided value where one maps cleanly; the host publishes exactly one
color, its surface background, and that is the value this decision consumes.

The same revision replaces the inline launcher's decorative commit graph with a
large `GitRight` wordmark on a centered sheet card, and replaces the wordmark
flight with a card choreography: activation slides the card out through the
frame's right edge, and the pane answers with a card of the same proportions
sliding in from its left edge, opening to the pane's bounds while the wordmark
shrinks onto the header's own. Waiting motion is a small drift of `Right` that
hover freezes in place. The event-driven activation contract (`animationend`,
never a timer), the hand-off marker gating, the `animationcancel` abandonment,
and the reduced-motion immediate path are unchanged. Widths below the header
wordmark's 480 CSS pixel visibility floor keep the card's own mark and let it
fade instead of landing; the supported 380 pixel minimum therefore plays the
entrance without the landing swap, which is accepted behavior.

## Considered options

- Matching the host composer's input-field color with hardcoded per-theme
  values was rejected because the host does not expose that color to the
  widget; measured constants would drift silently whenever the host repaints,
  and the host's published surface background is the only color it shares.
- Keeping GitRight's own fixed surface values was rejected because the pane
  and the inline card then sit on visibly foreign color against the host in
  both themes, which the launcher-to-pane card choreography makes more
  prominent than the previous chrome did.

## Consequences

New mark and geometry tokens (`--gr-mark-*`, `--gr-inline-inset`, the entrance
geometry set) are GitRight-defined tokens documented with the widget styles
under ADR-0014. Hosts that publish a surface color identical to the commit
sheet's fixed color reduce the sheet's lift to its hairline and shadow; this is
accepted. The ADR-0011 visual baseline must be regenerated and re-attested
before the next release, since these are package-input changes that repaint
every capture.

Amendment 2026-08-03: that regeneration duty now reads against ADR-0018's five
reviewed reference captures and its visual-impact condition instead of
ADR-0011; the product decision recorded here is unchanged.
