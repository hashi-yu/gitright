import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { createCommitDetailService } from "../plugins/gitright/server/commit-detail-service.ts";

const execFile = promisify(execFileCallback);

function sha(value) {
  return value.toString(16).padStart(40, "0");
}

function result(stdout, status = 0, stderr = "") {
  return {
    status,
    signal: null,
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut: false,
    outputLimited: false,
  };
}

function timedOutResult(stdout = "") {
  return {
    ...result(stdout, null),
    timedOut: true,
  };
}

function detailOutput({ commitSha, parents, author = "Ada", message = "Full message\n" }) {
  return Buffer.from(
    `${commitSha}\0${parents.join(" ")}\0${author}\0` +
      "2026-07-13T09:10:11+09:00\0" +
      "2026-07-13T10:11:12-04:00\0" +
      `${message}\0\n`,
  );
}

function changedFilesOutput(entries) {
  const fields = [];
  for (const entry of entries) {
    fields.push(Buffer.from(entry.status), Buffer.from([0]));
    if (entry.oldPath) {
      fields.push(Buffer.from(entry.oldPath), Buffer.from([0]));
    }
    fields.push(Buffer.from(entry.path), Buffer.from([0]));
  }
  return Buffer.concat(fields);
}

function changedStatsOutput(entries) {
  const fields = [];
  for (const entry of entries) {
    fields.push(Buffer.from(`${entry.additions}\t${entry.deletions}\t`));
    if (entry.oldPath) {
      fields.push(Buffer.from([0]), Buffer.from(entry.oldPath), Buffer.from([0]));
    }
    fields.push(Buffer.from(entry.path), Buffer.from([0]));
  }
  return Buffer.concat(fields);
}

function changedObjectMetadata(entry, index) {
  return {
    oldMode: entry.oldMode ?? (entry.status === "A" ? "000000" : "100644"),
    newMode: entry.newMode ?? (entry.status === "D" ? "000000" : "100644"),
    oldOid: entry.oldOid ?? (entry.status === "A" ? "0".repeat(40) : sha(10_000 + index)),
    newOid: entry.newOid ?? (entry.status === "D" ? "0".repeat(40) : sha(20_000 + index)),
  };
}

function changedObjectsOutput(entries) {
  const fields = [];
  for (const [index, entry] of entries.entries()) {
    const metadata = changedObjectMetadata(entry, index);
    fields.push(Buffer.from(
      `:${metadata.oldMode} ${metadata.newMode} ${metadata.oldOid} ${metadata.newOid} ${entry.status}`,
    ));
    fields.push(Buffer.from([0]));
    if (entry.oldPath) fields.push(Buffer.from(entry.oldPath), Buffer.from([0]));
    fields.push(Buffer.from(entry.path), Buffer.from([0]));
  }
  return Buffer.concat(fields);
}

function createFixture({
  commitSha,
  parents,
  filesByParent,
  diffsByPath = new Map(),
  author,
  message,
}) {
  const operations = [];
  return {
    operations,
    executor: {
      detail: async (_repository, operation, objectIds, pathspecs = []) => {
        operations.push({ operation, objectIds: [...objectIds], pathspecs: [...pathspecs] });
        if (operation === "commit-detail") {
          return result(detailOutput({ commitSha, parents, author, message }));
        }
        if (operation === "file-diff") {
          const diff = diffsByPath.get(pathspecs.join("\0")) ?? Buffer.alloc(0);
          return diff && typeof diff === "object" && "stdout" in diff
            ? diff
            : result(diff);
        }
        if (operation === "blob-exists") return result("");
        const parent = objectIds.length === 1 ? "root" : objectIds[0];
        const entries = filesByParent.get(parent) ?? [];
        if (operation === "changed-files") return result(changedFilesOutput(entries));
        if (operation === "changed-file-stats") return result(changedStatsOutput(entries));
        if (operation === "changed-file-objects") return result(changedObjectsOutput(entries));
        throw new Error(`Unexpected operation: ${operation}`);
      },
    },
  };
}

function binding(commitSha, parents) {
  return {
    sha: commitSha,
    parents: parents.map((parent) => ({ sha: parent, loaded: true })),
    refs: [
      {
        name: "main",
        fullName: "refs/heads/main",
        kind: "local-branch",
        checkedOut: true,
      },
      { name: "v1", fullName: "refs/tags/v1", kind: "tag", checkedOut: false },
    ],
  };
}

test("loads sanitized commit metadata and the first changed-file page", async () => {
  const commitSha = sha(10);
  const parents = [sha(9)];
  const files = [
    { status: "M", path: "README.md", additions: "3", deletions: "1" },
    {
      status: "R087",
      oldPath: "old name.txt",
      path: "new name.txt",
      additions: "2",
      deletions: "0",
    },
    { status: "M", path: "image.png", additions: "-", deletions: "-" },
  ];
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[parents[0], files]]),
    author: "Ada\u001b[31m Lovelace\u0007\u202eoverride",
    message: "<b>Plain</b> https://example.invalid\n\u001b[2JBody\u0001\r\u2066isolated\u2069\n",
  });
  const service = createCommitDetailService(
    fixture.executor,
    (value) => `local:${value}`,
  );

  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );

  assert.equal(detail.status, "ready");
  assert.match(detail.detailId, /^[0-9a-f]{64}$/);
  assert.equal(detail.sha, commitSha);
  assert.equal(
    detail.message,
    "<b>Plain</b> https://example.invalid\n�[2JBody���isolated�\n",
  );
  assert.equal(detail.authorName, "Ada�[31m Lovelace��override");
  assert.deepEqual(detail.authorDate, {
    recorded: "2026-07-13T09:10:11+09:00",
    local: "local:2026-07-13T09:10:11+09:00",
  });
  assert.deepEqual(detail.committerDate, {
    recorded: "2026-07-13T10:11:12-04:00",
    local: "local:2026-07-13T10:11:12-04:00",
  });
  assert.deepEqual(detail.parents, parents);
  assert.deepEqual(detail.refs, binding(commitSha, parents).refs);
  assert.equal(detail.selectedParentIndex, 0);
  assert.equal(detail.selectedParentSha, parents[0]);
  assert.deepEqual(detail.summary, {
    totalFiles: 3,
    additions: 5,
    deletions: 1,
    binaryFiles: 1,
  });
  assert.equal(detail.loadedFileCount, 3);
  assert.equal(detail.totalFileCount, 3);
  assert.equal(detail.hasMoreFiles, false);
  assert.deepEqual(
    detail.files.map(({ status, path, oldPath, additions, deletions }) => ({
      status,
      path,
      oldPath,
      additions,
      deletions,
    })),
    [
      {
        status: "modified",
        path: "README.md",
        oldPath: null,
        additions: 3,
        deletions: 1,
      },
      {
        status: "renamed",
        path: "new name.txt",
        oldPath: "old name.txt",
        additions: 2,
        deletions: 0,
      },
      {
        status: "modified",
        path: "image.png",
        oldPath: null,
        additions: null,
        deletions: null,
      },
    ],
  );
  assert.ok(detail.files.every((file) => /^[0-9a-f]{64}$/.test(file.fileId)));
  assert.equal(JSON.stringify(detail).includes("email"), false);
  assert.equal(fixture.operations.some(({ operation }) => operation === "file-diff"), false);
});

test("retries one timed-out rename-aware changed-file request with renames disabled", async () => {
  const commitSha = sha(70);
  const parents = [sha(69)];
  const fallbackFiles = [
    { status: "D", path: "old.txt", additions: "0", deletions: "1" },
    { status: "A", path: "new.txt", additions: "1", deletions: "0" },
  ];
  const operations = [];
  const executor = {
    detail: async (_repository, operation, objectIds, pathspecs = []) => {
      operations.push({ operation, objectIds: [...objectIds], pathspecs: [...pathspecs] });
      if (operation === "commit-detail") {
        return result(detailOutput({ commitSha, parents }));
      }
      if (["changed-files", "changed-file-stats", "changed-file-objects"].includes(operation)) {
        return timedOutResult("partial output that must be discarded");
      }
      if (operation === "changed-files-no-renames") {
        return result(changedFilesOutput(fallbackFiles));
      }
      if (operation === "changed-file-stats-no-renames") {
        return result(changedStatsOutput(fallbackFiles));
      }
      if (operation === "changed-file-objects-no-renames") {
        return result(changedObjectsOutput(fallbackFiles));
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  };
  const service = createCommitDetailService(executor, (value) => value);

  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "7".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );

  assert.equal(detail.status, "ready");
  assert.equal(detail.renameDetectionSkipped, true);
  assert.deepEqual(
    detail.files.map(({ status, path: filePath, oldPath }) => ({ status, path: filePath, oldPath })),
    [
      { status: "deleted", path: "old.txt", oldPath: null },
      { status: "added", path: "new.txt", oldPath: null },
    ],
  );
  assert.deepEqual(
    operations.map(({ operation }) => operation),
    [
      "commit-detail",
      "changed-files",
      "changed-file-stats",
      "changed-file-objects",
      "changed-files-no-renames",
      "changed-file-stats-no-renames",
      "changed-file-objects-no-renames",
    ],
  );
});

test("a double changed-file timeout keeps the last complete detail and exposes no partial list", async () => {
  const commitSha = sha(80);
  const parents = [sha(79)];
  const completeFiles = [
    { status: "M", path: "complete.txt", additions: "1", deletions: "1" },
  ];
  let failChangedFileReads = false;
  const executor = {
    detail: async (_repository, operation) => {
      if (operation === "commit-detail") {
        return result(detailOutput({ commitSha, parents }));
      }
      const fallback = operation.endsWith("-no-renames");
      if (failChangedFileReads) {
        return fallback
          ? timedOutResult("fallback partial output")
          : timedOutResult("rename partial output");
      }
      if (operation === "changed-files") return result(changedFilesOutput(completeFiles));
      if (operation === "changed-file-stats") return result(changedStatsOutput(completeFiles));
      if (operation === "changed-file-objects") return result(changedObjectsOutput(completeFiles));
      throw new Error(`Unexpected operation: ${operation}`);
    },
  };
  const service = createCommitDetailService(executor, (value) => value);
  const lastGood = await service.load(
    "/tmp/repository",
    { snapshotId: "8".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(lastGood.status, "ready");
  assert.equal(lastGood.renameDetectionSkipped, false);

  failChangedFileReads = true;
  const failed = await service.load(
    "/tmp/repository",
    { snapshotId: "9".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );

  assert.deepEqual(failed, {
    status: "error",
    message: "Changed-file request timed out",
    code: "changed-files-timeout",
  });
  assert.equal(service.current(), lastGood);
  assert.deepEqual(service.current().files.map(({ path: filePath }) => filePath), ["complete.txt"]);
});

test("keeps canonically distinct macOS Unicode paths distinct without normalization", async () => {
  const commitSha = sha(90);
  const parents = [sha(89)];
  const composed = "caf\u00e9.txt";
  const decomposed = "cafe\u0301.txt";
  const files = [
    { status: "A", path: Buffer.from(composed), additions: "1", deletions: "0" },
    { status: "A", path: Buffer.from(decomposed), additions: "1", deletions: "0" },
  ];
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[parents[0], files]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);

  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );

  assert.equal(detail.status, "ready");
  assert.deepEqual(detail.files.map(({ path: filePath }) => filePath), [composed, decomposed]);
  assert.notEqual(detail.files[0].path, detail.files[1].path);
  assert.equal(detail.files[0].path.normalize("NFD"), detail.files[1].path);
});

test("loads only the selected file's unified diff with old and new line numbers", async () => {
  const commitSha = sha(10);
  const parents = [sha(9)];
  const patch = [
    "diff --git a/README.md b/README.md",
    "index 1111111..2222222 100644",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -2,3 +2,4 @@ heading",
    " context",
    "-removed",
    "+added",
    "+another",
    " tail",
    "",
  ].join("\n");
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[
      parents[0],
      [{ status: "M", path: "README.md", additions: "2", deletions: "1" }],
    ]]),
    diffsByPath: new Map([["README.md", patch]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");

  const diff = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });

  assert.equal(diff.status, "ready");
  assert.equal(diff.detailId, detail.detailId);
  assert.equal(diff.fileId, detail.files[0].fileId);
  assert.equal(diff.path, "README.md");
  assert.deepEqual(diff.statistics, { additions: 2, deletions: 1 });
  assert.equal(diff.truncated, false);
  assert.equal(diff.truncatedBy, null);
  assert.deepEqual(
    diff.lines.slice(4).map(({ kind, content, oldLine, newLine }) => ({
      kind,
      content,
      oldLine,
      newLine,
    })),
    [
      { kind: "hunk", content: "@@ -2,3 +2,4 @@ heading", oldLine: null, newLine: null },
      { kind: "context", content: " context", oldLine: 2, newLine: 2 },
      { kind: "deletion", content: "-removed", oldLine: 3, newLine: null },
      { kind: "addition", content: "+added", oldLine: null, newLine: 3 },
      { kind: "addition", content: "+another", oldLine: null, newLine: 4 },
      { kind: "context", content: " tail", oldLine: 4, newLine: 5 },
    ],
  );
  assert.deepEqual(
    fixture.operations.filter(({ operation }) => operation === "file-diff"),
    [{
      operation: "file-diff",
      objectIds: [sha(10_000), sha(20_000)],
      pathspecs: ["README.md"],
    }],
  );
});

test("binary diff checks exact blob existence without reading blob content", async () => {
  const commitSha = sha(11);
  const parents = [sha(10)];
  const file = {
    status: "M",
    path: "image.png",
    additions: "-",
    deletions: "-",
    oldOid: sha(31_101),
    newOid: sha(31_102),
  };
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[parents[0], [file]]]),
    diffsByPath: new Map([["image.png", "+SECRET_BINARY_CONTENT\n"]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "b".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");

  const diff = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });

  assert.equal(diff.status, "ready");
  assert.deepEqual(diff.statistics, { additions: null, deletions: null });
  assert.match(
    diff.lines.map(({ content }) => content).join("\n"),
    /Binary files a\/image\.png and b\/image\.png differ/,
  );
  assert.equal(
    diff.lines.some(({ kind }) => ["hunk", "context", "addition", "deletion"].includes(kind)),
    false,
  );
  assert.equal(JSON.stringify(diff).includes("SECRET_BINARY_CONTENT"), false);
  assert.deepEqual(
    fixture.operations.filter(({ operation }) => operation === "blob-exists"),
    [file.oldOid, file.newOid].map((objectId) => ({
      operation: "blob-exists",
      objectIds: [objectId],
      pathspecs: [],
    })),
  );
  assert.deepEqual(
    fixture.operations.filter(({ operation }) => operation === "file-diff"),
    [],
  );
});

test("keeps invalid filename bytes display-safe while selecting its exact blob pair", async () => {
  const commitSha = sha(12);
  const parents = [sha(11)];
  const invalidPath = Buffer.concat([
    Buffer.from("invalid-"),
    Buffer.from([0xff]),
    Buffer.from(".txt"),
  ]);
  const files = [{
    status: "M",
    path: invalidPath,
    additions: "1",
    deletions: "1",
    oldOid: sha(31_001),
    newOid: sha(31_002),
  }];
  const patch = [
    `diff --git a/${files[0].oldOid} b/${files[0].newOid}`,
    `index ${files[0].oldOid}..${files[0].newOid} 100644`,
    `--- a/${files[0].oldOid}`,
    `+++ b/${files[0].newOid}`,
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "",
  ].join("\n");
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[parents[0], files]]),
    diffsByPath: new Map([["invalid-\\xFF.txt", patch]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "f".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");
  assert.equal(detail.files[0].path, "invalid-\\xFF.txt");

  const diff = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });
  assert.equal(diff.status, "ready");
  assert.ok(diff.lines.some(({ content }) => content === "+after"));
  assert.deepEqual(
    fixture.operations.filter(({ operation }) => operation === "file-diff"),
    [{
      operation: "file-diff",
      objectIds: [files[0].oldOid, files[0].newOid],
      pathspecs: ["invalid-\\xFF.txt"],
    }],
  );
});

test("caps a selected file diff at 20,000 lines and retains its original statistics", async () => {
  const commitSha = sha(20);
  const parents = [sha(19)];
  const patch = [
    "diff --git a/many.txt b/many.txt",
    "--- a/many.txt",
    "+++ b/many.txt",
    "@@ -0,0 +1,20001 @@",
    ...Array.from({ length: 20_001 }, (_, index) => `+${index}`),
    "",
  ].join("\n");
  assert.ok(Buffer.byteLength(patch) < 1024 * 1024);
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[
      parents[0],
      [{ status: "M", path: "many.txt", additions: "20001", deletions: "0" }],
    ]]),
    diffsByPath: new Map([["many.txt", patch]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "b".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");

  const diff = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });

  assert.equal(diff.status, "ready");
  assert.equal(diff.truncated, true);
  assert.equal(diff.truncatedBy, "lines");
  assert.equal(diff.lineCount, 20_000);
  assert.equal(diff.lines.length, 20_000);
  assert.deepEqual(diff.statistics, { additions: 20_001, deletions: 0 });
});

test("caps a selected file diff at 1 MiB before the line limit", async () => {
  const commitSha = sha(30);
  const parents = [sha(29)];
  const patch = [
    "diff --git a/large.txt b/large.txt",
    "--- a/large.txt",
    "+++ b/large.txt",
    "@@ -0,0 +1,12000 @@",
    ...Array.from({ length: 12_000 }, (_, index) =>
      `+${String(index).padStart(5, "0")}:${"x".repeat(90)}`
    ),
    "",
  ].join("\n");
  assert.ok(Buffer.byteLength(patch) > 1024 * 1024);
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[
      parents[0],
      [{ status: "M", path: "large.txt", additions: "12000", deletions: "0" }],
    ]]),
    diffsByPath: new Map([["large.txt", patch]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "c".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");

  const diff = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });

  assert.equal(diff.status, "ready");
  assert.equal(diff.truncated, true);
  assert.equal(diff.truncatedBy, "bytes");
  assert.ok(diff.bytes <= 1024 * 1024);
  assert.ok(diff.lineCount < 20_000);
  assert.deepEqual(diff.statistics, { additions: 12_000, deletions: 0 });
});

test("preserves whitespace, CRLF markers, multiple hunk numbering, and empty-file headers", async () => {
  const commitSha = sha(40);
  const parents = [sha(39)];
  const whitespacePatch = Buffer.from(
    "diff --git a/space.txt b/space.txt\n" +
      "--- a/space.txt\n" +
      "+++ b/space.txt\n" +
      "@@ -1,2 +1,2 @@\n" +
      "-old \tvalue\r\n" +
      "+old\tvalue \r\n" +
      " unchanged\r\n" +
      "@@ -10 +10 @@\n" +
      "-later\r\n" +
      "+later \r\n",
  );
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[
      parents[0],
      [
        { status: "M", path: "space.txt", additions: "2", deletions: "2" },
        { status: "A", path: "empty.txt", additions: "0", deletions: "0" },
      ],
    ]]),
    diffsByPath: new Map([
      ["space.txt", whitespacePatch],
      ["empty.txt", Buffer.alloc(0)],
    ]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "d".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");

  const whitespace = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });
  assert.equal(whitespace.status, "ready");
  assert.deepEqual(
    whitespace.lines.filter(({ kind }) => ["deletion", "addition", "context"].includes(kind))
      .map(({ content, oldLine, newLine }) => ({ content, oldLine, newLine })),
    [
      { content: "-old \tvalue\r", oldLine: 1, newLine: null },
      { content: "+old\tvalue \r", oldLine: null, newLine: 1 },
      { content: " unchanged\r", oldLine: 2, newLine: 2 },
      { content: "-later\r", oldLine: 10, newLine: null },
      { content: "+later \r", oldLine: null, newLine: 10 },
    ],
  );

  const empty = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[1].fileId,
  });
  assert.equal(empty.status, "ready");
  assert.ok(empty.lines.length > 0);
  assert.ok(empty.lines.every(({ kind }) => kind === "header"));
  assert.deepEqual(empty.statistics, { additions: 0, deletions: 0 });
});

test("a file diff error identifies the selected file and keeps the last good detail", async () => {
  const commitSha = sha(50);
  const parents = [sha(49)];
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[
      parents[0],
      [{ status: "M", path: "broken.txt", additions: "1", deletions: "1" }],
    ]]),
    diffsByPath: new Map([["broken.txt", result(Buffer.alloc(0), 1)]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "e".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");

  const diff = await service.loadDiff("/tmp/repository", {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });

  assert.deepEqual(diff, {
    status: "error",
    message: "File diff is unavailable",
    code: "file-diff-read-failed",
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
    path: "broken.txt",
  });
  assert.equal(service.current(), detail);
  assert.equal("lines" in diff, false);
});

test("missing and corrupt selected blobs have distinct safe diff errors", async () => {
  const commitSha = sha(55);
  const parents = [sha(54)];
  const cases = [
    {
      stderr: `fatal: bad object ${sha(99)}\n`,
      message: "Repository object is missing",
      code: "missing-object",
    },
    {
      stderr: "error: object file .git/objects/aa/bb is corrupt\n",
      message: "Repository object is corrupt",
      code: "corrupt-object",
    },
  ];

  for (const item of cases) {
    const fixture = createFixture({
      commitSha,
      parents,
      filesByParent: new Map([[
        parents[0],
        [{ status: "M", path: "unavailable.txt", additions: "1", deletions: "1" }],
      ]]),
      diffsByPath: new Map([[
        "unavailable.txt",
        result(Buffer.alloc(0), 128, item.stderr),
      ]]),
    });
    const service = createCommitDetailService(fixture.executor, (value) => value);
    const detail = await service.load(
      "/tmp/repository",
      { snapshotId: "f".repeat(64), parentIndex: 0 },
      binding(commitSha, parents),
    );
    assert.equal(detail.status, "ready");

    assert.deepEqual(
      await service.loadDiff("/tmp/repository", {
        detailId: detail.detailId,
        fileId: detail.files[0].fileId,
      }),
      {
        status: "error",
        message: item.message,
        code: item.code,
        detailId: detail.detailId,
        fileId: detail.files[0].fileId,
        path: "unavailable.txt",
      },
    );
  }
});

test("uses root comparison and exposes no parent selector for a root commit", async () => {
  const commitSha = sha(1);
  const files = [{ status: "A", path: "root.txt", additions: "1", deletions: "0" }];
  const fixture = createFixture({
    commitSha,
    parents: [],
    filesByParent: new Map([["root", files]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);

  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, []),
  );

  assert.equal(detail.status, "ready");
  assert.equal(detail.selectedParentIndex, null);
  assert.equal(detail.selectedParentSha, null);
  assert.deepEqual(detail.files.map((file) => file.path), ["root.txt"]);
  assert.deepEqual(
    fixture.operations.filter(({ operation }) => operation === "changed-files")[0].objectIds,
    [commitSha],
  );
});

test("a two-parent merge defaults to parent 1 and compares each parent separately", async () => {
  const commitSha = sha(10);
  const parents = [sha(8), sha(9)];
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([
      [parents[0], [{ status: "M", path: "from-first.txt", additions: "2", deletions: "0" }]],
      [parents[1], [{ status: "M", path: "from-second.txt", additions: "0", deletions: "3" }]],
    ]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);

  const first = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  const second = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 1 },
    binding(commitSha, parents),
  );

  assert.equal(first.status, "ready");
  assert.equal(first.selectedParentIndex, 0);
  assert.equal(first.selectedParentSha, parents[0]);
  assert.deepEqual(first.files.map((file) => file.path), ["from-first.txt"]);
  assert.equal(second.status, "ready");
  assert.equal(second.selectedParentIndex, 1);
  assert.equal(second.selectedParentSha, parents[1]);
  assert.deepEqual(second.files.map((file) => file.path), ["from-second.txt"]);
  assert.deepEqual(
    fixture.operations
      .filter(({ operation }) => operation === "changed-files")
      .map(({ objectIds }) => objectIds),
    [
      [parents[0], commitSha],
      [parents[1], commitSha],
    ],
  );
  assert.ok(
    fixture.operations
      .filter(({ operation }) => operation === "changed-file-stats")
      .every(({ objectIds }) => objectIds.length === 2),
  );
});

test("switching an octopus parent atomically replaces and resets the file snapshot", async () => {
  const commitSha = sha(20);
  const parents = [sha(11), sha(12), sha(13), sha(14)];
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([
      [parents[0], [{ status: "M", path: "first.txt", additions: "1", deletions: "0" }]],
      [parents[2], [{ status: "M", path: "third.txt", additions: "0", deletions: "2" }]],
    ]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);

  const first = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  const third = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 2 },
    binding(commitSha, parents),
  );

  assert.equal(first.status, "ready");
  assert.equal(third.status, "ready");
  assert.notEqual(third.detailId, first.detailId);
  assert.equal(third.selectedParentIndex, 2);
  assert.equal(third.selectedParentSha, parents[2]);
  assert.equal(third.loadedFileCount, 1);
  assert.deepEqual(third.files.map((file) => file.path), ["third.txt"]);
});

test("paginates 1,001 changed files without duplicate or missing boundaries", async () => {
  const commitSha = sha(2_000);
  const parents = [sha(1_999)];
  const files = Array.from({ length: 1_001 }, (_, index) => ({
    status: "M",
    path: `${String(index).padStart(4, "0")}.txt`,
    additions: "1",
    deletions: "0",
  }));
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[parents[0], files]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);
  const first = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(first.status, "ready");
  assert.equal(first.loadedFileCount, 500);
  assert.equal(first.hasMoreFiles, true);

  const second = await service.loadMoreFiles("/tmp/repository", {
    detailId: first.detailId,
    loadedCount: first.loadedFileCount,
    lastFileId: first.files.at(-1).fileId,
  });
  assert.equal(second.status, "ready");
  assert.equal(second.files.length, 500);
  assert.equal(second.previousLoadedCount, 500);

  const current = service.current();
  assert.equal(current.status, "ready");
  const third = await service.loadMoreFiles("/tmp/repository", {
    detailId: current.detailId,
    loadedCount: current.loadedFileCount,
    lastFileId: current.files.at(-1).fileId,
  });
  assert.equal(third.status, "ready");
  assert.equal(third.files.length, 1);
  assert.equal(third.hasMoreFiles, false);

  const final = service.current();
  const paths = final.files.map((file) => file.path);
  assert.deepEqual(paths, files.map((file) => file.path));
  assert.equal(new Set(final.files.map((file) => file.fileId)).size, 1_001);
});

test("rejects stale parent and page boundaries while keeping the last good detail", async () => {
  const commitSha = sha(50);
  const parents = [sha(49)];
  const fixture = createFixture({
    commitSha,
    parents,
    filesByParent: new Map([[parents[0], [{ status: "M", path: "one", additions: "1", deletions: "1" }]]]),
  });
  const service = createCommitDetailService(fixture.executor, (value) => value);

  const invalidParent = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 4 },
    binding(commitSha, parents),
  );
  assert.equal(invalidParent.status, "error");

  const detail = await service.load(
    "/tmp/repository",
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(commitSha, parents),
  );
  assert.equal(detail.status, "ready");
  const stale = await service.loadMoreFiles("/tmp/repository", {
    detailId: "f".repeat(64),
    loadedCount: detail.loadedFileCount,
    lastFileId: detail.files.at(-1).fileId,
  });
  assert.deepEqual(stale, {
    status: "error",
    message: "Changed-file page boundary is invalid",
    code: "invalid-file-page-boundary",
  });
  assert.equal(service.current().detailId, detail.detailId);
});

test("system Git parses a root addition and a rename as complete changed-file entries", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-commit-detail-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);
  const oldPath = path.join(repository, "old name.txt");
  const newPath = path.join(repository, "new name.txt");
  await writeFile(oldPath, "one\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "old name.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "root"]);
  const rootSha = (await execFile("/usr/bin/git", ["-C", repository, "rev-parse", "HEAD"]))
    .stdout.trim();

  await rename(oldPath, newPath);
  await writeFile(newPath, "one\ntwo\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "-A", "--"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "rename"]);
  const renameSha = (await execFile("/usr/bin/git", ["-C", repository, "rev-parse", "HEAD"]))
    .stdout.trim();
  const service = createCommitDetailService(undefined, (value) => value);

  const root = await service.load(
    repository,
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(rootSha, []),
  );
  assert.equal(root.status, "ready");
  assert.deepEqual(
    root.files.map(({ status, path: filePath, oldPath: previousPath }) => ({
      status,
      path: filePath,
      oldPath: previousPath,
    })),
    [{ status: "added", path: "old name.txt", oldPath: null }],
  );

  const renamed = await service.load(
    repository,
    { snapshotId: "a".repeat(64), parentIndex: 0 },
    binding(renameSha, [rootSha]),
  );
  assert.equal(renamed.status, "ready");
  assert.deepEqual(
    renamed.files.map(({ status, path: filePath, oldPath: previousPath }) => ({
      status,
      path: filePath,
      oldPath: previousPath,
    })),
    [{ status: "renamed", path: "new name.txt", oldPath: "old name.txt" }],
  );
});

test("system Git distinguishes missing and corrupt one-sided blobs", async () => {
  const cases = [
    { transition: "added", damage: "missing" },
    { transition: "deleted", damage: "missing" },
    { transition: "deleted", damage: "corrupt" },
  ];

  for (const item of cases) {
    const repository = await mkdtemp(path.join(tmpdir(), "gitright-damaged-blob-"));
    await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
    await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
    await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(repository, "fixture.txt"), "fixture\n");
    await execFile("/usr/bin/git", ["-C", repository, "add", "--", "fixture.txt"]);
    await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "add fixture"]);
    const addedSha = (await execFile(
      "/usr/bin/git",
      ["-C", repository, "rev-parse", "HEAD"],
    )).stdout.trim();
    const blobSha = (await execFile(
      "/usr/bin/git",
      ["-C", repository, "rev-parse", `${addedSha}:fixture.txt`],
    )).stdout.trim();

    let commitSha = addedSha;
    let parents = [];
    if (item.transition === "deleted") {
      await execFile("/usr/bin/git", ["-C", repository, "rm", "-q", "--", "fixture.txt"]);
      await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "delete fixture"]);
      commitSha = (await execFile(
        "/usr/bin/git",
        ["-C", repository, "rev-parse", "HEAD"],
      )).stdout.trim();
      parents = [addedSha];
    }

    const loadedService = createCommitDetailService(undefined, (value) => value);
    const loaded = await loadedService.load(
      repository,
      { snapshotId: "d".repeat(64), parentIndex: 0 },
      binding(commitSha, parents),
    );
    assert.equal(loaded.status, "ready");
    assert.equal(loaded.files.length, 1);

    const objectPath = path.join(
      repository,
      ".git",
      "objects",
      blobSha.slice(0, 2),
      blobSha.slice(2),
    );
    if (item.damage === "missing") {
      await unlink(objectPath);
    } else {
      await chmod(objectPath, 0o644);
      await writeFile(objectPath, "not a Git object");
    }
    const expectedMessage = item.damage === "missing"
      ? "Repository object is missing"
      : "Repository object is corrupt";
    const expectedCode = item.damage === "missing" ? "missing-object" : "corrupt-object";

    const failedService = createCommitDetailService(undefined, (value) => value);
    const failedLoad = await failedService.load(
      repository,
      { snapshotId: "e".repeat(64), parentIndex: 0 },
      binding(commitSha, parents),
    );
    if (item.transition === "deleted") {
      assert.deepEqual(failedLoad, {
        status: "error",
        message: expectedMessage,
        code: expectedCode,
      });
    } else {
      assert.equal(failedLoad.status, "ready");
      const missingBinaryDiff = await failedService.loadDiff(repository, {
        detailId: failedLoad.detailId,
        fileId: failedLoad.files[0].fileId,
      });
      assert.deepEqual(missingBinaryDiff, {
        status: "error",
        message: expectedMessage,
        code: expectedCode,
        detailId: failedLoad.detailId,
        fileId: failedLoad.files[0].fileId,
        path: "fixture.txt",
      });
    }

    const failedDiff = await loadedService.loadDiff(repository, {
      detailId: loaded.detailId,
      fileId: loaded.files[0].fileId,
    });
    assert.deepEqual(failedDiff, {
      status: "error",
      message: expectedMessage,
      code: expectedCode,
      detailId: loaded.detailId,
      fileId: loaded.files[0].fileId,
      path: "fixture.txt",
    });
  }
});

test("system Git selects literal pathspec-looking and invalid-byte filenames exactly", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-exact-file-diff-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);

  const fixtures = [
    [path.join(repository, "*.txt"), "literal-star"],
    [path.join(repository, "ordinary.txt"), "ordinary-star-match"],
    [path.join(repository, ":(glob)*.md"), "literal-magic"],
    [path.join(repository, "ordinary.md"), "ordinary-magic-match"],
    [path.join(repository, "quote-\"-apostrophe-'-backslash-\\.txt"), "literal-quotes"],
    [path.join(repository, "line\nbreak-tab\t.txt"), "literal-controls"],
  ];
  if (process.platform !== "darwin") {
    fixtures.push([
      Buffer.concat([
        Buffer.from(`${repository}/invalid-`),
        Buffer.from([0xff]),
        Buffer.from(".txt"),
      ]),
      "invalid-byte",
    ]);
  }
  for (const [filePath, marker] of fixtures) {
    await writeFile(filePath, `${marker}-before\n`);
  }
  await execFile("/usr/bin/git", ["-C", repository, "add", "-A", "--"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "base"]);
  const parentSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  for (const [filePath, marker] of fixtures) {
    await writeFile(filePath, `${marker}-after\n`);
  }
  await execFile("/usr/bin/git", ["-C", repository, "add", "-A", "--"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "change"]);
  const commitSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  const service = createCommitDetailService(undefined, (value) => value);
  const detail = await service.load(
    repository,
    { snapshotId: "e".repeat(64), parentIndex: 0 },
    binding(commitSha, [parentSha]),
  );
  assert.equal(detail.status, "ready");

  const selections = [
    ["*.txt", "literal-star-after", "ordinary-star-match-after"],
    [":(glob)*.md", "literal-magic-after", "ordinary-magic-match-after"],
    ["quote-\"-apostrophe-'-backslash-\\.txt", "literal-quotes-after", "ordinary-star-match-after"],
    ["line�break-tab�.txt", "literal-controls-after", "ordinary-star-match-after"],
  ];
  if (process.platform !== "darwin") {
    assert.ok(detail.files.some(({ path: filePath }) => filePath === "invalid-\\xFF.txt"));
    selections.push([
      "invalid-\\xFF.txt",
      "invalid-byte-after",
      "ordinary-star-match-after",
    ]);
  }
  for (const [selectedPath, selectedMarker, excludedMarker] of selections) {
    const file = detail.files.find(({ path: filePath }) => filePath === selectedPath);
    assert.ok(file, `missing changed file ${selectedPath}`);
    const diff = await service.loadDiff(repository, {
      detailId: detail.detailId,
      fileId: file.fileId,
    });
    assert.equal(diff.status, "ready");
    const rendered = diff.lines.map(({ content }) => content).join("\n");
    assert.match(rendered, new RegExp(selectedMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(
      rendered,
      new RegExp(excludedMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});

test("system Git renders symlink targets as plain text without following either target", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-symlink-diff-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "first-target.txt"), "FIRST TARGET SECRET\n");
  await writeFile(path.join(repository, "second-target.txt"), "SECOND TARGET SECRET\n");
  await symlink("first-target.txt", path.join(repository, "link.txt"));
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "link.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "first link"]);
  const parentSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await unlink(path.join(repository, "link.txt"));
  await symlink("second-target.txt", path.join(repository, "link.txt"));
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "link.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "second link"]);
  const commitSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  const service = createCommitDetailService(undefined, (value) => value);
  const detail = await service.load(
    repository,
    { snapshotId: "b".repeat(64), parentIndex: 0 },
    binding(commitSha, [parentSha]),
  );
  assert.equal(detail.status, "ready");
  const link = detail.files.find(({ path: filePath }) => filePath === "link.txt");
  assert.ok(link);

  const diff = await service.loadDiff(repository, {
    detailId: detail.detailId,
    fileId: link.fileId,
  });
  assert.equal(diff.status, "ready");
  const rendered = diff.lines.map(({ content }) => content).join("\n");
  assert.match(rendered, /first-target\.txt/);
  assert.match(rendered, /second-target\.txt/);
  assert.doesNotMatch(rendered, /FIRST TARGET SECRET|SECOND TARGET SECRET/);
});

test("system Git shows only object IDs for gitlink add, update, delete, and type transitions", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-gitlink-diff-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);

  const targetPath = path.join(repository, "secret.txt");
  await writeFile(targetPath, "secret-before\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "secret.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "target old"]);
  const oldTarget = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await writeFile(targetPath, "secret-after\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "secret.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "target new"]);
  const newTarget = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await execFile("/usr/bin/git", ["-C", repository, "rm", "-q", "--", "secret.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "plain"]);
  const plain = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await execFile("/usr/bin/git", [
    "-C", repository, "update-index", "--add", "--cacheinfo", `160000,${oldTarget},vendor`,
  ]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "gitlink add"]);
  const added = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await execFile("/usr/bin/git", [
    "-C", repository, "update-index", "--cacheinfo", `160000,${newTarget},vendor`,
  ]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "gitlink update"]);
  const updated = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await execFile("/usr/bin/git", ["-C", repository, "rm", "--cached", "-q", "--", "vendor"]);
  await writeFile(path.join(repository, "vendor"), "regular-file\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "vendor"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "gitlink to file"]);
  const changedToFile = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();
  const regularBlob = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", `${changedToFile}:vendor`],
  )).stdout.trim();

  await execFile("/usr/bin/git", [
    "-C", repository, "update-index", "--add", "--cacheinfo", `160000,${oldTarget},vendor`,
  ]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "file to gitlink"]);
  const changedToGitlink = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await execFile("/usr/bin/git", ["-C", repository, "update-index", "--force-remove", "vendor"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "gitlink delete"]);
  const deleted = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  const zero = "0".repeat(40);
  const cases = [
    { parent: plain, commit: added, oldOid: zero, newOid: oldTarget },
    { parent: added, commit: updated, oldOid: oldTarget, newOid: newTarget },
    { parent: updated, commit: changedToFile, oldOid: newTarget, newOid: regularBlob },
    { parent: changedToFile, commit: changedToGitlink, oldOid: regularBlob, newOid: oldTarget },
    { parent: changedToGitlink, commit: deleted, oldOid: oldTarget, newOid: zero },
  ];
  const service = createCommitDetailService(undefined, (value) => value);
  for (const [index, fixture] of cases.entries()) {
    const detail = await service.load(
      repository,
      { snapshotId: String(index + 1).repeat(64), parentIndex: 0 },
      binding(fixture.commit, [fixture.parent]),
    );
    assert.equal(detail.status, "ready");
    const file = detail.files.find(({ path: filePath }) => filePath === "vendor");
    assert.ok(file);
    const diff = await service.loadDiff(repository, {
      detailId: detail.detailId,
      fileId: file.fileId,
    });
    assert.equal(diff.status, "ready");
    const rendered = diff.lines.map(({ content }) => content).join("\n");
    assert.match(rendered, new RegExp(fixture.oldOid));
    assert.match(rendered, new RegExp(fixture.newOid));
    assert.doesNotMatch(rendered, /secret-before|secret-after|regular-file|^@@/m);
  }
});

test("system Git preserves commit-path text classification for a NUL-bearing blob", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-forced-text-diff-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, ".gitattributes"), "forced.dat diff\n");
  await writeFile(
    path.join(repository, "forced.dat"),
    Buffer.from("before\0value\ncontext\n"),
  );
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", ".gitattributes", "forced.dat"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "base"]);
  const parentSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  await writeFile(
    path.join(repository, "forced.dat"),
    Buffer.from("after\0value\ncontext\n"),
  );
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "forced.dat"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "change"]);
  const commitSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();

  const service = createCommitDetailService(undefined, (value) => value);
  const detail = await service.load(
    repository,
    { snapshotId: "9".repeat(64), parentIndex: 0 },
    binding(commitSha, [parentSha]),
  );
  assert.equal(detail.status, "ready");
  const file = detail.files.find(({ path: filePath }) => filePath === "forced.dat");
  assert.ok(file);
  assert.deepEqual(
    { additions: file.additions, deletions: file.deletions },
    { additions: 1, deletions: 1 },
  );

  const diff = await service.loadDiff(repository, {
    detailId: detail.detailId,
    fileId: file.fileId,
  });
  assert.equal(diff.status, "ready");
  assert.ok(diff.lines.some(({ kind }) => kind === "hunk"));
  assert.ok(diff.lines.some(({ kind, content }) =>
    kind === "deletion" && content.includes("before\0value")
  ));
  assert.ok(diff.lines.some(({ kind, content }) =>
    kind === "addition" && content.includes("after\0value")
  ));
  assert.ok(diff.lines.some(({ kind, content }) =>
    kind === "context" && content === " context"
  ));
});

test("system Git stops a selected large file diff at 1 MiB without changing the repository", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-large-file-diff-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.name", "GitRight Test"]);
  await execFile("/usr/bin/git", ["-C", repository, "config", "user.email", "test@example.invalid"]);
  const filePath = path.join(repository, "large.txt");
  await writeFile(filePath, "base\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "large.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "base"]);
  const parentSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();
  const largeContents = Array.from({ length: 12_000 }, (_, index) =>
    `${String(index).padStart(5, "0")}:${"x".repeat(90)}\n`
  ).join("");
  await writeFile(filePath, largeContents);
  await execFile("/usr/bin/git", ["-C", repository, "add", "--", "large.txt"]);
  await execFile("/usr/bin/git", ["-C", repository, "commit", "-q", "-m", "large"]);
  const commitSha = (await execFile(
    "/usr/bin/git",
    ["-C", repository, "rev-parse", "HEAD"],
  )).stdout.trim();
  const service = createCommitDetailService(undefined, (value) => value);
  const detail = await service.load(
    repository,
    { snapshotId: "f".repeat(64), parentIndex: 0 },
    binding(commitSha, [parentSha]),
  );
  assert.equal(detail.status, "ready");

  const diff = await service.loadDiff(repository, {
    detailId: detail.detailId,
    fileId: detail.files[0].fileId,
  });

  assert.equal(diff.status, "ready");
  assert.equal(diff.truncated, true);
  assert.equal(diff.truncatedBy, "bytes");
  assert.ok(diff.bytes <= 1024 * 1024);
  assert.ok(diff.lines.some(({ kind }) => kind === "addition"));
  assert.equal(
    (await execFile("/usr/bin/git", ["-C", repository, "status", "--porcelain=v1"])).stdout,
    "",
  );
});
