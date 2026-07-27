---
status: accepted
---

# Publish the product decision records

GitRight publishes its product architecture decision records, ADR-0001 through ADR-0015, in this repository, and records every later architecture decision here as well. The published text is lightly edited from the pre-public records and is now the canonical wording. Records about the publication process itself remain private.

This amends the earlier documentation boundary that kept the ADR collection private. The product decisions are published because they describe the shipped product's contracts — supported pane width, the read-only Git model, the runtime and distribution model, and the accepted interaction layout — and contributors need those decisions and their rejected alternatives to change the product safely.

## Consequences

New architecture decisions are numbered continuously from this record and committed to `docs/adr/`. Superseding a published decision requires a new ADR rather than editing the old record.
