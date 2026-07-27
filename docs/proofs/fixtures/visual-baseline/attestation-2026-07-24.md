# Public visual baseline attestation

Date: 2026-07-24
Reviewer: hashi-yu (public maintainer)
Result: PASS

## Reviewed evidence

- Candidate SHA: `952ab5778a797300f169c20984dcc0706aa4da42`
- `plugins/gitright/dist/widget.js` SHA-256: `a9429a66d27ce2e3db8800155154f21aad31f343be9e08e3227c1251aa0d0d5d`
- Capture set: `docs/proofs/fixtures/visual-baseline/reference/` (40 PNG files)
- Manifest: `docs/proofs/fixtures/visual-baseline/reference/manifest.json`

## Attestation

The reviewer approved the launcher, history, search, and diff surfaces at 380
and 720 CSS px in light and dark themes with English and Japanese typography,
plus the loading, empty, unavailable, and error lifecycle states.

The reviewer confirmed that every capture is product-only and contains no host
chrome, personal environment detail, or private information.

This attestation is limited to the capture set and package identities above.
