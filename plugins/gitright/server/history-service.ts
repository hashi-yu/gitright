import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  classifyGitFailure,
  type GitResult,
  type RepositoryOperation,
  systemGitExecutor,
} from "./repository-binding.ts";

export type HistoryExecutor = {
  history: (
    cwd: string,
    operation: RepositoryOperation,
    objectIds?: readonly string[],
  ) => Promise<GitResult>;
};

const systemHistoryExecutor: HistoryExecutor = {
  history: (cwd, operation, objectIds) =>
    systemGitExecutor.repository(cwd, operation, objectIds),
};

export type HistoryRef = {
  name: string;
  fullName: string;
  kind: "head" | "local-branch" | "remote-branch" | "tag";
  checkedOut: boolean;
};

export type HistoryCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  committerTime: number;
  topologyRole: "root" | "commit" | "merge" | "octopus merge";
  shallowBoundary: boolean;
  parents: Array<{ sha: string; loaded: boolean }>;
  refs: HistoryRef[];
  inlineRefs: HistoryRef[];
  additionalRefCount: number;
};

export type HistorySelection =
  | { status: "none" }
  | { status: "reachable" | "unreachable" | "missing"; sha: string };

export type ReadyHistorySnapshot = {
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
  selection: HistorySelection;
};

export type HistoryError = {
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

export type HistorySnapshot = ReadyHistorySnapshot | HistoryError;

export type HistoryPageRequest = {
  snapshotId: string;
  refFingerprint: string;
  loadedCount: number;
  lastCommitSha: string | null;
};

export type HistoryPage = {
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

export type HistoryChanged = {
  status: "changed";
  message: "History changed — Refresh to continue";
  code: "history-changed";
  snapshotId: string;
};

export type HistoryPageResult = HistoryPage | HistoryChanged | HistoryError;

export type HistoryRefreshRequest = {
  snapshotId: string;
  selectedSha: string | null;
};

type RawRef = {
  fullName: string;
  objectId: string;
  objectType: string;
  peeledObjectId: string;
  peeledObjectType: string;
};

type RawCommit = {
  sha: string;
  committerTime: number;
  parents: string[];
  shallowBoundary: boolean;
};

type RefCapture = {
  head: string | null;
  symbolicHead: string | null;
  refs: RawRef[];
  checkedOutBranches: Set<string>;
  tips: string[];
  fingerprint: string;
};

type HistoryCursor = {
  bySha: Map<string, RawCommit>;
  remainingChildCount: Map<string, number>;
  ready: RawCommit[];
  ordered: RawCommit[];
  totalCount: number;
};

type ActiveSnapshot = {
  repository: string;
  capture: RefCapture;
  cursor: HistoryCursor;
  snapshot: ReadyHistorySnapshot;
};

const completeObjectId = /^[0-9a-f]{40}$/;
const fullLocalBranch = /^refs\/heads\/(.+)$/;
const fullRemoteBranch = /^refs\/remotes\/(.+)$/;
const fullTag = /^refs\/tags\/(.+)$/;
const maximumHistoryCandidates = 100_000;
const historyProcessingBudgetMs = 275;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function successfulOutput(result: GitResult): Buffer | null {
  return result.status === 0 && result.signal === null && !result.timedOut
    ? result.stdout
    : null;
}

function failure(
  code: string,
  message: HistoryError["message"] =
    "History is unavailable",
): HistoryError {
  return { status: "error", message, code };
}

function gitFailure(result: GitResult, fallbackCode: string): HistoryError {
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

function oneLine(output: Buffer): string | null {
  if (output.length === 0 || output.at(-1) !== 0x0a) return null;
  const value = output.subarray(0, -1).toString("utf8");
  return value.includes("\n") || value.includes("\0") ? null : value;
}

function nulRecords(output: Buffer, fieldCount: number): string[][] | null {
  if (output.length === 0) return [];
  const records: string[][] = [];
  let offset = 0;

  while (offset < output.length) {
    const fields: string[] = [];
    for (let field = 0; field < fieldCount; field += 1) {
      const separator = output.indexOf(0, offset);
      if (separator < 0) return null;
      fields.push(output.subarray(offset, separator).toString("utf8"));
      offset = separator + 1;
    }
    if (output.at(offset) !== 0x0a) return null;
    offset += 1;
    records.push(fields);
  }

  return records;
}

function parseRefs(output: Buffer): RawRef[] | null {
  const records = nulRecords(output, 5);
  if (!records) return null;
  const refs: RawRef[] = [];
  const names = new Set<string>();

  for (const [fullName, objectId, objectType, peeledObjectId, peeledObjectType] of records) {
    if (
      !fullName ||
      names.has(fullName) ||
      !completeObjectId.test(objectId) ||
      (peeledObjectId !== "" && !completeObjectId.test(peeledObjectId))
    ) {
      return null;
    }
    names.add(fullName);
    refs.push({ fullName, objectId, objectType, peeledObjectId, peeledObjectType });
  }

  return refs;
}

function parseWorktreeBranches(
  output: Buffer,
  currentWorktreePath: string,
): Set<string> | null {
  const records = nulRecords(output, 2);
  if (!records) return null;
  const checkedOut = new Set<string>();
  const seen = new Set<string>();
  const canonicalPath = (value: string) => {
    try {
      return realpathSync.native(value);
    } catch {
      return path.resolve(value);
    }
  };
  const currentWorktree = canonicalPath(currentWorktreePath);

  for (const [fullName, worktreePath] of records) {
    if (!fullLocalBranch.test(fullName) || seen.has(fullName)) return null;
    seen.add(fullName);
    if (worktreePath !== "" && canonicalPath(worktreePath) !== currentWorktree) {
      checkedOut.add(fullName);
    }
  }

  return checkedOut;
}

function parseHistory(
  output: Buffer,
  processingDeadline: number,
  monotonicNow: () => number,
): RawCommit[] | "processing-limit" | "too-large" | null {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0x0a) return null;
  const commits: RawCommit[] = [];
  const seen = new Set<string>();

  const lines = output.subarray(0, -1).toString("ascii").split("\n");
  for (const [index, line] of lines.entries()) {
    const fields = line.split(" ");
    if (fields.length < 2 || !/^\d+$/.test(fields[0])) return null;
    const committerTime = Number(fields[0]);
    const [sha, ...parents] = fields.slice(1);
    if (
      !Number.isSafeInteger(committerTime) ||
      committerTime < 0 ||
      !completeObjectId.test(sha) ||
      parents.some((parent) => !completeObjectId.test(parent)) ||
      seen.has(sha)
    ) {
      return null;
    }
    if (commits.length === maximumHistoryCandidates) return "too-large";
    seen.add(sha);
    commits.push({ sha, committerTime, parents, shallowBoundary: false });
    if ((index & 0xfff) === 0xfff && monotonicNow() > processingDeadline) {
      return "processing-limit";
    }
  }

  return commits;
}

function parseRawParents(
  output: Buffer,
  expectedShas: readonly string[],
  processingDeadline: number,
  monotonicNow: () => number,
): Map<string, string[]> | "processing-limit" | null {
  if (output.length === 0 || output.at(-1) !== 0x0a) return null;
  const parentsBySha = new Map<string, string[]>();
  const lines = output.subarray(0, -1).toString("ascii").split("\n");
  for (const [index, line] of lines.entries()) {
    const [sha, ...parents] = line.split(" ");
    if (
      !completeObjectId.test(sha) ||
      parents.some((parent) => !completeObjectId.test(parent)) ||
      parentsBySha.has(sha)
    ) {
      return null;
    }
    parentsBySha.set(sha, parents);
    if ((index & 0xfff) === 0xfff && monotonicNow() > processingDeadline) {
      return "processing-limit";
    }
  }
  return expectedShas.length === parentsBySha.size &&
    expectedShas.every((sha) => parentsBySha.has(sha))
    ? parentsBySha
    : null;
}

function heapPush(
  heap: RawCommit[],
  commit: RawCommit,
  compare: (left: RawCommit, right: RawCommit) => number,
): void {
  heap.push(commit);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compare(heap[parentIndex], commit) <= 0) break;
    heap[index] = heap[parentIndex];
    index = parentIndex;
  }
  heap[index] = commit;
}

function heapPop(
  heap: RawCommit[],
  compare: (left: RawCommit, right: RawCommit) => number,
): RawCommit | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;

  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    if (leftIndex >= heap.length) break;
    const rightIndex = leftIndex + 1;
    const childIndex =
      rightIndex < heap.length && compare(heap[rightIndex], heap[leftIndex]) < 0
        ? rightIndex
        : leftIndex;
    if (compare(last, heap[childIndex]) <= 0) break;
    heap[index] = heap[childIndex];
    index = childIndex;
  }
  heap[index] = last;
  return first;
}

function createHistoryCursor(
  commits: RawCommit[],
  processingDeadline: number,
  monotonicNow: () => number,
): HistoryCursor | "processing-limit" | null {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const remainingChildCount = new Map(commits.map((commit) => [commit.sha, 0]));

  for (const [index, commit] of commits.entries()) {
    for (const parent of commit.parents) {
      if (bySha.has(parent)) {
        remainingChildCount.set(parent, (remainingChildCount.get(parent) ?? 0) + 1);
      }
    }
    if ((index & 0xfff) === 0xfff && monotonicNow() > processingDeadline) {
      return "processing-limit";
    }
  }

  const compare = (left: RawCommit, right: RawCommit) =>
    right.committerTime - left.committerTime || compareText(left.sha, right.sha);
  const ready: RawCommit[] = [];
  for (const [index, commit] of commits.entries()) {
    if (remainingChildCount.get(commit.sha) === 0) heapPush(ready, commit, compare);
    if ((index & 0xfff) === 0xfff && monotonicNow() > processingDeadline) {
      return "processing-limit";
    }
  }

  if (commits.length > 0 && ready.length === 0) return null;
  return {
    bySha,
    remainingChildCount,
    ready,
    ordered: [],
    totalCount: commits.length,
  };
}

function cloneHistoryCursor(cursor: HistoryCursor): HistoryCursor {
  return {
    bySha: cursor.bySha,
    remainingChildCount: new Map(cursor.remainingChildCount),
    ready: [...cursor.ready],
    ordered: [...cursor.ordered],
    totalCount: cursor.totalCount,
  };
}

function takeHistoryPage(
  cursor: HistoryCursor,
  maximumCount: number,
  processingDeadline: number,
  monotonicNow: () => number,
): RawCommit[] | "processing-limit" | null {
  const compare = (left: RawCommit, right: RawCommit) =>
    right.committerTime - left.committerTime || compareText(left.sha, right.sha);
  const page: RawCommit[] = [];

  while (cursor.ready.length > 0 && page.length < maximumCount) {
    const commit = heapPop(cursor.ready, compare);
    if (!commit) break;
    cursor.ordered.push(commit);
    page.push(commit);
    for (const parent of commit.parents) {
      if (!cursor.bySha.has(parent)) continue;
      const remaining = (cursor.remainingChildCount.get(parent) ?? 0) - 1;
      cursor.remainingChildCount.set(parent, remaining);
      if (remaining === 0) {
        heapPush(cursor.ready, cursor.bySha.get(parent)!, compare);
      }
    }
    if ((page.length & 0x3f) === 0 && monotonicNow() > processingDeadline) {
      return "processing-limit";
    }
  }

  const expectedCount = Math.min(maximumCount, cursor.totalCount - (cursor.ordered.length - page.length));
  return page.length === expectedCount ? page : null;
}

function parseSubjects(output: Buffer, expectedShas: readonly string[]): Map<string, string> | null {
  const records = nulRecords(output, 2);
  if (!records || records.length !== expectedShas.length) return null;
  const subjects = new Map<string, string>();

  for (const [sha, rawSubject] of records) {
    if (!completeObjectId.test(sha) || subjects.has(sha)) return null;
    const subject = rawSubject.replace(/[\u0000-\u001f\u007f-\u009f]/g, "�");
    subjects.set(sha, subject);
  }

  return expectedShas.every((sha) => subjects.has(sha)) ? subjects : null;
}

function refTarget(ref: RawRef): string | null {
  if (ref.objectType === "commit") return ref.objectId;
  if (ref.objectType === "tag" && ref.peeledObjectType === "commit") {
    return ref.peeledObjectId;
  }
  return null;
}

function displayRef(ref: RawRef, checkedOutBranches: Set<string>): HistoryRef | null {
  const local = fullLocalBranch.exec(ref.fullName);
  if (local) {
    return {
      name: local[1],
      fullName: ref.fullName,
      kind: "local-branch",
      checkedOut: checkedOutBranches.has(ref.fullName),
    };
  }
  const remote = fullRemoteBranch.exec(ref.fullName);
  if (remote) {
    return {
      name: remote[1],
      fullName: ref.fullName,
      kind: "remote-branch",
      checkedOut: false,
    };
  }
  const tag = fullTag.exec(ref.fullName);
  if (tag) {
    return { name: tag[1], fullName: ref.fullName, kind: "tag", checkedOut: false };
  }
  return null;
}

function refPriority(ref: HistoryRef): number {
  if (ref.kind === "head") return 0;
  if (ref.kind === "local-branch") return ref.checkedOut ? 1 : 2;
  if (ref.kind === "remote-branch") return 3;
  return 4;
}

function topologyRole(parentCount: number): HistoryCommit["topologyRole"] {
  if (parentCount === 0) return "root";
  if (parentCount === 1) return "commit";
  if (parentCount === 2) return "merge";
  return "octopus merge";
}

function refFingerprint(
  head: string | null,
  symbolicHead: string | null,
  refs: readonly RawRef[],
  checkedOutBranches: Set<string>,
): string {
  const visibleRefs = refs
    .flatMap((ref) => {
      const target = refTarget(ref);
      const visible = displayRef(ref, checkedOutBranches);
      return target && visible
        ? [{ fullName: visible.fullName, target, checkedOut: visible.checkedOut }]
        : [];
    })
    .sort((left, right) =>
      compareText(left.fullName, right.fullName) ||
      compareText(left.target, right.target) ||
      Number(left.checkedOut) - Number(right.checkedOut),
    );
  return createHash("sha256")
    .update(JSON.stringify({ head, symbolicHead, refs: visibleRefs }))
    .digest("hex");
}

export function createHistoryService(
  git: HistoryExecutor = systemHistoryExecutor,
  now: () => number = () => Math.floor(Date.now() / 1_000),
  monotonicNow: () => number = () => performance.now(),
) {
  let active: ActiveSnapshot | null = null;
  let refreshInFlight: Promise<HistorySnapshot> | null = null;
  let generation = 0;

  async function captureRefs(pinnedRepository: string): Promise<RefCapture | HistoryError> {
    const headResult = await git.history(pinnedRepository, "head");
    const headOutput = successfulOutput(headResult);
    let head: string | null = null;
    if (headOutput) {
      head = oneLine(headOutput);
      if (!head || !completeObjectId.test(head)) return failure("invalid-head");
    } else if (classifyGitFailure(headResult)) {
      return gitFailure(headResult, "head-read-failed");
    } else if (
      ![1, 128].includes(headResult.status ?? -1) ||
      headResult.signal !== null ||
      headResult.timedOut
    ) {
      return failure("head-read-failed");
    }

    const symbolicHeadResult = await git.history(pinnedRepository, "symbolic-head");
    const symbolicHeadOutput = successfulOutput(symbolicHeadResult);
    let symbolicHead: string | null = null;
    if (symbolicHeadOutput) {
      symbolicHead = oneLine(symbolicHeadOutput);
      if (!symbolicHead || !fullLocalBranch.test(symbolicHead)) {
        return failure("invalid-symbolic-head");
      }
    } else if (classifyGitFailure(symbolicHeadResult)) {
      return gitFailure(symbolicHeadResult, "symbolic-head-read-failed");
    } else if (
      symbolicHeadResult.status !== 1 ||
      symbolicHeadResult.signal !== null ||
      symbolicHeadResult.timedOut
    ) {
      return failure("symbolic-head-read-failed");
    }

    const refsResult = await git.history(pinnedRepository, "refs");
    const refsOutput = successfulOutput(refsResult);
    if (refsOutput === null) return gitFailure(refsResult, "refs-read-failed");
    const refs = parseRefs(refsOutput);
    if (!refs) return failure("invalid-refs");

    const worktreeResult = await git.history(pinnedRepository, "worktree-branches");
    const worktreeOutput = successfulOutput(worktreeResult);
    if (worktreeOutput === null) {
      return gitFailure(worktreeResult, "worktree-branches-read-failed");
    }
    const checkedOutBranches = parseWorktreeBranches(worktreeOutput, pinnedRepository);
    if (!checkedOutBranches) return failure("invalid-worktree-branches");

    const tips = [
      ...new Set(
        [head, ...refs.map(refTarget)].filter((tip): tip is string => !!tip),
      ),
    ].sort();
    return {
      head,
      symbolicHead,
      refs,
      checkedOutBranches,
      tips,
      fingerprint: refFingerprint(head, symbolicHead, refs, checkedOutBranches),
    };
  }

  function nextSnapshotId(fingerprint: string, snapshotTime: number): string {
    generation += 1;
    return createHash("sha256")
      .update(fingerprint)
      .update("\0")
      .update(String(snapshotTime))
      .update("\0")
      .update(String(generation))
      .digest("hex");
  }

  function snapshotHasContinuation(cursor: HistoryCursor, loadedShas: Set<string>): boolean {
    return (
      cursor.ordered.length < cursor.totalCount ||
      cursor.ordered.some((commit) =>
        commit.parents.some((parent) => !loadedShas.has(parent)),
      )
    );
  }

  async function materializeCommits(
    pinnedRepository: string,
    capture: RefCapture,
    rawCommits: readonly RawCommit[],
    loadedShas: Set<string>,
  ): Promise<{ commits: HistoryCommit[] } | HistoryError> {
    const subjects = new Map<string, string>();
    for (let offset = 0; offset < rawCommits.length; offset += 500) {
      const batch = rawCommits.slice(offset, offset + 500).map((commit) => commit.sha);
      const subjectResult = await git.history(
        pinnedRepository,
        "history-subjects",
        batch,
      );
      const subjectOutput = successfulOutput(subjectResult);
      if (subjectOutput === null) return gitFailure(subjectResult, "subjects-read-failed");
      const parsedSubjects = parseSubjects(subjectOutput, batch);
      if (!parsedSubjects) return failure("invalid-subjects");
      for (const [sha, subject] of parsedSubjects) subjects.set(sha, subject);
    }

    const refsBySha = new Map<string, HistoryRef[]>();
    if (capture.head && loadedShas.has(capture.head)) {
      refsBySha.set(capture.head, [
        {
          name: capture.symbolicHead ? "HEAD" : "HEAD (detached)",
          fullName: "HEAD",
          kind: "head",
          checkedOut: true,
        },
      ]);
    }
    for (const ref of capture.refs) {
      const target = refTarget(ref);
      const visible = displayRef(ref, capture.checkedOutBranches);
      if (!target || !visible || !loadedShas.has(target)) continue;
      const current = refsBySha.get(target) ?? [];
      current.push(visible);
      refsBySha.set(target, current);
    }

    return {
      commits: rawCommits.map<HistoryCommit>((commit) => {
        const commitRefs = (refsBySha.get(commit.sha) ?? []).sort(
          (left, right) =>
            refPriority(left) - refPriority(right) ||
            compareText(left.fullName, right.fullName),
        );
        return {
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 7),
          subject: subjects.get(commit.sha) ?? "",
          committerTime: commit.committerTime,
          topologyRole: topologyRole(commit.parents.length),
          shallowBoundary: commit.shallowBoundary,
          parents: commit.parents.map((parent) => ({
            sha: parent,
            loaded: loadedShas.has(parent),
          })),
          refs: commitRefs,
          inlineRefs: commitRefs.slice(0, 3),
          additionalRefCount: Math.max(0, commitRefs.length - 3),
        };
      }),
    };
  }

  async function classifySelection(
    pinnedRepository: string,
    cursor: HistoryCursor,
    selectedSha: string | null,
  ): Promise<HistorySelection | HistoryError> {
    if (!selectedSha) return { status: "none" };
    if (cursor.bySha.has(selectedSha)) {
      return { status: "reachable", sha: selectedSha };
    }

    const result = await git.history(
      pinnedRepository,
      "history-parents",
      [selectedSha],
    );
    const output = successfulOutput(result);
    if (output !== null) {
      const parents = parseRawParents(
        output,
        [selectedSha],
        Number.POSITIVE_INFINITY,
        monotonicNow,
      );
      if (parents instanceof Map) {
        return { status: "unreachable", sha: selectedSha };
      }
      return failure("invalid-selection-parents");
    }
    const kind = classifyGitFailure(result);
    if (kind === "missing-object") {
      return { status: "missing", sha: selectedSha };
    }
    return gitFailure(result, "selection-read-failed");
  }

  async function buildSnapshot(
    pinnedRepository: string,
    minimumLoadedCount: number,
    selectedSha: string | null,
  ): Promise<{ active: ActiveSnapshot } | HistoryError> {
    const capture = await captureRefs(pinnedRepository);
    if ("status" in capture) return capture;
    const snapshotTime = now();
    let cursor: HistoryCursor = {
      bySha: new Map(),
      remainingChildCount: new Map(),
      ready: [],
      ordered: [],
      totalCount: 0,
    };

    if (capture.tips.length > 0) {
      const historyResult = await git.history(
        pinnedRepository,
        "history-page",
        capture.tips,
      );
      const historyOutput = successfulOutput(historyResult);
      if (historyOutput === null) {
        return historyResult.outputLimited
          ? failure(
              "history-too-large",
              "History exceeds GitRight's supported snapshot limit",
            )
          : gitFailure(historyResult, "history-read-failed");
      }

      const requestedPages = Math.max(1, Math.ceil(minimumLoadedCount / 500));
      const processingDeadline =
        monotonicNow() + historyProcessingBudgetMs * requestedPages;
      const parsedHistory = parseHistory(
        historyOutput,
        processingDeadline,
        monotonicNow,
      );
      if (parsedHistory === "too-large") {
        return failure(
          "history-too-large",
          "History exceeds GitRight's supported snapshot limit",
        );
      }
      if (parsedHistory === "processing-limit") {
        return failure(
          "history-processing-limit",
          "History exceeds GitRight's supported snapshot limit",
        );
      }
      if (!parsedHistory) return failure("invalid-history");

      const processingRemaining = processingDeadline - monotonicNow();
      if (processingRemaining <= 0) {
        return failure(
          "history-processing-limit",
          "History exceeds GitRight's supported snapshot limit",
        );
      }
      const historyShas = parsedHistory.map((commit) => commit.sha);
      const parentResult = await git.history(
        pinnedRepository,
        "history-parents",
        historyShas,
      );
      const parentOutput = successfulOutput(parentResult);
      if (parentOutput === null) {
        return parentResult.outputLimited
          ? failure(
              "history-too-large",
              "History exceeds GitRight's supported snapshot limit",
            )
          : gitFailure(parentResult, "parents-read-failed");
      }
      const resumedProcessingDeadline = monotonicNow() + processingRemaining;
      const parentsBySha = parseRawParents(
        parentOutput,
        historyShas,
        resumedProcessingDeadline,
        monotonicNow,
      );
      if (parentsBySha === "processing-limit") {
        return failure(
          "history-processing-limit",
          "History exceeds GitRight's supported snapshot limit",
        );
      }
      if (!parentsBySha) return failure("invalid-parents");
      const historyWithRawParents = parsedHistory.map((commit) => {
        const rawParents = parentsBySha.get(commit.sha) ?? [];
        return {
          ...commit,
          parents: rawParents,
          shallowBoundary: commit.parents.length === 0 && rawParents.length > 0,
        };
      });
      const createdCursor = createHistoryCursor(
        historyWithRawParents,
        resumedProcessingDeadline,
        monotonicNow,
      );
      if (createdCursor === "processing-limit") {
        return failure(
          "history-processing-limit",
          "History exceeds GitRight's supported snapshot limit",
        );
      }
      if (!createdCursor) return failure("invalid-history-topology");
      cursor = createdCursor;

      const initialCount = Math.min(
        cursor.totalCount,
        Math.max(500, minimumLoadedCount),
      );
      const initialPage = takeHistoryPage(
        cursor,
        initialCount,
        resumedProcessingDeadline,
        monotonicNow,
      );
      if (initialPage === "processing-limit") {
        return failure(
          "history-processing-limit",
          "History exceeds GitRight's supported snapshot limit",
        );
      }
      if (!initialPage) return failure("invalid-history-topology");

      if (
        selectedSha &&
        cursor.bySha.has(selectedSha) &&
        !cursor.ordered.some((commit) => commit.sha === selectedSha)
      ) {
        while (
          cursor.ready.length > 0 &&
          !cursor.ordered.some((commit) => commit.sha === selectedSha)
        ) {
          const selectionPage = takeHistoryPage(
            cursor,
            500,
            monotonicNow() + historyProcessingBudgetMs,
            monotonicNow,
          );
          if (selectionPage === "processing-limit") {
            return failure(
              "history-processing-limit",
              "History exceeds GitRight's supported snapshot limit",
            );
          }
          if (!selectionPage) return failure("invalid-history-topology");
        }
      }
    }

    const loadedShas = new Set(cursor.ordered.map((commit) => commit.sha));
    const materialized = await materializeCommits(
      pinnedRepository,
      capture,
      cursor.ordered,
      loadedShas,
    );
    if ("status" in materialized) return materialized;
    const selection = await classifySelection(
      pinnedRepository,
      cursor,
      selectedSha,
    );
    if ("message" in selection) return selection;
    const finalCapture = await captureRefs(pinnedRepository);
    if ("status" in finalCapture) return finalCapture;
    if (finalCapture.fingerprint !== capture.fingerprint) {
      return failure(
        "history-changed-during-read",
        "History changed — Refresh to continue",
      );
    }
    const snapshot: ReadyHistorySnapshot = {
      status: "ready",
      snapshotId: nextSnapshotId(capture.fingerprint, snapshotTime),
      snapshotTime,
      refFingerprint: capture.fingerprint,
      headSha: capture.head,
      loadedCount: materialized.commits.length,
      pageSize: 500,
      hasContinuation: snapshotHasContinuation(cursor, loadedShas),
      hasMore: cursor.ordered.length < cursor.totalCount,
      commits: materialized.commits,
      selection,
    };
    return {
      active: {
        repository: pinnedRepository,
        capture,
        cursor,
        snapshot,
      },
    };
  }

  function validPageBoundary(request: HistoryPageRequest): boolean {
    if (!active) return false;
    const current = active.snapshot;
    const lastCommitSha = current.commits.at(-1)?.sha ?? null;
    return (
      /^[0-9a-f]{64}$/.test(request.snapshotId) &&
      /^[0-9a-f]{64}$/.test(request.refFingerprint) &&
      Number.isSafeInteger(request.loadedCount) &&
      request.loadedCount >= 0 &&
      (request.lastCommitSha === null || completeObjectId.test(request.lastCommitSha)) &&
      request.snapshotId === current.snapshotId &&
      request.refFingerprint === current.refFingerprint &&
      request.loadedCount === current.loadedCount &&
      request.lastCommitSha === lastCommitSha
    );
  }

  async function load(pinnedRepository: string): Promise<HistorySnapshot> {
    if (active) {
      return active.repository === pinnedRepository
        ? active.snapshot
        : failure("history-repository-mismatch");
    }
    const built = await buildSnapshot(pinnedRepository, 500, null);
    if ("status" in built) return built;
    active = built.active;
    return active.snapshot;
  }

  async function loadMore(
    pinnedRepository: string,
    request: HistoryPageRequest,
  ): Promise<HistoryPageResult> {
    if (
      !active ||
      active.repository !== pinnedRepository ||
      !validPageBoundary(request) ||
      !active.snapshot.hasMore
    ) {
      return failure(
        "invalid-page-boundary",
        "History page boundary is invalid",
      );
    }
    if (refreshInFlight) {
      return failure(
        "refresh-in-progress",
        "History refresh is already in progress",
      );
    }

    const currentRefs = await captureRefs(pinnedRepository);
    if ("status" in currentRefs) return currentRefs;
    if (currentRefs.fingerprint !== active.snapshot.refFingerprint) {
      return {
        status: "changed",
        message: "History changed — Refresh to continue",
        code: "history-changed",
        snapshotId: active.snapshot.snapshotId,
      };
    }

    const previous = active;
    const nextCursor = cloneHistoryCursor(previous.cursor);
    const rawPage = takeHistoryPage(
      nextCursor,
      500,
      monotonicNow() + historyProcessingBudgetMs,
      monotonicNow,
    );
    if (rawPage === "processing-limit") {
      return failure(
        "history-processing-limit",
        "History exceeds GitRight's supported snapshot limit",
      );
    }
    if (!rawPage || rawPage.length === 0) {
      return failure(
        "invalid-page-boundary",
        "History page boundary is invalid",
      );
    }

    const previousShas = new Set(previous.snapshot.commits.map((commit) => commit.sha));
    if (rawPage.some((commit) => previousShas.has(commit.sha))) {
      return failure(
        "invalid-page-boundary",
        "History page boundary is invalid",
      );
    }
    const loadedShas = new Set([
      ...previousShas,
      ...rawPage.map((commit) => commit.sha),
    ]);
    if (loadedShas.size !== previousShas.size + rawPage.length) {
      return failure(
        "invalid-page-boundary",
        "History page boundary is invalid",
      );
    }
    const materialized = await materializeCommits(
      pinnedRepository,
      previous.capture,
      rawPage,
      loadedShas,
    );
    if ("status" in materialized) return materialized;

    const finalRefs = await captureRefs(pinnedRepository);
    if ("status" in finalRefs) return finalRefs;
    if (finalRefs.fingerprint !== previous.snapshot.refFingerprint) {
      return {
        status: "changed",
        message: "History changed — Refresh to continue",
        code: "history-changed",
        snapshotId: previous.snapshot.snapshotId,
      };
    }

    const previousLoadedCount = previous.snapshot.loadedCount;
    const previousLastCommitSha = previous.snapshot.commits.at(-1)?.sha ?? null;
    const hasMore = nextCursor.ordered.length < nextCursor.totalCount;
    const hasContinuation = snapshotHasContinuation(nextCursor, loadedShas);
    const nextSnapshot: ReadyHistorySnapshot = {
      ...previous.snapshot,
      loadedCount: previousLoadedCount + materialized.commits.length,
      hasContinuation,
      hasMore,
      commits: [...previous.snapshot.commits, ...materialized.commits],
    };
    active = {
      ...previous,
      cursor: nextCursor,
      snapshot: nextSnapshot,
    };

    return {
      status: "ready",
      snapshotId: nextSnapshot.snapshotId,
      refFingerprint: nextSnapshot.refFingerprint,
      previousLoadedCount,
      previousLastCommitSha,
      loadedCount: nextSnapshot.loadedCount,
      pageSize: 500,
      hasContinuation,
      hasMore,
      commits: materialized.commits,
    };
  }

  async function refresh(
    pinnedRepository: string,
    request: HistoryRefreshRequest,
  ): Promise<HistorySnapshot> {
    if (refreshInFlight) {
      return failure(
        "refresh-in-progress",
        "History refresh is already in progress",
      );
    }
    if (
      !active ||
      active.repository !== pinnedRepository ||
      !/^[0-9a-f]{64}$/.test(request.snapshotId) ||
      request.snapshotId !== active.snapshot.snapshotId ||
      (request.selectedSha !== null && !completeObjectId.test(request.selectedSha))
    ) {
      return failure("stale-refresh", "History refresh request is stale");
    }

    const previousLoadedCount = active.snapshot.loadedCount;
    const run = (async (): Promise<HistorySnapshot> => {
      const built = await buildSnapshot(
        pinnedRepository,
        previousLoadedCount,
        request.selectedSha,
      );
      if ("status" in built) return built;
      active = built.active;
      return active.snapshot;
    })();
    refreshInFlight = run;
    try {
      return await run;
    } finally {
      if (refreshInFlight === run) refreshInFlight = null;
    }
  }

  function loadedCommit(snapshotId: string, sha: string): HistoryCommit | null {
    if (
      !active ||
      !/^[0-9a-f]{64}$/.test(snapshotId) ||
      !completeObjectId.test(sha) ||
      active.snapshot.snapshotId !== snapshotId
    ) {
      return null;
    }
    return active.snapshot.commits.find((commit) => commit.sha === sha) ?? null;
  }

  return { load, loadMore, refresh, loadedCommit };
}
