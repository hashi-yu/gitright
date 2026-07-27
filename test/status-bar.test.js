import assert from "node:assert/strict";
import { test } from "node:test";

import {
  abbreviateHomePath,
  statusBarItems,
} from "../plugins/gitright/widget/status-bar.ts";

test("abbreviates only a macOS home-directory prefix to ~", () => {
  assert.equal(
    abbreviateHomePath("/Users/example/Documents/gitright"),
    "~/Documents/gitright",
  );
  assert.equal(abbreviateHomePath("/Users/example"), "~");
  assert.equal(abbreviateHomePath("/Users"), "/Users");
  assert.equal(abbreviateHomePath("/opt/repositories/codex_git"), "/opt/repositories/codex_git");
  assert.equal(abbreviateHomePath("/Usersland/repo"), "/Usersland/repo");
  assert.equal(
    abbreviateHomePath("/Users/名前/プロジェクト"),
    "~/プロジェクト",
  );
});

test("lists path and branch always, worktree only for linked worktrees", () => {
  assert.deepEqual(
    statusBarItems(
      {
        path: "/Users/example/Documents/gitright",
        branch: "main",
        worktreeName: null,
      },
      "HEAD (detached)",
    ),
    [
      {
        kind: "path",
        value: "~/Documents/gitright",
        title: "/Users/example/Documents/gitright",
      },
      { kind: "branch", value: "main", title: "main" },
    ],
  );

  assert.deepEqual(
    statusBarItems(
      {
        path: "/srv/repo",
        branch: null,
        worktreeName: "feature/history-filter",
      },
      "HEAD (detached)",
    ),
    [
      { kind: "path", value: "/srv/repo", title: "/srv/repo" },
      { kind: "branch", value: "HEAD (detached)", title: "HEAD (detached)" },
      {
        kind: "worktree",
        value: "feature/history-filter",
        title: "feature/history-filter",
      },
    ],
  );
});
