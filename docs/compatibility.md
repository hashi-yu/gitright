# Compatibility

## Supported beta environment

| Surface | Supported range |
| --- | --- |
| Operating system | macOS |
| Architecture | native `arm64` and native `x86_64` |
| Bun runtime | `>=1.3.14 <2.0.0` |
| Git | 2.30.0 or later, including the current macOS system Git |
| Host | Codex with plugin and fullscreen MCP Apps support |
| Pane width | 380 CSS px or wider for the complete experience |
| Language | English and Japanese |
| Theme | Light and dark |

GitRight ships one JavaScript-based plugin package for both supported Mac
architectures. It does not bundle Bun or select an architecture-specific
server.

No minimum macOS release is claimed independently of the supported Codex host,
Bun 1.x, and Git versions. Native Intel support is verified on fresh
`x86_64` macOS runners; physical Intel hardware validation is not claimed.

## Runtime behavior

The launcher searches inherited `PATH`, then the standard Bun locations
`~/.bun/bin/bun`, `/opt/homebrew/bin/bun`, and `/usr/local/bin/bun`. Missing,
too-old, unrecognized, and Bun 2.x versions fail with a diagnostic and do not
change the environment.

The task must supply exactly one trusted repository context that resolves to a
Git repository. GitRight does not fall back to the process working directory or
accept a model-provided repository path.

## Accessibility boundary

The beta includes semantic structure, accessible names and status regions,
keyboard navigation, graph and text topology, visible focus, reduced-motion
handling, and meaning that does not depend on color alone.

Installed VoiceOver behavior has not received separate validation, so VoiceOver
compatibility is not claimed for the beta.

## Support policy

Compatibility reports are accepted as reproducible GitHub Issues and handled
on a best-effort basis. There is no response or resolution deadline.
