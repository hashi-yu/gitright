import assert from "node:assert/strict";
import { test } from "node:test";

import {
  captureHistoryReturnTarget,
  createHistoryPresentation,
  updateHistoryPresentation,
} from "../plugins/gitright/widget/history-detail-navigation.ts";

test("history presentation remains in memory while detail replaces the history surface", () => {
  const initial = createHistoryPresentation();
  const searched = updateHistoryPresentation(initial, {
    query: "merge",
    topologyMode: "text",
    graphScrollLeft: 144,
  });

  assert.deepEqual(initial, {
    query: "",
    topologyMode: "graph",
    graphScrollLeft: 0,
  });
  assert.deepEqual(searched, {
    query: "merge",
    topologyMode: "text",
    graphScrollLeft: 144,
  });
});

test("detail navigation captures the vertical and graph position to restore", () => {
  assert.deepEqual(
    captureHistoryReturnTarget("a".repeat(40), 612.5, 144),
    {
      originatingSha: "a".repeat(40),
      verticalScrollTop: 612.5,
      graphScrollLeft: 144,
    },
  );
  assert.deepEqual(
    captureHistoryReturnTarget(
      "b".repeat(40),
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
    {
      originatingSha: "b".repeat(40),
      verticalScrollTop: 0,
      graphScrollLeft: 0,
    },
  );
});
