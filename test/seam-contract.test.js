import assert from "node:assert/strict";
import { test } from "node:test";

import {
  outputSchemas,
  restoreOmittedNulls,
  validate,
} from "../plugins/gitright/contract/index.ts";

test("host-omitted nullable changed-file fields normalize back to explicit null", () => {
  const hostPayload = {
    status: "ready",
    files: [{
      fileId: "e".repeat(64),
      status: "modified",
      path: "file.txt",
    }],
  };

  const normalized = restoreOmittedNulls.commitDetail(hostPayload);
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

  const normalized = restoreOmittedNulls.commitDetail(invalidPayload);
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

  const normalized = restoreOmittedNulls.changedFilePage(hostPage);
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

  assert.deepEqual(restoreOmittedNulls.history(emptyHistory), {
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

  assert.deepEqual(restoreOmittedNulls.commitDetail(rootDetail), {
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

  assert.equal(
    restoreOmittedNulls.historyPage(historyPage).previousLastCommitSha,
    null,
  );
  assert.equal(
    restoreOmittedNulls.changedFilePage(changedFilePage).previousLastFileId,
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

  const normalized = restoreOmittedNulls.fileDiff(hostDiff);
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

  assert.deepEqual(restoreOmittedNulls.fileDiff(hostError), {
    ...hostError,
    path: null,
  });
});

test("a payload the contract does not recognize is returned untouched", () => {
  const unknown = { status: "surprise" };
  const unmarked = { path: "file.txt" };
  assert.equal(restoreOmittedNulls.history(unknown), unknown);
  assert.equal(restoreOmittedNulls.fileDiff(unmarked), unmarked);
  assert.equal(restoreOmittedNulls.fileDiff("not an object"), "not an object");
});

function readyFileDiff(overrides = {}) {
  return {
    status: "ready",
    detailId: "d".repeat(64),
    fileId: "f".repeat(64),
    path: "file.txt",
    oldPath: null,
    statistics: { additions: 1, deletions: null },
    bytes: 12,
    lineCount: 1,
    truncated: false,
    truncatedBy: null,
    lines: [{ kind: "context", content: " unchanged", oldLine: 1, newLine: 1 }],
    ...overrides,
  };
}

test("every advertised output schema is an object schema", () => {
  const names = Object.keys(outputSchemas).sort();
  assert.deepEqual(names, [
    "changedFilePage",
    "commitDetail",
    "fileDiff",
    "history",
    "historyPage",
    "launch",
    "repositoryState",
  ]);
  for (const [name, schema] of Object.entries(outputSchemas)) {
    assert.equal(schema.type, "object", `${name} must advertise an object`);
  }
});

test("the advertised launch schema keeps its optional reason code", () => {
  assert.deepEqual(outputSchemas.launch.required, ["outcome"]);
  assert.equal(outputSchemas.launch.additionalProperties, false);
  assert.deepEqual(outputSchemas.launch.properties.outcome.enum, [
    "opened",
    "unavailable",
    "unsupported",
  ]);
});

test("nullable fields are advertised as a null-accepting alternative", () => {
  const ready = outputSchemas.fileDiff.oneOf[0];
  assert.equal(ready.additionalProperties, false);
  assert.deepEqual(ready.properties.oldPath, {
    anyOf: [{ type: "string" }, { type: "null" }],
  });
});

test("the invariants beyond JSON Schema stay out of the advertised schema", () => {
  const ready = outputSchemas.fileDiff.oneOf[0];
  assert.equal("refine" in ready, false);
  assert.deepEqual(Object.keys(ready).sort(), [
    "additionalProperties",
    "properties",
    "required",
    "type",
  ]);
});

test("validation accepts a payload that satisfies the advertised shape", () => {
  assert.equal(validate.fileDiff(readyFileDiff()), true);
  assert.equal(
    validate.fileDiffError({
      status: "error",
      message: "File diff is unavailable",
      code: "file-diff-read-failed",
      detailId: "d".repeat(64),
      fileId: "f".repeat(64),
      path: null,
    }),
    true,
  );
});

test("validation rejects undeclared fields and out-of-bounds values", () => {
  assert.equal(validate.fileDiff(readyFileDiff({ surprise: 1 })), false);
  assert.equal(validate.fileDiff(readyFileDiff({ bytes: -1 })), false);
  assert.equal(validate.fileDiff(readyFileDiff({ detailId: "short" })), false);
});

test("validation enforces the invariants JSON Schema cannot carry", () => {
  assert.equal(validate.fileDiff(readyFileDiff({ lineCount: 2 })), false);
  assert.equal(validate.fileDiff(readyFileDiff({ truncated: true })), false);
  assert.equal(
    validate.fileDiff(readyFileDiff({ statistics: { additions: -1, deletions: null } })),
    false,
  );
});

test("validation accepts either tool's bounded error behind one seam notice", () => {
  const detailError = {
    status: "error",
    message: "Commit detail request is stale",
    code: "stale-detail",
  };
  const pageError = {
    status: "error",
    message: "Changed-file page boundary is invalid",
    code: "invalid-file-page-boundary",
  };

  assert.equal(validate.commitDetailError(detailError), true);
  assert.equal(validate.commitDetailError(pageError), true);
  assert.equal(
    validate.commitDetailError({ ...detailError, code: "not-a-real-code" }),
    false,
  );
});
