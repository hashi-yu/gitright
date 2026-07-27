const sha = { type: "string", pattern: "^[0-9a-f]{40}$" } as const;
const opaqueId = { type: "string", pattern: "^[0-9a-f]{64}$" } as const;
const nullableSha = { anyOf: [sha, { type: "null" }] } as const;
const nullableOpaqueId = { anyOf: [opaqueId, { type: "null" }] } as const;
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const nullableInteger = { anyOf: [{ type: "integer" }, { type: "null" }] } as const;

function boundedError(message: string, codes: readonly string[]) {
  return {
    type: "object",
    properties: {
      status: { const: "error" },
      message: { const: message },
      code: codes.length === 1 ? { const: codes[0] } : { enum: codes },
    },
    required: ["status", "message", "code"],
    additionalProperties: false,
  } as const;
}

function boundedFileDiffError(message: string, codes: readonly string[]) {
  const error = boundedError(message, codes);
  return {
    ...error,
    properties: {
      ...error.properties,
      detailId: opaqueId,
      fileId: opaqueId,
      path: nullableString,
    },
    required: ["status", "message", "code", "detailId", "fileId", "path"],
  } as const;
}

const historyRef = {
  type: "object",
  properties: {
    name: { type: "string" },
    fullName: { type: "string" },
    kind: {
      type: "string",
      enum: ["head", "local-branch", "remote-branch", "tag"],
    },
    checkedOut: { type: "boolean" },
  },
  required: ["name", "fullName", "kind", "checkedOut"],
  additionalProperties: false,
} as const;

const historyCommit = {
  type: "object",
  properties: {
    sha,
    shortSha: { type: "string", pattern: "^[0-9a-f]{7,40}$" },
    subject: { type: "string" },
    committerTime: { type: "integer" },
    relativeCommitterTime: { type: "string" },
    topologyRole: {
      type: "string",
      enum: ["root", "commit", "merge", "octopus merge"],
    },
    shallowBoundary: { type: "boolean" },
    parents: {
      type: "array",
      items: {
        type: "object",
        properties: { sha, loaded: { type: "boolean" } },
        required: ["sha", "loaded"],
        additionalProperties: false,
      },
    },
    refs: { type: "array", items: historyRef },
    inlineRefs: { type: "array", items: historyRef },
    additionalRefCount: { type: "integer", minimum: 0 },
  },
  required: [
    "sha",
    "shortSha",
    "subject",
    "committerTime",
    "relativeCommitterTime",
    "topologyRole",
    "shallowBoundary",
    "parents",
    "refs",
    "inlineRefs",
    "additionalRefCount",
  ],
  additionalProperties: false,
} as const;

const historySelection = {
  type: "object",
  oneOf: [
    {
      type: "object",
      properties: { status: { const: "none" } },
      required: ["status"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { enum: ["reachable", "unreachable", "missing"] },
        sha,
      },
      required: ["status", "sha"],
      additionalProperties: false,
    },
  ],
} as const;

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

const getHistoryError = {
  type: "object",
  oneOf: [
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
  ],
} as const;

const historyPageError = {
  type: "object",
  oneOf: [
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
  ],
} as const;

const readyHistory = {
  type: "object",
  properties: {
    status: { const: "ready" },
    snapshotId: opaqueId,
    snapshotTime: { type: "integer" },
    refFingerprint: opaqueId,
    headSha: nullableSha,
    loadedCount: { type: "integer", minimum: 0, maximum: 100000 },
    pageSize: { const: 500 },
    hasContinuation: { type: "boolean" },
    hasMore: { type: "boolean" },
    commits: { type: "array", items: historyCommit },
    selection: historySelection,
  },
  required: [
    "status",
    "snapshotId",
    "snapshotTime",
    "refFingerprint",
    "headSha",
    "loadedCount",
    "pageSize",
    "hasContinuation",
    "hasMore",
    "commits",
    "selection",
  ],
  additionalProperties: false,
} as const;

const readyHistoryPage = {
  type: "object",
  properties: {
    status: { const: "ready" },
    snapshotId: opaqueId,
    refFingerprint: opaqueId,
    previousLoadedCount: { type: "integer", minimum: 0, maximum: 100000 },
    previousLastCommitSha: nullableSha,
    loadedCount: { type: "integer", minimum: 0, maximum: 100000 },
    pageSize: { const: 500 },
    hasContinuation: { type: "boolean" },
    hasMore: { type: "boolean" },
    commits: { type: "array", items: historyCommit },
  },
  required: [
    "status",
    "snapshotId",
    "refFingerprint",
    "previousLoadedCount",
    "previousLastCommitSha",
    "loadedCount",
    "pageSize",
    "hasContinuation",
    "hasMore",
    "commits",
  ],
  additionalProperties: false,
} as const;

const historyChanged = {
  type: "object",
  properties: {
    status: { const: "changed" },
    message: { const: "History changed — Refresh to continue" },
    code: { const: "history-changed" },
    snapshotId: opaqueId,
  },
  required: ["status", "message", "code", "snapshotId"],
  additionalProperties: false,
} as const;

const changedFile = {
  type: "object",
  properties: {
    fileId: opaqueId,
    status: {
      enum: ["added", "modified", "deleted", "renamed", "type-changed", "unknown"],
    },
    path: { type: "string" },
    oldPath: nullableString,
    additions: nullableInteger,
    deletions: nullableInteger,
  },
  required: ["fileId", "status", "path", "oldPath", "additions", "deletions"],
  additionalProperties: false,
} as const;

const commitDate = {
  type: "object",
  properties: {
    recorded: { type: "string" },
    local: { type: "string" },
  },
  required: ["recorded", "local"],
  additionalProperties: false,
} as const;

const getCommitDetailError = {
  type: "object",
  oneOf: [
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
  ],
} as const;

const changedFilePageError = {
  type: "object",
  oneOf: [
    boundedError("Commit detail is unavailable", ["repository-unavailable"]),
    boundedError("Changed-file page boundary is invalid", ["invalid-file-page-boundary"]),
  ],
} as const;

const readyCommitDetail = {
  type: "object",
  properties: {
    status: { const: "ready" },
    detailId: opaqueId,
    snapshotId: opaqueId,
    sha,
    message: { type: "string" },
    authorName: { type: "string" },
    authorDate: commitDate,
    committerDate: commitDate,
    parents: { type: "array", items: sha },
    refs: { type: "array", items: historyRef },
    selectedParentIndex: nullableInteger,
    selectedParentSha: nullableSha,
    summary: {
      type: "object",
      properties: {
        totalFiles: { type: "integer", minimum: 0, maximum: 100000 },
        additions: { type: "integer", minimum: 0 },
        deletions: { type: "integer", minimum: 0 },
        binaryFiles: { type: "integer", minimum: 0, maximum: 100000 },
      },
      required: ["totalFiles", "additions", "deletions", "binaryFiles"],
      additionalProperties: false,
    },
    loadedFileCount: { type: "integer", minimum: 0, maximum: 100000 },
    totalFileCount: { type: "integer", minimum: 0, maximum: 100000 },
    filePageSize: { const: 500 },
    hasMoreFiles: { type: "boolean" },
    renameDetectionSkipped: { type: "boolean" },
    files: { type: "array", items: changedFile },
  },
  required: [
    "status",
    "detailId",
    "snapshotId",
    "sha",
    "message",
    "authorName",
    "authorDate",
    "committerDate",
    "parents",
    "refs",
    "selectedParentIndex",
    "selectedParentSha",
    "summary",
    "loadedFileCount",
    "totalFileCount",
    "filePageSize",
    "hasMoreFiles",
    "renameDetectionSkipped",
    "files",
  ],
  additionalProperties: false,
} as const;

const changedFilePage = {
  type: "object",
  properties: {
    status: { const: "ready" },
    detailId: opaqueId,
    previousLoadedCount: { type: "integer", minimum: 0, maximum: 100000 },
    previousLastFileId: nullableOpaqueId,
    loadedCount: { type: "integer", minimum: 0, maximum: 100000 },
    totalCount: { type: "integer", minimum: 0, maximum: 100000 },
    pageSize: { const: 500 },
    hasMoreFiles: { type: "boolean" },
    files: { type: "array", items: changedFile },
  },
  required: [
    "status",
    "detailId",
    "previousLoadedCount",
    "previousLastFileId",
    "loadedCount",
    "totalCount",
    "pageSize",
    "hasMoreFiles",
    "files",
  ],
  additionalProperties: false,
} as const;

const fileDiffError = {
  type: "object",
  oneOf: [
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
  ],
} as const;

const readyFileDiff = {
  type: "object",
  properties: {
    status: { const: "ready" },
    detailId: opaqueId,
    fileId: opaqueId,
    path: { type: "string" },
    oldPath: nullableString,
    statistics: {
      type: "object",
      properties: { additions: nullableInteger, deletions: nullableInteger },
      required: ["additions", "deletions"],
      additionalProperties: false,
    },
    bytes: { type: "integer", minimum: 0, maximum: 1048576 },
    lineCount: { type: "integer", minimum: 0, maximum: 20000 },
    truncated: { type: "boolean" },
    truncatedBy: { anyOf: [{ enum: ["bytes", "lines"] }, { type: "null" }] },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { enum: ["header", "hunk", "context", "addition", "deletion", "meta"] },
          content: { type: "string" },
          oldLine: nullableInteger,
          newLine: nullableInteger,
        },
        required: ["kind", "content", "oldLine", "newLine"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "status",
    "detailId",
    "fileId",
    "path",
    "oldPath",
    "statistics",
    "bytes",
    "lineCount",
    "truncated",
    "truncatedBy",
    "lines",
  ],
  additionalProperties: false,
} as const;

export const launchOutputSchema = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["opened", "unavailable", "unsupported"],
    },
    reasonCode: {
      type: "string",
      enum: [
        "repository-unavailable",
        "bare-repository",
        "partial-clone",
        "sha256-repository",
        "ownership-refused",
        "git-version-blocked",
      ],
    },
  },
  required: ["outcome"],
  additionalProperties: false,
} as const;

export const repositoryStateOutputSchema = {
  type: "object",
  oneOf: [
    {
      type: "object",
      properties: {
        status: { const: "ready" },
        message: { const: "Repository ready" },
        repositoryName: { type: "string" },
        repositoryPath: { type: "string" },
        repositoryKind: { enum: ["repository", "linked-worktree"] },
        branch: { type: ["string", "null"] },
        worktreeName: { type: ["string", "null"] },
        gitVersion: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
      },
      required: [
        "status",
        "message",
        "repositoryName",
        "repositoryPath",
        "repositoryKind",
        "branch",
        "worktreeName",
        "gitVersion",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "unavailable" },
        message: { const: "Current task repository is unavailable" },
      },
      required: ["status", "message"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "unsupported" },
        message: {
          enum: [
            "Bare repositories are not supported in this version",
            "Partial clones are not supported in this version",
            "SHA-256 repositories are not supported in this version",
          ],
        },
        gitVersion: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
      },
      required: ["status", "message", "gitVersion"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "ownership-refused" },
        message: { const: "Git refused this repository because its ownership is not trusted" },
        guidance: {
          const: "Resolve the repository trust outside GitRight, then open a new task",
        },
        gitVersion: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
      },
      required: ["status", "message", "guidance", "gitVersion"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        status: { const: "blocked" },
        message: { const: "Git 2.30.0 or newer is required" },
        requiredGitVersion: { const: "2.30.0" },
        detectedGitVersion: { type: "string" },
        durationMs: { type: "number", minimum: 0 },
        errorCode: { const: "git-version-blocked" },
      },
      required: [
        "status",
        "message",
        "requiredGitVersion",
        "detectedGitVersion",
        "durationMs",
        "errorCode",
      ],
      additionalProperties: false,
    },
  ],
} as const;

export const historyOutputSchema = {
  type: "object",
  oneOf: [readyHistory, getHistoryError],
} as const;

export const historyPageOutputSchema = {
  type: "object",
  oneOf: [readyHistoryPage, historyChanged, historyPageError],
} as const;

export const commitDetailOutputSchema = {
  type: "object",
  oneOf: [readyCommitDetail, getCommitDetailError],
} as const;

export const changedFilePageOutputSchema = {
  type: "object",
  oneOf: [changedFilePage, changedFilePageError],
} as const;

export const fileDiffOutputSchema = {
  type: "object",
  oneOf: [readyFileDiff, fileDiffError],
} as const;
