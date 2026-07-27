import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import {
  EMPTY_HISTORY_SEARCH_MATCHES,
  matchLoadedHistory,
  refMatchesQuery,
  subjectMatchRanges,
} from "../plugins/gitright/widget/history-search.ts";

function commit(index) {
  const sha = index.toString(16).padStart(40, "0");
  return {
    sha,
    subject: index === 377 ? "Fix the frobnicator" : `Commit ${index}`,
    refs:
      index === 233
        ? [{ name: "release/candidate", fullName: "refs/heads/release/candidate" }]
        : [],
    parents: index === 91 ? [{ sha: "f".repeat(40), loaded: false }] : [],
    relativeCommitterTime: index === 91 ? "secret-time-token" : "1 minute ago",
  };
}

test("matches loaded subjects, SHAs, and complete refs without filtering rows", () => {
  const commits = Array.from({ length: 500 }, (_, index) => commit(index));

  assert.deepEqual(matchLoadedHistory(commits, "FROBNICATOR").matchOrder, [
    commits[377].sha,
  ]);
  assert.deepEqual(
    matchLoadedHistory(commits, commits[121].sha.slice(-4)).matchOrder,
    [commits[121].sha],
  );
  assert.deepEqual(matchLoadedHistory(commits, "release/CANDIDATE").matchOrder, [
    commits[233].sha,
  ]);
  assert.deepEqual(matchLoadedHistory(commits, "secret-time-token").matchOrder, []);
  assert.deepEqual(matchLoadedHistory(commits, "f".repeat(40)).matchOrder, []);
  assert.equal(matchLoadedHistory(commits, ""), EMPTY_HISTORY_SEARCH_MATCHES);
  assert.equal(matchLoadedHistory(commits, "   "), EMPTY_HISTORY_SEARCH_MATCHES);

  const started = performance.now();
  matchLoadedHistory(commits, "commit");
  const duration = performance.now() - started;
  assert.ok(duration < 50, `500-commit search took ${duration.toFixed(3)} ms`);
});

test("keeps matches in row order and exposes them as a set for row emphasis", () => {
  const commits = Array.from({ length: 500 }, (_, index) => commit(index));
  const matches = matchLoadedHistory(commits, "Commit 49");

  assert.deepEqual(matches.matchOrder, [
    commits[49].sha,
    commits[490].sha,
    commits[491].sha,
    commits[492].sha,
    commits[493].sha,
    commits[494].sha,
    commits[495].sha,
    commits[496].sha,
    commits[497].sha,
    commits[498].sha,
    commits[499].sha,
  ]);
  assert.equal(matches.matchedShas.size, matches.matchOrder.length);
  assert.ok(matches.matchedShas.has(commits[49].sha));
  assert.equal(matches.query, "commit 49");
});

test("finds every case-insensitive subject occurrence for capsule emphasis", () => {
  assert.deepEqual(subjectMatchRanges("docs: installed Installed gate", "installed"), [
    { start: 6, end: 15 },
    { start: 16, end: 25 },
  ]);
  assert.deepEqual(subjectMatchRanges("no match here", "installed"), []);
  assert.deepEqual(subjectMatchRanges("anything", ""), []);
  assert.deepEqual(subjectMatchRanges("aaa", "aa"), [{ start: 0, end: 2 }]);
});

test("matches ref capsules by short or full name", () => {
  const ref = { name: "origin/main", fullName: "refs/remotes/origin/main" };
  assert.equal(refMatchesQuery(ref, "origin"), true);
  assert.equal(refMatchesQuery(ref, "remotes"), true);
  assert.equal(refMatchesQuery(ref, "release"), false);
  assert.equal(refMatchesQuery(ref, ""), false);
});
