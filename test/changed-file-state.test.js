import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendChangedFilePage,
  searchLoadedChangedFiles,
} from "../plugins/gitright/widget/changed-file-state.ts";

function file(value, overrides = {}) {
  return {
    fileId: value.toString(16).padStart(64, "0"),
    status: "modified",
    path: `${value}.txt`,
    oldPath: null,
    additions: 1,
    deletions: 0,
    ...overrides,
  };
}

function detail(files) {
  return {
    detailId: "a".repeat(64),
    loadedFileCount: files.length,
    totalFileCount: 4,
    hasMoreFiles: true,
    files,
  };
}

test("appends a valid file page without replacing loaded entries", () => {
  const first = file(1);
  const second = file(2);
  const current = detail([first, second]);
  const result = appendChangedFilePage(current, {
    status: "ready",
    detailId: current.detailId,
    previousLoadedCount: 2,
    previousLastFileId: second.fileId,
    loadedCount: 4,
    totalCount: 4,
    pageSize: 500,
    hasMoreFiles: false,
    files: [file(3), file(4)],
  });

  assert.equal(result.status, "ready");
  assert.equal(result.detail.files[0], first);
  assert.equal(result.detail.files[1], second);
  assert.equal(result.detail.loadedFileCount, 4);
  assert.equal(result.detail.hasMoreFiles, false);
});

test("duplicate and stale file pages preserve the last good detail", () => {
  const current = detail([file(1), file(2)]);
  const base = {
    status: "ready",
    detailId: current.detailId,
    previousLoadedCount: 2,
    previousLastFileId: current.files.at(-1).fileId,
    loadedCount: 3,
    totalCount: 4,
    pageSize: 500,
    hasMoreFiles: true,
    files: [file(3)],
  };
  for (const page of [
    { ...base, detailId: "b".repeat(64) },
    { ...base, previousLoadedCount: 1 },
    { ...base, previousLastFileId: file(99).fileId },
    { ...base, files: [file(2)] },
  ]) {
    assert.deepEqual(appendChangedFilePage(current, page), {
      status: "error",
      message: "Changed-file page boundary is invalid",
      detail: current,
    });
  }
});

test("search covers only loaded new paths, old rename paths, and statuses", () => {
  const files = [
    file(1, { path: "src/current.ts" }),
    file(2, { status: "renamed", oldPath: "legacy/name.ts", path: "src/name.ts" }),
    file(3, { status: "deleted", path: "docs/removed.md" }),
  ];

  assert.deepEqual(searchLoadedChangedFiles(files, "CURRENT"), [files[0]]);
  assert.deepEqual(searchLoadedChangedFiles(files, "legacy"), [files[1]]);
  assert.deepEqual(searchLoadedChangedFiles(files, "deleted"), [files[2]]);
  assert.deepEqual(searchLoadedChangedFiles(files, "unloaded"), []);
});
