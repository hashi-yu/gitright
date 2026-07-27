---
status: accepted
---

# Publish the product decision records

GitRight publishes its pre-public product architecture decision records, ADR-0001 through ADR-0015, in this public repository, and records every later architecture decision here as well. Before publication each record was sanitized: references to pre-public issue numbers and to private design documents were removed, because those references do not resolve in the public repository. The pre-public operational records covering the publication process itself remain private design records, consistent with the decision to start public history from a sanitized snapshot.

This amends the pre-public documentation boundary, which kept the complete ADR collection private. The product decisions are republished because they describe the shipped product's contracts — supported pane width, the read-only Git model, the runtime and distribution model, and the accepted interaction layout — and contributors need those decisions and their rejected alternatives to change the product without re-litigating them.

## Considered options

- Keeping all pre-public ADRs private and starting a fresh public decision log was rejected because the shipped product's binding constraints would then live only in private records, and public contributors could not see why the current contracts exist.
- Publishing the complete collection including the publication-process records was rejected because those records are operational rather than product decisions and were written under the private documentation boundary.

## Consequences

New architecture decisions are numbered continuously from this record and committed to `docs/adr/`. The published pre-public records keep their original numbers, statuses, and amendment histories; their sanitized wording is now the canonical public text. Superseding a published decision requires a new public ADR rather than editing the old record.
