import assert from "node:assert/strict";
import { test } from "node:test";

import {
  restoreOmittedChangedFilePageNulls,
  restoreOmittedCommitDetailNulls,
  restoreOmittedFileDiffNulls,
  restoreOmittedHistoryNulls,
} from "../plugins/gitright/widget/host-payload.ts";

test("host-omitted nullable changed-file fields normalize back to explicit null", () => {
  const hostPayload = {
    status: "ready",
    files: [{
      fileId: "e".repeat(64),
      status: "modified",
      path: "file.txt",
    }],
  };

  const normalized = restoreOmittedCommitDetailNulls(hostPayload);
  assert.notEqual(normalized, hostPayload);
  assert.deepEqual(normalized.files, [{
    fileId: "e".repeat(64),
    status: "modified",
    path: "file.txt",
    oldPath: null,
    additions: null,
    deletions: null,
  }]);
  assert.equal("oldPath" in hostPayload.files[0], false, "input was mutated");
});

test("changed-file normalization does not coerce present values", () => {
  const invalidPayload = {
    status: "ready",
    files: [{
      fileId: "e".repeat(64),
      status: "modified",
      path: "file.txt",
      oldPath: 42,
      additions: 1,
      deletions: 0,
    }],
  };

  const normalized = restoreOmittedCommitDetailNulls(invalidPayload);
  assert.equal(normalized.files[0].oldPath, 42);
});

test("host-omitted nullable fields normalize on a changed-file page", () => {
  const hostPage = {
    status: "ready",
    detailId: "d".repeat(64),
    previousLoadedCount: 500,
    previousLastFileId: "f".repeat(64),
    loadedCount: 501,
    totalCount: 501,
    pageSize: 500,
    hasMoreFiles: false,
    files: [{
      fileId: "e".repeat(64),
      status: "renamed",
      path: "new-name.txt",
    }],
  };

  const normalized = restoreOmittedChangedFilePageNulls(hostPage);
  assert.deepEqual(normalized.files[0], {
    fileId: "e".repeat(64),
    status: "renamed",
    path: "new-name.txt",
    oldPath: null,
    additions: null,
    deletions: null,
  });
});

test("host-omitted nullable head normalizes on an empty history snapshot", () => {
  const emptyHistory = {
    status: "ready",
    snapshotTime: 1,
    commits: [],
  };

  assert.deepEqual(restoreOmittedHistoryNulls(emptyHistory), {
    ...emptyHistory,
    headSha: null,
  });
});

test("host-omitted nullable parent selection normalizes on a root commit detail", () => {
  const rootDetail = {
    status: "ready",
    parents: [],
    files: [],
  };

  assert.deepEqual(restoreOmittedCommitDetailNulls(rootDetail), {
    ...rootDetail,
    selectedParentIndex: null,
    selectedParentSha: null,
  });
});

test("host-omitted nullable pagination boundaries normalize before validation", () => {
  const historyPage = {
    status: "ready",
    previousLoadedCount: 0,
    commits: [{}],
  };
  const changedFilePage = {
    status: "ready",
    previousLoadedCount: 0,
    files: [{}],
  };

  assert.equal(restoreOmittedHistoryNulls(historyPage).previousLastCommitSha, null);
  assert.equal(
    restoreOmittedChangedFilePageNulls(changedFilePage).previousLastFileId,
    null,
  );
});

test("host-omitted nullable fields normalize across a ready file diff", () => {
  const hostDiff = {
    status: "ready",
    detailId: "d".repeat(64),
    fileId: "f".repeat(64),
    path: "file.txt",
    statistics: {},
    bytes: 12,
    lineCount: 1,
    truncated: false,
    lines: [{ kind: "context", content: " unchanged" }],
  };

  const normalized = restoreOmittedFileDiffNulls(hostDiff);
  assert.deepEqual(normalized, {
    ...hostDiff,
    oldPath: null,
    statistics: { additions: null, deletions: null },
    truncatedBy: null,
    lines: [{
      kind: "context",
      content: " unchanged",
      oldLine: null,
      newLine: null,
    }],
  });
  assert.equal("oldPath" in hostDiff, false, "input was mutated");
});

test("host-omitted nullable path normalizes on a file-diff error", () => {
  const hostError = {
    status: "error",
    message: "File diff is unavailable",
    code: "file-diff-read-failed",
    detailId: "d".repeat(64),
    fileId: "f".repeat(64),
  };

  assert.deepEqual(restoreOmittedFileDiffNulls(hostError), {
    ...hostError,
    path: null,
  });
});
