import { createHash } from "node:crypto";

import {
  classifyGitFailure,
  type GitResult,
  type RepositoryOperation,
  systemGitExecutor,
} from "./repository-binding.ts";
import type { HistoryCommit, HistoryRef } from "./history-service.ts";

type DetailOperation = Extract<
  RepositoryOperation,
  | "commit-detail"
  | "changed-files"
  | "changed-file-stats"
  | "changed-file-objects"
  | "changed-files-no-renames"
  | "changed-file-stats-no-renames"
  | "changed-file-objects-no-renames"
  | "blob-exists"
  | "file-diff"
>;

export type CommitDetailExecutor = {
  detail: (
    repository: string,
    operation: DetailOperation,
    objectIds: readonly string[],
    pathspecs?: readonly string[],
  ) => Promise<GitResult>;
};

const systemCommitDetailExecutor: CommitDetailExecutor = {
  detail: (repository, operation, objectIds, pathspecs) =>
    systemGitExecutor.repository(repository, operation, objectIds, pathspecs),
};

export type CommitDate = {
  recorded: string;
  local: string;
};

export type ChangedFile = {
  fileId: string;
  status: "added" | "modified" | "deleted" | "renamed" | "type-changed" | "unknown";
  path: string;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
};

export type ReadyCommitDetail = {
  status: "ready";
  detailId: string;
  snapshotId: string;
  sha: string;
  message: string;
  authorName: string;
  authorDate: CommitDate;
  committerDate: CommitDate;
  parents: string[];
  refs: HistoryRef[];
  selectedParentIndex: number | null;
  selectedParentSha: string | null;
  summary: {
    totalFiles: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
  loadedFileCount: number;
  totalFileCount: number;
  filePageSize: 500;
  hasMoreFiles: boolean;
  renameDetectionSkipped: boolean;
  files: ChangedFile[];
};

export type CommitDetailError = {
  status: "error";
  message:
    | "Commit detail is unavailable"
    | "Commit detail request is stale"
    | "Changed-file request timed out"
    | "Changed-file page boundary is invalid"
    | "Repository is temporarily locked — Refresh to retry"
    | "Repository object is missing"
    | "Repository object is corrupt";
  code: string;
};

export type ChangedFilePage = {
  status: "ready";
  detailId: string;
  previousLoadedCount: number;
  previousLastFileId: string | null;
  loadedCount: number;
  totalCount: number;
  pageSize: 500;
  hasMoreFiles: boolean;
  files: ChangedFile[];
};

type CommitDetailRequest = {
  snapshotId: string;
  parentIndex: number;
};

export type ChangedFilePageRequest = {
  detailId: string;
  loadedCount: number;
  lastFileId: string | null;
};

export type FileDiffRequest = {
  detailId: string;
  fileId: string;
};

export type FileDiffLine = {
  kind: "header" | "hunk" | "context" | "addition" | "deletion" | "meta";
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

export type ReadyFileDiff = {
  status: "ready";
  detailId: string;
  fileId: string;
  path: string;
  oldPath: string | null;
  statistics: { additions: number | null; deletions: number | null };
  bytes: number;
  lineCount: number;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
  lines: FileDiffLine[];
};

export type FileDiffError = {
  status: "error";
  message:
    | "File diff is unavailable"
    | "File diff request is stale"
    | "Repository is temporarily locked — Refresh to retry"
    | "Repository object is missing"
    | "Repository object is corrupt";
  code: string;
  detailId: string;
  fileId: string;
  path: string | null;
};

type ParsedDetail = {
  sha: string;
  parents: string[];
  authorName: string;
  authorDate: string;
  committerDate: string;
  message: string;
};

type RawChangedFile = {
  status: string;
  path: Buffer;
  oldPath: Buffer | null;
};

type RawChangedStat = {
  path: Buffer;
  oldPath: Buffer | null;
  additions: number | null;
  deletions: number | null;
};

type RawChangedObject = RawChangedFile & {
  oldMode: string;
  newMode: string;
  oldOid: string;
  newOid: string;
};

type ActiveDetail = {
  repository: string;
  detail: ReadyCommitDetail;
  allFiles: ChangedFile[];
  rawFiles: RawChangedObject[];
};

const completeObjectId = /^[0-9a-f]{40}$/;
const opaqueId = /^[0-9a-f]{64}$/;
const strictGitDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const unsafeDirectionalControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\ufff9-\ufffb]/g;
const maximumChangedFiles = 100_000;
const maximumDiffBytes = 1024 * 1024;
const maximumDiffLines = 20_000;

function successfulOutput(result: GitResult): Buffer | null {
  return result.status === 0 && result.signal === null && !result.timedOut
    ? result.stdout
    : null;
}

function failure(
  code: string,
  message: CommitDetailError["message"] = "Commit detail is unavailable",
): CommitDetailError {
  return { status: "error", message, code };
}

function gitReadFailure(result: GitResult, fallbackCode: string): CommitDetailError {
  const kind = classifyGitFailure(result);
  if (kind === "transient-lock") {
    return failure(
      "transient-lock-timeout",
      "Repository is temporarily locked — Refresh to retry",
    );
  }
  if (kind === "missing-object") {
    return failure("missing-object", "Repository object is missing");
  }
  if (kind === "corrupt-object") {
    return failure("corrupt-object", "Repository object is corrupt");
  }
  return failure(fallbackCode);
}

function fileDiffFailure(
  result: GitResult,
  request: FileDiffRequest,
  file: ChangedFile,
): FileDiffError {
  const kind = classifyGitFailure(result);
  const message: FileDiffError["message"] = kind === "transient-lock"
    ? "Repository is temporarily locked — Refresh to retry"
    : kind === "missing-object"
      ? "Repository object is missing"
      : kind === "corrupt-object"
        ? "Repository object is corrupt"
        : "File diff is unavailable";
  return {
    status: "error",
    message,
    code: kind === "transient-lock"
      ? "transient-lock-timeout"
      : kind ?? "file-diff-read-failed",
    detailId: request.detailId,
    fileId: request.fileId,
    path: file.path,
  };
}

function sanitizeLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "�")
    .replace(unsafeDirectionalControls, "�");
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "�")
    .replace(unsafeDirectionalControls, "�");
}

function parseDetail(output: Buffer): ParsedDetail | null {
  const fields: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < 6; index += 1) {
    const separator = output.indexOf(0, offset);
    if (separator < 0) return null;
    fields.push(output.subarray(offset, separator));
    offset = separator + 1;
  }
  if (
    offset !== output.length &&
    !(offset + 1 === output.length && output.at(offset) === 0x0a)
  ) {
    return null;
  }

  const [rawSha, rawParents, rawAuthor, rawAuthorDate, rawCommitterDate, rawMessage] =
    fields.map((field) => field.toString("utf8"));
  const parents = rawParents === "" ? [] : rawParents.split(" ");
  if (
    !completeObjectId.test(rawSha) ||
    parents.some((parent) => !completeObjectId.test(parent)) ||
    !strictGitDate.test(rawAuthorDate) ||
    !strictGitDate.test(rawCommitterDate) ||
    !Number.isFinite(Date.parse(rawAuthorDate)) ||
    !Number.isFinite(Date.parse(rawCommitterDate))
  ) {
    return null;
  }
  return {
    sha: rawSha,
    parents,
    authorName: sanitizeLine(rawAuthor),
    authorDate: canonicalGitDate(rawAuthorDate),
    committerDate: canonicalGitDate(rawCommitterDate),
    message: sanitizeMessage(rawMessage),
  };
}

// Git before 2.45 prints a UTC strict-ISO date as "+00:00" while newer Git
// prints "Z"; canonicalize so the recorded date does not depend on the
// installed Git version.
function canonicalGitDate(value: string): string {
  return value.endsWith("+00:00") ? `${value.slice(0, -"+00:00".length)}Z` : value;
}

function splitNul(output: Buffer): Buffer[] | null {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0) return null;
  const fields: Buffer[] = [];
  let offset = 0;
  while (offset < output.length) {
    const separator = output.indexOf(0, offset);
    if (separator < 0) return null;
    fields.push(output.subarray(offset, separator));
    offset = separator + 1;
  }
  return fields;
}

function parseChangedFiles(output: Buffer): RawChangedFile[] | null {
  const fields = splitNul(output);
  if (!fields) return null;
  const entries: RawChangedFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index]?.toString("ascii") ?? "";
    index += 1;
    if (/^R\d{1,3}$/.test(status)) {
      const oldPath = fields[index];
      const path = fields[index + 1];
      if (!oldPath || !path || oldPath.length === 0 || path.length === 0) return null;
      entries.push({ status, oldPath, path });
      index += 2;
    } else {
      const path = fields[index];
      if (!/^[AMDTRUXB]$/.test(status) || !path || path.length === 0) return null;
      entries.push({ status, oldPath: null, path });
      index += 1;
    }
    if (entries.length > maximumChangedFiles) return null;
  }
  return entries;
}

function parseCount(value: string): number | null | "invalid" {
  if (value === "-") return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return "invalid";
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : "invalid";
}

function parseChangedStats(output: Buffer): RawChangedStat[] | null {
  const fields = splitNul(output);
  if (!fields) return null;
  const entries: RawChangedStat[] = [];
  for (let index = 0; index < fields.length; ) {
    const header = fields[index];
    if (!header) return null;
    index += 1;
    const firstTab = header.indexOf(0x09);
    const secondTab = firstTab < 0 ? -1 : header.indexOf(0x09, firstTab + 1);
    if (firstTab < 0 || secondTab < 0) return null;
    const additions = parseCount(header.subarray(0, firstTab).toString("ascii"));
    const deletions = parseCount(header.subarray(firstTab + 1, secondTab).toString("ascii"));
    if (additions === "invalid" || deletions === "invalid") return null;

    const inlinePath = header.subarray(secondTab + 1);
    if (inlinePath.length > 0) {
      entries.push({ path: inlinePath, oldPath: null, additions, deletions });
    } else {
      const oldPath = fields[index];
      const path = fields[index + 1];
      if (!oldPath || !path || oldPath.length === 0 || path.length === 0) return null;
      entries.push({ path, oldPath, additions, deletions });
      index += 2;
    }
    if (entries.length > maximumChangedFiles) return null;
  }
  return entries;
}

function parseChangedObjects(output: Buffer): RawChangedObject[] | null {
  const fields = splitNul(output);
  if (!fields) return null;
  const entries: RawChangedObject[] = [];
  for (let index = 0; index < fields.length; ) {
    const header = fields[index]?.toString("ascii") ?? "";
    index += 1;
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) (R\d{1,3}|[AMDTRUXB])$/.exec(
      header,
    );
    if (!match) return null;
    const [, oldMode, newMode, oldOid, newOid, status] = match;
    if (status.startsWith("R")) {
      const oldPath = fields[index];
      const path = fields[index + 1];
      if (!oldPath || !path || oldPath.length === 0 || path.length === 0) return null;
      entries.push({ status, oldPath, path, oldMode, newMode, oldOid, newOid });
      index += 2;
    } else {
      const path = fields[index];
      if (!path || path.length === 0) return null;
      entries.push({ status, oldPath: null, path, oldMode, newMode, oldOid, newOid });
      index += 1;
    }
    if (entries.length > maximumChangedFiles) return null;
  }
  return entries;
}

function samePath(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

function validUtf8SequenceLength(value: Buffer, index: number): number {
  const first = value[index];
  if (first <= 0x7f) return 1;
  const second = value[index + 1];
  const third = value[index + 2];
  const fourth = value[index + 3];
  const continuation = (byte: number | undefined) =>
    byte !== undefined && byte >= 0x80 && byte <= 0xbf;
  if (first >= 0xc2 && first <= 0xdf && continuation(second)) return 2;
  if (
    first === 0xe0 && second >= 0xa0 && second <= 0xbf && continuation(third) ||
    first >= 0xe1 && first <= 0xec && continuation(second) && continuation(third) ||
    first === 0xed && second >= 0x80 && second <= 0x9f && continuation(third) ||
    first >= 0xee && first <= 0xef && continuation(second) && continuation(third)
  ) return 3;
  if (
    first === 0xf0 && second >= 0x90 && second <= 0xbf && continuation(third) && continuation(fourth) ||
    first >= 0xf1 && first <= 0xf3 && continuation(second) && continuation(third) && continuation(fourth) ||
    first === 0xf4 && second >= 0x80 && second <= 0x8f && continuation(third) && continuation(fourth)
  ) return 4;
  return 0;
}

function displayPath(value: Buffer): string {
  let displayed = "";
  for (let index = 0; index < value.length; ) {
    const sequenceLength = validUtf8SequenceLength(value, index);
    if (sequenceLength === 0) {
      displayed += `\\x${value[index].toString(16).padStart(2, "0").toUpperCase()}`;
      index += 1;
      continue;
    }
    displayed += value.subarray(index, index + sequenceLength).toString("utf8");
    index += sequenceLength;
  }
  return displayed
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "�")
    .replace(unsafeDirectionalControls, "�");
}

function displayStatus(value: string): ChangedFile["status"] {
  if (value.startsWith("R")) return "renamed";
  if (value === "A") return "added";
  if (value === "M") return "modified";
  if (value === "D") return "deleted";
  if (value === "T") return "type-changed";
  return "unknown";
}

function patchPaths(file: ChangedFile): { oldPath: string; newPath: string } {
  return { oldPath: file.oldPath ?? file.path, newPath: file.path };
}

function patchIdentityHeaders(raw: RawChangedObject, file: ChangedFile): string[] {
  const { oldPath, newPath } = patchPaths(file);
  const headers = [`diff --git a/${oldPath} b/${newPath}`];
  if (raw.status.startsWith("R")) {
    const similarity = Number(raw.status.slice(1));
    if (Number.isSafeInteger(similarity)) headers.push(`similarity index ${similarity}%`);
    headers.push(`rename from ${oldPath}`, `rename to ${newPath}`);
  }
  if (raw.status === "A") headers.push(`new file mode ${raw.newMode}`);
  if (raw.status === "D") headers.push(`deleted file mode ${raw.oldMode}`);
  if (
    raw.status !== "A" &&
    raw.status !== "D" &&
    raw.oldMode !== raw.newMode
  ) {
    headers.push(`old mode ${raw.oldMode}`, `new mode ${raw.newMode}`);
  }
  return headers;
}

function binaryPatch(raw: RawChangedObject, file: ChangedFile): Buffer {
  const { oldPath, newPath } = patchPaths(file);
  const headers = patchIdentityHeaders(raw, file);
  headers.push(
    `index ${raw.oldOid}..${raw.newOid}`,
    `Binary files ${raw.status === "A" ? "/dev/null" : `a/${oldPath}`} and ${
      raw.status === "D" ? "/dev/null" : `b/${newPath}`
    } differ`,
  );
  return Buffer.from(`${headers.join("\n")}\n`);
}

function gitlinkPatch(raw: RawChangedObject, file: ChangedFile): Buffer {
  const headers = patchIdentityHeaders(raw, file);
  headers.push(`Submodule ${file.path} ${raw.oldOid}..${raw.newOid}`);
  return Buffer.from(`${headers.join("\n")}\n`);
}

function singleSidedPatch(
  output: Buffer,
  outputLimited: boolean,
  raw: RawChangedObject,
  file: ChangedFile,
): Buffer {
  const { oldPath, newPath } = patchPaths(file);
  let contents = output;
  if (outputLimited && contents.at(-1) !== 0x0a) {
    const lastCompleteLine = contents.lastIndexOf(0x0a);
    contents = lastCompleteLine < 0
      ? Buffer.alloc(0)
      : contents.subarray(0, lastCompleteLine + 1);
  }
  const hasTerminalNewline = contents.at(-1) === 0x0a;
  const text = contents.toString("utf8");
  const contentLines = text.length === 0
    ? []
    : (hasTerminalNewline ? text.slice(0, -1) : text).split("\n");
  const headers = patchIdentityHeaders(raw, file);
  headers.push(
    `index ${raw.oldOid}..${raw.newOid}`,
    raw.status === "A" ? "--- /dev/null" : `--- a/${oldPath}`,
    raw.status === "D" ? "+++ /dev/null" : `+++ b/${newPath}`,
  );
  if (contentLines.length === 0) return Buffer.from(`${headers.join("\n")}\n`);

  if (raw.status === "A") {
    headers.push(`@@ -0,0 +1,${contentLines.length} @@`);
    headers.push(...contentLines.map((line) => `+${line}`));
  } else {
    headers.push(`@@ -1,${contentLines.length} +0,0 @@`);
    headers.push(...contentLines.map((line) => `-${line}`));
  }
  if (!hasTerminalNewline && !outputLimited) {
    headers.push("\\ No newline at end of file");
  }
  return Buffer.from(`${headers.join("\n")}\n`);
}

function normalizedBlobPatch(
  output: Buffer,
  raw: RawChangedObject,
  file: ChangedFile,
): Buffer {
  if (output.length === 0) {
    return Buffer.from(`${patchIdentityHeaders(raw, file).join("\n")}\n`);
  }
  const terminalNewline = output.at(-1) === 0x0a;
  const lines = output.toString("utf8").split("\n");
  if (terminalNewline) lines.pop();
  const { oldPath, newPath } = patchPaths(file);
  let insertedIdentity = false;
  const normalized: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      normalized.push(...patchIdentityHeaders(raw, file));
      insertedIdentity = true;
    } else if (line.startsWith("index ")) {
      normalized.push(
        `index ${raw.oldOid}..${raw.newOid}${
          raw.oldMode === raw.newMode ? ` ${raw.oldMode}` : ""
        }`,
      );
    } else if (line.startsWith("--- ")) {
      normalized.push(`--- a/${oldPath}`);
    } else if (line.startsWith("+++ ")) {
      normalized.push(`+++ b/${newPath}`);
    } else {
      normalized.push(line);
    }
  }
  if (!insertedIdentity) normalized.unshift(...patchIdentityHeaders(raw, file));
  return Buffer.from(`${normalized.join("\n")}${terminalNewline ? "\n" : ""}`);
}

function prepareUnifiedDiff(
  output: Buffer,
  outputLimited: boolean,
  raw: RawChangedObject,
  file: ChangedFile,
): Buffer {
  if (raw.status === "A" || raw.status === "D") {
    return singleSidedPatch(output, outputLimited, raw, file);
  }
  return normalizedBlobPatch(output, raw, file);
}

function isGitlinkTransition(raw: RawChangedObject): boolean {
  return raw.oldMode === "160000" || raw.newMode === "160000";
}

function boundUnifiedDiff(
  output: Buffer,
  outputLimited: boolean,
): {
  output: Buffer;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
} {
  const byteTruncated = outputLimited || output.length > maximumDiffBytes;
  let candidate = output.subarray(0, maximumDiffBytes);
  if (byteTruncated && candidate.at(-1) !== 0x0a) {
    const lastCompleteLine = candidate.lastIndexOf(0x0a);
    candidate = lastCompleteLine < 0
      ? Buffer.alloc(0)
      : candidate.subarray(0, lastCompleteLine + 1);
  }

  let completedLines = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== 0x0a) continue;
    completedLines += 1;
    if (completedLines === maximumDiffLines) {
      const boundary = index + 1;
      if (candidate.length > boundary || byteTruncated) {
        return {
          output: candidate.subarray(0, boundary),
          truncated: true,
          truncatedBy: "lines",
        };
      }
      break;
    }
  }
  if (byteTruncated) {
    return { output: candidate, truncated: true, truncatedBy: "bytes" };
  }
  return { output: candidate, truncated: false, truncatedBy: null };
}

function parseUnifiedDiff(output: Buffer): FileDiffLine[] {
  if (output.length === 0) return [];
  const text = output.toString("utf8");
  const contents = text.endsWith("\n")
    ? text.slice(0, -1).split("\n")
    : text.split("\n");
  const lines: FileDiffLine[] = [];
  let oldLine: number | null = null;
  let newLine: number | null = null;

  for (const content of contents) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(content);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      lines.push({ kind: "hunk", content, oldLine: null, newLine: null });
      continue;
    }
    if (oldLine !== null && newLine !== null && content.startsWith(" ")) {
      lines.push({ kind: "context", content, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (oldLine !== null && newLine !== null && content.startsWith("-")) {
      lines.push({ kind: "deletion", content, oldLine, newLine: null });
      oldLine += 1;
      continue;
    }
    if (oldLine !== null && newLine !== null && content.startsWith("+")) {
      lines.push({ kind: "addition", content, oldLine: null, newLine });
      newLine += 1;
      continue;
    }
    if (content.startsWith("\\ ")) {
      lines.push({ kind: "meta", content, oldLine: null, newLine: null });
      continue;
    }
    lines.push({ kind: "header", content, oldLine: null, newLine: null });
  }
  return lines;
}

function readyFileDiff(
  request: FileDiffRequest,
  file: ChangedFile,
  prepared: Buffer,
  outputLimited: boolean,
): ReadyFileDiff {
  const bounded = boundUnifiedDiff(prepared, outputLimited);
  const lines = parseUnifiedDiff(bounded.output);
  return {
    status: "ready",
    detailId: request.detailId,
    fileId: request.fileId,
    path: file.path,
    oldPath: file.oldPath,
    statistics: { additions: file.additions, deletions: file.deletions },
    bytes: bounded.output.length,
    lineCount: lines.length,
    truncated: bounded.truncated,
    truncatedBy: bounded.truncatedBy,
    lines,
  };
}

function defaultLocalDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
  }).format(new Date(value));
}

export function createCommitDetailService(
  executor: CommitDetailExecutor = systemCommitDetailExecutor,
  formatLocalDate: (value: string) => string = defaultLocalDate,
) {
  let active: ActiveDetail | null = null;
  let generation = 0;

  function nextDetailId(
    snapshotId: string,
    commitSha: string,
    parentSha: string | null,
  ): string {
    generation += 1;
    return createHash("sha256")
      .update(snapshotId)
      .update("\0")
      .update(commitSha)
      .update("\0")
      .update(parentSha ?? "root")
      .update("\0")
      .update(String(generation))
      .digest("hex");
  }

  function fileId(detailId: string, index: number): string {
    return createHash("sha256")
      .update(detailId)
      .update("\0")
      .update(String(index))
      .digest("hex");
  }

  async function load(
    repository: string,
    request: CommitDetailRequest,
    binding: Pick<HistoryCommit, "sha" | "parents" | "refs">,
  ): Promise<ReadyCommitDetail | CommitDetailError> {
    const parents = binding.parents.map((parent) => parent.sha);
    if (
      !opaqueId.test(request.snapshotId) ||
      !completeObjectId.test(binding.sha) ||
      !Number.isSafeInteger(request.parentIndex) ||
      request.parentIndex < 0 ||
      (parents.length > 0 && request.parentIndex >= parents.length) ||
      (parents.length === 0 && request.parentIndex !== 0)
    ) {
      return failure("stale-detail", "Commit detail request is stale");
    }
    const selectedParentIndex = parents.length === 0 ? null : request.parentIndex;
    const selectedParentSha = selectedParentIndex === null
      ? null
      : parents[selectedParentIndex];
    const comparison = selectedParentSha
      ? [selectedParentSha, binding.sha]
      : [binding.sha];

    const [detailResult, renameAwareResults] = await Promise.all([
      executor.detail(repository, "commit-detail", [binding.sha]),
      Promise.all([
        executor.detail(repository, "changed-files", comparison),
        executor.detail(repository, "changed-file-stats", comparison),
        executor.detail(repository, "changed-file-objects", comparison),
      ]),
    ]);
    let [filesResult, statsResult, objectsResult] = renameAwareResults;
    const detailOutput = successfulOutput(detailResult);
    if (detailOutput === null) {
      return gitReadFailure(detailResult, "detail-read-failed");
    }

    let renameDetectionSkipped = false;
    if ([filesResult, statsResult, objectsResult].some((result) => result.timedOut)) {
      renameDetectionSkipped = true;
      [filesResult, statsResult, objectsResult] = await Promise.all([
        executor.detail(repository, "changed-files-no-renames", comparison),
        executor.detail(repository, "changed-file-stats-no-renames", comparison),
        executor.detail(repository, "changed-file-objects-no-renames", comparison),
      ]);
    }
    const filesOutput = successfulOutput(filesResult);
    const statsOutput = successfulOutput(statsResult);
    const objectsOutput = successfulOutput(objectsResult);
    if (filesOutput === null || statsOutput === null || objectsOutput === null) {
      if ([filesResult, statsResult, objectsResult].some((result) => result.timedOut)) {
        return failure("changed-files-timeout", "Changed-file request timed out");
      }
      const failedResult = [filesResult, statsResult, objectsResult]
        .find((result) => successfulOutput(result) === null);
      return failedResult
        ? gitReadFailure(failedResult, "detail-read-failed")
        : failure("detail-read-failed");
    }

    const parsedDetail = parseDetail(detailOutput);
    const parsedFiles = parseChangedFiles(filesOutput);
    const parsedStats = parseChangedStats(statsOutput);
    const parsedObjects = parseChangedObjects(objectsOutput);
    if (
      !parsedDetail ||
      !parsedFiles ||
      !parsedStats ||
      !parsedObjects ||
      parsedDetail.sha !== binding.sha ||
      parsedDetail.parents.length !== parents.length ||
      parsedDetail.parents.some((parent, index) => parent !== parents[index]) ||
      parsedFiles.length !== parsedStats.length ||
      parsedFiles.length !== parsedObjects.length ||
      parsedFiles.some((file, index) =>
        !file.path.equals(parsedStats[index].path) ||
        !samePath(file.oldPath, parsedStats[index].oldPath) ||
        !file.path.equals(parsedObjects[index].path) ||
        !samePath(file.oldPath, parsedObjects[index].oldPath) ||
        file.status !== parsedObjects[index].status,
      )
    ) {
      return failure("invalid-detail-output");
    }

    const detailId = nextDetailId(request.snapshotId, binding.sha, selectedParentSha);
    const allFiles = parsedFiles.map<ChangedFile>((file, index) => ({
      fileId: fileId(detailId, index),
      status: displayStatus(file.status),
      path: displayPath(file.path),
      oldPath: file.oldPath ? displayPath(file.oldPath) : null,
      additions: parsedStats[index].additions,
      deletions: parsedStats[index].deletions,
    }));
    const loadedFiles = allFiles.slice(0, 500);
    const ready: ReadyCommitDetail = {
      status: "ready",
      detailId,
      snapshotId: request.snapshotId,
      sha: parsedDetail.sha,
      message: parsedDetail.message,
      authorName: parsedDetail.authorName,
      authorDate: {
        recorded: parsedDetail.authorDate,
        local: formatLocalDate(parsedDetail.authorDate),
      },
      committerDate: {
        recorded: parsedDetail.committerDate,
        local: formatLocalDate(parsedDetail.committerDate),
      },
      parents,
      refs: binding.refs.map((ref) => ({ ...ref })),
      selectedParentIndex,
      selectedParentSha,
      summary: {
        totalFiles: allFiles.length,
        additions: allFiles.reduce((total, file) => total + (file.additions ?? 0), 0),
        deletions: allFiles.reduce((total, file) => total + (file.deletions ?? 0), 0),
        binaryFiles: allFiles.filter(
          (file) => file.additions === null || file.deletions === null,
        ).length,
      },
      loadedFileCount: loadedFiles.length,
      totalFileCount: allFiles.length,
      filePageSize: 500,
      hasMoreFiles: loadedFiles.length < allFiles.length,
      renameDetectionSkipped,
      files: loadedFiles,
    };
    active = { repository, detail: ready, allFiles, rawFiles: parsedObjects };
    return ready;
  }

  function current(): ReadyCommitDetail | CommitDetailError {
    return active?.detail ?? failure("detail-unavailable");
  }

  async function loadMoreFiles(
    repository: string,
    request: ChangedFilePageRequest,
  ): Promise<ChangedFilePage | CommitDetailError> {
    const previousLastFileId = active?.detail.files.at(-1)?.fileId ?? null;
    if (
      !active ||
      active.repository !== repository ||
      !opaqueId.test(request.detailId) ||
      !Number.isSafeInteger(request.loadedCount) ||
      request.loadedCount < 0 ||
      request.loadedCount > maximumChangedFiles ||
      !(request.lastFileId === null || opaqueId.test(request.lastFileId)) ||
      request.detailId !== active.detail.detailId ||
      request.loadedCount !== active.detail.loadedFileCount ||
      request.lastFileId !== previousLastFileId ||
      !active.detail.hasMoreFiles
    ) {
      return failure(
        "invalid-file-page-boundary",
        "Changed-file page boundary is invalid",
      );
    }

    const previousLoadedCount = active.detail.loadedFileCount;
    const files = active.allFiles.slice(previousLoadedCount, previousLoadedCount + 500);
    if (files.length === 0) {
      return failure(
        "invalid-file-page-boundary",
        "Changed-file page boundary is invalid",
      );
    }
    const loadedCount = previousLoadedCount + files.length;
    const nextDetail: ReadyCommitDetail = {
      ...active.detail,
      loadedFileCount: loadedCount,
      hasMoreFiles: loadedCount < active.allFiles.length,
      files: [...active.detail.files, ...files],
    };
    active = { ...active, detail: nextDetail };
    return {
      status: "ready",
      detailId: nextDetail.detailId,
      previousLoadedCount,
      previousLastFileId,
      loadedCount,
      totalCount: nextDetail.totalFileCount,
      pageSize: 500,
      hasMoreFiles: nextDetail.hasMoreFiles,
      files,
    };
  }

  async function loadDiff(
    repository: string,
    request: FileDiffRequest,
  ): Promise<ReadyFileDiff | FileDiffError> {
    const loadedIndex = active?.detail.files.findIndex(
      (file) => file.fileId === request.fileId,
    ) ?? -1;
    if (
      !active ||
      active.repository !== repository ||
      !opaqueId.test(request.detailId) ||
      !opaqueId.test(request.fileId) ||
      request.detailId !== active.detail.detailId ||
      loadedIndex < 0
    ) {
      return {
        status: "error",
        message: "File diff request is stale",
        code: "stale-file-diff",
        detailId: request.detailId,
        fileId: request.fileId,
        path: null,
      };
    }

    const file = active.detail.files[loadedIndex];
    const raw = active.rawFiles[loadedIndex];
    if (isGitlinkTransition(raw)) {
      return readyFileDiff(request, file, gitlinkPatch(raw, file), false);
    }
    if (file.additions === null || file.deletions === null) {
      const objectIds = [raw.oldOid, raw.newOid].filter(
        (objectId) => !/^0{40}$/.test(objectId),
      );
      const checks = await Promise.all(
        objectIds.map((objectId) =>
          executor.detail(repository, "blob-exists", [objectId]),
        ),
      );
      const failedCheck = checks.find((result) => successfulOutput(result) === null);
      if (failedCheck) return fileDiffFailure(failedCheck, request, file);
      return readyFileDiff(request, file, binaryPatch(raw, file), false);
    }
    const displayPaths = file.oldPath ? [file.oldPath, file.path] : [file.path];
    const result = await executor.detail(
      repository,
      "file-diff",
      [raw.oldOid, raw.newOid],
      displayPaths,
    );
    const output = successfulOutput(result) ?? (
      result.outputLimited === true && !result.timedOut && result.signal === null
        ? result.stdout
        : null
    );
    if (output === null) {
      return fileDiffFailure(result, request, file);
    }
    const textOutputLimited = result.outputLimited === true;
    const prepared = prepareUnifiedDiff(
      output,
      textOutputLimited,
      raw,
      file,
    );
    return readyFileDiff(request, file, prepared, textOutputLimited);
  }

  return { load, current, loadMoreFiles, loadDiff };
}
