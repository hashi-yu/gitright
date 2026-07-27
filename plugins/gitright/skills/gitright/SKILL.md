---
name: gitright
description: Open the installed GitRight app through its dedicated read-only tool. Use when the user invokes $gitright, selects the GitRight plugin, asks to open GitRight, or clearly asks to view the current repository's Git history such as "Gitの履歴を表示して". Do not use for generic Git concept or command questions.
---

# GitRight

- Call only the `open_gitright` tool with an empty input object.
- Do not open GitRight for generic questions about Git concepts, commands, or
  repository content unless the user also asks to open the GitRight view.
- Never run Shell, Git commands, or repository-reading tools as a fallback.
- If `open_gitright` is unavailable or fails to start, stop. Report that
  GitRight could not start and surface its bounded startup diagnostic when one
  is available.
- Do not inspect, summarize, or expose repository content in place of GitRight.
