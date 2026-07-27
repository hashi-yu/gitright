import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beginCommitDetailLoad,
  beginCommitSelectionLoad,
  commitDetailMatchesSelection,
  failCommitDetailLoad,
  failCommitSelectionLoad,
  finishCommitDetailLoad,
  finishCommitSelectionLoad,
} from "../plugins/gitright/widget/commit-detail-state.ts";

test("commit selection stays on history until its detail is ready", () => {
  assert.deepEqual(beginCommitSelectionLoad(null), {
    surface: "history",
    detail: null,
    notice: null,
    loading: true,
  });
  assert.deepEqual(finishCommitSelectionLoad({ detailId: "ready" }), {
    surface: "detail",
    detail: { detailId: "ready" },
    notice: null,
    loading: false,
  });
  assert.deepEqual(failCommitSelectionLoad("Commit detail is unavailable"), {
    surface: "history",
    detail: null,
    notice: "Commit detail is unavailable",
    loading: false,
  });
});

test("a cached exact detail can transition without loading", () => {
  const cached = { detailId: "cached" };
  assert.deepEqual(beginCommitSelectionLoad(cached), {
    surface: "detail",
    detail: cached,
    notice: null,
    loading: false,
  });
});

test("loading a different selection never exposes the last commit detail", () => {
  const lastGood = { detailId: "last-good", files: ["complete.txt"] };

  assert.deepEqual(beginCommitDetailLoad(null), {
    detail: null,
    notice: null,
  });

  assert.deepEqual(
    failCommitDetailLoad(null, "Changed-file request timed out"),
    { detail: null, notice: "Changed-file request timed out" },
  );
});

test("reloading the current selection retains its exact detail without a transient notice", () => {
  const lastGood = { detailId: "last-good", files: ["complete.txt"] };

  assert.deepEqual(beginCommitDetailLoad(lastGood), {
    detail: lastGood,
    notice: null,
  });
  assert.deepEqual(
    failCommitDetailLoad(lastGood, "Changed-file request timed out"),
    { detail: lastGood, notice: "Changed-file request timed out" },
  );
});

test("a successful load atomically replaces the retained detail", () => {
  const replacement = { detailId: "replacement", files: ["new.txt"] };

  assert.deepEqual(finishCommitDetailLoad(replacement), {
    detail: replacement,
    notice: null,
  });
});

test("an initial load has no fictional last-good detail", () => {
  assert.deepEqual(beginCommitDetailLoad(null), { detail: null, notice: null });
  assert.deepEqual(
    failCommitDetailLoad(null, "Changed-file request timed out"),
    { detail: null, notice: "Changed-file request timed out" },
  );
});

test("a retained detail is interactive only for its exact snapshot, commit, and parent", () => {
  const detail = {
    snapshotId: "snapshot-a",
    sha: "commit-a",
    parents: ["parent-a", "parent-b"],
    selectedParentIndex: 1,
  };

  assert.equal(
    commitDetailMatchesSelection(detail, "snapshot-a", "commit-a", 1),
    true,
  );
  assert.equal(
    commitDetailMatchesSelection(detail, "snapshot-b", "commit-a", 1),
    false,
  );
  assert.equal(
    commitDetailMatchesSelection(detail, "snapshot-a", "commit-b", 1),
    false,
  );
  assert.equal(
    commitDetailMatchesSelection(detail, "snapshot-a", "commit-a", 0),
    false,
  );
});

test("a root detail matches the requested synthetic parent index zero", () => {
  const root = {
    snapshotId: "snapshot-a",
    sha: "root-commit",
    parents: [],
    selectedParentIndex: null,
  };

  assert.equal(
    commitDetailMatchesSelection(root, "snapshot-a", "root-commit", 0),
    true,
  );
});
