import assert from "node:assert/strict";
import { test } from "node:test";

import { statusBarItems } from "../plugins/gitright/widget/status-bar.ts";

function pathItemValue(path) {
  return statusBarItems(
    { path, branch: "main", worktreeName: null },
    "HEAD (detached)",
  )[0].value;
}

test("abbreviates only a macOS home-directory prefix to ~", () => {
  assert.equal(
    pathItemValue("/Users/example/Documents/gitright"),
    "~/Documents/gitright",
  );
  assert.equal(pathItemValue("/Users/example"), "~");
  assert.equal(pathItemValue("/Users"), "/Users");
  assert.equal(pathItemValue("/opt/repositories/codex_git"), "/opt/repositories/codex_git");
  assert.equal(pathItemValue("/Usersland/repo"), "/Usersland/repo");
  assert.equal(
    pathItemValue("/Users/名前/プロジェクト"),
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
