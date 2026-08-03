# Public visual baseline

`reference/` holds the five product-only captures that the release-time visual
review looks at, together with `manifest.json` recording the conditions they
were taken under. The set covers every pairwise combination of pane width,
theme, and locale plus the launcher: history at 380 CSS px in dark and
Japanese, diff at 380 CSS px in light and English, search at 720 CSS px in
light and Japanese, the unavailable state at 720 CSS px in dark and English,
and the launcher with its hint visible at 380 CSS px in dark. Remaining
lifecycle states and combinations stay covered by the automated browser tests.

The current set is a reference produced by the capture script. It carries no
attestation: an approved review record is added beside this file when a release
candidate is reviewed.

No automated test or workflow compares these images. Regenerate them and have
them reviewed when a change visibly affects layout, color, typography, or
interaction hierarchy.

## Regenerating

```sh
npm run build:dist
node docs/proofs/fixtures/visual-baseline/capture-reference-set.mjs
```

The script needs a local Chrome or Chromium; set `GITRIGHT_CHROMIUM_PATH` to
its executable if it is not in `/Applications`. It replaces the whole set in
`reference/`, and it fails if the browser reaches the network.

The captures are taken against a fixture repository at the fixed neutral path
`/private/tmp/gitright-visual-fixture`, so no personal path appears in the
status bar, at device scale factor 1 with reduced motion, a pinned UTC snapshot
time, and no host-published surface color — the widget paints against its own
fallbacks, light `#f2f3f7` and dark `#1c1c1e`. The PNGs contain only the
GitRight product surface, not host chrome or conversation content.
