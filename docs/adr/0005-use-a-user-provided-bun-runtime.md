---
status: accepted
amended: 2026-07-14
---

# Use a user-provided Bun runtime for beta distribution

GitRight distributes one architecture-neutral plugin with a prebuilt Bun-targeted server bundle and widget assets, while users provide Bun `>=1.3.14 <2.0.0`; release builds remain pinned to Bun 1.3.14. This supersedes ADR-0004 because the packaging spike measured approximately 63 MB and 69 MB for separate Bun-containing arm64 and x86_64 executables, making a universal executable exceed GitHub's normal single-file limit and adding launcher, signing, and notarization work that is not justified for a developer beta. GitRight never installs or updates Bun, users never run `bun install` inside the installed plugin, and its MCP runtime makes no network request after prerequisite and marketplace installation.

## Considered options

- Bundled Bun executables and a native dispatcher are retained as a future option if the documented Bun prerequisite creates measurable installation or support problems.
- A native MCP server remains a future option if profiling or distribution evidence justifies rewriting the TypeScript server.
- Supporting Node.js alongside Bun is deferred to avoid doubling the runtime compatibility matrix during beta.

## Consequences

Routine public pull requests test the minimum and latest stable Bun 1.x plus minimum and current Git on GitHub-hosted runners with read-only permissions and no secrets. Dedicated visual validation may use a self-hosted Mac under a non-personal runner identity, but it is maintainer-dispatched, accepts only trusted GitRight commits, and is not pull-request or release evidence. Before `beta` advances, the release candidate separately runs the full prebuilt-payload matrix on fresh native arm64 and x86_64 GitHub-hosted macOS runners.

Release candidates also receive a real ChatGPT/Codex marketplace smoke test on a physical arm64 Mac. The physical smoke composes an online Desktop integration observation with a direct launch of the exact installed package under runtime-only network denial. Native x86_64 fresh-runner evidence is the Intel support gate; native Intel real-hardware verification is non-blocking and must be reported as unverified until observed. Host-wide disconnection is excluded because it prevents the Codex model turn before an MCP tool can run; the host's model transport is not part of GitRight's runtime network boundary. Because GitRight distributes no native executable, Developer ID signing and Apple notarization are not GitRight release gates under this decision.

## Amendment history

The original workflow ran the full fresh arm64 and Intel matrix for every pull-request update. On 2026-07-14, routine same-repository pull requests moved to a trusted self-hosted arm64 runner to prevent ordinary development iterations from exhausting GitHub-hosted macOS minutes. The fresh native two-architecture matrix remains a mandatory release-candidate gate and is dispatched only for a candidate intended to advance `beta`.

On 2026-07-21, the public-repository decision moved routine pull-request validation back to GitHub-hosted runners so external fork pull requests receive CI without exposing a maintainer machine to untrusted code. Public CI is kept separate from dedicated self-hosted visual validation and private physical-host acceptance.
