---
status: accepted
---

# Require an explicit conversation handoff for selected commits

GitRight keeps commit selection inside the widget until the user explicitly asks to use that selection in the Codex conversation. A secondary action in commit detail sends the selected full SHA as its stable identity through the standard MCP Apps `ui/update-model-context` notification and displays an in-widget confirmation. It excludes the commit message, diff, and author data by default, does not submit a message, and does not start a model response. Selecting another commit does not update conversation context until the user activates the action again.

This preserves repository-data minimization and prevents navigation from silently changing model context, while still giving the fullscreen/right-pane experience a deliberate path back to the system composer.

## Considered options

- Automatically updating model context on every selection was rejected because browsing would silently disclose repository content and make conversation state depend on incidental navigation.
- Never connecting selection to conversation was rejected because it would leave the fullscreen view disconnected from the host composer and weaken GitRight's conversational value.
- Sending a follow-up message from the widget was rejected because handing off a selection should not create a conversation turn or trigger an unsolicited model response.

## Consequences

The handoff control appears only when one commit is selected. Hosts that do not advertise model-context update support must leave the action unavailable without falling back to automatic messaging.
