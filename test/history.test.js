import assert from "node:assert/strict";
import test from "node:test";

import {
  formatGraphRow,
  summarizeChanges,
  summarizeCommit,
} from "../src/history.js";

test("formats a short commit summary", () => {
  assert.equal(
    summarizeCommit({ hash: "0123456789abcdef", subject: "Initial commit" }),
    "0123456 Initial commit",
  );
});

test("formats a graph row with branch labels", () => {
  assert.equal(
    formatGraphRow({
      graph: "*",
      hash: "abcdef0123456789",
      subject: "Render graph row",
      refs: ["HEAD -> feature/git-graph"],
    }),
    "* abcdef0 Render graph row (HEAD -> feature/git-graph)",
  );
});

test("summarizes changed file statistics", () => {
  assert.equal(
    summarizeChanges([
      { additions: 12, deletions: 2 },
      { additions: 3, deletions: 8 },
    ]),
    "2 files, +15 -10",
  );
});
