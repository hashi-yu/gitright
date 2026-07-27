---
status: accepted
---

# Do not claim VoiceOver support in beta

GitRight beta explicitly does not support or guarantee VoiceOver compatibility,
and installed VoiceOver review is not a release gate. This boundary was
accepted by the product owner on 2026-07-15 after installed MVP review.

The existing semantic HTML, accessible control names, status and alert regions,
keyboard path, Graph/Text topology alternative, and non-color meaning remain
required. They improve interoperability but do not constitute a VoiceOver
compatibility claim. VoiceOver behavior may work incidentally and remains
non-contractual until a later decision adds a defined support target and real
installed validation matrix.

## Considered options

- Keeping VoiceOver as a required beta gate was rejected because the product
  owner chose to prioritize the installed visual and functional MVP without a
  screen-reader compatibility commitment.
- Removing semantic and keyboard accessibility work was rejected because those
  are independent product requirements and useful compatibility foundations.

## Consequences

Release notes, issues, and proof records must say `NOT-SUPPORTED` rather than
`PASS` or silently omitting VoiceOver. A future support claim requires an
explicit specification change and renewed installed-device validation.
