import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commitDetailMatchesSelection,
} from "../plugins/gitright/widget/commit-detail-state.ts";

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
