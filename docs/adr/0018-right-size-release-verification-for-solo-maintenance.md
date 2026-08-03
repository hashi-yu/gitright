---
status: accepted
---

# Right-size release verification for solo maintenance

GitRight's release verification is scaled to its actual governance: a single
maintainer reviewing a small beta. The visual acceptance gate shrinks from the
forty-capture matrix to five reviewed reference captures, and the attestation
becomes a short human note recording the review date, the candidate commit,
the reviewed captures, and the result. The machine-checkable chains around the
baseline — per-capture sha256 pinning, typography fingerprints, and pinned-
baseline verification — are removed. Regeneration and re-review are required
when a change visibly affects layout, color, typography, or interaction
hierarchy, not for every package-input change.

The five captures cover every pairwise combination of pane width, theme, and
locale, plus the most recently redesigned surface: history at 380 px dark
Japanese, diff at 380 px light English, search at 720 px light Japanese, the
unavailable state at 720 px dark English, and the launcher with its hint
visible at 380 px dark. Remaining lifecycle states and combinations stay
covered by the automated browser tests.

This supersedes ADR-0011. Automated proofs that protect user-facing
contracts — read-only operation, runtime network denial, and package
isolation — keep their substance. Their mandatory cadence is right-sized:
the double-rebuild dist proof and the Git minimum-version source proof must
run for release candidates and for changes to the layers they verify. A
routine test suite that happens to exercise them more often is acceptable
and is not part of this gate. Human review concentrates on a few
representative captures; automation concentrates on invariants that can
break users.

## Considered options

- Keeping the forty-capture matrix was rejected because no automated test
  compares the images; they exist only for release-time human review, and
  forty captures exceed what a single maintainer can meaningfully review for
  each release.
- Replacing human review entirely with browser tests was rejected because
  hierarchy, density, and theme fit still need a human eye on representative
  surfaces.
- Keeping the sha256 and fingerprint chain was rejected because the Git
  history already binds the reviewed images and their note to a commit; the
  chain re-proved byte identity without adding review value.

## Consequences

The reference set shrinks to five captures. The manifest records capture
conditions — including the host-surface fallback colors light `#f2f3f7` and
dark `#1c1c1e`, since captures are taken without a host-published surface
color — without hash chains, and captures are generated at a neutral fixture
path so no environment-specific path appears in the images. An attestation is
a few lines: date, candidate commit, the five captures, result. The
regeneration duty that ADR-0014 and ADR-0017 reference through ADR-0011 now
reads against this five-capture set and the visual-impact condition.
