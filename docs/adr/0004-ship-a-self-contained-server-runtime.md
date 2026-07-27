---
status: superseded by ADR-0005
---

# Ship a self-contained server runtime

GitRight ships its MCP server as a ready-to-run macOS executable and never requires or downloads a system Node.js or another language runtime. This increases artifact, signing, and release complexity but preserves zero-setup marketplace installation; a packaging spike selects the concrete executable format before production implementation.
