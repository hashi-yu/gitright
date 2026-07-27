---
status: accepted
---

# Keep launch results status-only in model context

GitRight limits the model-visible result of `open_gitright` to a bounded lifecycle outcome—`opened`, `unavailable`, or `unsupported`—and a stable reason code when one is needed. Repository name, SHA, subject, author, history, diff, and path data are excluded from normal model-visible tool results. Rich repository data is delivered only through app-only tools and widget-only result metadata; the explicit conversation handoff remains the sole path for a selected SHA to enter model context.

Every GitRight tool declares an exact output schema for the result it can return. Contract tests assert both the allowed status shape and the absence of repository data from model-visible launch results.

## Considered options

- Returning a concise repository or selection summary from `open_gitright` was rejected because opening the app does not imply consent to add repository content to the conversation.
- Returning no model-visible result was rejected because the host and model need a predictable, bounded way to distinguish a successful launch from unavailable or unsupported states.

## Consequences

Adding repository content to a normal model-visible tool result requires a new explicit product and privacy decision. App-only result schemas may be richer, but they must not be reused as the model-visible launch schema.
