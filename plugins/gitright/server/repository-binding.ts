import { execFile as execFileCallback, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

export type GitResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  outputLimited?: boolean;
};

export type GitFailureKind =
  | "transient-lock"
  | "missing-object"
  | "corrupt-object";

export type RepositoryOperation =
  | "boundary"
  | "partial-clone"
  | "worktree-config"
  | "top-level"
  | "git-directory"
  | "common-directory"
  | "head"
  | "symbolic-head"
  | "refs"
  | "worktree-branches"
  | "history-page"
  | "history-parents"
  | "history-subjects"
  | "commit-detail"
  | "changed-files"
  | "changed-file-stats"
  | "changed-file-objects"
  | "changed-files-no-renames"
  | "changed-file-stats-no-renames"
  | "changed-file-objects-no-renames"
  | "blob-exists"
  | "file-diff";

export type GitExecutor = {
  version: () => Promise<GitResult>;
  repository: (
    cwd: string,
    operation: RepositoryOperation,
    objectIds?: readonly string[],
    pathspecs?: readonly string[],
  ) => Promise<GitResult>;
};

export type RepositoryState =
  | {
      status: "ready";
      message: "Repository ready";
      repositoryName: string;
      repositoryPath: string;
      repositoryKind: "repository" | "linked-worktree";
      branch: string | null;
      worktreeName: string | null;
      gitVersion: string;
    }
  | {
      status: "unavailable";
      message: "Current task repository is unavailable";
    }
  | {
      status: "unsupported";
      message:
        | "Bare repositories are not supported in this version"
        | "Partial clones are not supported in this version"
        | "SHA-256 repositories are not supported in this version";
      gitVersion: string;
    }
  | {
      status: "ownership-refused";
      message: "Git refused this repository because its ownership is not trusted";
      guidance: "Resolve the repository trust outside GitRight, then open a new task";
      gitVersion: string;
    }
  | {
      status: "blocked";
      message: "Git 2.30.0 or newer is required";
      requiredGitVersion: "2.30.0";
      detectedGitVersion: string;
      durationMs: number;
      errorCode: "git-version-blocked";
    };

const unavailableState: RepositoryState = {
  status: "unavailable",
  message: "Current task repository is unavailable",
};

const minimumGitVersion = "2.30.0";

function boundedDuration(started: number, finished: number): number {
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return 0;
  return Number(Math.max(0, finished - started).toFixed(3));
}

const fixedRepositoryArguments = {
  boundary: [
    "rev-parse",
    "--is-bare-repository",
    "--is-shallow-repository",
    "--show-object-format",
  ],
  "partial-clone": [
    "config",
    "--local",
    "--get-regexp",
    "^(extensions\\.(partialclone|worktreeconfig)|remote\\..*\\.promisor|core\\.worktree|include\\.path|includeif\\..*\\.path)$",
  ],
  "worktree-config": [
    "config",
    "--worktree",
    "--get-regexp",
    "^(extensions\\.partialclone|remote\\..*\\.promisor|core\\.worktree|include\\.path|includeif\\..*\\.path)$",
  ],
  "top-level": ["rev-parse", "--show-toplevel"],
  "git-directory": ["rev-parse", "--absolute-git-dir"],
  "common-directory": ["rev-parse", "--git-common-dir"],
  head: ["rev-parse", "--verify", "HEAD^{commit}"],
  "symbolic-head": ["symbolic-ref", "-q", "HEAD"],
  refs: [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00",
    "refs/heads",
    "refs/tags",
    "refs/remotes",
  ],
  "worktree-branches": [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(worktreepath)%00",
    "refs/heads",
  ],
} as const satisfies Partial<Record<RepositoryOperation, readonly string[]>>;
const fixedGitArguments = [
  "--no-pager",
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "color.ui=false",
  "-c",
  "core.attributesFile=/dev/null",
  "-c",
  "core.excludesFile=/dev/null",
  "-c",
  "diff.orderFile=/dev/null",
] as const;

let isolatedGitHome: string | null = null;
const activeGitProcesses = new Set<ChildProcess>();
let shutdownHandlersRegistered = false;

function cleanupGitRuntime(): void {
  for (const child of activeGitProcesses) child.kill("SIGKILL");
  activeGitProcesses.clear();
  if (!isolatedGitHome) return;
  rmSync(isolatedGitHome, { recursive: true, force: true });
  isolatedGitHome = null;
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;
  process.once("exit", cleanupGitRuntime);
  for (const [signal, exitCode] of [
    ["SIGHUP", 129],
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.once(signal, () => {
      cleanupGitRuntime();
      process.exit(exitCode);
    });
  }
}

function gitHome(): string {
  if (isolatedGitHome) return isolatedGitHome;
  isolatedGitHome = mkdtempSync(path.join(tmpdir(), "gitright-git-home-"));
  registerShutdownHandlers();
  return isolatedGitHome;
}

function trackGitProcess(child: ChildProcess): void {
  activeGitProcesses.add(child);
  child.once("close", () => activeGitProcesses.delete(child));
}

export function cleanGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_") && typeof value === "string") environment[name] = value;
  }
  const home = gitHome();
  return {
    ...environment,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function pathContains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

type ExecFileFailure = Error & {
  code?: number | string;
  signal?: NodeJS.Signals | null;
  killed?: boolean;
  stdout?: Buffer | string;
  stderr?: Buffer | string;
};

function asBuffer(value: Buffer | string | undefined): Buffer {
  if (Buffer.isBuffer(value)) return value;
  return typeof value === "string" ? Buffer.from(value) : Buffer.alloc(0);
}

async function executeGit(
  args: readonly string[],
  cwd?: string,
  internalEnvironment: NodeJS.ProcessEnv = {},
  maxBuffer = 2 * 1024 * 1024,
  timeoutMs = 2_000,
): Promise<GitResult> {
  return await new Promise((resolve) => {
    const child = execFileCallback(
      "/usr/bin/git",
      [...args],
      {
        cwd,
        encoding: "buffer",
        env: { ...cleanGitEnvironment(), ...internalEnvironment },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer,
      },
      (error, stdout, stderr) => {
        activeGitProcesses.delete(child);
        if (!error) {
          resolve({
            status: 0,
            signal: null,
            stdout: asBuffer(stdout),
            stderr: asBuffer(stderr),
            timedOut: false,
            outputLimited: false,
          });
          return;
        }
        const failure = error as ExecFileFailure;
        resolve({
          status: Number.isInteger(failure.code) ? Number(failure.code) : null,
          signal: failure.signal ?? null,
          stdout: asBuffer(stdout),
          stderr: asBuffer(stderr),
          timedOut: failure.killed === true,
          outputLimited: failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    );
    trackGitProcess(child);
  });
}

async function executeGitWithInput(
  args: readonly string[],
  input: Buffer,
  cwd: string,
  internalEnvironment: NodeJS.ProcessEnv,
  maxBuffer: number,
  timeoutMs = 2_000,
): Promise<GitResult> {
  return await new Promise((resolve) => {
    const child = execFileCallback(
      "/usr/bin/git",
      [...args],
      {
        cwd,
        encoding: "buffer",
        env: { ...cleanGitEnvironment(), ...internalEnvironment },
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer,
      },
      (error, stdout, stderr) => {
        activeGitProcesses.delete(child);
        if (!error) {
          resolve({
            status: 0,
            signal: null,
            stdout: asBuffer(stdout),
            stderr: asBuffer(stderr),
            timedOut: false,
            outputLimited: false,
          });
          return;
        }
        const failure = error as ExecFileFailure;
        resolve({
          status: Number.isInteger(failure.code) ? Number(failure.code) : null,
          signal: failure.signal ?? null,
          stdout: asBuffer(stdout),
          stderr: asBuffer(stderr),
          timedOut: failure.killed === true,
          outputLimited: failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
      },
    );
    trackGitProcess(child);
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

const completeObjectId = /^[0-9a-f]{40}$/;

function repositoryOperationArguments(
  operation: RepositoryOperation,
  objectIds: readonly string[],
  pathspecs: readonly string[],
): readonly string[] | null {
  if (
    operation === "history-page" ||
    operation === "history-parents" ||
    operation === "history-subjects"
  ) {
    if (
      objectIds.length === 0 ||
      (operation === "history-parents" && objectIds.length > 100_000) ||
      (operation === "history-subjects" && objectIds.length > 500) ||
      objectIds.some((objectId) => !completeObjectId.test(objectId))
    ) {
      return null;
    }
    if (operation === "history-page") {
      return [
        "rev-list",
        "--parents",
        "--timestamp",
        ...objectIds,
      ];
    }
    if (operation === "history-parents") {
      return ["rev-list", "--stdin", "--no-walk", "--parents"];
    }
    return [
      "show",
      "-s",
      "--no-patch",
      "--no-show-signature",
      "--format=%H%x00%s%x00",
      ...objectIds,
      "--",
    ];
  }

  if (
    operation === "commit-detail" ||
    operation === "changed-files" ||
    operation === "changed-file-stats" ||
    operation === "changed-file-objects" ||
    operation === "changed-files-no-renames" ||
    operation === "changed-file-stats-no-renames" ||
    operation === "changed-file-objects-no-renames" ||
    operation === "file-diff"
  ) {
    if (
      objectIds.some((objectId) => !completeObjectId.test(objectId)) ||
      (operation === "commit-detail" && objectIds.length !== 1) ||
      (operation === "file-diff"
        ? objectIds.length !== 2 || objectIds.every((objectId) => /^0{40}$/.test(objectId))
        : operation !== "commit-detail" && ![1, 2].includes(objectIds.length)) ||
      (operation === "file-diff"
        ? pathspecs.length < 1 || pathspecs.length > 2 || pathspecs.some((pathspec) =>
            pathspec.length === 0 ||
            pathspec.includes("\0") ||
            path.isAbsolute(pathspec) ||
            path.posix.normalize(pathspec) !== pathspec ||
            pathspec === ".." ||
            pathspec.startsWith("../")
          )
        : pathspecs.length !== 0)
    ) {
      return null;
    }
    if (operation === "commit-detail") {
      return [
        "show",
        "-s",
        "--no-patch",
        "--no-show-signature",
        "--format=%H%x00%P%x00%an%x00%aI%x00%cI%x00%B%x00",
        objectIds[0],
        "--",
      ];
    }
    if (operation === "file-diff") {
      const populatedObjectIds = objectIds.filter((objectId) => !/^0{40}$/.test(objectId));
      if (populatedObjectIds.length === 1) {
        return ["cat-file", "blob", populatedObjectIds[0]];
      }
      return [
        "diff",
        "--text",
        "--full-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        ...objectIds,
        "--",
      ];
    }
    return [
      "diff-tree",
      ...(objectIds.length === 1 ? ["--root"] : []),
      "--no-commit-id",
      "-r",
      "-z",
      ...(operation === "changed-files" || operation === "changed-files-no-renames"
        ? ["--name-status"]
        : operation === "changed-file-stats" || operation === "changed-file-stats-no-renames"
          ? ["--numstat"]
          : ["--raw", "--abbrev=40"]),
      ...(operation.endsWith("-no-renames") ? ["--no-renames"] : ["-M50%"]),
      "--no-ext-diff",
      "--no-textconv",
      ...objectIds,
      "--",
    ];
  }

  if (operation === "blob-exists") {
    if (
      objectIds.length !== 1 ||
      !completeObjectId.test(objectIds[0]) ||
      /^0{40}$/.test(objectIds[0]) ||
      pathspecs.length !== 0
    ) {
      return null;
    }
    return ["cat-file", "-e", `${objectIds[0]}^{blob}`];
  }

  if (objectIds.length !== 0 || pathspecs.length !== 0) return null;
  return fixedRepositoryArguments[operation] ?? null;
}

function invalidOperationResult(): GitResult {
  return {
    status: null,
    signal: null,
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    timedOut: false,
    outputLimited: false,
  };
}

export function classifyGitFailure(result: GitResult): GitFailureKind | null {
  if (result.status === 0 || result.signal !== null || result.timedOut) return null;
  const error = result.stderr.subarray(0, 64 * 1024).toString("utf8");
  if (
    /object file .* is (?:empty|corrupt)|(?:loose|packed) object .* is corrupt|corrupt (?:loose )?object|sha1 mismatch|hash mismatch|inflate: data stream error/i.test(
      error,
    )
  ) {
    return "corrupt-object";
  }
  if (
    /unable to create .*\.lock|could not lock|cannot lock ref|\.lock['"]?: File exists|another git process/i.test(
      error,
    )
  ) {
    return "transient-lock";
  }
  if (
    /bad object|not a valid object name|missing (?:blob|tree|commit|object)|(?:could not|unable to) read [0-9a-f]{40}|unable to read (?:tree|object)|unable to find [0-9a-f]{40}|git cat-file [0-9a-f]{40}: bad file/i.test(
      error,
    )
  ) {
    return "missing-object";
  }
  return null;
}

const retryWindowMs = 5_000;

export async function retryTransientGitRead(
  run: (timeoutMs: number) => Promise<GitResult>,
  monotonicNow: () => number = () => performance.now(),
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<GitResult> {
  const deadline = monotonicNow() + retryWindowMs;
  let delay = 25;
  let result: GitResult;

  while (true) {
    const remaining = Math.max(1, Math.floor(deadline - monotonicNow()));
    result = await run(Math.min(2_000, remaining));
    if (classifyGitFailure(result) !== "transient-lock") return result;

    const remainingAfterRead = deadline - monotonicNow();
    if (remainingAfterRead <= 0) return result;
    await wait(Math.min(delay, remainingAfterRead));
    if (monotonicNow() >= deadline) return result;
    delay = Math.min(delay * 2, 1_000);
  }
}

function executeRepositoryOperation(
  cwd: string,
  operation: RepositoryOperation,
  operationArguments: readonly string[],
  objectIds: readonly string[],
  timeoutMs: number,
): Promise<GitResult> {
  if (operation === "history-parents") {
    return executeGitWithInput(
      [...fixedGitArguments, ...operationArguments],
      Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
      cwd,
      { GIT_SHALLOW_FILE: "/dev/null" },
      16 * 1024 * 1024,
      timeoutMs,
    );
  }
  return executeGit(
    [...fixedGitArguments, ...operationArguments],
    cwd,
    undefined,
    operation === "file-diff"
      ? 1024 * 1024
      : [
          "history-page",
          "changed-files",
          "changed-file-stats",
          "changed-file-objects",
          "changed-files-no-renames",
          "changed-file-stats-no-renames",
          "changed-file-objects-no-renames",
        ].includes(operation)
        ? 16 * 1024 * 1024
        : undefined,
    timeoutMs,
  );
}

export const systemGitExecutor: GitExecutor = {
  version: () => executeGit(["--version"]),
  repository: (cwd, operation, objectIds = [], pathspecs = []) => {
    const operationArguments = repositoryOperationArguments(operation, objectIds, pathspecs);
    if (!operationArguments) return Promise.resolve(invalidOperationResult());
    return retryTransientGitRead(
      (timeoutMs) => executeRepositoryOperation(
        cwd,
        operation,
        operationArguments,
        objectIds,
        timeoutMs,
      ),
    );
  },
};

function trustedWorkspace(params: unknown): string | null {
  if (!params || typeof params !== "object") return null;
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return null;
  const turnMetadata = (meta as Record<string, unknown>)["x-codex-turn-metadata"];
  if (!turnMetadata || typeof turnMetadata !== "object") return null;
  const workspaces = (turnMetadata as { workspaces?: unknown }).workspaces;
  if (!workspaces || typeof workspaces !== "object" || Array.isArray(workspaces)) return null;
  const keys = Object.keys(workspaces);
  return keys.length === 1 && path.isAbsolute(keys[0]) ? keys[0] : null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function detectedGitVersion(result: GitResult): string {
  if (result.status !== 0 || result.signal !== null || result.timedOut) return "unavailable";
  const match = /^git version (\d+\.\d+\.\d+)(?:\s|\n|$)/.exec(
    result.stdout.toString("utf8"),
  );
  return match?.[1] ?? "unrecognized";
}

function successfulOutput(result: GitResult): Buffer | null {
  return result.status === 0 && result.signal === null && !result.timedOut
    ? result.stdout
    : null;
}

function ownershipRefused(result: GitResult): boolean {
  if (result.status === 0) return false;
  const boundedError = result.stderr.subarray(0, 64 * 1024).toString("utf8");
  return /detected dubious ownership|unsafe repository|safe\.directory/i.test(boundedError);
}

function ownershipState(gitVersion: string): RepositoryState {
  return {
    status: "ownership-refused",
    message: "Git refused this repository because its ownership is not trusted",
    guidance: "Resolve the repository trust outside GitRight, then open a new task",
    gitVersion,
  };
}

function singlePath(output: Buffer): string | null {
  if (output.length === 0 || output.at(-1) !== 0x0a) return null;
  const value = output.subarray(0, -1).toString("utf8");
  return path.isAbsolute(value) ? value : null;
}

function partialCloneMarker(
  output: Buffer,
): "present" | "absent" | "invalid" | "worktree-config" {
  if (output.length === 0 || output.at(-1) !== 0x0a) return "invalid";
  let worktreeConfig = false;

  for (const record of output.subarray(0, -1).toString("utf8").split("\n")) {
    const separator = record.indexOf(" ");
    if (separator < 0) return "invalid";
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1).trim().toLowerCase();

    if (key === "extensions.partialclone") return "present";
    if (key === "extensions.worktreeconfig") {
      if (!["false", "no", "off", "0"].includes(value)) worktreeConfig = true;
      continue;
    }
    if (!/^remote\..+\.promisor$/.test(key)) return "invalid";
    if (!["false", "no", "off", "0"].includes(value)) return "present";
  }

  return worktreeConfig ? "worktree-config" : "absent";
}

export async function systemGitDiagnostics(
  monotonicNow: () => number = () => performance.now(),
): Promise<{
  status: "ok" | "error";
  version: string;
  durationMs: number;
  errorCode: "git-version-unavailable" | null;
}> {
  const started = monotonicNow();
  const result = await systemGitExecutor.version();
  const durationMs = boundedDuration(started, monotonicNow());
  const version = detectedGitVersion(result);
  const status = /^\d+\.\d+\.\d+$/.test(version) ? "ok" : "error";
  return {
    status,
    version: status === "ok" ? `git version ${version}` : version,
    durationMs,
    errorCode: status === "ok" ? null : "git-version-unavailable",
  };
}

export function createRepositoryBinding(
  git: GitExecutor = systemGitExecutor,
  canonicalizePath: (value: string) => Promise<string> = realpath,
  monotonicNow: () => number = () => performance.now(),
) {
  let attempted = false;
  let state: RepositoryState | null = null;
  let pinnedRoot: string | null = null;

  return {
    async open(params: unknown): Promise<RepositoryState> {
      if (attempted) return state ?? unavailableState;
      attempted = true;

      const workspace = trustedWorkspace(params);
      if (!workspace) {
        state = unavailableState;
        return state;
      }

      const gitVersionStarted = monotonicNow();
      const gitVersion = detectedGitVersion(await git.version());
      const gitVersionDurationMs = boundedDuration(gitVersionStarted, monotonicNow());
      if (
        gitVersion === "unavailable" ||
        gitVersion === "unrecognized" ||
        compareVersions(gitVersion, minimumGitVersion) < 0
      ) {
        state = {
          status: "blocked",
          message: "Git 2.30.0 or newer is required",
          requiredGitVersion: minimumGitVersion,
          detectedGitVersion: gitVersion,
          durationMs: gitVersionDurationMs,
          errorCode: "git-version-blocked",
        };
        return state;
      }

      const boundaryResult = await git.repository(workspace, "boundary");
      if (ownershipRefused(boundaryResult)) {
        state = ownershipState(gitVersion);
        return state;
      }
      const boundaryOutput = successfulOutput(boundaryResult);
      if (!boundaryOutput) {
        state = unavailableState;
        return state;
      }

      const boundaryRecords = boundaryOutput.toString("ascii").split("\n");
      if (boundaryRecords[0] === "true") {
        state = {
          status: "unsupported",
          message: "Bare repositories are not supported in this version",
          gitVersion,
        };
        return state;
      }
      if (
        boundaryRecords.length !== 4 ||
        boundaryRecords[0] !== "false" ||
        !["true", "false"].includes(boundaryRecords[1]) ||
        !["sha1", "sha256"].includes(boundaryRecords[2]) ||
        boundaryRecords[3] !== ""
      ) {
        state = unavailableState;
        return state;
      }
      if (boundaryRecords[2] === "sha256") {
        state = {
          status: "unsupported",
          message: "SHA-256 repositories are not supported in this version",
          gitVersion,
        };
        return state;
      }

      const partialCloneResult = await git.repository(workspace, "partial-clone");
      if (ownershipRefused(partialCloneResult)) {
        state = ownershipState(gitVersion);
        return state;
      }
      const partialCloneOutput = successfulOutput(partialCloneResult);
      let worktreeConfigEnabled = false;
      if (partialCloneOutput !== null) {
        const marker = partialCloneMarker(partialCloneOutput);
        if (marker === "invalid") {
          state = unavailableState;
          return state;
        }
        if (marker === "present") {
          state = {
            status: "unsupported",
            message: "Partial clones are not supported in this version",
            gitVersion,
          };
          return state;
        }
        worktreeConfigEnabled = marker === "worktree-config";
      }
      if (partialCloneOutput === null && (
        partialCloneResult.status !== 1 ||
        partialCloneResult.signal !== null ||
        partialCloneResult.timedOut
      )) {
        state = unavailableState;
        return state;
      }

      if (worktreeConfigEnabled) {
        const worktreeConfigResult = await git.repository(workspace, "worktree-config");
        if (ownershipRefused(worktreeConfigResult)) {
          state = ownershipState(gitVersion);
          return state;
        }
        const worktreeConfigOutput = successfulOutput(worktreeConfigResult);
        if (worktreeConfigOutput !== null) {
          const marker = partialCloneMarker(worktreeConfigOutput);
          if (marker === "invalid" || marker === "worktree-config") {
            state = unavailableState;
            return state;
          }
          if (marker === "present") {
            state = {
              status: "unsupported",
              message: "Partial clones are not supported in this version",
              gitVersion,
            };
            return state;
          }
        }
        if (worktreeConfigOutput === null && (
          worktreeConfigResult.status !== 1 ||
          worktreeConfigResult.signal !== null ||
          worktreeConfigResult.timedOut
        )) {
          state = unavailableState;
          return state;
        }
      }

      const repositoryRootResult = await git.repository(workspace, "top-level");
      const gitDirectoryResult = await git.repository(workspace, "git-directory");
      const commonDirectoryResult = await git.repository(workspace, "common-directory");
      const symbolicHeadResult = await git.repository(workspace, "symbolic-head");
      for (const result of [
        repositoryRootResult,
        gitDirectoryResult,
        commonDirectoryResult,
        symbolicHeadResult,
      ]) {
        if (ownershipRefused(result)) {
          state = ownershipState(gitVersion);
          return state;
        }
      }

      const repositoryRootOutput = successfulOutput(repositoryRootResult);
      const gitDirectoryOutput = successfulOutput(gitDirectoryResult);
      const commonDirectoryOutput = successfulOutput(commonDirectoryResult);
      if (!repositoryRootOutput || !gitDirectoryOutput || !commonDirectoryOutput) {
        state = unavailableState;
        return state;
      }

      const repositoryRoot = singlePath(repositoryRootOutput);
      const gitDirectory = singlePath(gitDirectoryOutput);
      if (commonDirectoryOutput.length === 0 || commonDirectoryOutput.at(-1) !== 0x0a) {
        state = unavailableState;
        return state;
      }
      const commonDirectoryValue = commonDirectoryOutput.subarray(0, -1).toString("utf8");
      const commonDirectory = path.isAbsolute(commonDirectoryValue)
        ? commonDirectoryValue
        : path.resolve(workspace, commonDirectoryValue);
      if (!repositoryRoot || !gitDirectory || commonDirectoryValue.length === 0) {
        state = unavailableState;
        return state;
      }

      const symbolicHeadOutput = successfulOutput(symbolicHeadResult);
      let branch: string | null = null;
      if (symbolicHeadOutput !== null) {
        if (symbolicHeadOutput.length === 0 || symbolicHeadOutput.at(-1) !== 0x0a) {
          state = unavailableState;
          return state;
        }
        const symbolicHead = symbolicHeadOutput.subarray(0, -1).toString("utf8");
        const branchPrefix = "refs/heads/";
        if (
          !symbolicHead.startsWith(branchPrefix) ||
          symbolicHead.length === branchPrefix.length
        ) {
          state = unavailableState;
          return state;
        }
        branch = symbolicHead.slice(branchPrefix.length);
      }
      if (symbolicHeadOutput === null && (
        symbolicHeadResult.status !== 1 ||
        symbolicHeadResult.signal !== null ||
        symbolicHeadResult.timedOut
      )) {
        state = unavailableState;
        return state;
      }

      let canonicalWorkspace: string;
      let canonicalRepositoryRoot: string;
      let canonicalGitDirectory: string;
      let canonicalCommonDirectory: string;
      try {
        [
          canonicalWorkspace,
          canonicalRepositoryRoot,
          canonicalGitDirectory,
          canonicalCommonDirectory,
        ] = await Promise.all([
          canonicalizePath(workspace),
          canonicalizePath(repositoryRoot),
          canonicalizePath(gitDirectory),
          canonicalizePath(commonDirectory),
        ]);
      } catch {
        state = unavailableState;
        return state;
      }
      if (!pathContains(canonicalRepositoryRoot, canonicalWorkspace)) {
        state = unavailableState;
        return state;
      }

      const repositoryKind =
        path.normalize(canonicalGitDirectory) === path.normalize(canonicalCommonDirectory)
          ? "repository"
          : "linked-worktree";
      state = {
        status: "ready",
        message: "Repository ready",
        repositoryName: path.basename(canonicalRepositoryRoot),
        repositoryPath: path.dirname(path.normalize(canonicalCommonDirectory)),
        repositoryKind,
        branch,
        worktreeName: repositoryKind === "linked-worktree"
          ? path.basename(canonicalRepositoryRoot)
          : null,
        gitVersion,
      };
      pinnedRoot = canonicalRepositoryRoot;
      return state;
    },

    current(): RepositoryState {
      return state ?? unavailableState;
    },

    pinnedRepository(): string | null {
      return pinnedRoot;
    },
  };
}
