import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendHistoryPage,
  createHistoryRefreshGuard,
  replaceHistorySnapshot,
} from "../plugins/gitright/widget/history-state.ts";

function sha(value) {
  return value.toString(16).padStart(40, "0");
}

function commit(value) {
  const objectId = sha(value);
  return {
    sha: objectId,
    shortSha: objectId.slice(0, 7),
    subject: `Commit ${value}`,
    committerTime: 1_800_000_000 - value,
    topologyRole: "commit",
    shallowBoundary: false,
    parents: [],
    refs: [],
    inlineRefs: [],
    additionalRefCount: 0,
  };
}

function snapshot(commits) {
  return {
    status: "ready",
    snapshotId: "a".repeat(64),
    snapshotTime: 1_800_000_000,
    refFingerprint: "b".repeat(64),
    headSha: commits[0]?.sha ?? null,
    loadedCount: commits.length,
    pageSize: 500,
    hasContinuation: true,
    hasMore: true,
    commits,
    selection: { status: "none" },
  };
}

function page(commits, overrides = {}) {
  return {
    status: "ready",
    snapshotId: "a".repeat(64),
    refFingerprint: "b".repeat(64),
    previousLoadedCount: 2,
    previousLastCommitSha: sha(2),
    loadedCount: 2 + commits.length,
    pageSize: 500,
    hasContinuation: false,
    hasMore: false,
    commits,
    ...overrides,
  };
}

test("appending a valid page preserves every existing row object and layout input", () => {
  const first = commit(1);
  const second = commit(2);
  const current = snapshot([first, second]);

  const result = appendHistoryPage(current, page([commit(3), commit(4)]));

  assert.equal(result.status, "ready");
  assert.equal(result.snapshot.commits[0], first);
  assert.equal(result.snapshot.commits[1], second);
  assert.deepEqual(result.snapshot.commits.map((item) => item.sha), [sha(1), sha(2), sha(3), sha(4)]);
});

test("duplicate and missing page boundaries preserve the last good UI snapshot", () => {
  const current = snapshot([commit(1), commit(2)]);
  const invalidPages = [
    page([commit(2), commit(3)]),
    page([commit(3)], { previousLoadedCount: 1 }),
    page([commit(3)], { previousLastCommitSha: sha(99) }),
    page([commit(3)], { loadedCount: 4 }),
  ];

  for (const nextPage of invalidPages) {
    assert.deepEqual(appendHistoryPage(current, nextPage), {
      status: "error",
      message: "History page boundary is invalid",
      snapshot: current,
    });
  }
});

test("refresh preserves selection and scroll when the target remains reachable", () => {
  const selected = commit(2);
  const current = {
    snapshot: snapshot([commit(1), selected]),
    selectedSha: selected.sha,
    selectedCommit: selected,
    scrollTop: 640,
    notice: null,
  };
  const refreshed = snapshot([commit(10), { ...selected, subject: "Still here" }]);

  const next = replaceHistorySnapshot(current, refreshed, {
    status: "reachable",
    sha: selected.sha,
  });

  assert.equal(next.selectedSha, selected.sha);
  assert.equal(next.selectedCommit.subject, "Still here");
  assert.equal(next.scrollTop, 640);
  assert.equal(next.notice, null);
});

test("refresh retains stored unreachable detail but clears a disappeared object", () => {
  const selected = commit(2);
  const current = {
    snapshot: snapshot([commit(1), selected]),
    selectedSha: selected.sha,
    selectedCommit: selected,
    scrollTop: 640,
    notice: null,
  };
  const refreshed = snapshot([commit(10)]);

  const unreachable = replaceHistorySnapshot(current, refreshed, {
    status: "unreachable",
    sha: selected.sha,
  });
  assert.equal(unreachable.selectedSha, selected.sha);
  assert.equal(unreachable.selectedCommit, selected);
  assert.equal(unreachable.notice, "No longer reachable from current refs");
  assert.equal(unreachable.scrollTop, 640);

  const missing = replaceHistorySnapshot(current, refreshed, {
    status: "missing",
    sha: selected.sha,
  });
  assert.equal(missing.selectedSha, null);
  assert.equal(missing.selectedCommit, null);
  assert.equal(missing.notice, "Selected commit is no longer available");
});

test("a delayed refresh freezes selection and captures scroll at atomic replacement", async () => {
  const guard = createHistoryRefreshGuard();
  let scrollTop = 120;
  let release;
  const delayedRefresh = new Promise((resolve) => { release = resolve; });

  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false);
  const response = delayedRefresh.then(() =>
    guard.captureReplacementScroll(() => scrollTop),
  );

  assert.equal(guard.allowsSelection(), false);
  scrollTop = 880;
  release();
  assert.equal(await response, 880);

  guard.end();
  assert.equal(guard.allowsSelection(), true);
});
