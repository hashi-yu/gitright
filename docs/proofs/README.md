# Proof fixtures

`docs/proofs/fixtures/` contains reproducible inputs, scripts, and evidence for
the checks described in the verification guide. They live under `docs/`
because they support verification and release review; they are not part of the
installed GitRight runtime.

## Pull request CI

The required `.github/workflows/tests.yml` workflow runs for every pull request
and for pushes to `main`. Its non-browser test job exercises these fixtures
through the public test suite:

- `read-only-security/run-proof.sh` from
  `test/read-only-security.test.js`
- `git-compatibility/proof-cli.mjs` from
  `test/git-compatibility-proof.test.js`
- `bun-distribution/run-package-proof.sh` and
  `bun-distribution/check-dist.sh` from `test/distribution.test.js`
- `ten-lane-variant-e.json` from `test/history-graph.test.js`
- `repository-digest.mjs` from `test/repository-digest.test.js`

These checks keep their proof logic reusable while making regressions visible
in normal pull request CI.

## Manually dispatched release proofs

`.github/workflows/bun-distribution-proof.yml` and
`.github/workflows/git-compatibility-proof.yml` use only
`workflow_dispatch`. They are heavier release checks, not part of the normal
pull request workflow.

The Bun distribution proof exercises the packaged plugin on macOS 15 runners
across the supported architecture and Bun matrix. The Git compatibility proof
checks the current macOS system Git and builds the minimum supported Git
2.30.0 from source with `git-compatibility/build-minimum-git.sh`.

## Human-reviewed visual baseline

`visual-baseline/reference/` holds the PNG captures and their manifest. The
reference set is five captures covering every pairwise combination of pane
width, theme, and locale plus the most recently redesigned surface; the
manifest records their capture conditions without hash chains. The current
captures are an initial reference showing that the capture script works, and
they carry no attestation; an approved review record is added beside them when
the set is regenerated and reviewed for a release candidate. No automated test
or workflow compares these images. They are the reference for the release-time
visual review described in `docs/verification.md`, and a change that visibly
affects layout, color, typography, or interaction hierarchy requires
regeneration and human review before release.
