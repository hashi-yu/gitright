import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createToolResultStore,
  repositoryStateFromToolResult,
} from "../plugins/gitright/widget/tool-result-state.ts";

test("extracts app-only repository state from a standard tool-result notification", () => {
  const repositoryState = {
    status: "ready",
    message: "Repository ready",
    repositoryName: "gitright",
    repositoryPath: "/Users/example/gitright",
    repositoryKind: "repository",
    branch: "main",
    worktreeName: null,
    gitVersion: "2.50.0",
  };
  assert.equal(
    repositoryStateFromToolResult({
      structuredContent: { outcome: "opened" },
      _meta: { repositoryState },
    }),
    repositoryState,
  );
  assert.equal(repositoryStateFromToolResult({ structuredContent: {} }), undefined);
});

test("retains an early tool result and notifies mounted subscribers", () => {
  const store = createToolResultStore();
  const early = { _meta: { repositoryState: { status: "ready" } } };
  store.publish(early);
  assert.equal(store.latest(), early);

  const received = [];
  const unsubscribe = store.subscribe((value) => received.push(value));
  const update = { _meta: { repositoryState: { status: "unavailable" } } };
  store.publish(update);
  unsubscribe();
  store.publish({ _meta: { repositoryState: { status: "blocked" } } });
  assert.deepEqual(received, [update]);
});

test("waits briefly for the standard initial notification before falling back", async () => {
  const store = createToolResultStore();
  const result = { _meta: { repositoryState: { status: "ready" } } };
  const waiting = store.waitForLatest(100);
  store.publish(result);
  assert.equal(await waiting, result);
  assert.equal(await store.waitForLatest(0), result);
});
