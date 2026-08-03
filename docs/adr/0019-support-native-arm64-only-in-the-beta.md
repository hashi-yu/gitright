---
status: accepted
---

# Support native arm64 only in the beta

The supported beta architecture narrows to native arm64. The architecture-
neutral package may run on native x86_64, but x86_64 becomes unverified and
is not a supported beta environment; compatibility reports are welcome and
handled on a best-effort basis. The fresh-runner Intel proof lanes are
removed.

This supersedes the Intel-support consequences of ADR-0005. The maintainer
owns no Intel hardware, so x86_64 support rested entirely on GitHub-hosted
Intel runners whose availability policy has already shifted once. A support
promise the maintainer cannot reproduce on real hardware is not a promise
this beta can keep.

## Considered options

- Keeping one fresh Intel lane per release candidate was rejected because it
  couples the support promise to third-party runner availability and adds a
  recurring release dependency the maintainer cannot verify on real hardware.
- Describing x86_64 as "best-effort support" was rejected because it still
  reads as a support commitment; only the handling of reports is best-effort.

## Consequences

`docs/compatibility.md` lists native arm64 as the supported architecture and
describes x86_64 as unverified. The bun-distribution proof matrix drops its
Intel entries. The read-only, offline, and package-isolation proofs continue
on arm64. Restoring x86_64 to the supported set requires a new decision with
renewed evidence.
