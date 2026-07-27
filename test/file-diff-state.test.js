import assert from "node:assert/strict";
import { test } from "node:test";

import { createFileDiffRequestGuard } from "../plugins/gitright/widget/file-diff-state.ts";

test("rapid commit, parent, and file selection accepts only the latest diff request", () => {
  const guard = createFileDiffRequestGuard();
  const first = guard.begin("a".repeat(64), "1".repeat(64));
  const second = guard.begin("a".repeat(64), "2".repeat(64));

  assert.equal(guard.accepts(first), false);
  assert.equal(guard.accepts(second), true);

  guard.invalidate();
  assert.equal(guard.accepts(second), false);

  const nextDetail = guard.begin("b".repeat(64), "3".repeat(64));
  assert.equal(guard.accepts(nextDetail), true);
  assert.equal(guard.accepts({ ...nextDetail, fileId: "4".repeat(64) }), false);
});
