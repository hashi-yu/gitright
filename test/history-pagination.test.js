import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import { createHistoryService } from "../plugins/gitright/server/history-service.ts";

function result(stdout, status = 0, stderr = "") {
  return {
    status,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut: false,
  };
}

function sha(value) {
  return value.toString(16).padStart(40, "0");
}

function createLinearExecutor(initialCommits) {
  let commits = initialCommits;
  let failHistory = false;
  let missing = new Set();
  let heldHistory = null;
  let invisibleTag = null;
  const knownParents = new Map();
  let historyReads = 0;
  let replaceAfterSubjects = null;
  let historyFailureStderr = "";
  let selectionFailure = null;

  function remember(values) {
    for (const [index, objectId] of values.entries()) {
      knownParents.set(objectId, values[index + 1] ? [values[index + 1]] : []);
    }
  }
  remember(commits);

  const executor = {
    history: async (_cwd, operation, objectIds = []) => {
      if (operation === "head") return result(`${commits[0]}\n`);
      if (operation === "symbolic-head") return result("refs/heads/main\n");
      if (operation === "refs") {
        const main = `refs/heads/main\0${commits[0]}\0commit\0\0\0\n`;
        const hidden = invisibleTag
          ? `refs/tags/blob-only\0${invisibleTag}\0blob\0\0\0\n`
          : "";
        return result(`${main}${hidden}`);
      }
      if (operation === "worktree-branches") {
        return result("refs/heads/main\0/tmp/worktree\0\n");
      }
      if (operation === "history-page") {
        historyReads += 1;
        if (heldHistory) await heldHistory;
        if (failHistory) return result("", 128, historyFailureStderr);
        return result(
          commits
            .map((objectId, index) =>
              `${1_800_000_000 - index} ${objectId}${commits[index + 1] ? ` ${commits[index + 1]}` : ""}`,
            )
            .join("\n") + "\n",
        );
      }
      if (operation === "history-parents") {
        if (selectionFailure && objectIds.length === 1 && objectIds[0] === selectionFailure.sha) {
          return result("", selectionFailure.status, selectionFailure.stderr);
        }
        const missingObjectId = objectIds.find((objectId) => missing.has(objectId));
        if (missingObjectId) {
          return result("", 128, `fatal: bad object ${missingObjectId}\n`);
        }
        return result(
          objectIds
            .map((objectId) => `${objectId}${(knownParents.get(objectId) ?? []).map((parent) => ` ${parent}`).join("")}`)
            .join("\n") + "\n",
        );
      }
      if (operation === "history-subjects") {
        const response = result(
          objectIds.map((objectId) => `${objectId}\0Commit ${objectId.slice(-6)}\0`).join("\n") + "\n",
        );
        if (replaceAfterSubjects) {
          commits = replaceAfterSubjects;
          remember(commits);
          replaceAfterSubjects = null;
        }
        return response;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  };

  return {
    executor,
    replace(values) {
      commits = values;
      remember(values);
    },
    setHistoryFailure(value, stderr = "") {
      failHistory = value;
      historyFailureStderr = stderr;
    },
    setMissing(values) {
      missing = new Set(values);
    },
    setSelectionFailure(objectId, status, stderr) {
      selectionFailure = { sha: objectId, status, stderr };
    },
    holdHistory(promise) {
      heldHistory = promise;
    },
    setInvisibleTag(objectId) {
      invisibleTag = objectId;
    },
    replaceRefsAfterSubjects(values) {
      replaceAfterSubjects = values;
    },
    historyReads() {
      return historyReads;
    },
  };
}

function pageRequest(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    refFingerprint: snapshot.refFingerprint,
    loadedCount: snapshot.loadedCount,
    lastCommitSha: snapshot.commits.at(-1)?.sha ?? null,
  };
}

test("unchanged snapshot pagination appends exact stable 500-commit pages", async () => {
  const commits = Array.from({ length: 1_001 }, (_, index) => sha(index + 1));
  const fixture = createLinearExecutor(commits);
  const service = createHistoryService(fixture.executor, () => 1_800_000_100);

  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");
  assert.match(first.snapshotId, /^[0-9a-f]{64}$/);
  assert.equal(first.loadedCount, 500);
  assert.equal(first.hasMore, true);
  assert.equal(
    service.loadedCommit(first.snapshotId, first.commits[20].sha),
    first.commits[20],
  );
  assert.equal(service.loadedCommit("f".repeat(64), first.commits[20].sha), null);
  assert.equal(service.loadedCommit(first.snapshotId, commits[700]), null);

  const originalRows = [...first.commits];
  const appendStarted = performance.now();
  const second = await service.loadMore(
    "/tmp/pinned-repository",
    pageRequest(first),
  );
  const appendDuration = performance.now() - appendStarted;

  assert.equal(second.status, "ready");
  assert.equal(second.previousLoadedCount, 500);
  assert.equal(second.previousLastCommitSha, first.commits.at(-1).sha);
  assert.equal(second.commits.length, 500);
  assert.equal(second.loadedCount, 1_000);
  assert.equal(second.hasMore, true);
  assert.ok(
    appendDuration < 300,
    `500-commit snapshot append took ${appendDuration.toFixed(3)} ms`,
  );
  assert.deepEqual(second.commits.map((commit) => commit.sha), commits.slice(500, 1_000));
  assert.equal(new Set([...first.commits, ...second.commits].map((commit) => commit.sha)).size, 1_000);

  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.deepEqual(current.commits.slice(0, 500), originalRows);
  assert.deepEqual(current.commits.map((commit) => commit.sha), commits.slice(0, 1_000));

  const third = await service.loadMore(
    "/tmp/pinned-repository",
    pageRequest(current),
  );
  assert.equal(third.status, "ready");
  assert.deepEqual(third.commits.map((commit) => commit.sha), [commits[1_000]]);
  assert.equal(third.loadedCount, 1_001);
  assert.equal(third.hasMore, false);
});

test("twenty stable pages load 10,000 commits without duplicates or reordered prefixes", async () => {
  const commits = Array.from({ length: 10_001 }, (_, index) => sha(index + 1));
  const fixture = createLinearExecutor(commits);
  const service = createHistoryService(fixture.executor, () => 1_800_000_100);
  let current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  let stablePrefix = [...current.commits];

  while (current.loadedCount < 10_000) {
    const started = performance.now();
    const nextPage = await service.loadMore(
      "/tmp/pinned-repository",
      pageRequest(current),
    );
    const duration = performance.now() - started;
    assert.equal(nextPage.status, "ready");
    assert.equal(nextPage.commits.length, 500);
    assert.ok(duration < 300, `incremental page took ${duration.toFixed(3)} ms`);
    const next = await service.load("/tmp/pinned-repository");
    assert.equal(next.status, "ready");
    assert.deepEqual(next.commits.slice(0, stablePrefix.length), stablePrefix);
    stablePrefix = [...next.commits];
    current = next;
  }

  assert.equal(current.loadedCount, 10_000);
  assert.equal(new Set(current.commits.map((commit) => commit.sha)).size, 10_000);
  assert.deepEqual(current.commits.map((commit) => commit.sha), commits.slice(0, 10_000));
  assert.equal(current.hasMore, true);
});

test("a changed ref fingerprint stops pagination and preserves the last good snapshot", async () => {
  const original = Array.from({ length: 700 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 700 }, (_, index) => sha(2_000 + index));
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replace(replacement);
  const changed = await service.loadMore(
    "/tmp/pinned-repository",
    pageRequest(first),
  );

  assert.deepEqual(changed, {
    status: "changed",
    message: "History changed — Refresh to continue",
    code: "history-changed",
    snapshotId: first.snapshotId,
  });
  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.equal(current.snapshotId, first.snapshotId);
  assert.deepEqual(current.commits, first.commits);
  assert.equal(fixture.historyReads(), 1, "pagination must not rebuild after detecting changed refs");
});

test("a ref change during pagination never appends subjects from the old snapshot", async () => {
  const original = Array.from({ length: 700 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 700 }, (_, index) => sha(2_000 + index));
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replaceRefsAfterSubjects(replacement);
  const changed = await service.loadMore(
    "/tmp/pinned-repository",
    pageRequest(first),
  );

  assert.deepEqual(changed, {
    status: "changed",
    message: "History changed — Refresh to continue",
    code: "history-changed",
    snapshotId: first.snapshotId,
  });
  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.equal(current.loadedCount, first.loadedCount);
  assert.deepEqual(current.commits, first.commits);
});

test("an invisible non-commit ref does not change the visible-ref fingerprint", async () => {
  const commits = Array.from({ length: 501 }, (_, index) => sha(index + 1));
  const fixture = createLinearExecutor(commits);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.setInvisibleTag(sha(90_000));
  const page = await service.loadMore(
    "/tmp/pinned-repository",
    pageRequest(first),
  );

  assert.equal(page.status, "ready");
  assert.equal(page.commits.length, 1);
  assert.equal(page.commits[0].sha, commits[500]);
  assert.equal(page.refFingerprint, first.refFingerprint);
});

test("refresh atomically replaces a snapshot and classifies a stored unreachable selection", async () => {
  const original = Array.from({ length: 700 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 700 }, (_, index) => sha(2_000 + index));
  const selectedSha = original[20];
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replace(replacement);
  const refreshed = await service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha,
  });

  assert.equal(refreshed.status, "ready");
  assert.notEqual(refreshed.snapshotId, first.snapshotId);
  assert.deepEqual(refreshed.commits.map((commit) => commit.sha), replacement.slice(0, 500));
  assert.deepEqual(refreshed.selection, { status: "unreachable", sha: selectedSha });
  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.equal(current.snapshotId, refreshed.snapshotId);
});

test("a missing selected object returns to history after refresh", async () => {
  const original = Array.from({ length: 40 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 40 }, (_, index) => sha(2_000 + index));
  const selectedSha = original[20];
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replace(replacement);
  fixture.setMissing([selectedSha]);
  const refreshed = await service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha,
  });

  assert.equal(refreshed.status, "ready");
  assert.deepEqual(refreshed.selection, { status: "missing", sha: selectedSha });
});

test("an unclassified selection read failure preserves the last good snapshot", async () => {
  const original = Array.from({ length: 40 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 40 }, (_, index) => sha(2_000 + index));
  const selectedSha = original[20];
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replace(replacement);
  fixture.setSelectionFailure(
    selectedSha,
    1,
    "fatal: unexpected selection read failure\n",
  );
  assert.deepEqual(
    await service.refresh("/tmp/pinned-repository", {
      snapshotId: first.snapshotId,
      selectedSha,
    }),
    {
      status: "error",
      message: "History is unavailable",
      code: "selection-read-failed",
    },
  );
  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.equal(current.snapshotId, first.snapshotId);
  assert.deepEqual(current.commits, first.commits);
});

test("refresh failure leaves the complete last good snapshot active", async () => {
  const original = Array.from({ length: 700 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 700 }, (_, index) => sha(2_000 + index));
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replace(replacement);
  fixture.setHistoryFailure(true);
  const failed = await service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha: null,
  });

  assert.equal(failed.status, "error");
  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.equal(current.snapshotId, first.snapshotId);
  assert.deepEqual(current.commits, first.commits);
});

test("an exhausted transient lock keeps the last good snapshot for a manual retry", async () => {
  const commits = Array.from({ length: 20 }, (_, index) => sha(index + 1));
  const fixture = createLinearExecutor(commits);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.setHistoryFailure(
    true,
    "fatal: Unable to create '.git/packed-refs.lock': File exists.\n",
  );
  assert.deepEqual(
    await service.refresh("/tmp/pinned-repository", {
      snapshotId: first.snapshotId,
      selectedSha: null,
    }),
    {
      status: "error",
      message: "Repository is temporarily locked — Refresh to retry",
      code: "transient-lock-timeout",
    },
  );
  assert.equal((await service.load("/tmp/pinned-repository")).snapshotId, first.snapshotId);

  fixture.setHistoryFailure(false);
  const retried = await service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha: null,
  });
  assert.equal(retried.status, "ready");
  assert.notEqual(retried.snapshotId, first.snapshotId);
});

test("a ref change during refresh is never published with the old commit data", async () => {
  const original = Array.from({ length: 20 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 20 }, (_, index) => sha(2_000 + index));
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replaceRefsAfterSubjects(replacement);
  const changed = await service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha: null,
  });

  assert.deepEqual(changed, {
    status: "error",
    message: "History changed — Refresh to continue",
    code: "history-changed-during-read",
  });
  const current = await service.load("/tmp/pinned-repository");
  assert.equal(current.status, "ready");
  assert.equal(current.snapshotId, first.snapshotId);
  assert.deepEqual(current.commits, first.commits);
});

test("missing, corrupt, and exhausted-lock reads have distinct safe history errors", async () => {
  const cases = [
    {
      stderr: `fatal: bad object ${sha(1)}\n`,
      expected: { status: "error", message: "Repository object is missing", code: "missing-object" },
    },
    {
      stderr: "error: object file .git/objects/aa/bb is corrupt\n",
      expected: { status: "error", message: "Repository object is corrupt", code: "corrupt-object" },
    },
    {
      stderr: "fatal: Unable to create '.git/packed-refs.lock': File exists.\n",
      expected: { status: "error", message: "Repository is temporarily locked — Refresh to retry", code: "transient-lock-timeout" },
    },
  ];

  for (const item of cases) {
    const fixture = createLinearExecutor([sha(1)]);
    fixture.setHistoryFailure(true, item.stderr);
    const service = createHistoryService(fixture.executor);
    assert.deepEqual(await service.load("/tmp/pinned-repository"), item.expected);
  }
});

test("refresh is single-flight and never queues a second rebuild", async () => {
  const original = Array.from({ length: 20 }, (_, index) => sha(index + 1));
  const replacement = Array.from({ length: 20 }, (_, index) => sha(2_000 + index));
  const fixture = createLinearExecutor(original);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  fixture.replace(replacement);
  let release;
  fixture.holdHistory(new Promise((resolve) => { release = resolve; }));
  const firstRefresh = service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha: null,
  });
  await Promise.resolve();
  const secondRefresh = await service.refresh("/tmp/pinned-repository", {
    snapshotId: first.snapshotId,
    selectedSha: null,
  });

  assert.deepEqual(secondRefresh, {
    status: "error",
    message: "History refresh is already in progress",
    code: "refresh-in-progress",
  });
  release();
  const refreshed = await firstRefresh;
  assert.equal(refreshed.status, "ready");
  assert.equal(fixture.historyReads(), 2, "one initial read and one refresh read");
});

test("stale or missing page boundaries are explicit errors", async () => {
  const commits = Array.from({ length: 700 }, (_, index) => sha(index + 1));
  const fixture = createLinearExecutor(commits);
  const service = createHistoryService(fixture.executor);
  const first = await service.load("/tmp/pinned-repository");
  assert.equal(first.status, "ready");

  for (const request of [
    { ...pageRequest(first), loadedCount: 499 },
    { ...pageRequest(first), lastCommitSha: sha(90_000) },
    { ...pageRequest(first), refFingerprint: "f".repeat(64) },
  ]) {
    assert.deepEqual(
      await service.loadMore("/tmp/pinned-repository", request),
      {
        status: "error",
        message: "History page boundary is invalid",
        code: "invalid-page-boundary",
      },
    );
  }
});
