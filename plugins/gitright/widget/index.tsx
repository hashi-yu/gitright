import "./styles.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { commitDetailMatchesSelection } from "./commit-detail-state.ts";
import {
  restoreOmittedChangedFilePageNulls,
  restoreOmittedCommitDetailNulls,
  restoreOmittedFileDiffNulls,
  restoreOmittedHistoryNulls,
} from "./host-payload.ts";
import {
  conversationHandoffModality,
  createConversationHandoffParams,
  type ConversationHandoffModality,
} from "./conversation-handoff.ts";

import {
  appendChangedFilePage,
  createChangedFilePageGuard,
  searchLoadedChangedFiles,
} from "./changed-file-state.ts";
import { createFileDiffRequestGuard } from "./file-diff-state.ts";
import {
  hostEnvironmentPresentation,
  resolveHostEnvironment,
  type DisplayMode,
  type HostEnvironment,
  type HostSafeArea,
} from "./host-environment.ts";
import {
  GRAPH_METRICS,
  appendHistoryGraphLayout,
  countOffscreenParents,
  createHistoryGraphLayout,
  graphLaneX,
  graphRowGeometry,
  minimumLaneReveal,
  type HistoryGraphLayout,
  type HistoryGraphRow,
} from "./history-graph.ts";
import {
  EMPTY_HISTORY_SEARCH_MATCHES,
  matchLoadedHistory,
  refMatchesQuery,
  subjectMatchRanges,
} from "./history-search.ts";
import {
  commitAccessibilityLabel,
  copyFor,
  diffLineAccessibilityLabel,
  fileAccessibilityLabel,
  formatRelativeTime,
  isActivationKey,
  translateServiceMessage,
  type Copy,
  type GitRightLocale,
} from "./localization.ts";
import {
  appendHistoryPage,
  createHistoryRefreshGuard,
  replaceHistorySnapshot,
  type HistoryStateSelection,
} from "./history-state.ts";
import { statusBarItems } from "./status-bar.ts";
import {
  createToolResultStore,
  repositoryStateFromToolResult,
} from "./tool-result-state.ts";
import {
  createPersistedWidgetState,
  parsePersistedWidgetState,
  restoreWidgetSelection,
  truncateWidgetStateQuery,
  type PersistedWidgetState,
} from "./widget-state.ts";

const DETAIL_REQUEST_DEBOUNCE_MS = 150;
const FILE_SEARCH_MINIMUM_ENTRIES = 6;

type RepositoryState =
  | { status: "loading"; message: "Opening repository…" }
  | {
      status: "ready";
      message: string;
      repositoryName: string;
      repositoryPath: string;
      repositoryKind: "repository" | "linked-worktree";
      branch: string | null;
      worktreeName: string | null;
      gitVersion: string;
    }
  | { status: "unavailable"; message: string }
  | { status: "unsupported"; message: string; gitVersion: string }
  | { status: "ownership-refused"; message: string; guidance: string; gitVersion: string }
  | {
      status: "blocked";
      message: string;
      requiredGitVersion: string;
      detectedGitVersion: string;
      durationMs: number;
      errorCode: "git-version-blocked";
    };

type HistoryRef = {
  name: string;
  fullName: string;
  kind: "head" | "local-branch" | "remote-branch" | "tag";
  checkedOut: boolean;
};

type DiffNotice = {
  message: string;
  path: string;
};

type HistoryCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  committerTime: number;
  relativeCommitterTime: string;
  topologyRole: "root" | "commit" | "merge" | "octopus merge";
  shallowBoundary: boolean;
  parents: Array<{ sha: string; loaded: boolean }>;
  refs: HistoryRef[];
  inlineRefs: HistoryRef[];
  additionalRefCount: number;
};

type HistorySnapshot = {
  status: "ready";
  snapshotId: string;
  snapshotTime: number;
  refFingerprint: string;
  headSha: string | null;
  loadedCount: number;
  pageSize: 500;
  hasContinuation: boolean;
  hasMore: boolean;
  commits: HistoryCommit[];
  selection: HistoryStateSelection;
};

type HistoryPage = {
  status: "ready";
  snapshotId: string;
  refFingerprint: string;
  previousLoadedCount: number;
  previousLastCommitSha: string | null;
  loadedCount: number;
  pageSize: 500;
  hasContinuation: boolean;
  hasMore: boolean;
  commits: HistoryCommit[];
};

type HistoryChanged = {
  status: "changed";
  message: "History changed — Refresh to continue";
  code: "history-changed";
  snapshotId: string;
};

type HistoryErrorSnapshot = {
  status: "error";
  message:
    | "History is unavailable"
    | "History exceeds GitRight's supported snapshot limit"
    | "History page boundary is invalid"
    | "History refresh is already in progress"
    | "History refresh request is stale"
    | "History changed — Refresh to continue"
    | "Repository is temporarily locked — Refresh to retry"
    | "Repository object is missing"
    | "Repository object is corrupt";
  code: string;
};

type HistoryViewState =
  | { status: "idle" }
  | { status: "loading" }
  | HistorySnapshot
  | { status: "error"; message: string };

type ChangedFile = {
  fileId: string;
  status: "added" | "modified" | "deleted" | "renamed" | "type-changed" | "unknown";
  path: string;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
};

type CommitDate = {
  recorded: string;
  local: string;
};

type CommitDetail = {
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

type ChangedFilePage = {
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

type FileDiffLine = {
  kind: "header" | "hunk" | "context" | "addition" | "deletion" | "meta";
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

type FileDiff = {
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

type FileDiffError = {
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

type CommitDetailError = {
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

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

declare global {
  interface Window {
    openai?: {
      locale?: string;
      theme?: "light" | "dark";
      displayMode?: DisplayMode;
      maxHeight?: number;
      safeArea?: { insets?: HostSafeArea };
      requestDisplayMode?: (request: {
        mode: "fullscreen";
      }) => Promise<{ mode: DisplayMode } | void> | undefined;
      widgetState?: unknown;
      setWidgetState?: (state: PersistedWidgetState) => Promise<void> | void;
    };
  }
}

let rpcId = 0;
let bridgeInitialization: Promise<HostEnvironment> | null = null;
let currentHostEnvironment: HostEnvironment | undefined;
let currentConversationHandoffModality: ConversationHandoffModality | null = null;
const pendingRequests = new Map<number, PendingRequest>();
const hostEnvironmentListeners = new Set<(environment: HostEnvironment) => void>();
const toolResultStore = createToolResultStore();

function hostEnvironment(value?: unknown): HostEnvironment {
  currentHostEnvironment = resolveHostEnvironment(value, {
    globals: window.openai,
    navigatorLanguage: navigator.language,
    prefersDark: window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  }, currentHostEnvironment);
  return currentHostEnvironment;
}

function applyHostEnvironment(environment: HostEnvironment): void {
  currentHostEnvironment = environment;
  const presentation = hostEnvironmentPresentation(environment);
  const root = document.documentElement;
  root.lang = presentation.lang;
  root.setAttribute("data-theme", presentation.theme);
  root.setAttribute("data-display-mode", presentation.displayMode);
  for (const [name, value] of Object.entries(presentation.properties)) {
    root.style.setProperty(name, value);
  }
  const surfaceBackground = hostSurfaceBackground();
  if (surfaceBackground === null) {
    root.style.removeProperty("--host-surface-background");
  } else {
    root.style.setProperty("--host-surface-background", surfaceBackground);
  }
}

/* The host's own surface color, when it publishes one. The inline
   launcher paints it behind its card so the card sits in the thread
   rather than on a slab of GitRight's own color, and the pane entrance
   opens on it so nothing flashes before the arriving card brings the
   GitRight surface in. */
function hostSurfaceBackground(): string | null {
  const value = (window.openai as { surfaceBackgroundColor?: unknown } | undefined)
    ?.surfaceBackgroundColor;
  return typeof value === "string" && value.length <= 50 &&
      /^[#a-zA-Z0-9(),.%\s-]+$/.test(value)
    ? value
    : null;
}

function rpcNotify(method: string, params: unknown): void {
  window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
}

function rpcRequest(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    pendingRequests.set(id, { resolve, reject });
    window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  });
}

/* Codex delivers host-global updates (theme, surface background, max
   height) through openai:set_globals events after mount; re-resolve the
   environment from window.openai whenever one arrives. */
window.addEventListener("openai:set_globals", () => {
  const environment = hostEnvironment();
  applyHostEnvironment(environment);
  for (const listener of hostEnvironmentListeners) listener(environment);
});

window.addEventListener(
  "message",
  (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.method === "ui/notifications/host-context-changed") {
      const environment = hostEnvironment(message.params);
      applyHostEnvironment(environment);
      for (const listener of hostEnvironmentListeners) listener(environment);
      return;
    }
    if (message.method === "ui/notifications/tool-result") {
      if (isRepositoryState(repositoryStateFromToolResult(message.params))) {
        toolResultStore.publish(message.params);
      }
      return;
    }
    if (typeof message.id !== "number") return;
    if (!("result" in message) && !("error" in message)) return;
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    if (message.error) pending.reject(message.error);
    else pending.resolve(message.result);
  },
  { passive: true },
);

function initializeBridge(): Promise<HostEnvironment> {
  if (bridgeInitialization) return bridgeInitialization;
  bridgeInitialization = (async () => {
    const result = await rpcRequest("ui/initialize", {
      appInfo: { name: "gitright-widget", version: "0.1.0-beta.1" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });
    rpcNotify("ui/notifications/initialized", {});
    currentConversationHandoffModality = conversationHandoffModality(
      (result as { hostCapabilities?: unknown })?.hostCapabilities,
    );
    const environment = hostEnvironment(result);
    applyHostEnvironment(environment);
    return environment;
  })().catch((error: unknown) => {
    bridgeInitialization = null;
    throw error;
  });
  return bridgeInitialization;
}

function isRepositoryState(value: unknown): value is Exclude<RepositoryState, { status: "loading" }> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.message !== "string") return false;
  if (candidate.status === "unavailable") return true;
  if (candidate.status === "unsupported") return typeof candidate.gitVersion === "string";
  if (candidate.status === "ownership-refused") {
    return typeof candidate.guidance === "string" && typeof candidate.gitVersion === "string";
  }
  if (candidate.status === "blocked") {
    const blocked = value as Partial<Extract<RepositoryState, { status: "blocked" }>>;
    return (
      typeof blocked.requiredGitVersion === "string" &&
      typeof blocked.detectedGitVersion === "string" &&
      typeof blocked.durationMs === "number" &&
      Number.isFinite(blocked.durationMs) &&
      blocked.durationMs >= 0 &&
      blocked.errorCode === "git-version-blocked"
    );
  }
  return (
    candidate.status === "ready" &&
    typeof candidate.repositoryName === "string" &&
    typeof candidate.repositoryPath === "string" &&
    (candidate.repositoryKind === "repository" || candidate.repositoryKind === "linked-worktree") &&
    (candidate.branch === null || typeof candidate.branch === "string") &&
    (candidate.worktreeName === null || typeof candidate.worktreeName === "string") &&
    typeof candidate.gitVersion === "string"
  );
}

function isHistoryRef(value: unknown): value is HistoryRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<HistoryRef>;
  return (
    typeof ref.name === "string" &&
    typeof ref.fullName === "string" &&
    ["head", "local-branch", "remote-branch", "tag"].includes(String(ref.kind)) &&
    typeof ref.checkedOut === "boolean"
  );
}

function isHistoryCommit(value: unknown): value is HistoryCommit {
  if (!value || typeof value !== "object") return false;
  const commit = value as Partial<HistoryCommit>;
  return (
    typeof commit.sha === "string" &&
    /^[0-9a-f]{40}$/.test(commit.sha) &&
    commit.shortSha === commit.sha.slice(0, 7) &&
    typeof commit.subject === "string" &&
    typeof commit.committerTime === "number" &&
    typeof commit.relativeCommitterTime === "string" &&
    ["root", "commit", "merge", "octopus merge"].includes(String(commit.topologyRole)) &&
    typeof commit.shallowBoundary === "boolean" &&
    Array.isArray(commit.parents) &&
    commit.parents.every(
      (parent) =>
        !!parent &&
        typeof parent === "object" &&
        /^[0-9a-f]{40}$/.test(String(parent.sha)) &&
        typeof parent.loaded === "boolean",
    ) &&
    Array.isArray(commit.refs) &&
    commit.refs.every(isHistoryRef) &&
    Array.isArray(commit.inlineRefs) &&
    commit.inlineRefs.length <= 3 &&
    commit.inlineRefs.every(isHistoryRef) &&
    typeof commit.additionalRefCount === "number"
  );
}

function isHistorySelection(value: unknown): value is HistoryStateSelection {
  if (!value || typeof value !== "object") return false;
  const selection = value as { status?: unknown; sha?: unknown };
  if (selection.status === "none") return typeof selection.sha === "undefined";
  return (
    ["reachable", "unreachable", "missing"].includes(String(selection.status)) &&
    typeof selection.sha === "string" &&
    /^[0-9a-f]{40}$/.test(selection.sha)
  );
}

function isHistorySnapshot(value: unknown): value is HistorySnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<HistorySnapshot>;
  return (
    snapshot.status === "ready" &&
    typeof snapshot.snapshotId === "string" &&
    /^[0-9a-f]{64}$/.test(snapshot.snapshotId) &&
    typeof snapshot.snapshotTime === "number" &&
    typeof snapshot.refFingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(snapshot.refFingerprint) &&
    (snapshot.headSha === null || (
      typeof snapshot.headSha === "string" &&
      /^[0-9a-f]{40}$/.test(snapshot.headSha)
    )) &&
    snapshot.pageSize === 500 &&
    typeof snapshot.loadedCount === "number" &&
    snapshot.loadedCount >= 0 &&
    snapshot.loadedCount <= 100_000 &&
    typeof snapshot.hasContinuation === "boolean" &&
    typeof snapshot.hasMore === "boolean" &&
    Array.isArray(snapshot.commits) &&
    snapshot.commits.length === snapshot.loadedCount &&
    snapshot.commits.every(isHistoryCommit) &&
    isHistorySelection(snapshot.selection)
  );
}

function isHistoryPage(value: unknown): value is HistoryPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<HistoryPage>;
  return (
    page.status === "ready" &&
    typeof page.snapshotId === "string" &&
    /^[0-9a-f]{64}$/.test(page.snapshotId) &&
    typeof page.refFingerprint === "string" &&
    /^[0-9a-f]{64}$/.test(page.refFingerprint) &&
    typeof page.previousLoadedCount === "number" &&
    Number.isSafeInteger(page.previousLoadedCount) &&
    page.previousLoadedCount >= 0 &&
    (page.previousLastCommitSha === null || (
      typeof page.previousLastCommitSha === "string" &&
      /^[0-9a-f]{40}$/.test(page.previousLastCommitSha)
    )) &&
    typeof page.loadedCount === "number" &&
    Number.isSafeInteger(page.loadedCount) &&
    page.loadedCount >= 0 &&
    page.loadedCount <= 100_000 &&
    page.pageSize === 500 &&
    typeof page.hasContinuation === "boolean" &&
    typeof page.hasMore === "boolean" &&
    Array.isArray(page.commits) &&
    page.commits.length > 0 &&
    page.commits.length <= 500 &&
    page.commits.every(isHistoryCommit)
  );
}

function isHistoryChanged(value: unknown): value is HistoryChanged {
  if (!value || typeof value !== "object") return false;
  const changed = value as Partial<HistoryChanged>;
  return (
    changed.status === "changed" &&
    changed.message === "History changed — Refresh to continue" &&
    changed.code === "history-changed" &&
    typeof changed.snapshotId === "string" &&
    /^[0-9a-f]{64}$/.test(changed.snapshotId)
  );
}

function isHistoryErrorSnapshot(value: unknown): value is HistoryErrorSnapshot {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<HistoryErrorSnapshot>;
  return (
    error.status === "error" &&
    [
      "History is unavailable",
      "History exceeds GitRight's supported snapshot limit",
      "History page boundary is invalid",
      "History refresh is already in progress",
      "History refresh request is stale",
      "History changed — Refresh to continue",
      "Repository is temporarily locked — Refresh to retry",
      "Repository object is missing",
      "Repository object is corrupt",
    ].includes(String(error.message)) &&
    typeof error.code === "string"
  );
}

function isChangedFile(value: unknown): value is ChangedFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<ChangedFile>;
  return (
    typeof file.fileId === "string" &&
    /^[0-9a-f]{64}$/.test(file.fileId) &&
    ["added", "modified", "deleted", "renamed", "type-changed", "unknown"].includes(
      String(file.status),
    ) &&
    typeof file.path === "string" &&
    (file.oldPath === null || typeof file.oldPath === "string") &&
    (file.additions === null || (
      Number.isSafeInteger(file.additions) && (file.additions as number) >= 0
    )) &&
    (file.deletions === null || (
      Number.isSafeInteger(file.deletions) && (file.deletions as number) >= 0
    ))
  );
}

function isCommitDate(value: unknown): value is CommitDate {
  if (!value || typeof value !== "object") return false;
  const date = value as Partial<CommitDate>;
  return typeof date.recorded === "string" && typeof date.local === "string";
}

function isCommitDetail(value: unknown): value is CommitDetail {
  if (!value || typeof value !== "object") return false;
  const detail = value as Partial<CommitDetail>;
  const parents = Array.isArray(detail.parents) ? detail.parents : [];
  const selectedParentIsValid = parents.length === 0
    ? detail.selectedParentIndex === null && detail.selectedParentSha === null
    : Number.isSafeInteger(detail.selectedParentIndex) &&
      (detail.selectedParentIndex as number) >= 0 &&
      (detail.selectedParentIndex as number) < parents.length &&
      detail.selectedParentSha === parents[detail.selectedParentIndex as number];
  const summary = detail.summary as Partial<CommitDetail["summary"]> | undefined;
  return (
    detail.status === "ready" &&
    typeof detail.detailId === "string" &&
    /^[0-9a-f]{64}$/.test(detail.detailId) &&
    typeof detail.snapshotId === "string" &&
    /^[0-9a-f]{64}$/.test(detail.snapshotId) &&
    typeof detail.sha === "string" &&
    /^[0-9a-f]{40}$/.test(detail.sha) &&
    typeof detail.message === "string" &&
    typeof detail.authorName === "string" &&
    isCommitDate(detail.authorDate) &&
    isCommitDate(detail.committerDate) &&
    parents.every((parent) => typeof parent === "string" && /^[0-9a-f]{40}$/.test(parent)) &&
    Array.isArray(detail.refs) &&
    detail.refs.every(isHistoryRef) &&
    selectedParentIsValid &&
    !!summary &&
    Number.isSafeInteger(summary.totalFiles) &&
    (summary.totalFiles as number) >= 0 &&
    Number.isSafeInteger(summary.additions) &&
    (summary.additions as number) >= 0 &&
    Number.isSafeInteger(summary.deletions) &&
    (summary.deletions as number) >= 0 &&
    Number.isSafeInteger(summary.binaryFiles) &&
    (summary.binaryFiles as number) >= 0 &&
    Number.isSafeInteger(detail.loadedFileCount) &&
    (detail.loadedFileCount as number) >= 0 &&
    Number.isSafeInteger(detail.totalFileCount) &&
    (detail.totalFileCount as number) >= 0 &&
    (detail.totalFileCount as number) <= 100_000 &&
    (detail.loadedFileCount as number) <= (detail.totalFileCount as number) &&
    detail.filePageSize === 500 &&
    typeof detail.hasMoreFiles === "boolean" &&
    typeof detail.renameDetectionSkipped === "boolean" &&
    detail.hasMoreFiles === (
      (detail.loadedFileCount as number) < (detail.totalFileCount as number)
    ) &&
    Array.isArray(detail.files) &&
    detail.files.length === detail.loadedFileCount &&
    detail.files.every(isChangedFile)
  );
}

function isChangedFilePage(value: unknown): value is ChangedFilePage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<ChangedFilePage>;
  return (
    page.status === "ready" &&
    typeof page.detailId === "string" &&
    /^[0-9a-f]{64}$/.test(page.detailId) &&
    Number.isSafeInteger(page.previousLoadedCount) &&
    (page.previousLoadedCount as number) >= 0 &&
    (page.previousLastFileId === null || (
      typeof page.previousLastFileId === "string" &&
      /^[0-9a-f]{64}$/.test(page.previousLastFileId)
    )) &&
    Number.isSafeInteger(page.loadedCount) &&
    (page.loadedCount as number) >= 0 &&
    Number.isSafeInteger(page.totalCount) &&
    (page.totalCount as number) >= 0 &&
    (page.totalCount as number) <= 100_000 &&
    page.pageSize === 500 &&
    typeof page.hasMoreFiles === "boolean" &&
    Array.isArray(page.files) &&
    page.files.length > 0 &&
    page.files.length <= 500 &&
    page.files.every(isChangedFile)
  );
}

function isCommitDetailError(value: unknown): value is CommitDetailError {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<CommitDetailError>;
  return (
    error.status === "error" &&
    [
      "Commit detail is unavailable",
      "Commit detail request is stale",
      "Changed-file request timed out",
      "Changed-file page boundary is invalid",
      "Repository is temporarily locked — Refresh to retry",
      "Repository object is missing",
      "Repository object is corrupt",
    ].includes(String(error.message)) &&
    typeof error.code === "string"
  );
}

type LoadedCommitDetail =
  | { status: "ready"; detail: CommitDetail }
  | { status: "error"; message: string };

async function loadCommitDetail(
  snapshotId: string,
  commitSha: string,
  parentIndex: number,
): Promise<LoadedCommitDetail> {
  try {
    const result = (await rpcRequest("tools/call", {
      name: "get_commit_detail",
      arguments: { snapshotId, commitSha, parentIndex },
    })) as { structuredContent?: unknown };
    const structuredContent = restoreOmittedCommitDetailNulls(result?.structuredContent);
    if (
      isCommitDetail(structuredContent) &&
      commitDetailMatchesSelection(structuredContent, snapshotId, commitSha, parentIndex)
    ) {
      return { status: "ready", detail: structuredContent };
    }
    return {
      status: "error",
      message: isCommitDetailError(structuredContent)
        ? structuredContent.message
        : "Commit detail is unavailable",
    };
  } catch {
    return { status: "error", message: "Commit detail is unavailable" };
  }
}

function isFileDiffLine(value: unknown): value is FileDiffLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<FileDiffLine>;
  return (
    ["header", "hunk", "context", "addition", "deletion", "meta"].includes(
      String(line.kind),
    ) &&
    typeof line.content === "string" &&
    (line.oldLine === null || (
      Number.isSafeInteger(line.oldLine) && (line.oldLine as number) >= 0
    )) &&
    (line.newLine === null || (
      Number.isSafeInteger(line.newLine) && (line.newLine as number) >= 0
    ))
  );
}

function isFileDiff(value: unknown): value is FileDiff {
  if (!value || typeof value !== "object") return false;
  const diff = value as Partial<FileDiff>;
  const statistics = diff.statistics as Partial<FileDiff["statistics"]> | undefined;
  return (
    diff.status === "ready" &&
    typeof diff.detailId === "string" &&
    /^[0-9a-f]{64}$/.test(diff.detailId) &&
    typeof diff.fileId === "string" &&
    /^[0-9a-f]{64}$/.test(diff.fileId) &&
    typeof diff.path === "string" &&
    (diff.oldPath === null || typeof diff.oldPath === "string") &&
    !!statistics &&
    (statistics.additions === null || (
      Number.isSafeInteger(statistics.additions) && (statistics.additions as number) >= 0
    )) &&
    (statistics.deletions === null || (
      Number.isSafeInteger(statistics.deletions) && (statistics.deletions as number) >= 0
    )) &&
    Number.isSafeInteger(diff.bytes) &&
    (diff.bytes as number) >= 0 &&
    (diff.bytes as number) <= 1024 * 1024 &&
    Number.isSafeInteger(diff.lineCount) &&
    (diff.lineCount as number) >= 0 &&
    (diff.lineCount as number) <= 20_000 &&
    typeof diff.truncated === "boolean" &&
    (diff.truncated
      ? ["bytes", "lines"].includes(String(diff.truncatedBy))
      : diff.truncatedBy === null) &&
    Array.isArray(diff.lines) &&
    diff.lines.length === diff.lineCount &&
    diff.lines.every(isFileDiffLine)
  );
}

function isFileDiffError(value: unknown): value is FileDiffError {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<FileDiffError>;
  return (
    error.status === "error" &&
    [
      "File diff is unavailable",
      "File diff request is stale",
      "Repository is temporarily locked — Refresh to retry",
      "Repository object is missing",
      "Repository object is corrupt",
    ].includes(
      String(error.message),
    ) &&
    typeof error.code === "string" &&
    typeof error.detailId === "string" &&
    /^[0-9a-f]{64}$/.test(error.detailId) &&
    typeof error.fileId === "string" &&
    /^[0-9a-f]{64}$/.test(error.fileId) &&
    (error.path === null || typeof error.path === "string")
  );
}

/* ---- icons (bundled inline; CSP forbids external assets) ---- */

type IconProps = { size?: number };

function iconStyle(size: number): React.CSSProperties {
  return { width: size, height: size };
}

function SearchIcon({ size = 13 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" strokeLinecap="round" />
    </svg>
  );
}

function GraphIcon({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true" focusable="false">
      <circle cx="4.5" cy="3.5" r="1.7" />
      <circle cx="4.5" cy="12.5" r="1.7" />
      <circle cx="11.5" cy="5.5" r="1.7" />
      <path d="M4.5 5.2v5.6M11.5 7.2c0 3-4.5 2.2-6.3 4" />
    </svg>
  );
}

function TextIcon({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M3 4.5h10M3 8h10M3 11.5h6.5" />
    </svg>
  );
}

function RefreshIcon({ size = 16 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7M13.2 2.2v2.6h-2.6" />
    </svg>
  );
}

function ChevronUpIcon({ size = 12 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M3.5 10 8 5.5l4.5 4.5" />
    </svg>
  );
}

function ChevronDownIcon({ size = 12 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}

function CloseIcon({ size = 13 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function CopyIcon({ size = 12 }: IconProps): React.ReactElement {
  return (
    <svg className="gr-icon" style={iconStyle(size)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V4.5A1.5 1.5 0 0 1 4.5 3H11" />
    </svg>
  );
}

function FolderIcon(): React.ReactElement {
  return (
    <svg className="gr-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true" focusable="false">
      <path d="M1.8 4.2a1.4 1.4 0 0 1 1.4-1.4h3l1.5 1.7h5.1a1.4 1.4 0 0 1 1.4 1.4v6a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4z" />
    </svg>
  );
}

function WorktreeIcon(): React.ReactElement {
  return (
    <svg className="gr-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="9" height="9" rx="1.5" />
      <path d="M5 14h7.5A1.5 1.5 0 0 0 14 12.5V5" />
    </svg>
  );
}

/* ---- history rows ---- */

function SubjectText({
  subject,
  query,
  fallback,
}: {
  subject: string;
  query: string;
  fallback: string;
}): React.ReactElement {
  if (!subject) return <>{fallback}</>;
  const ranges = query === "" ? [] : subjectMatchRanges(subject, query);
  if (ranges.length === 0) return <>{subject}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start > cursor) parts.push(subject.slice(cursor, range.start));
    parts.push(<mark key={index}>{subject.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < subject.length) parts.push(subject.slice(cursor));
  return <>{parts}</>;
}

function inlineRefFor(commit: HistoryCommit): { ref: HistoryRef; head: boolean } | null {
  const primary = commit.inlineRefs[0] ?? null;
  if (!primary) return null;
  if (primary.kind !== "head") return { ref: primary, head: false };
  const branch = commit.inlineRefs.find((ref) => ref.kind === "local-branch") ??
    commit.refs.find((ref) => ref.kind === "local-branch");
  return branch ? { ref: branch, head: true } : { ref: primary, head: true };
}

type HistoryRowProps = {
  commit: HistoryCommit;
  mode: "graph" | "text";
  row: HistoryGraphRow | null;
  graphWidth: number;
  railWidth: number;
  scrollLeft: number;
  snapshotTime: number;
  copy: Copy;
  selected: boolean;
  selectionLocked: boolean;
  searching: boolean;
  matched: boolean;
  currentMatch: boolean;
  query: string;
  loadedShas: Set<string>;
  registerRail: (sha: string, element: HTMLDivElement | null) => void;
  onRailScroll: (source: HTMLDivElement) => void;
  onRevealParent: (direction: "left" | "right", row: HistoryGraphRow) => void;
  onSelect: (commit: HistoryCommit) => void;
  onStepSelection: (commit: HistoryCommit, delta: 1 | -1) => void;
};

function HistoryRow({
  commit,
  mode,
  row,
  graphWidth,
  railWidth,
  scrollLeft,
  snapshotTime,
  copy,
  selected,
  selectionLocked,
  searching,
  matched,
  currentMatch,
  query,
  loadedShas,
  registerRail,
  onRailScroll,
  onRevealParent,
  onSelect,
  onStepSelection,
}: HistoryRowProps): React.ReactElement {
  const geometry = row === null ? null : graphRowGeometry(row);
  const head = commit.refs.some((ref) => ref.kind === "head");
  const relativeTime = formatRelativeTime(commit.committerTime, snapshotTime, copy.locale);
  const hiddenParents = row === null
    ? { left: 0, right: 0 }
    : countOffscreenParents(
        row.routes.map((route) => route.parentLane),
        { scrollLeft, railWidth },
      );
  const register = useCallback(
    (element: HTMLDivElement | null) => registerRail(commit.sha, element),
    [commit.sha, registerRail],
  );
  const select = () => {
    if (!selectionLocked) onSelect(commit);
  };
  const activateRow = (event: React.MouseEvent<HTMLLIElement>) => {
    const direction = (event.target as Element).closest<HTMLElement>("[data-reveal-parent]")
      ?.dataset.revealParent;
    if (row !== null && (direction === "left" || direction === "right")) {
      onRevealParent(direction, row);
      return;
    }
    select();
  };
  const inlineRef = inlineRefFor(commit);
  const overflowRefCount = inlineRef === null
    ? commit.refs.length
    : commit.refs.length - 1;
  const nodeColor = row === null ? "var(--gr-text-faint)" : `var(--lane-${row.lane % 8})`;
  const isMergeNode = commit.topologyRole === "merge" ||
    commit.topologyRole === "octopus merge";
  const nodeY = GRAPH_METRICS.rowHeight / 2;
  const classes = [
    "gr-row",
    `role-${commit.topologyRole.replaceAll(" ", "-")}`,
    searching && !matched ? "gr-dim" : "",
    searching && matched ? "gr-match" : "",
    currentMatch ? "gr-match-current" : "",
  ].filter(Boolean).join(" ");

  return (
    <li
      className={classes}
      role="option"
      tabIndex={selectionLocked ? -1 : 0}
      aria-selected={selected}
      aria-disabled={selectionLocked ? "true" : undefined}
      data-commit-sha={commit.sha}
      data-lane={row?.lane}
      aria-label={commitAccessibilityLabel(copy, {
        subject: commit.subject,
        selected,
        role: commit.topologyRole,
        lane: row === null ? undefined : row.lane + 1,
        parents: commit.parents.map((parent) => ({
          shortSha: parent.sha.slice(0, 7),
          state: loadedShas.has(parent.sha)
            ? "loaded"
            : commit.shallowBoundary ? "shallow" : "continuation",
        })),
        refs: commit.refs.map((ref) => ({
          name: ref.name,
          worktree: ref.kind === "local-branch" && ref.checkedOut,
        })),
        shortSha: commit.shortSha,
        relativeTime,
        offscreenParents: row === null ? undefined : hiddenParents,
      })}
      onClick={activateRow}
      onKeyDown={(event) => {
        if (isActivationKey(event.key)) {
          event.preventDefault();
          select();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          if (!selectionLocked) onStepSelection(commit, 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          if (!selectionLocked) onStepSelection(commit, -1);
        } else if (
          row !== null && selected && event.key === "ArrowLeft" && hiddenParents.left > 0
        ) {
          event.preventDefault();
          onRevealParent("left", row);
        } else if (
          row !== null && selected && event.key === "ArrowRight" && hiddenParents.right > 0
        ) {
          event.preventDefault();
          onRevealParent("right", row);
        }
      }}
    >
      {mode === "graph" && row !== null && geometry !== null ? (
        <div className="graph-rail-shell" aria-hidden="true">
          <div
            className="graph-rail-viewport"
            ref={register}
            tabIndex={-1}
            onScroll={(event) => onRailScroll(event.currentTarget)}
          >
            <svg
              className="graph-row-svg"
              width={graphWidth}
              height={GRAPH_METRICS.rowHeight}
              viewBox={`0 0 ${graphWidth} ${GRAPH_METRICS.rowHeight}`}
              aria-hidden="true"
              focusable="false"
            >
              {geometry.paths.map((path, index) => (
                <g key={`path-${index}`}>
                  <path
                    className="graph-path-casing"
                    d={path.d}
                    strokeWidth={path.casingWidth}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    className="graph-path-color"
                    d={path.d}
                    stroke={`var(--lane-${path.lane % 8})`}
                    strokeWidth={path.lineWidth}
                    vectorEffect="non-scaling-stroke"
                    data-kind={path.kind}
                    data-parent-index={path.parentIndex ?? undefined}
                  />
                </g>
              ))}
              <circle
                className="graph-node-casing"
                cx={geometry.nodeX}
                cy={nodeY}
                r={selected ? 9.5 : isMergeNode ? 7.5 : 5.5}
              />
              {head ? (
                <circle
                  className="graph-head-halo"
                  cx={geometry.nodeX}
                  cy={nodeY}
                  r={12.5}
                />
              ) : null}
              {selected ? (
                <circle
                  className="graph-selection-ring"
                  cx={geometry.nodeX}
                  cy={nodeY}
                  r={8}
                />
              ) : null}
              {isMergeNode ? (
                <circle
                  className="graph-node"
                  cx={geometry.nodeX}
                  cy={nodeY}
                  r={4.5}
                  fill="var(--gr-sheet)"
                  stroke={nodeColor}
                  strokeWidth={2.5}
                />
              ) : (
                <circle
                  className="graph-node"
                  cx={geometry.nodeX}
                  cy={nodeY}
                  r={3.5}
                  fill={nodeColor}
                />
              )}
              {commit.topologyRole === "octopus merge" ? (
                <circle
                  className="graph-octopus-core"
                  cx={geometry.nodeX}
                  cy={nodeY}
                  r={1.7}
                  fill={nodeColor}
                />
              ) : null}
            </svg>
          </div>
          {selected && hiddenParents.left > 0 ? (
            <span
              className="graph-edge-indicator graph-edge-indicator-left"
              data-reveal-parent="left"
              title={copy.offscreenParents(hiddenParents.left, hiddenParents.right)}
            >
              ←{hiddenParents.left}
            </span>
          ) : null}
          {selected && hiddenParents.right > 0 ? (
            <span
              className="graph-edge-indicator graph-edge-indicator-right"
              data-reveal-parent="right"
              title={copy.offscreenParents(hiddenParents.left, hiddenParents.right)}
            >
              {hiddenParents.right}→
            </span>
          ) : null}
        </div>
      ) : (
        <span className="gr-topo" aria-hidden="true" />
      )}
      <div className="gr-row-copy">
        <span className="gr-subject" title={commit.subject}>
          <SubjectText
            subject={commit.subject}
            query={searching && matched ? query : ""}
            fallback={copy.noSubject}
          />
        </span>
        <span className="gr-refs" aria-hidden="true">
          {inlineRef !== null ? (
            <span
              className={[
                "gr-pill",
                inlineRef.head || inlineRef.ref.kind === "head" ? "head" : "",
                searching && refMatchesQuery(inlineRef.ref, query) ? "gr-pill-match" : "",
              ].filter(Boolean).join(" ")}
              title={inlineRef.ref.fullName}
            >
              {inlineRef.ref.name}
              {inlineRef.ref.kind === "local-branch" && inlineRef.ref.checkedOut ? (
                <span className="gr-worktree-badge">{copy.worktree}</span>
              ) : null}
            </span>
          ) : null}
          {commit.shallowBoundary ? (
            <span className="gr-pill">{copy.shallowBoundary}</span>
          ) : null}
          {overflowRefCount > 0 ? (
            <span
              className="gr-pill"
              title={commit.refs
                .filter((ref) => ref !== inlineRef?.ref)
                .map((ref) => ref.name)
                .join(", ")}
            >
              +{overflowRefCount}
            </span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

/* ---- history list (graph rail synchronization + footer) ---- */

function HistoryList({
  history,
  layout,
  mode,
  loadedShas,
  selectedSha,
  selectionLocked,
  searching,
  matchedShas,
  currentMatchSha,
  query,
  scrollLeft,
  loadingMore,
  paginationBlocked,
  copy,
  onScrollLeftChange,
  onSelect,
  onStepSelection,
  onLoadMore,
}: {
  history: HistorySnapshot;
  layout: HistoryGraphLayout;
  mode: "graph" | "text";
  loadedShas: Set<string>;
  selectedSha: string | null;
  selectionLocked: boolean;
  searching: boolean;
  matchedShas: ReadonlySet<string>;
  currentMatchSha: string | null;
  query: string;
  scrollLeft: number;
  loadingMore: boolean;
  paginationBlocked: boolean;
  copy: Copy;
  onScrollLeftChange: (scrollLeft: number) => void;
  onSelect: (commit: HistoryCommit) => void;
  onStepSelection: (commit: HistoryCommit, delta: 1 | -1) => void;
  onLoadMore: () => void;
}): React.ReactElement {
  const railElements = useRef(new Map<string, HTMLDivElement>());
  const scrollLeftRef = useRef(scrollLeft);
  const revealedSelectionRef = useRef<string | null>(selectedSha);
  const [railWidth, setRailWidth] = useState(
    Math.min(layout.graphWidth, GRAPH_METRICS.railCap),
  );
  const rowBySha = useMemo(
    () => new Map(layout.rows.map((row) => [row.sha, row])),
    [layout],
  );
  const registerRail = useCallback((sha: string, element: HTMLDivElement | null) => {
    if (element) {
      railElements.current.set(sha, element);
      element.scrollLeft = scrollLeftRef.current;
      if (element.clientWidth > 0) setRailWidth(element.clientWidth);
    } else {
      railElements.current.delete(sha);
    }
  }, []);

  useEffect(() => {
    scrollLeftRef.current = scrollLeft;
    for (const element of railElements.current.values()) {
      if (element.scrollLeft !== scrollLeft) element.scrollLeft = scrollLeft;
    }
  }, [scrollLeft]);

  const synchronizeScroll = useCallback((next: number, source?: HTMLDivElement) => {
    const maximum = Math.max(0, layout.graphWidth - railWidth);
    const clamped = Math.min(Math.max(0, next), maximum);
    for (const element of railElements.current.values()) {
      if (element !== source && element.scrollLeft !== clamped) element.scrollLeft = clamped;
    }
    if (source && source.scrollLeft !== clamped) source.scrollLeft = clamped;
    onScrollLeftChange(clamped);
  }, [layout.graphWidth, onScrollLeftChange, railWidth]);

  const onRailScroll = useCallback((source: HTMLDivElement) => {
    synchronizeScroll(source.scrollLeft, source);
    if (source.clientWidth > 0 && source.clientWidth !== railWidth) {
      setRailWidth(source.clientWidth);
    }
  }, [railWidth, synchronizeScroll]);

  useEffect(() => {
    if (selectedSha === revealedSelectionRef.current) return;
    revealedSelectionRef.current = selectedSha;
    if (!selectedSha) return;
    const row = rowBySha.get(selectedSha);
    if (!row) return;
    synchronizeScroll(
      minimumLaneReveal(scrollLeft, railWidth, graphLaneX(row.lane), layout.graphWidth),
    );
  }, [
    layout.graphWidth,
    railWidth,
    rowBySha,
    scrollLeft,
    selectedSha,
    synchronizeScroll,
  ]);

  const revealParent = useCallback((direction: "left" | "right", row: HistoryGraphRow) => {
    const candidates = row.routes
      .map((route) => graphLaneX(route.parentLane))
      .filter((position) => direction === "left"
        ? position < scrollLeft
        : position > scrollLeft + railWidth)
      .sort((left, right) => left - right);
    const position = direction === "left" ? candidates.at(-1) : candidates[0];
    if (position === undefined) return;
    synchronizeScroll(
      minimumLaneReveal(scrollLeft, railWidth, position, layout.graphWidth),
    );
  }, [layout.graphWidth, railWidth, scrollLeft, synchronizeScroll]);

  const style = {
    "--graph-rail-width": `min(${layout.graphWidth}px, ${GRAPH_METRICS.railCap}px, calc(100% - ${GRAPH_METRICS.subjectMinimum}px))`,
  } as React.CSSProperties;
  const continuingLaneCount = layout.openLanes.filter(Boolean).length;

  return (
    <>
      <ol
        className={mode === "graph" ? "graph-commit-list" : "text-commit-list"}
        style={mode === "graph" ? style : undefined}
        role="listbox"
        aria-label={copy.commitHistory}
        data-lane-count={layout.laneCount}
      >
        {history.commits.map((commit) => (
          <HistoryRow
            commit={commit}
            mode={mode}
            row={mode === "graph" ? rowBySha.get(commit.sha) ?? null : null}
            graphWidth={layout.graphWidth}
            railWidth={railWidth}
            scrollLeft={scrollLeft}
            snapshotTime={history.snapshotTime}
            copy={copy}
            selected={selectedSha === commit.sha}
            selectionLocked={selectionLocked}
            searching={searching}
            matched={matchedShas.has(commit.sha)}
            currentMatch={currentMatchSha === commit.sha}
            query={query}
            loadedShas={loadedShas}
            registerRail={registerRail}
            onRailScroll={onRailScroll}
            onRevealParent={revealParent}
            onSelect={onSelect}
            onStepSelection={onStepSelection}
            key={commit.sha}
          />
        ))}
      </ol>
      {history.hasContinuation && continuingLaneCount > 0 ? (
        <p className="graph-boundary" role="status">
          {copy.graphBoundary(continuingLaneCount)}
        </p>
      ) : null}
      <div className="gr-list-footer">
        {history.hasContinuation && history.hasMore ? (
          <button
            type="button"
            className="gr-loadmore continuation-boundary-action"
            disabled={paginationBlocked || loadingMore || selectionLocked}
            onClick={onLoadMore}
          >
            ↘ {loadingMore ? copy.loading : copy.loadContinuation}
          </button>
        ) : null}
        {history.hasMore ? (
          <button
            type="button"
            className="gr-loadmore load-more-action"
            disabled={paginationBlocked || loadingMore || selectionLocked}
            onClick={onLoadMore}
          >
            {loadingMore ? copy.loading : copy.loadMore}
          </button>
        ) : null}
        <span>{copy.loadedCommits(history.loadedCount)}</span>
      </div>
    </>
  );
}

/* ---- commit sheet ---- */

function fileStatistics(
  copy: Copy,
  statistics: { additions: number | null; deletions: number | null },
): React.ReactElement {
  if (statistics.additions === null || statistics.deletions === null) {
    return <span className="gr-filestat">{copy.binary}</span>;
  }
  return (
    <span className="gr-filestat">
      <span className="add">+{statistics.additions}</span>{" "}
      <span className="del">−{statistics.deletions}</span>
    </span>
  );
}

/** Placeholder shimmer shown while a commit's detail loads; the row
 * widths only shape the silhouette. Screen readers get the existing
 * aria-live loading announcement instead. */
function SheetSkeleton({ widths }: { widths: number[] }): React.ReactElement {
  return (
    <div className="gr-skeleton" aria-hidden="true">
      {widths.map((width, index) => (
        <span key={index} style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

function fileBaseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function fileDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator + 1);
}

/** Compact `yyyy-mm-dd hh:mm` in the commit's recorded wall time; the
 * full recorded/local strings stay available on hover. */
function formatCommitDateDisplay(recorded: string): string {
  const match = recorded.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : recorded;
}

function SheetDetailSection({
  subject,
  laneIndex,
  detail,
  loading,
  notice,
  interactionLocked,
  selectedParentIndex,
  shaCopyStatus,
  handoffModality,
  handoffStatus,
  copy,
  onCopySha,
  onSelectParent,
  onConversationHandoff,
}: {
  subject: string;
  laneIndex: number;
  detail: CommitDetail | null;
  loading: boolean;
  notice: string | null;
  interactionLocked: boolean;
  selectedParentIndex: number;
  shaCopyStatus: "idle" | "copied" | "failed";
  handoffModality: ConversationHandoffModality | null;
  handoffStatus: "idle" | "sending" | "sent" | "failed";
  copy: Copy;
  onCopySha: () => void;
  onSelectParent: (index: number) => void;
  onConversationHandoff: () => void;
}): React.ReactElement {
  return (
    <section className="gr-detail" aria-label={copy.commitDetail}>
      <h2 className="gr-detail-subject">
        <span
          className="gr-lane-thread"
          aria-hidden="true"
          style={{ background: `var(--lane-${laneIndex % 8})` }}
        />
        {subject || copy.noSubject}
      </h2>
      {detail?.renameDetectionSkipped ? (
        <p className="gr-note" role="status">{copy.renameDetectionSkipped}</p>
      ) : null}
      {notice !== null ? (
        <p className="gr-note" role="status" aria-live="polite">
          {translateServiceMessage(notice, copy)}
        </p>
      ) : null}
      {detail === null ? (
        loading ? (
          <SheetSkeleton widths={[88, 56, 72, 40, 80, 52]} />
        ) : null
      ) : (
        <>
          <dl className="gr-meta">
            <div>
              <dt>{copy.metaSha}</dt>
              <dd className="gr-sha">
                <code title={detail.sha}>{detail.sha}</code>
                <button
                  type="button"
                  className="gr-copy"
                  aria-label={copy.copySha}
                  title={copy.copySha}
                  onClick={onCopySha}
                >
                  <CopyIcon />
                </button>
                <span className="visually-hidden" role="status" aria-live="polite">
                  {shaCopyStatus === "copied"
                    ? copy.shaCopied
                    : shaCopyStatus === "failed" ? copy.copyFailed : ""}
                </span>
              </dd>
            </div>
            <div>
              <dt>{copy.metaParents}</dt>
              <dd>
                {detail.parents.length === 0 ? (
                  copy.noDirectParents
                ) : detail.parents.length === 1 ? (
                  <code title={detail.parents[0]}>{detail.parents[0].slice(0, 7)}</code>
                ) : (
                  <span
                    className="gr-parents"
                    role="group"
                    aria-label={copy.compareWithParent}
                  >
                    {/* The options stay enabled while a parent's detail loads:
                        disabling them would drop keyboard focus to the body.
                        Rapid switching is debounced by the detail effect. */}
                    {detail.parents.map((parent, index) => (
                      <button
                        type="button"
                        className="gr-parent-option"
                        aria-pressed={selectedParentIndex === index}
                        aria-label={`${copy.parent(index + 1)} ${parent.slice(0, 7)}`}
                        title={parent}
                        onClick={() => onSelectParent(index)}
                        key={parent}
                      >
                        {parent.slice(0, 7)}
                      </button>
                    ))}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>{copy.author}</dt>
              <dd>{detail.authorName || copy.noAuthorName}</dd>
            </div>
            <div>
              <dt>{copy.authorDate}</dt>
              <dd title={`${detail.authorDate.recorded} · ${detail.authorDate.local}`}>
                <time dateTime={detail.authorDate.recorded}>
                  {formatCommitDateDisplay(detail.authorDate.recorded)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{copy.committerDate}</dt>
              <dd title={`${detail.committerDate.recorded} · ${detail.committerDate.local}`}>
                <time dateTime={detail.committerDate.recorded}>
                  {formatCommitDateDisplay(detail.committerDate.recorded)}
                </time>
              </dd>
            </div>
          </dl>
          {detail.refs.length === 0 ? (
            <p className="gr-note">{copy.noRefs}</p>
          ) : (
            <ul className="gr-detail-refs" aria-label={copy.completeRefSet}>
              {detail.refs.map((ref) => (
                <li key={ref.fullName}>
                  <span
                    className={`gr-pill${ref.kind === "head" ? " head" : ""}`}
                    title={ref.fullName}
                  >
                    {ref.name}
                    {ref.kind === "local-branch" && ref.checkedOut ? (
                      <span className="gr-worktree-badge">{copy.worktree}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <pre className="gr-message">{detail.message || copy.noCommitMessage}</pre>
          {handoffModality !== null ? (
            <div className="gr-handoff">
              <button
                type="button"
                className="gr-action"
                disabled={interactionLocked || handoffStatus === "sending"}
                onClick={onConversationHandoff}
              >
                {handoffStatus === "sending"
                  ? copy.sharingCommitSha
                  : copy.useCommitShaInConversation}
              </button>
              {handoffStatus === "sent" ? (
                <p role="status" aria-live="polite">{copy.commitShaShared}</p>
              ) : handoffStatus === "failed" ? (
                <p role="status" aria-live="polite">{copy.conversationHandoffFailed}</p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function SheetFilesSection({
  detail,
  selectedFileId,
  loadingMoreFiles,
  interactionLocked,
  loading,
  copy,
  onSelectFile,
  onLoadMoreFiles,
}: {
  detail: CommitDetail | null;
  selectedFileId: string | null;
  loadingMoreFiles: boolean;
  interactionLocked: boolean;
  loading: boolean;
  copy: Copy;
  onSelectFile: (file: ChangedFile) => void;
  onLoadMoreFiles: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  useEffect(() => {
    setQuery("");
  }, [detail?.detailId]);
  const files = detail?.files ?? [];
  const visibleFiles = useMemo(
    () => searchLoadedChangedFiles(files, query),
    [files, query],
  );
  const searchable = detail !== null &&
    detail.loadedFileCount >= FILE_SEARCH_MINIMUM_ENTRIES;

  return (
    <section className="gr-files" aria-label={copy.changedFiles}>
      {detail === null ? (
        loading ? <SheetSkeleton widths={[64, 52, 70, 44, 58]} /> : null
      ) : (
        <>
          <div className="gr-files-head">
            <span>{copy.changedFilesCount(detail.summary.totalFiles)}</span>
            {fileStatistics(copy, {
              additions: detail.summary.additions,
              deletions: detail.summary.deletions,
            })}
          </div>
          {detail.loadedFileCount < detail.totalFileCount ? (
            <p className="gr-note">
              {copy.loadedFiles(detail.loadedFileCount, detail.totalFileCount)}
            </p>
          ) : null}
          {detail.summary.binaryFiles > 0 ? (
            <p className="gr-note">
              {copy.fileSummary(
                detail.summary.totalFiles,
                detail.summary.additions,
                detail.summary.deletions,
                detail.summary.binaryFiles,
              )}
            </p>
          ) : null}
          {searchable ? (
            <>
              <div className="gr-files-search">
                <SearchIcon size={11} />
                <input
                  type="search"
                  value={query}
                  aria-label={copy.searchLoadedFiles}
                  placeholder={copy.fileSearchPlaceholder}
                  autoComplete="off"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
              {query.trim() !== "" ? (
                <p className="gr-note" role="status" aria-live="polite">
                  {copy.fileSearchResult(visibleFiles.length, detail.loadedFileCount)}
                </p>
              ) : null}
            </>
          ) : null}
          {visibleFiles.length === 0 ? (
            <p className="gr-note">
              {detail.totalFileCount === 0 ? copy.noChangedFiles : copy.noMatchingFiles}
            </p>
          ) : (
            <ul className="gr-file-list">
              {visibleFiles.map((file) => (
                <li key={file.fileId}>
                  <button
                    type="button"
                    className="gr-file"
                    data-file-id={file.fileId}
                    aria-pressed={selectedFileId === file.fileId}
                    aria-label={fileAccessibilityLabel(copy, {
                      selected: selectedFileId === file.fileId,
                      status: file.status,
                      path: file.path,
                      oldPath: file.oldPath,
                      additions: file.additions,
                      deletions: file.deletions,
                    })}
                    disabled={interactionLocked}
                    title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                    onClick={() => onSelectFile(file)}
                  >
                    <span
                      className={`gr-badge${
                        file.status === "added"
                          ? " added"
                          : file.status === "deleted" ? " deleted" : ""
                      }`}
                      aria-hidden="true"
                    >
                      {copy.fileStatusBadge(file.status)}
                    </span>
                    <span className="gr-file-text">
                      <code className="gr-file-name">{fileBaseName(file.path)}</code>
                      {file.oldPath !== null || fileDirectory(file.path) !== "" ? (
                        <code className="gr-file-dir">
                          {file.oldPath ? <><s>{file.oldPath}</s> → </> : null}
                          {fileDirectory(file.path)}
                        </code>
                      ) : null}
                    </span>
                    {fileStatistics(copy, {
                      additions: file.additions,
                      deletions: file.deletions,
                    })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {detail.hasMoreFiles ? (
            <button
              type="button"
              className="gr-loadmore load-more-files-action"
              disabled={loadingMoreFiles || interactionLocked}
              onClick={onLoadMoreFiles}
            >
              {loadingMoreFiles ? copy.loadingFiles : copy.loadMoreFiles}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function SheetDiffSection({
  file,
  diff,
  loading,
  notice,
  copy,
  frozen = false,
  onClose,
}: {
  file: ChangedFile;
  diff: FileDiff | null;
  loading: boolean;
  notice: DiffNotice | null;
  copy: Copy;
  frozen?: boolean;
  onClose: () => void;
}): React.ReactElement {
  const diffViewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (frozen) return;
    if (diff && !loading && !notice) diffViewport.current?.focus({ preventScroll: true });
  }, [diff, loading, notice, frozen]);
  const statistics = diff?.statistics ??
    { additions: file.additions, deletions: file.deletions };

  return (
    <section className="gr-diff">
      <div className="gr-diff-head">
        <code className="gr-diff-file" title={file.path}>
          {file.oldPath ? <><s>{file.oldPath}</s> → </> : null}
          {file.path}
        </code>
        {fileStatistics(copy, statistics)}
        <button
          type="button"
          className="gr-iconbtn"
          aria-label={copy.closeDiff}
          title={copy.closeDiff}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      {diff?.truncated ? (
        <p className="gr-diff-notice" role="status">
          {copy.diffTruncated} · {copy.originalFileStatistics}{" "}
          {statistics.additions === null || statistics.deletions === null
            ? copy.binary
            : `+${statistics.additions} −${statistics.deletions}`}
        </p>
      ) : null}
      {loading ? (
        <p className="gr-diff-empty gr-loading" role="status">
          {copy.loadingDiff(file.path)}
        </p>
      ) : notice ? (
        <p className="gr-diff-empty" role="status">
          {translateServiceMessage(notice.message, copy)}: {notice.path}
        </p>
      ) : diff === null ? null : diff.lines.length === 0 ? (
        <p className="gr-diff-empty">{copy.binary}</p>
      ) : (
        <div
          className="gr-diff-scroll"
          ref={diffViewport}
          tabIndex={0}
          aria-label={copy.unifiedDiffFor(diff.path)}
        >
          <table>
            <caption className="visually-hidden">{copy.unifiedDiffFor(diff.path)}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{copy.oldLine}</th>
                <th scope="col">{copy.newLine}</th>
                <th scope="col">{copy.plainTextDiff}</th>
              </tr>
            </thead>
            <tbody>
              {diff.lines.map((line, index) => (
                <tr
                  className={`diff-${line.kind}`}
                  aria-label={diffLineAccessibilityLabel(copy, line)}
                  key={`${index}:${line.kind}`}
                >
                  {line.kind === "hunk" || line.kind === "header" || line.kind === "meta" ? (
                    <td className="diff-line-content" colSpan={3}>
                      <code>{line.content}</code>
                    </td>
                  ) : (
                    <>
                      <td className="diff-line-number">{line.oldLine ?? ""}</td>
                      <td className="diff-line-number">{line.newLine ?? ""}</td>
                      <td className="diff-line-content"><code>{line.content}</code></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---- status bar ---- */

function StatusBar({
  state,
  copy,
}: {
  state: Extract<RepositoryState, { status: "ready" }>;
  copy: Copy;
}): React.ReactElement {
  const items = statusBarItems(
    {
      path: state.repositoryPath,
      branch: state.branch,
      worktreeName: state.worktreeName,
    },
    copy.detachedHead,
  );
  const iconFor = {
    path: <FolderIcon />,
    branch: <GraphIcon size={12} />,
    worktree: <WorktreeIcon />,
  } as const;
  const labelFor = {
    path: copy.repositoryLocation,
    branch: copy.branchLabel,
    worktree: copy.worktree,
  } as const;

  return (
    <footer className="gr-statusbar" aria-label={copy.repositoryStatus}>
      {items.map((item) => (
        <span
          className={`gr-status-item${item.kind === "path" ? " gr-status-path" : ""}`}
          title={item.title}
          aria-label={`${labelFor[item.kind]}: ${item.value}`}
          key={item.kind}
        >
          {iconFor[item.kind]}
          <code aria-hidden="true">{item.value}</code>
        </span>
      ))}
    </footer>
  );
}

/* ---- complete view ---- */

/* Watchdog bounds for the one-shot entrance (§4.3): generous multiples
   of the choreography's own runtime (card arrival 970 ms, sentinel
   1000 ms), so they never race a healthy animationend and only catch
   entrances whose release event was lost. */
const ENTRANCE_ARMED_FALLBACK_MS = 8000;
const ENTRANCE_READY_FALLBACK_MS = 4000;

function GitRightView({
  locale,
  entrance = false,
}: {
  locale: GitRightLocale;
  entrance?: boolean;
}): React.ReactElement {
  const copy = useMemo(() => copyFor(locale), [locale]);
  const [restoredWidgetState] = useState(() =>
    parsePersistedWidgetState(window.openai?.widgetState)
  );
  /* One-shot pane entrance: armed only when fullscreen was reached
     through the launcher; released by the CSS sentinel's animationend.
     The rest of the choreography (header, rows, sheet) waits for the
     arriving card to finish opening — signalled by its animationend.
     The signal rides on the card rather than the header wordmark
     because the wordmark is display:none below 480 CSS px, and a
     display:none element never runs an animation to report. */
  const [entranceDone, setEntranceDone] = useState(false);
  const [entranceOpened, setEntranceOpened] = useState(false);
  const [state, setState] = useState<RepositoryState>({
    status: "loading",
    message: "Opening repository…",
  });
  const [history, setHistory] = useState<HistoryViewState>({ status: "idle" });
  /* A history error aborts the entrance outright so the error message
     is never left hidden behind the logo-only stage. */
  const entranceActive = entrance && !entranceDone && history.status !== "error";
  const entranceReady = entranceActive && entranceOpened && history.status === "ready";
  /* The release above is driven by animationend, but the host can cancel
     a CSS animation without ever finishing it — a dynamic
     prefers-reduced-motion flip, a display:none while the pane resizes,
     a reparented frame. A canceled one-shot would otherwise leave the
     opacity guard in place forever, so any cancellation of an
     entrance-critical animation abandons the choreography and shows the
     finished view at once. The listener sits on the document (capture
     phase) so it works from the first render, before the complete
     view's own subtree exists. */
  useEffect(() => {
    if (!entranceActive) return;
    const abort = (event: Event) => {
      const animationName = (event as AnimationEvent).animationName;
      if (animationName === "gr-ent-open" || animationName === "gr-entrance-end") {
        setEntranceDone(true);
      }
    };
    document.addEventListener("animationcancel", abort, true);
    return () => document.removeEventListener("animationcancel", abort, true);
  }, [entranceActive]);

  /* Last-resort watchdog for cancellations that never reach the frame
     (for example the sentinel unmounting mid-flight): the choreography
     has a bounded runtime, so an entrance still unreleased well past
     that bound has lost its animationend and is force-completed. */
  useEffect(() => {
    if (!entranceActive) return;
    const timer = window.setTimeout(
      () => setEntranceDone(true),
      entranceReady ? ENTRANCE_READY_FALLBACK_MS : ENTRANCE_ARMED_FALLBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [entranceActive, entranceReady]);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<HistoryCommit | null>(null);
  const [selectedParentIndex, setSelectedParentIndex] = useState(0);
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const [diffLayerOpen, setDiffLayerOpen] = useState(false);
  const [diffLayerClosing, setDiffLayerClosing] = useState(false);
  const diffSwitchDirection = useRef<"forward" | "backward" | null>(null);
  const [outgoingDiff, setOutgoingDiff] = useState<
    {
      file: ChangedFile;
      diff: FileDiff | null;
      loading: boolean;
      notice: DiffNotice | null;
      direction: "forward" | "backward";
    } | null
  >(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffNotice, setDiffNotice] = useState<DiffNotice | null>(null);
  const [loadingMoreFiles, setLoadingMoreFiles] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [paginationBlocked, setPaginationBlocked] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [shaCopyStatus, setShaCopyStatus] =
    useState<"idle" | "copied" | "failed">("idle");
  const [handoffModality, setHandoffModality] =
    useState<ConversationHandoffModality | null>(null);
  const [handoffStatus, setHandoffStatus] =
    useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [historyPresentation, setHistoryPresentation] = useState(() => ({
    query: restoredWidgetState.query,
    topologyMode: restoredWidgetState.mode,
    graphScrollLeft: 0,
  }));
  const [matchCursor, setMatchCursor] = useState(0);
  const [widgetStateReady, setWidgetStateReady] = useState(false);
  const lastSynchronizedWidgetState = useRef<string | null>(null);
  const graphScrollElement = useRef<HTMLDivElement | null>(null);
  const initialRevealDone = useRef(false);
  const detailRequestId = useRef(0);
  const handoffRequestId = useRef(0);
  const handoffInFlight = useRef(false);
  const selectedShaRef = useRef<string | null>(selectedSha);
  const [refreshGuard] = useState(createHistoryRefreshGuard);
  const [changedFilePageGuard] = useState(createChangedFilePageGuard);
  const [fileDiffRequestGuard] = useState(createFileDiffRequestGuard);
  const historySnapshotId = history.status === "ready" ? history.snapshotId : null;
  const selectedCommitIsLoaded = history.status === "ready" && selectedSha !== null
    ? history.commits.some((commit) => commit.sha === selectedSha)
    : false;
  const commitDetailMatchesCurrentSelection = commitDetail !== null &&
    commitDetailMatchesSelection(
      commitDetail,
      historySnapshotId,
      selectedSha,
      selectedParentIndex,
    );
  selectedShaRef.current = selectedSha;

  const { query, topologyMode, graphScrollLeft } = historyPresentation;
  const graphLayoutCache = useRef<{
    snapshotId: string;
    commits: HistoryCommit[];
    layout: HistoryGraphLayout;
  } | null>(null);
  const loadedShas = useMemo(
    () => new Set(history.status === "ready" ? history.commits.map((commit) => commit.sha) : []),
    [history],
  );
  const graphLayout = useMemo(() => {
    if (history.status !== "ready") return createHistoryGraphLayout([]);
    const previous = graphLayoutCache.current;
    const sameSnapshotPrefix = previous?.snapshotId === history.snapshotId &&
      previous.commits.length <= history.commits.length &&
      previous.commits.every((commit, index) => history.commits[index]?.sha === commit.sha);
    const layout = sameSnapshotPrefix && previous
      ? appendHistoryGraphLayout(previous.layout, history.commits.slice(previous.commits.length))
      : createHistoryGraphLayout(history.commits, history.headSha);
    graphLayoutCache.current = {
      snapshotId: history.snapshotId,
      commits: history.commits,
      layout,
    };
    return layout;
  }, [history]);
  const selectedLaneIndex = useMemo(() => {
    if (selectedSha === null) return 0;
    return graphLayout.rows.find((row) => row.sha === selectedSha)?.lane ?? 0;
  }, [graphLayout, selectedSha]);

  const searchMatches = useMemo(
    () => (history.status === "ready"
      ? matchLoadedHistory(history.commits, query)
      : EMPTY_HISTORY_SEARCH_MATCHES),
    [history, query],
  );
  const searching = searchMatches.query !== "";
  const matchTotal = searchMatches.matchOrder.length;
  const safeMatchCursor = matchTotal === 0 ? 0 : Math.min(matchCursor, matchTotal - 1);
  const currentMatchSha = matchTotal > 0
    ? searchMatches.matchOrder[safeMatchCursor]
    : null;

  useEffect(() => {
    setMatchCursor(0);
  }, [searchMatches.query]);

  useEffect(() => {
    if (!searching || currentMatchSha === null) return;
    graphScrollElement.current
      ?.querySelector(`[data-commit-sha="${currentMatchSha}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentMatchSha, safeMatchCursor, searching]);

  useEffect(() => {
    handoffRequestId.current += 1;
    handoffInFlight.current = false;
    setHandoffStatus("idle");
    setShaCopyStatus("idle");
  }, [selectedSha]);

  useEffect(() => {
    if (!widgetStateReady) return;
    const next = createPersistedWidgetState({
      mode: historyPresentation.topologyMode,
      query: historyPresentation.query,
      selectedSha,
    });
    const serialized = JSON.stringify(next);
    if (lastSynchronizedWidgetState.current === serialized) return;
    const synchronize = window.openai?.setWidgetState;
    if (!synchronize) return;
    lastSynchronizedWidgetState.current = serialized;
    try {
      void Promise.resolve(synchronize(next)).catch(() => {
        if (lastSynchronizedWidgetState.current === serialized) {
          lastSynchronizedWidgetState.current = null;
        }
      });
    } catch {
      lastSynchronizedWidgetState.current = null;
    }
  }, [
    historyPresentation.query,
    historyPresentation.topologyMode,
    selectedSha,
    widgetStateReady,
  ]);

  function resetFileDiffSelection(): void {
    fileDiffRequestGuard.invalidate();
    setSelectedFileId(null);
    setFileDiff(null);
    setDiffLoading(false);
    setDiffNotice(null);
  }

  useEffect(() => {
    if (!diffLayerOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeDiffLayer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [diffLayerOpen, diffLayerClosing, selectedFileId]);

  useEffect(() => {
    if (!diffLayerClosing) return;
    const timer = window.setTimeout(finalizeDiffLayerClose, 400);
    return () => window.clearTimeout(timer);
  }, [diffLayerClosing]);

  useEffect(() => {
    if (outgoingDiff === null) return;
    const timer = window.setTimeout(() => setOutgoingDiff(null), 400);
    return () => window.clearTimeout(timer);
  }, [outgoingDiff]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeBridge();
        if (!active) return;
        setHandoffModality(currentConversationHandoffModality);
        let initialRepositoryState = repositoryStateFromToolResult(
          await toolResultStore.waitForLatest(250),
        );
        if (!isRepositoryState(initialRepositoryState)) {
          const repositoryResult = (await rpcRequest("tools/call", {
            name: "get_repository_state",
            arguments: {},
          })) as { structuredContent?: unknown };
          initialRepositoryState = repositoryResult?.structuredContent;
        }
        if (!isRepositoryState(initialRepositoryState)) {
          throw new Error("GitRight received an invalid repository state");
        }
        if (!active) return;
        setState(initialRepositoryState);
        if (initialRepositoryState.status !== "ready") return;

        setHistory({ status: "loading" });
        const historyResult = (await rpcRequest("tools/call", {
          name: "get_history",
          arguments: {},
        })) as { structuredContent?: unknown };
        if (!active) return;
        const structuredContent = restoreOmittedHistoryNulls(historyResult?.structuredContent);
        if (isHistorySnapshot(structuredContent)) {
          const snapshot = structuredContent;
          const restoredSelectedSha = restoreWidgetSelection(
            restoredWidgetState.selectedSha,
            snapshot.commits,
          );
          // The persistent sheet starts populated: HEAD by default,
          // falling back to the first row.
          const defaultSha = restoredSelectedSha ??
            (snapshot.headSha !== null &&
                snapshot.commits.some((commit) => commit.sha === snapshot.headSha)
              ? snapshot.headSha
              : snapshot.commits[0]?.sha ?? null);
          setHistory(snapshot);
          setSelectedSha(defaultSha);
          setSelectedCommit(
            defaultSha === null
              ? null
              : snapshot.commits.find((commit) => commit.sha === defaultSha) ?? null,
          );
          setHistoryNotice(null);
          setPaginationBlocked(false);
          setWidgetStateReady(true);
        } else if (isHistoryErrorSnapshot(structuredContent)) {
          setHistory({ status: "error", message: structuredContent.message });
        } else {
          setHistory({ status: "error", message: "GitRight could not read this history snapshot." });
        }
      } catch {
        if (active) {
          setState({ status: "unavailable", message: "Current task repository is unavailable" });
          setHistory({ status: "error", message: "Open GitRight from a repository-linked task." });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [restoredWidgetState]);

  useEffect(() => toolResultStore.subscribe((result) => {
    const repositoryState = repositoryStateFromToolResult(result);
    if (isRepositoryState(repositoryState)) setState(repositoryState);
  }), []);

  useEffect(() => {
    if (initialRevealDone.current || history.status !== "ready" || selectedSha === null) {
      return;
    }
    /* During the launcher entrance the list stays at the top while the
       rows cascade; once the entrance releases, the reveal glides to
       the restored selection instead of jumping mid-build. Direct
       fullscreen render keeps the instant reveal. */
    if (entranceActive) return;
    initialRevealDone.current = true;
    graphScrollElement.current
      ?.querySelector(`[data-commit-sha="${selectedSha}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: entrance ? "smooth" : "auto" });
  }, [entranceActive, entrance, history.status, selectedSha]);

  // The sheet follows selection; rapid keyboard movement debounces the
  // detail request so interim commits are skipped.
  useEffect(() => {
    if (!selectedSha || !historySnapshotId || !selectedCommitIsLoaded) {
      detailRequestId.current += 1;
      setCommitDetail(null);
      setDetailNotice(null);
      setDetailLoading(false);
      return;
    }
    if (commitDetailMatchesCurrentSelection) {
      setDetailLoading(false);
      return;
    }
    const requestId = ++detailRequestId.current;
    const retainedDetail = commitDetail;
    setCommitDetail(retainedDetail);
    setDetailNotice(null);
    setDetailLoading(true);
    const snapshotId = historySnapshotId;
    const sha = selectedSha;
    const parentIndex = selectedParentIndex;
    const timer = setTimeout(() => {
      void (async () => {
        const loaded = await loadCommitDetail(snapshotId, sha, parentIndex);
        if (detailRequestId.current !== requestId) return;
        if (loaded.status === "ready") {
          setCommitDetail(loaded.detail);
          setDetailNotice(null);
        } else {
          setCommitDetail(retainedDetail);
          setDetailNotice(loaded.message);
        }
        setDetailLoading(false);
      })();
    }, DETAIL_REQUEST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commitDetailMatchesCurrentSelection,
    historySnapshotId,
    selectedCommitIsLoaded,
    selectedParentIndex,
    selectedSha,
  ]);

  async function handoffSelectedCommit(): Promise<void> {
    if (
      handoffInFlight.current ||
      handoffModality === null ||
      selectedSha === null ||
      !commitDetailMatchesCurrentSelection
    ) {
      return;
    }
    const sha = selectedSha;
    const requestId = ++handoffRequestId.current;
    handoffInFlight.current = true;
    setHandoffStatus("sending");
    try {
      await rpcRequest(
        "ui/update-model-context",
        createConversationHandoffParams(sha, handoffModality),
      );
      if (handoffRequestId.current === requestId && selectedShaRef.current === sha) {
        setHandoffStatus("sent");
      }
    } catch {
      if (handoffRequestId.current === requestId && selectedShaRef.current === sha) {
        setHandoffStatus("failed");
      }
    } finally {
      if (handoffRequestId.current === requestId) handoffInFlight.current = false;
    }
  }

  function selectCommit(commit: HistoryCommit): void {
    if (!refreshGuard.allowsSelection()) return;
    if (commit.sha !== selectedSha) {
      changedFilePageGuard.invalidate();
      resetFileDiffSelection();
      setSelectedParentIndex(0);
      setLoadingMoreFiles(false);
    }
    setDiffLayerOpen(false);
    setDiffLayerClosing(false);
    setOutgoingDiff(null);
    setSelectedSha(commit.sha);
    setSelectedCommit(commit);
  }

  function stepSelection(commit: HistoryCommit, delta: 1 | -1): void {
    if (history.status !== "ready") return;
    const index = history.commits.findIndex((candidate) => candidate.sha === commit.sha);
    if (index === -1) return;
    const next = history.commits[index + delta];
    if (!next) return;
    selectCommit(next);
    graphScrollElement.current
      ?.querySelector<HTMLElement>(`[data-commit-sha="${next.sha}"]`)
      ?.focus();
  }

  function navigateMatch(delta: 1 | -1): void {
    if (matchTotal === 0) return;
    setMatchCursor((safeMatchCursor + delta + matchTotal) % matchTotal);
  }

  function selectParent(index: number): void {
    if (!commitDetail || index === selectedParentIndex) return;
    changedFilePageGuard.invalidate();
    resetFileDiffSelection();
    setDiffLayerOpen(false);
    setDiffLayerClosing(false);
    setOutgoingDiff(null);
    setSelectedParentIndex(index);
    setLoadingMoreFiles(false);
  }

  async function selectFile(file: ChangedFile): Promise<void> {
    if (!commitDetail || refreshing || detailLoading) return;
    if (diffLayerOpen && !diffLayerClosing && selectedFileId === file.fileId) {
      closeDiffLayer();
      return;
    }
    if (diffLayerOpen && !diffLayerClosing && selectedFileId !== null) {
      const currentIndex = commitDetail.files.findIndex(
        (candidate) => candidate.fileId === selectedFileId,
      );
      const nextIndex = commitDetail.files.findIndex(
        (candidate) => candidate.fileId === file.fileId,
      );
      const direction = nextIndex >= currentIndex ? "forward" : "backward";
      diffSwitchDirection.current = direction;
      const previousFile = commitDetail.files[currentIndex] ?? null;
      if (
        previousFile !== null &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setOutgoingDiff({
          file: previousFile,
          diff: fileDiff,
          loading: diffLoading,
          notice: diffNotice,
          direction,
        });
      }
    } else {
      diffSwitchDirection.current = null;
    }
    const requestToken = fileDiffRequestGuard.begin(commitDetail.detailId, file.fileId);
    setSelectedFileId(file.fileId);
    setFileDiff(null);
    setDiffNotice(null);
    setDiffLoading(true);
    setDiffLayerOpen(true);
    setDiffLayerClosing(false);
    try {
      const result = (await rpcRequest("tools/call", {
        name: "get_diff",
        arguments: {
          detailId: commitDetail.detailId,
          fileId: file.fileId,
        },
      })) as { structuredContent?: unknown };
      if (!fileDiffRequestGuard.accepts(requestToken)) return;
      const structuredContent = restoreOmittedFileDiffNulls(result?.structuredContent);
      if (
        isFileDiff(structuredContent) &&
        structuredContent.detailId === requestToken.detailId &&
        structuredContent.fileId === requestToken.fileId
      ) {
        setFileDiff(structuredContent);
        setDiffNotice(null);
      } else if (
        isFileDiffError(structuredContent) &&
        structuredContent.detailId === requestToken.detailId &&
        structuredContent.fileId === requestToken.fileId
      ) {
        setDiffNotice({
          message: structuredContent.message,
          path: file.path,
        });
      } else {
        setDiffNotice({ message: "File diff is unavailable", path: file.path });
      }
    } catch {
      if (fileDiffRequestGuard.accepts(requestToken)) {
        setDiffNotice({ message: "File diff is unavailable", path: file.path });
      }
    } finally {
      if (fileDiffRequestGuard.accepts(requestToken)) setDiffLoading(false);
    }
  }

  function closeDiffLayer(): void {
    if (!diffLayerOpen || diffLayerClosing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finalizeDiffLayerClose();
      return;
    }
    setDiffLayerClosing(true);
  }

  function finalizeDiffLayerClose(): void {
    const focusFileId = selectedFileId;
    resetFileDiffSelection();
    setDiffLayerOpen(false);
    setDiffLayerClosing(false);
    setOutgoingDiff(null);
    requestAnimationFrame(() => {
      if (focusFileId === null) return;
      document
        .querySelector<HTMLElement>(`.gr-file[data-file-id="${focusFileId}"]`)
        ?.focus();
    });
  }

  async function loadMoreChangedFiles(): Promise<void> {
    if (!commitDetail || !commitDetail.hasMoreFiles || loadingMoreFiles || refreshing) return;
    const requestToken = changedFilePageGuard.begin(commitDetail.detailId);
    setLoadingMoreFiles(true);
    try {
      const result = (await rpcRequest("tools/call", {
        name: "load_more_files",
        arguments: {
          detailId: commitDetail.detailId,
          loadedCount: commitDetail.loadedFileCount,
          lastFileId: commitDetail.files.at(-1)?.fileId ?? null,
        },
      })) as { structuredContent?: unknown };
      if (!changedFilePageGuard.accepts(requestToken)) return;
      const structuredContent = restoreOmittedChangedFilePageNulls(result?.structuredContent);
      if (isChangedFilePage(structuredContent)) {
        const appended = appendChangedFilePage(commitDetail, structuredContent);
        if (appended.status === "ready") {
          setCommitDetail({ ...commitDetail, ...appended.detail });
          setDetailNotice(null);
        } else {
          setDetailNotice(appended.message);
        }
      } else if (isCommitDetailError(structuredContent)) {
        setDetailNotice(structuredContent.message);
      } else {
        setDetailNotice("Changed-file page boundary is invalid");
      }
    } catch {
      if (changedFilePageGuard.accepts(requestToken)) {
        setDetailNotice("Commit detail is unavailable");
      }
    } finally {
      if (changedFilePageGuard.accepts(requestToken)) setLoadingMoreFiles(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (
      history.status !== "ready" ||
      !history.hasMore ||
      loadingMore ||
      refreshing ||
      paginationBlocked
    ) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = (await rpcRequest("tools/call", {
        name: "load_more",
        arguments: {
          snapshotId: history.snapshotId,
          refFingerprint: history.refFingerprint,
          loadedCount: history.loadedCount,
          lastCommitSha: history.commits.at(-1)?.sha ?? null,
        },
      })) as { structuredContent?: unknown };
      const structuredContent = restoreOmittedHistoryNulls(result?.structuredContent);
      if (isHistoryPage(structuredContent)) {
        const appended = appendHistoryPage(history, structuredContent);
        if (appended.status === "ready") {
          setHistory(appended.snapshot);
          setHistoryNotice(null);
        } else {
          setHistoryNotice(appended.message);
        }
      } else if (isHistoryChanged(structuredContent)) {
        setHistoryNotice(structuredContent.message);
        setPaginationBlocked(true);
      } else if (isHistoryErrorSnapshot(structuredContent)) {
        setHistoryNotice(structuredContent.message);
      } else {
        setHistoryNotice("History page boundary is invalid");
      }
    } catch {
      setHistoryNotice("History is unavailable");
    } finally {
      setLoadingMore(false);
    }
  }

  async function refreshHistory(): Promise<void> {
    if (history.status !== "ready" || refreshing || loadingMore) return;
    if (!refreshGuard.begin()) return;
    setRefreshing(true);
    try {
      const result = (await rpcRequest("tools/call", {
        name: "get_history",
        arguments: {
          refresh: true,
          snapshotId: history.snapshotId,
          selectedSha,
        },
      })) as { structuredContent?: unknown };
      const structuredContent = restoreOmittedHistoryNulls(result?.structuredContent);
      if (isHistorySnapshot(structuredContent)) {
        const scrollTop = refreshGuard.captureReplacementScroll(
          () => graphScrollElement.current?.scrollTop ?? 0,
        );
        const next = replaceHistorySnapshot(
          {
            snapshot: history,
            selectedSha,
            selectedCommit,
            scrollTop,
            notice: historyNotice,
          },
          structuredContent,
          structuredContent.selection,
        );
        setHistory(next.snapshot);
        setSelectedSha(next.selectedSha);
        setSelectedCommit(next.selectedCommit);
        setHistoryNotice(next.notice);
        setPaginationBlocked(false);
        requestAnimationFrame(() => {
          const element = graphScrollElement.current;
          if (element) element.scrollTop = next.scrollTop;
        });
      } else if (isHistoryErrorSnapshot(structuredContent)) {
        setHistoryNotice(structuredContent.message);
      } else {
        setHistoryNotice("History is unavailable");
      }
    } catch {
      setHistoryNotice("History is unavailable");
    } finally {
      refreshGuard.end();
      setRefreshing(false);
    }
  }

  async function copyDiagnostics(): Promise<void> {
    if (state.status !== "blocked") return;
    const diagnostics = [
      "GitRight startup diagnostics",
      "status=blocked",
      `required_git=${state.requiredGitVersion}`,
      `detected_git=${state.detectedGitVersion}`,
      `duration_ms=${state.durationMs}`,
      `error_code=${state.errorCode}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  async function copySelectedSha(): Promise<void> {
    if (!commitDetail) return;
    try {
      await navigator.clipboard.writeText(commitDetail.sha);
      setShaCopyStatus("copied");
    } catch {
      setShaCopyStatus("failed");
    }
  }

  if (state.status !== "ready") {
    return (
      <main className="gitright-app gr-stateview" aria-labelledby="repository-state-title">
        <div
          className={`gr-state gr-state-${state.status}`}
          role={state.status === "loading" ? undefined : "alert"}
          aria-live={state.status === "loading" ? "polite" : undefined}
        >
          {state.status === "loading" ? (
            <>
              <h2 id="repository-state-title" className="gr-loading">
                {copy.openingRepository}
              </h2>
              <p>{copy.checkingRepository}</p>
            </>
          ) : (
            <>
              <h2 id="repository-state-title">
                {translateServiceMessage(state.message, copy)}
              </h2>
              <p>
                {state.status === "blocked"
                  ? copy.requiredGit(state.requiredGitVersion, state.detectedGitVersion)
                  : state.status === "ownership-refused"
                    ? `${translateServiceMessage(state.guidance, copy)}${copy.locale === "ja" ? "。" : "."}`
                    : copy.openFromRepositoryTask}
              </p>
              {state.status === "blocked" ? (
                <button
                  type="button"
                  className="gr-action"
                  onClick={() => void copyDiagnostics()}
                >
                  {copyStatus === "copied"
                    ? copy.diagnosticsCopied
                    : copyStatus === "failed" ? copy.copyFailed : copy.copyDiagnostics}
                </button>
              ) : null}
            </>
          )}
        </div>
      </main>
    );
  }

  const selectionLocked = refreshing;
  const interactionLocked =
    refreshing || detailLoading || !commitDetailMatchesCurrentSelection;
  const stale = commitDetail !== null && !commitDetailMatchesCurrentSelection;
  const searchAnnouncement = searching
    ? copy.searchMatchStatus(matchTotal === 0 ? 0 : safeMatchCursor + 1, matchTotal)
    : "";
  const selectedFile = commitDetail?.files.find((file) => file.fileId === selectedFileId) ??
    null;
  const sheetContent = history.status === "ready" && selectedCommit !== null ? (
    <div className="gr-sheet">
      <SheetDetailSection
        subject={selectedCommit.subject}
        laneIndex={selectedLaneIndex}
        detail={stale ? null : commitDetail}
        loading={detailLoading || stale}
        notice={detailNotice}
        interactionLocked={interactionLocked}
        selectedParentIndex={selectedParentIndex}
        shaCopyStatus={shaCopyStatus}
        handoffModality={handoffModality}
        handoffStatus={handoffStatus}
        copy={copy}
        onCopySha={() => void copySelectedSha()}
        onSelectParent={selectParent}
        onConversationHandoff={() => void handoffSelectedCommit()}
      />
      <SheetFilesSection
        detail={stale ? null : commitDetail}
        selectedFileId={selectedFileId}
        loadingMoreFiles={loadingMoreFiles}
        interactionLocked={interactionLocked}
        loading={detailLoading || stale}
        copy={copy}
        onSelectFile={(file) => void selectFile(file)}
        onLoadMoreFiles={() => void loadMoreChangedFiles()}
      />
    </div>
  ) : (
    <div className="gr-sheet">
      <p className="gr-sheet-placeholder">
        {history.status === "loading" || history.status === "idle"
          ? copy.loadingHistory
          : history.status === "error"
            ? translateServiceMessage(history.message, copy)
            : copy.noCommits}
      </p>
    </div>
  );

  return (
    <main
      className={`gitright-app${entranceActive ? " gr-entrance" : ""}${
        entranceReady ? " gr-entrance-ready" : ""
      }`}
      aria-labelledby="gitright-wordmark"
    >
      <header className="gr-header">
        <h1 id="gitright-wordmark" className="gr-app">
          Git<span className="gr-app-right">Right</span>
        </h1>
        <div className="gr-search">
          <SearchIcon />
          <input
            id="history-search"
            type="search"
            value={query}
            aria-label={copy.searchLoadedCommits}
            placeholder={copy.searchPlaceholder}
            autoComplete="off"
            onChange={(event) => {
              // Read the value before the state updater runs: React detaches
              // event.currentTarget once the handler returns.
              const query = truncateWidgetStateQuery(event.currentTarget.value);
              setHistoryPresentation((current) => ({ ...current, query }));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              navigateMatch(event.shiftKey ? -1 : 1);
            }}
          />
          {searching ? (
            <span className="gr-matchnav">
              <span className="gr-matchcount" aria-hidden="true">
                {matchTotal === 0 ? "0 / 0" : `${safeMatchCursor + 1} / ${matchTotal}`}
              </span>
              <button
                type="button"
                className="gr-iconbtn"
                aria-label={copy.previousMatch}
                title={copy.previousMatch}
                disabled={matchTotal === 0}
                onClick={() => navigateMatch(-1)}
              >
                <ChevronUpIcon />
              </button>
              <button
                type="button"
                className="gr-iconbtn"
                aria-label={copy.nextMatch}
                title={copy.nextMatch}
                disabled={matchTotal === 0}
                onClick={() => navigateMatch(1)}
              >
                <ChevronDownIcon />
              </button>
            </span>
          ) : null}
        </div>
        <div className="gr-seg" role="group" aria-label={copy.topologyView}>
          <button
            type="button"
            aria-pressed={topologyMode === "graph"}
            aria-label={copy.graph}
            title={copy.graph}
            onClick={() => setHistoryPresentation((current) => ({
              ...current,
              topologyMode: "graph",
            }))}
          >
            <GraphIcon />
          </button>
          <button
            type="button"
            aria-pressed={topologyMode === "text"}
            aria-label={copy.text}
            title={copy.text}
            onClick={() => setHistoryPresentation((current) => ({
              ...current,
              topologyMode: "text",
            }))}
          >
            <TextIcon />
          </button>
        </div>
        <button
          type="button"
          className="gr-iconbtn gr-refresh"
          aria-label={refreshing ? copy.refreshing : copy.refresh}
          title={copy.refresh}
          aria-busy={refreshing}
          disabled={history.status !== "ready" || refreshing || loadingMore}
          onClick={() => void refreshHistory()}
        >
          <RefreshIcon />
        </button>
      </header>
      <span className="visually-hidden" role="status" aria-live="polite">
        {searchAnnouncement}
      </span>
      {detailLoading ? (
        <p className="visually-hidden" role="status" aria-live="polite">
          {copy.loadingCommitDetail}
        </p>
      ) : null}
      <section className="gr-history" aria-labelledby="gr-history-heading">
        <h2 id="gr-history-heading" className="visually-hidden">
          {topologyMode === "graph" ? copy.graphTopology : copy.textTopology}
        </h2>
        {historyNotice !== null ? (
          <p className="gr-banner" role="status" aria-live="polite">
            {translateServiceMessage(historyNotice, copy)}
          </p>
        ) : null}
        <div className="gr-graph" ref={graphScrollElement}>
          {history.status === "idle" || history.status === "loading" ? (
            <p className="gr-history-message gr-loading" aria-live="polite">
              {copy.loadingHistory}
            </p>
          ) : history.status === "error" ? (
            <p className="gr-history-message" role="alert">
              {translateServiceMessage(history.message, copy)}
            </p>
          ) : history.commits.length === 0 ? (
            <p className="gr-history-message">{copy.noCommits}</p>
          ) : (
            <HistoryList
              history={history}
              layout={graphLayout}
              mode={topologyMode}
              loadedShas={loadedShas}
              selectedSha={selectedSha}
              selectionLocked={selectionLocked}
              searching={searching}
              matchedShas={searchMatches.matchedShas}
              currentMatchSha={currentMatchSha}
              query={searchMatches.query}
              scrollLeft={graphScrollLeft}
              loadingMore={loadingMore}
              paginationBlocked={paginationBlocked}
              copy={copy}
              onScrollLeftChange={(scrollLeft) => setHistoryPresentation((current) => ({
                ...current,
                graphScrollLeft: scrollLeft,
              }))}
              onSelect={selectCommit}
              onStepSelection={stepSelection}
              onLoadMore={() => void loadMore()}
            />
          )}
        </div>
        {(diffLayerOpen && selectedFile !== null) || outgoingDiff !== null ? (
          <div
            className={`gr-diff-scrim${
              diffLayerClosing ? " gr-diff-scrim-closing" : ""
            }`}
            aria-hidden="true"
          />
        ) : null}
        {outgoingDiff !== null ? (
          <div
            className={`gr-diff-layer gr-diff-layer-switch-out-${
              outgoingDiff.direction === "forward" ? "left" : "right"
            }`}
            aria-hidden="true"
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setOutgoingDiff(null);
            }}
          >
            <SheetDiffSection
              file={outgoingDiff.file}
              diff={outgoingDiff.diff}
              loading={outgoingDiff.loading}
              notice={outgoingDiff.notice}
              copy={copy}
              frozen
              onClose={() => undefined}
            />
          </div>
        ) : null}
        {diffLayerOpen && selectedFile !== null ? (
          <div
            className={`gr-diff-layer${
              diffLayerClosing
                ? " gr-diff-layer-closing"
                : diffSwitchDirection.current === "forward"
                  ? " gr-diff-layer-switch-forward"
                  : diffSwitchDirection.current === "backward"
                    ? " gr-diff-layer-switch-backward"
                    : ""
            }`}
            key={selectedFile.fileId}
            onAnimationEnd={(event) => {
              if (diffLayerClosing && event.target === event.currentTarget) {
                finalizeDiffLayerClose();
              }
            }}
          >
            <SheetDiffSection
              file={selectedFile}
              diff={fileDiff}
              loading={diffLoading}
              notice={diffNotice}
              copy={copy}
              onClose={closeDiffLayer}
            />
          </div>
        ) : null}
      </section>
      <div className="gr-sheetwrap">{sheetContent}</div>
      <StatusBar state={state} copy={copy} />
      {entranceActive ? (
        <div
          className="gr-entrance-card"
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.animationName === "gr-ent-open") setEntranceOpened(true);
          }}
        >
          <span className="gr-entrance-mark">
            Git<span className="gr-entrance-mark-right">Right</span>
          </span>
        </div>
      ) : null}
      {entranceReady ? (
        <span
          className="gr-entrance-sentinel"
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.animationName === "gr-entrance-end") setEntranceDone(true);
          }}
        />
      ) : null}
    </main>
  );
}

function formatViewportMetrics(width: number, height: number): string {
  const support = width < 380
    ? "below 380px support"
    : width === 380
      ? "supported minimum"
      : "supported width";
  return `${width} × ${height} CSS px · ${support}`;
}

function isViewportMetricsShortcut(event: KeyboardEvent): boolean {
  return !event.repeat && event.ctrlKey && event.altKey && event.shiftKey && !event.metaKey &&
    event.code === "KeyW";
}

function DeveloperViewportMetrics(): React.ReactElement | null {
  const [visible, setVisible] = useState(false);
  const [label, setLabel] = useState("");

  const update = useCallback(() => {
    setLabel(formatViewportMetrics(window.innerWidth, window.innerHeight));
  }, []);

  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!isViewportMetricsShortcut(event)) return;
      event.preventDefault();
      update();
      setVisible((current) => !current);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [update]);

  useEffect(() => {
    if (!visible) return;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [update, visible]);

  if (!visible) return null;
  return (
    <output
      className="developer-viewport-metrics"
      data-developer-viewport-metrics=""
      aria-hidden="true"
    >
      {label}
    </output>
  );
}

/* The right pane is a separate widget instance from the inline
   launcher, so the "this fullscreen came from the launcher" signal
   travels through the versioned widget state; reaching the complete
   view consumes it (createPersistedWidgetState writes it back false). */
function persistLauncherHandoff(pending: boolean): void {
  const setWidgetState = window.openai?.setWidgetState;
  if (!setWidgetState) return;
  try {
    void Promise.resolve(setWidgetState({
      ...parsePersistedWidgetState(window.openai?.widgetState),
      launcherHandoff: pending,
    })).catch(() => undefined);
  } catch {
    /* Best effort: without the marker the pane just skips the entrance. */
  }
}

type LauncherStatus = "idle" | "requesting" | "unavailable" | "failed" | "unsupported";

type LauncherRequestOutcome =
  | { kind: "missing" }
  | { kind: "rejected" }
  | { kind: "thrown" }
  | { kind: "undefined" }
  | { kind: "resolved"; mode: DisplayMode };

type LauncherTransition = {
  showCompleteView: boolean;
  status: Exclude<LauncherStatus, "requesting">;
};

function resolveLauncherOutcome(outcome: LauncherRequestOutcome): LauncherTransition {
  if (outcome.kind === "resolved" && outcome.mode === "fullscreen") {
    return { showCompleteView: true, status: "idle" };
  }
  if (outcome.kind === "missing") {
    return { showCompleteView: false, status: "unavailable" };
  }
  if (outcome.kind === "rejected" || outcome.kind === "thrown") {
    return { showCompleteView: false, status: "failed" };
  }
  return { showCompleteView: false, status: "unsupported" };
}

function App(): React.ReactElement {
  const [showCompleteView, setShowCompleteView] = useState(
    window.openai?.displayMode === "fullscreen",
  );
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatus>("idle");
  const [launcherDeparting, setLauncherDeparting] = useState(false);
  const [entranceArmed, setEntranceArmed] = useState(
    () =>
      window.openai?.displayMode === "fullscreen" &&
      parsePersistedWidgetState(window.openai?.widgetState).launcherHandoff &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const displayModeRequestInFlight = useRef(false);
  const [locale, setLocale] = useState<GitRightLocale>(() => hostEnvironment().locale);
  const copy = copyFor(locale);

  useEffect(() => {
    const updateEnvironment = (environment: HostEnvironment) => setLocale(environment.locale);
    hostEnvironmentListeners.add(updateEnvironment);
    applyHostEnvironment(hostEnvironment());
    void initializeBridge().then(updateEnvironment, () => undefined);
    return () => {
      hostEnvironmentListeners.delete(updateEnvironment);
    };
  }, []);

  function applyLauncherOutcome(outcome: LauncherRequestOutcome): void {
    const transition = resolveLauncherOutcome(outcome);
    displayModeRequestInFlight.current = false;
    setLauncherDeparting(false);
    if (transition.showCompleteView) {
      /* Arm the one-shot pane entrance only for launcher-driven
         transitions: direct fullscreen render, refresh, and restore
         stay animation-free. This covers the case where the
         complete view mounts inside this same instance; the remounted
         right pane consumes the persisted hand-off marker instead. */
      if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setEntranceArmed(true);
      }
      applyHostEnvironment({ ...hostEnvironment(), displayMode: "fullscreen" });
    } else {
      /* The pane did not open: take the hand-off marker back so a later
         restore cannot replay the entrance. */
      persistLauncherHandoff(false);
    }
    setShowCompleteView(transition.showCompleteView);
    setLauncherStatus(transition.status);
  }

  /* Activation first lets the launcher card leave to the right
     (animationend of its exit), then issues the display-mode request;
     the host closes the inline frame as soon as the pane opens, so an
     immediate request would hide the animation entirely. Reduced motion
     skips the exit and requests at once. No timer is involved. */
  function openInRightPane(): void {
    if (displayModeRequestInFlight.current || launcherDeparting) return;
    /* Written at activation so it reaches the host well before the
       remounted pane instance reads it. */
    persistLauncherHandoff(true);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      requestRightPane();
      return;
    }
    setLauncherDeparting(true);
  }

  function completeLauncherDeparture(event: React.AnimationEvent): void {
    if (!launcherDeparting || event.animationName !== "launcher-exit") return;
    requestRightPane();
  }

  function requestRightPane(): void {
    if (displayModeRequestInFlight.current) return;
    const requestDisplayMode = window.openai?.requestDisplayMode;
    if (!requestDisplayMode) {
      applyLauncherOutcome({ kind: "missing" });
      return;
    }

    displayModeRequestInFlight.current = true;
    setLauncherStatus("requesting");
    try {
      const request = requestDisplayMode({ mode: "fullscreen" });
      if (!request) {
        applyLauncherOutcome({ kind: "undefined" });
        return;
      }
      void request.then(
        (result) => applyLauncherOutcome(
          result ? { kind: "resolved", mode: result.mode } : { kind: "undefined" },
        ),
        () => applyLauncherOutcome({ kind: "rejected" }),
      );
    } catch {
      applyLauncherOutcome({ kind: "thrown" });
    }
  }

  if (showCompleteView) {
    return (
      <>
        <GitRightView locale={locale} entrance={entranceArmed} />
        <DeveloperViewportMetrics />
      </>
    );
  }

  const launcherStatusMessage = launcherStatus === "requesting"
    ? copy.openingRightPane
    : launcherStatus === "unavailable"
      ? copy.rightPaneUnavailable
      : launcherStatus === "failed"
        ? copy.rightPaneFailed
        : launcherStatus === "unsupported"
          ? copy.rightPaneUnsupported
          : null;

  return (
    <>
      <main
        className={`launcher${
          launcherDeparting || launcherStatus === "requesting" ? " launcher-requesting" : ""
        }`}
        aria-label="GitRight"
      >
        <button
          type="button"
          className="launcher-action"
          disabled={launcherDeparting || launcherStatus === "requesting"}
          aria-describedby="gitright-launcher-status"
          onClick={openInRightPane}
          onAnimationEnd={completeLauncherDeparture}
        >
          {/* Hidden from assistive technology so the button's accessible
              name stays the hint's "Open GitRight" rather than gaining a
              redundant "GitRight" in front of it. The two nested spans
              exist so the idle drift and the hover glide compose: the
              loop lives on the outer one, the hover offset on the inner,
              and entering the card never snaps the mark back to zero. */}
          <span className="launcher-mark" aria-hidden="true">
            Git<span className="launcher-mark-right">
              <span className="launcher-mark-glide">Right</span>
            </span>
          </span>
          <span className="launcher-hint">{copy.openInRightPane}</span>
        </button>
        <p
          id="gitright-launcher-status"
          className="launcher-status"
          role="status"
          aria-live="polite"
        >
          {launcherStatusMessage}
        </p>
      </main>
      <DeveloperViewportMetrics />
    </>
  );
}

const rootElement = document.getElementById("gitright-root");
if (!rootElement) throw new Error("GitRight root element is missing");
applyHostEnvironment(hostEnvironment());
createRoot(rootElement).render(<App />);
