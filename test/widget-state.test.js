import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_WIDGET_STATE,
  MAX_WIDGET_STATE_QUERY_CODE_POINTS,
  WIDGET_STATE_VERSION,
  createPersistedWidgetState,
  parsePersistedWidgetState,
  restoreWidgetSelection,
  truncateWidgetStateQuery,
} from "../plugins/gitright/widget/widget-state.ts";

const selectedSha = "a".repeat(40);

test("widget state has one explicit minimal versioned schema", () => {
  assert.equal(WIDGET_STATE_VERSION, 1);
  assert.equal(MAX_WIDGET_STATE_QUERY_CODE_POINTS, 256);
  assert.deepEqual(DEFAULT_WIDGET_STATE, {
    version: 1,
    mode: "graph",
    query: "",
    selectedSha: null,
    launcherHandoff: false,
  });

  const persisted = createPersistedWidgetState({
    mode: "text",
    query: "merge",
    selectedSha,
  });
  assert.deepEqual(persisted, {
    version: 1,
    mode: "text",
    query: "merge",
    selectedSha,
    launcherHandoff: false,
  });
  assert.deepEqual(Object.keys(persisted).sort(), [
    "launcherHandoff",
    "mode",
    "query",
    "selectedSha",
    "version",
  ]);
  for (const prohibited of [
    "repository",
    "history",
    "message",
    "author",
    "refs",
    "path",
    "parentIndex",
    "fileId",
    "diff",
    "status",
    "scrollTop",
    "graphScrollLeft",
  ]) {
    assert.equal(prohibited in persisted, false);
  }
});

test("valid widget state restores mode, bounded Unicode query, and full SHA", () => {
  const query = "履歴🙂".repeat(64);
  assert.equal(Array.from(query).length, 192);
  assert.deepEqual(
    parsePersistedWidgetState({ version: 1, mode: "text", query, selectedSha }),
    { version: 1, mode: "text", query, selectedSha, launcherHandoff: false },
  );
  assert.deepEqual(
    parsePersistedWidgetState({
      version: 1,
      mode: "text",
      query,
      selectedSha,
      launcherHandoff: true,
    }),
    { version: 1, mode: "text", query, selectedSha, launcherHandoff: true },
  );
  assert.equal(
    parsePersistedWidgetState({
      version: 1,
      mode: "text",
      query,
      selectedSha,
      launcherHandoff: "yes",
    }).launcherHandoff,
    false,
  );
});

test("unknown versions and malformed fields fall back independently to documented defaults", () => {
  assert.deepEqual(
    parsePersistedWidgetState({ version: 2, mode: "text", query: "keep?", selectedSha }),
    DEFAULT_WIDGET_STATE,
  );
  assert.deepEqual(
    parsePersistedWidgetState({
      version: 1,
      mode: "tiles",
      query: 42,
      selectedSha: "not-a-full-sha",
      repository: "/private/repository",
      scrollTop: 500,
    }),
    DEFAULT_WIDGET_STATE,
  );
  assert.deepEqual(
    parsePersistedWidgetState({
      version: 1,
      mode: "text",
      query: "q".repeat(257),
      selectedSha,
    }),
    { ...DEFAULT_WIDGET_STATE, mode: "text", selectedSha },
  );
  assert.deepEqual(parsePersistedWidgetState(null), DEFAULT_WIDGET_STATE);
  assert.deepEqual(parsePersistedWidgetState([]), DEFAULT_WIDGET_STATE);
});

test("query bounding counts Unicode code points rather than UTF-16 code units", () => {
  const exact = "🙂".repeat(256);
  assert.equal(exact.length, 512);
  assert.equal(truncateWidgetStateQuery(exact), exact);
  assert.equal(Array.from(truncateWidgetStateQuery(`${exact}extra`)).length, 256);
});

test("selection restoration keeps only a full SHA in the current snapshot", () => {
  const otherSha = "b".repeat(40);
  assert.equal(restoreWidgetSelection(selectedSha, [{ sha: selectedSha }]), selectedSha);
  assert.equal(restoreWidgetSelection(selectedSha, [{ sha: otherSha }]), null);
  assert.equal(restoreWidgetSelection(null, [{ sha: selectedSha }]), null);
});
