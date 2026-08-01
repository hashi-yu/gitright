/**
 * The shapes that cross the server↔widget seam, defined once.
 *
 * Every output payload the server advertises is written here and nowhere else.
 * Semantic invariants that JSON Schema cannot carry — derivations between
 * fields, protocol constants, and bounds — ride along as refinements, so they
 * are enforced when a payload is received without changing what is advertised.
 */

import {
  advertised,
  array,
  bool,
  constant,
  int,
  nullable,
  num,
  object,
  rawNumber,
  str,
  stringEnum,
  stringified,
  union,
  type SchemaNode,
} from "./schema.ts";

const PAGE_SIZE = 500;
const MAX_LOADED = 100_000;
const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_DIFF_LINES = 20_000;
const MAX_INLINE_REFS = 3;

const sha = str({ pattern: "^[0-9a-f]{40}$" });
const opaqueId = str({ pattern: "^[0-9a-f]{64}$" });
const nullableSha = nullable(sha);
const nullableOpaqueId = nullable(opaqueId);
const nullableString = nullable(str());
const nullableInteger = nullable(int());

function isCount(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

/**
 * An error code is advertised as one of a tool's declared codes, but any code
 * the host sends still reaches the notice the widget shows for it.
 */
function errorCode(codes: readonly string[]): SchemaNode {
  return advertised(
    codes.length === 1 ? constant(codes[0]) : stringEnum(codes),
    str(),
  );
}

/** Advertised as a count within the snapshot limit, accepted as any count. */
function boundedCount(maximum: number): SchemaNode {
  return advertised(int({ minimum: 0, maximum }), int({ minimum: 0 }));
}

function boundedError(message: string, codes: readonly string[]): SchemaNode {
  return object({
    status: constant("error"),
    message: stringified(constant(message)),
    code: errorCode(codes),
  });
}

function boundedFileDiffError(message: string, codes: readonly string[]): SchemaNode {
  return object({
    status: constant("error"),
    message: stringified(constant(message)),
    code: errorCode(codes),
    detailId: opaqueId,
    fileId: opaqueId,
    path: nullableString,
  });
}

export const historyRef = object({
  name: str(),
  fullName: str(),
  kind: stringified(stringEnum(["head", "local-branch", "remote-branch", "tag"])),
  checkedOut: bool(),
});

export const historyCommit = object(
  {
    sha,
    shortSha: str({ pattern: "^[0-9a-f]{7,40}$" }),
    subject: str(),
    committerTime: advertised(int(), rawNumber()),
    relativeCommitterTime: str(),
    topologyRole: stringified(stringEnum(["root", "commit", "merge", "octopus merge"])),
    shallowBoundary: bool(),
    parents: array(object({ sha: stringified(sha), loaded: bool() })),
    refs: array(historyRef),
    inlineRefs: array(historyRef),
    additionalRefCount: advertised(int({ minimum: 0 }), rawNumber()),
  },
  {
    refine: (commit) =>
      commit.shortSha === (commit.sha as string).slice(0, 7) &&
      (commit.inlineRefs as unknown[]).length <= MAX_INLINE_REFS,
  },
);

export const historySelection = union([
  object(
    { status: constant("none") },
    { refine: (selection) => !("sha" in selection) },
  ),
  object({
    status: stringified(stringEnum(["reachable", "unreachable", "missing"])),
    sha,
  }),
]);

const historyCaptureUnavailableCodes = [
  "invalid-head",
  "head-read-failed",
  "invalid-symbolic-head",
  "symbolic-head-read-failed",
  "refs-read-failed",
  "invalid-refs",
  "worktree-branches-read-failed",
  "invalid-worktree-branches",
] as const;

export const getHistoryError = union([
  boundedError("History is unavailable", [
    "repository-unavailable",
    ...historyCaptureUnavailableCodes,
    "subjects-read-failed",
    "invalid-subjects",
    "invalid-selection-parents",
    "selection-read-failed",
    "history-read-failed",
    "invalid-history",
    "parents-read-failed",
    "invalid-parents",
    "invalid-history-topology",
  ]),
  boundedError("History exceeds GitRight's supported snapshot limit", [
    "history-too-large",
    "history-processing-limit",
  ]),
  boundedError("History refresh is already in progress", ["refresh-in-progress"]),
  boundedError("History refresh request is stale", ["stale-refresh"]),
  boundedError("History changed — Refresh to continue", ["history-changed-during-read"]),
  boundedError("Repository is temporarily locked — Refresh to retry", [
    "transient-lock-timeout",
  ]),
  boundedError("Repository object is missing", ["missing-object"]),
  boundedError("Repository object is corrupt", ["corrupt-object"]),
]);

export const historyPageError = union([
  boundedError("History is unavailable", [
    "repository-unavailable",
    ...historyCaptureUnavailableCodes,
    "subjects-read-failed",
    "invalid-subjects",
  ]),
  boundedError("History exceeds GitRight's supported snapshot limit", [
    "history-processing-limit",
  ]),
  boundedError("History page boundary is invalid", ["invalid-page-boundary"]),
  boundedError("History refresh is already in progress", ["refresh-in-progress"]),
  boundedError("Repository is temporarily locked — Refresh to retry", [
    "transient-lock-timeout",
  ]),
  boundedError("Repository object is missing", ["missing-object"]),
  boundedError("Repository object is corrupt", ["corrupt-object"]),
]);

export const readyHistory = object(
  {
    status: constant("ready"),
    snapshotId: opaqueId,
    snapshotTime: advertised(int(), rawNumber()),
    refFingerprint: opaqueId,
    headSha: nullableSha,
    loadedCount: advertised(
      int({ minimum: 0, maximum: MAX_LOADED }),
      num({ minimum: 0, maximum: MAX_LOADED }),
    ),
    pageSize: constant(PAGE_SIZE),
    hasContinuation: bool(),
    hasMore: bool(),
    commits: array(historyCommit),
    selection: historySelection,
  },
  { refine: (history) => (history.commits as unknown[]).length === history.loadedCount },
);

export const readyHistoryPage = object(
  {
    status: constant("ready"),
    snapshotId: opaqueId,
    refFingerprint: opaqueId,
    previousLoadedCount: boundedCount(MAX_LOADED),
    previousLastCommitSha: nullableSha,
    loadedCount: int({ minimum: 0, maximum: MAX_LOADED }),
    pageSize: constant(PAGE_SIZE),
    hasContinuation: bool(),
    hasMore: bool(),
    commits: array(historyCommit),
  },
  {
    refine: (page) => {
      const commits = page.commits as unknown[];
      return commits.length > 0 && commits.length <= PAGE_SIZE;
    },
  },
);

export const historyChanged = object({
  status: constant("changed"),
  message: constant("History changed — Refresh to continue"),
  code: constant("history-changed"),
  snapshotId: opaqueId,
});

export const changedFile = object(
  {
    fileId: opaqueId,
    status: stringified(
      stringEnum(["added", "modified", "deleted", "renamed", "type-changed", "unknown"]),
    ),
    path: str(),
    oldPath: nullableString,
    additions: nullableInteger,
    deletions: nullableInteger,
  },
  { refine: (file) => isCount(file.additions) && isCount(file.deletions) },
);

export const commitDate = object({
  recorded: str(),
  local: str(),
});

export const getCommitDetailError = union([
  boundedError("Commit detail is unavailable", [
    "repository-unavailable",
    "detail-read-failed",
    "invalid-detail-output",
  ]),
  boundedError("Commit detail request is stale", ["stale-detail"]),
  boundedError("Changed-file request timed out", ["changed-files-timeout"]),
  boundedError("Repository is temporarily locked — Refresh to retry", [
    "transient-lock-timeout",
  ]),
  boundedError("Repository object is missing", ["missing-object"]),
  boundedError("Repository object is corrupt", ["corrupt-object"]),
]);

export const changedFilePageError = union([
  boundedError("Commit detail is unavailable", ["repository-unavailable"]),
  boundedError("Changed-file page boundary is invalid", ["invalid-file-page-boundary"]),
]);

export const readyCommitDetail = object(
  {
    status: constant("ready"),
    detailId: opaqueId,
    snapshotId: opaqueId,
    sha,
    message: str(),
    authorName: str(),
    authorDate: commitDate,
    committerDate: commitDate,
    parents: array(sha),
    refs: array(historyRef),
    selectedParentIndex: nullableInteger,
    selectedParentSha: nullableSha,
    summary: object({
      totalFiles: boundedCount(MAX_LOADED),
      additions: int({ minimum: 0 }),
      deletions: int({ minimum: 0 }),
      binaryFiles: boundedCount(MAX_LOADED),
    }),
    loadedFileCount: boundedCount(MAX_LOADED),
    totalFileCount: int({ minimum: 0, maximum: MAX_LOADED }),
    filePageSize: constant(PAGE_SIZE),
    hasMoreFiles: bool(),
    renameDetectionSkipped: bool(),
    files: array(changedFile),
  },
  {
    refine: (detail) => {
      const parents = detail.parents as string[];
      const index = detail.selectedParentIndex;
      const selectedParentIsValid = parents.length === 0
        ? index === null && detail.selectedParentSha === null
        : Number.isSafeInteger(index) &&
          (index as number) >= 0 &&
          (index as number) < parents.length &&
          detail.selectedParentSha === parents[index as number];
      const loaded = detail.loadedFileCount as number;
      const total = detail.totalFileCount as number;
      return (
        selectedParentIsValid &&
        loaded <= total &&
        detail.hasMoreFiles === (loaded < total) &&
        (detail.files as unknown[]).length === loaded
      );
    },
  },
);

export const changedFilePage = object(
  {
    status: constant("ready"),
    detailId: opaqueId,
    previousLoadedCount: boundedCount(MAX_LOADED),
    previousLastFileId: nullableOpaqueId,
    loadedCount: boundedCount(MAX_LOADED),
    totalCount: int({ minimum: 0, maximum: MAX_LOADED }),
    pageSize: constant(PAGE_SIZE),
    hasMoreFiles: bool(),
    files: array(changedFile),
  },
  {
    refine: (page) => {
      const files = page.files as unknown[];
      return files.length > 0 && files.length <= PAGE_SIZE;
    },
  },
);

export const fileDiffError = union([
  boundedFileDiffError("File diff is unavailable", [
    "repository-unavailable",
    "file-diff-read-failed",
  ]),
  boundedFileDiffError("File diff request is stale", ["stale-file-diff"]),
  boundedFileDiffError("Repository is temporarily locked — Refresh to retry", [
    "transient-lock-timeout",
  ]),
  boundedFileDiffError("Repository object is missing", ["missing-object"]),
  boundedFileDiffError("Repository object is corrupt", ["corrupt-object"]),
]);

export const fileDiffLine = object(
  {
    kind: stringified(
      stringEnum(["header", "hunk", "context", "addition", "deletion", "meta"]),
    ),
    content: str(),
    oldLine: nullableInteger,
    newLine: nullableInteger,
  },
  { refine: (line) => isCount(line.oldLine) && isCount(line.newLine) },
);

export const readyFileDiff = object(
  {
    status: constant("ready"),
    detailId: opaqueId,
    fileId: opaqueId,
    path: str(),
    oldPath: nullableString,
    statistics: object(
      { additions: nullableInteger, deletions: nullableInteger },
      { refine: (stats) => isCount(stats.additions) && isCount(stats.deletions) },
    ),
    bytes: int({ minimum: 0, maximum: MAX_DIFF_BYTES }),
    lineCount: int({ minimum: 0, maximum: MAX_DIFF_LINES }),
    truncated: bool(),
    truncatedBy: nullable(stringified(stringEnum(["bytes", "lines"]))),
    lines: array(fileDiffLine),
  },
  {
    refine: (diff) =>
      (diff.lines as unknown[]).length === diff.lineCount &&
      (diff.truncated ? diff.truncatedBy !== null : diff.truncatedBy === null),
  },
);

export const launch = object(
  {
    outcome: stringEnum(["opened", "unavailable", "unsupported"]),
    reasonCode: stringEnum([
      "repository-unavailable",
      "bare-repository",
      "partial-clone",
      "sha256-repository",
      "ownership-refused",
      "git-version-blocked",
    ]),
  },
  { optional: ["reasonCode"] },
);

const gitVersion = advertised(str({ pattern: "^\\d+\\.\\d+\\.\\d+$" }), str());

/**
 * Repository state is shown to the user as prose, so the wording is advertised
 * but any wording the host sends is displayed rather than dropped.
 */
function advertisedWording(shown: SchemaNode): SchemaNode {
  return advertised(shown, str());
}

export const repositoryState = union([
  object({
    status: constant("ready"),
    message: advertisedWording(constant("Repository ready")),
    repositoryName: str(),
    repositoryPath: str(),
    repositoryKind: stringEnum(["repository", "linked-worktree"]),
    branch: nullableString,
    worktreeName: nullableString,
    gitVersion,
  }),
  object({
    status: constant("unavailable"),
    message: advertisedWording(constant("Current task repository is unavailable")),
  }),
  object({
    status: constant("unsupported"),
    message: advertisedWording(
      stringEnum([
        "Bare repositories are not supported in this version",
        "Partial clones are not supported in this version",
        "SHA-256 repositories are not supported in this version",
      ]),
    ),
    gitVersion,
  }),
  object({
    status: constant("ownership-refused"),
    message: advertisedWording(
      constant("Git refused this repository because its ownership is not trusted"),
    ),
    guidance: advertisedWording(
      constant("Resolve the repository trust outside GitRight, then open a new task"),
    ),
    gitVersion,
  }),
  object({
    status: constant("blocked"),
    message: advertisedWording(constant("Git 2.30.0 or newer is required")),
    requiredGitVersion: advertisedWording(constant("2.30.0")),
    detectedGitVersion: str(),
    durationMs: num({ minimum: 0 }),
    errorCode: constant("git-version-blocked"),
  }),
]);

export const history = union([readyHistory, getHistoryError]);
export const historyPage = union([readyHistoryPage, historyChanged, historyPageError]);
export const commitDetail = union([readyCommitDetail, getCommitDetailError]);
export const changedFilePageOutput = union([changedFilePage, changedFilePageError]);
export const fileDiff = union([readyFileDiff, fileDiffError]);
