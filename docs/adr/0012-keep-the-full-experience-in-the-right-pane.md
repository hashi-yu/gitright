---
status: accepted
---

# Keep the full experience in the right pane

Each user activation issues exactly one fullscreen display-mode request. GitRight renders repository history, commit detail, and diff only after the host grants that request and Codex presents it as the right pane. The inline surface remains a minimal Apps SDK launcher rather than an alternate application layout.

If the display-mode capability is absent, the request is rejected, or the resolved mode remains inline, GitRight shows a concise status in the launcher and leaves the same open action available for another deliberate user attempt. It does not automatically retry and does not expand the repository interface inside the conversation.

## Considered options

- Rendering the complete application inline as a fallback was rejected because it violates the right-pane product boundary and creates deep navigation and scrolling inside a conversational card.
- Automatically retrying the display request was rejected because observed host behavior requires a trusted user activation and background retries cannot reliably supply it.

## Consequences

An unavailable right pane is a bounded host-capability state, not a signal to switch layouts. Tests must cover missing capability, rejected promise, and a resolved non-fullscreen mode while proving that no repository history is rendered inline.
