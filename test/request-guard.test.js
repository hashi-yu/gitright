import assert from "node:assert/strict";
import { test } from "node:test";

import { createRequestGuard } from "../plugins/gitright/widget/request-guard.ts";

test("rapid commit, parent, and file selection accepts only the latest diff request", () => {
  const guard = createRequestGuard();
  const first = guard.begin("a".repeat(64), "1".repeat(64));
  const second = guard.begin("a".repeat(64), "2".repeat(64));
  assert.equal(guard.accepts(first), false);
  assert.equal(guard.accepts(second), true);

  guard.invalidate();
  assert.equal(guard.accepts(second), false);

  const nextDetail = guard.begin("b".repeat(64), "3".repeat(64));
  assert.equal(guard.accepts(nextDetail), true);
  assert.equal(
    guard.accepts({ ...nextDetail, keys: [nextDetail.keys[0], "4".repeat(64)] }),
    false,
  );
});

test("a deferred file page cannot survive a parent-switch invalidation", () => {
  const guard = createRequestGuard();
  const firstParentRequest = guard.begin("a".repeat(64));
  assert.equal(guard.accepts(firstParentRequest), true);

  guard.invalidate();
  assert.equal(guard.accepts(firstParentRequest), false);

  const secondParentRequest = guard.begin("b".repeat(64));
  assert.equal(guard.accepts(firstParentRequest), false);
  assert.equal(guard.accepts(secondParentRequest), true);
});
