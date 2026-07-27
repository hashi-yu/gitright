# Approved public visual baseline

`reference/` contains the deterministic, product-only browser captures for the
exact sanitized candidate package inputs recorded in `manifest.json`. Public
maintainer `hashi-yu` approved all 40 captures on 2026-07-24; the dated review
record is [`attestation-2026-07-24.md`](attestation-2026-07-24.md).

The review covers product hierarchy, containment, typography, theme and locale
parity, and the loading, empty, unavailable, and error states. The capture
manifest normalizes the local browser cache path to `/Users/<user>`. Capture
generation fails on any browser network request, and the PNGs contain only the
GitRight product surface rather than host chrome or conversation content.
