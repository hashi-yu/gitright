import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveLauncherOutcome } from "../plugins/gitright/widget/launcher-state.ts";

test("launcher mounts the complete view only after fullscreen acceptance", () => {
  assert.deepEqual(resolveLauncherOutcome({ kind: "resolved", mode: "fullscreen" }), {
    showCompleteView: true,
    status: "idle",
  });

  for (const outcome of [
    { kind: "missing" },
    { kind: "rejected" },
    { kind: "thrown" },
    { kind: "undefined" },
    { kind: "resolved", mode: "inline" },
    { kind: "resolved", mode: "pip" },
  ]) {
    assert.equal(resolveLauncherOutcome(outcome).showCompleteView, false);
  }
});

test("launcher gives every non-fullscreen outcome a bounded reusable status", () => {
  assert.deepEqual(resolveLauncherOutcome({ kind: "missing" }), {
    showCompleteView: false,
    status: "unavailable",
  });
  assert.deepEqual(resolveLauncherOutcome({ kind: "rejected" }), {
    showCompleteView: false,
    status: "failed",
  });
  assert.deepEqual(resolveLauncherOutcome({ kind: "thrown" }), {
    showCompleteView: false,
    status: "failed",
  });

  for (const outcome of [
    { kind: "undefined" },
    { kind: "resolved", mode: "inline" },
    { kind: "resolved", mode: "pip" },
  ]) {
    assert.deepEqual(resolveLauncherOutcome(outcome), {
      showCompleteView: false,
      status: "unsupported",
    });
  }
});
