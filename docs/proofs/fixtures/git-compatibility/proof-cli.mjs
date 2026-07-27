#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { directoryDigest } from "../repository-digest.mjs";

const execFile = promisify(execFileCallback);
const minimumGitVersion = "2.30.0";
const defaultTimeoutMs = 2_000;
const defaultOutputLimit = 2 * 1024 * 1024;

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseVersion(output) {
  return output.match(/^git version (\d+\.\d+\.\d+)(?:\D|$)/)?.[1];
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function boundaryConfigState(output) {
  // Keep this proof parser independent from the production parser. Sharing the
  // implementation would make compatibility evidence repeat the code under
  // test instead of checking the same Git output against an external oracle.
  if (output.length === 0 || output.at(-1) !== 0x0a) {
    throw new Error("partial-clone marker output was not LF-delimited");
  }

  let worktreeConfig = false;
  for (const record of output.subarray(0, -1).toString("utf8").split("\n")) {
    const separator = record.indexOf(" ");
    if (separator < 0) throw new Error("partial-clone marker output was malformed");
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1).trim().toLowerCase();

    if (key === "extensions.partialclone") {
      return { partialClone: true, worktreeConfig };
    }
    if (key === "extensions.worktreeconfig") {
      if (!["false", "no", "off", "0"].includes(value)) worktreeConfig = true;
      continue;
    }
    if (!/^remote\..+\.promisor$/.test(key)) {
      throw new Error("partial-clone marker key was outside the allowlist");
    }
    if (!["false", "no", "off", "0"].includes(value)) {
      return { partialClone: true, worktreeConfig };
    }
  }

  return { partialClone: false, worktreeConfig };
}

function requireCompleteSha(value) {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(
      "Git returned an object ID outside the supported SHA-1 format",
    );
  }
  return value;
}

function cleanEnvironment(home) {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_") && value !== undefined)
      environment[name] = value;
  }
  return {
    ...environment,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function gitArguments(operationArgs) {
  return [
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
    ...operationArgs,
  ];
}

async function execute(executable, args, options = {}) {
  const timeout = options.timeout ?? defaultTimeoutMs;
  const maxBuffer = options.maxBuffer ?? defaultOutputLimit;
  try {
    const { stdout, stderr } = await execFile(executable, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "buffer",
      timeout,
      maxBuffer,
    });
    return { status: 0, stdout, stderr, timedOut: false, timeout, maxBuffer };
  } catch (error) {
    const status = Number.isInteger(error.code) ? error.code : null;
    return {
      status,
      stdout: Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.alloc(0),
      stderr: Buffer.isBuffer(error.stderr) ? error.stderr : Buffer.alloc(0),
      timedOut: error.killed === true,
      timeout,
      maxBuffer,
      executionError: status === null ? error.message : undefined,
    };
  }
}

async function executeWithInput(executable, args, input, options = {}) {
  const timeout = options.timeout ?? defaultTimeoutMs;
  const maxBuffer = options.maxBuffer ?? defaultOutputLimit;
  return await new Promise((resolve) => {
    const child = execFileCallback(
      executable,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "buffer",
        timeout,
        maxBuffer,
      },
      (error, stdout, stderr) => {
        const status = error
          ? Number.isInteger(error.code)
            ? error.code
            : null
          : 0;
        resolve({
          status,
          signal: error?.signal ?? null,
          stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0),
          stderr: Buffer.isBuffer(stderr) ? stderr : Buffer.alloc(0),
          timedOut: error?.killed === true,
          timeout,
          maxBuffer,
          executionError: error && status === null ? error.message : undefined,
        });
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

async function setupGit(git, args, cwd, env) {
  const result = await execute(git, args, { cwd, env, timeout: 10_000 });
  if (result.status !== 0) {
    throw new Error(
      `fixture setup failed: git ${args.join(" ")} (${result.status}) ${result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout;
}

async function setupGitWithInput(git, args, input, cwd, env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(git, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      if (status === 0) resolve(Buffer.concat(stdout));
      else {
        reject(
          new Error(
            `fixture setup failed: git ${args.join(" ")} (${status}) ${Buffer.concat(stderr).toString("utf8")}`,
          ),
        );
      }
    });
    child.stdin.end(input);
  });
}

async function createFixture(git, fixtureRoot, env) {
  const repository = join(fixtureRoot, "repository");
  const linkedWorktree = join(fixtureRoot, "linked\nworktree");
  await mkdir(fixtureRoot, { recursive: true });
  await setupGit(git, ["init", "-b", "main", repository], fixtureRoot, env);
  await setupGit(
    git,
    ["config", "user.name", "GitRight Proof"],
    repository,
    env,
  );
  await setupGit(
    git,
    ["config", "user.email", "proof@example.invalid"],
    repository,
    env,
  );

  const oldPath = join(repository, "odd\nname.txt");
  const newPath = join(repository, "renamed\tname.txt");
  await writeFile(oldPath, "one\n");
  await setupGit(git, ["add", "--", "odd\nname.txt"], repository, env);
  await setupGit(git, ["commit", "-m", "initial"], repository, env);
  await setupGit(git, ["branch", "feature", "HEAD"], repository, env);

  await rename(oldPath, newPath);
  await writeFile(newPath, "one\ntwo\n");
  await setupGit(git, ["add", "-A", "--"], repository, env);
  const invalidBlob = (
    await setupGitWithInput(
      git,
      ["hash-object", "-w", "--stdin"],
      Buffer.from("invalid path byte\n"),
      repository,
      env,
    )
  )
    .toString("ascii")
    .trim();
  const invalidIndexRecord = Buffer.concat([
    Buffer.from(`100644 ${invalidBlob}\tinvalid-`),
    Buffer.from([0xff]),
    Buffer.from(".txt\0"),
  ]);
  await setupGitWithInput(
    git,
    ["update-index", "-z", "--index-info"],
    invalidIndexRecord,
    repository,
    env,
  );
  await setupGit(git, ["commit", "-m", "rename odd path"], repository, env);
  await setupGit(git, ["tag", "v1", "HEAD"], repository, env);
  await setupGit(
    git,
    ["update-ref", "refs/remotes/origin/main", "HEAD"],
    repository,
    env,
  );
  await setupGit(
    git,
    ["config", "remote.origin.promisor", "false"],
    repository,
    env,
  );
  await setupGit(
    git,
    ["config", "extensions.worktreeConfig", "true"],
    repository,
    env,
  );
  await setupGit(
    git,
    ["worktree", "add", linkedWorktree, "feature"],
    repository,
    env,
  );
  return { repository, linkedWorktree };
}

function parseRefRecords(output) {
  return output
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, object, type, peeledObject, peeledType] = line.split("\0");
      return { name, object, type, peeledObject, peeledType };
    });
}

function parseSinglePath(output) {
  if (output.length === 0 || output.at(-1) !== 0x0a) {
    throw new Error("Git path output did not end with its record delimiter");
  }
  return output.subarray(0, -1).toString("utf8");
}

function parseWorktreePaths(output) {
  const fields = output.toString("utf8").split("\0");
  const paths = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const refname = fields[index].replace(/^\n/, "");
    const path = fields[index + 1];
    if (refname.startsWith("refs/heads/") && path) paths.push(path);
  }
  return paths;
}

function splitNul(output) {
  const fields = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    fields.push(output.subarray(start, index));
    start = index + 1;
  }
  return fields;
}

function escapePathBytes(path) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = "";
  for (let index = 0; index < path.length; ) {
    const byte = path[index];
    const width =
      byte < 0x80 ? 1 : byte >= 0xc2 && byte <= 0xdf ? 2 : byte <= 0xef ? 3 : 4;
    const candidate = path.subarray(index, index + width);
    try {
      result += decoder.decode(candidate);
      index += width;
    } catch {
      result += `\\x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      index += 1;
    }
  }
  return result;
}

function parseChangedFiles(output) {
  const fields = splitNul(output);
  const entries = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index].toString("ascii");
    index += 1;
    if (/^[RC]\d+$/.test(status)) {
      entries.push({
        status,
        oldPath: escapePathBytes(fields[index]),
        newPath: escapePathBytes(fields[index + 1]),
      });
      index += 2;
    } else {
      entries.push({ status, path: escapePathBytes(fields[index]) });
      index += 1;
    }
  }
  return entries;
}

function parseChangedObjects(output) {
  const fields = splitNul(output);
  const entries = [];
  for (let index = 0; index < fields.length; ) {
    const header = fields[index].toString("ascii");
    index += 1;
    const match = /^:[0-7]{6} [0-7]{6} ([0-9a-f]{40}) ([0-9a-f]{40}) (R\d+|[AMDTRUXB])$/.exec(
      header,
    );
    if (!match) throw new Error("changed-file object output was malformed");
    const [, oldOid, newOid, status] = match;
    if (status.startsWith("R")) {
      entries.push({
        status,
        oldOid: requireCompleteSha(oldOid),
        newOid: requireCompleteSha(newOid),
        oldPath: escapePathBytes(fields[index]),
        newPath: escapePathBytes(fields[index + 1]),
      });
      index += 2;
    } else {
      entries.push({
        status,
        oldOid: requireCompleteSha(oldOid),
        newOid: requireCompleteSha(newOid),
        path: escapePathBytes(fields[index]),
      });
      index += 1;
    }
  }
  return entries;
}

const git = option("--git");
if (!git) {
  process.stderr.write(
    "usage: proof-cli.mjs --git <absolute-path> [--fixture-root <path> | --repository <path>]\n",
  );
  process.exit(64);
}

const versionEnvironment = cleanEnvironment(
  "/private/tmp/gitright-version-home",
);
let detectedGitVersion = "unavailable";
const versionResult = await execute(git, ["--version"], {
  env: versionEnvironment,
  maxBuffer: 64 * 1024,
});
if (versionResult.status === 0) {
  detectedGitVersion =
    parseVersion(versionResult.stdout.toString("utf8")) ?? "unrecognized";
}
const prerequisiteResults = [
  {
    operation: "git-version",
    executable: git,
    arguments: ["--version"],
    readOnly: true,
    shell: false,
    timeoutMs: versionResult.timeout,
    outputLimitBytes: versionResult.maxBuffer,
    exitStatus: versionResult.status,
    timedOut: versionResult.timedOut,
    stdoutBytes: versionResult.stdout.length,
    stderrBytes: versionResult.stderr.length,
  },
];

if (
  detectedGitVersion === "unavailable" ||
  detectedGitVersion === "unrecognized" ||
  compareVersions(detectedGitVersion, minimumGitVersion) < 0
) {
  process.stdout.write(
    `${JSON.stringify({
      verdict: "BLOCKED",
      requiredGitVersion: minimumGitVersion,
      detectedGitVersion,
      copyDiagnostics: true,
      repositoryReads: 0,
      prerequisiteResults,
    })}\n`,
  );
  process.exit(2);
}

const fixtureRoot = option("--fixture-root");
const suppliedRepository = option("--repository");
if (!fixtureRoot && !suppliedRepository) {
  process.stderr.write("one of --fixture-root or --repository is required\n");
  process.exit(64);
}

const home = fixtureRoot
  ? join(fixtureRoot, "home")
  : await mkdtemp(join(tmpdir(), "gitright-proof-home-"));
await mkdir(home, { recursive: true });
const environment = cleanEnvironment(home);
const fixture = fixtureRoot
  ? await createFixture(git, fixtureRoot, environment)
  : { repository: suppliedRepository };
const before = await directoryDigest(fixtureRoot ?? suppliedRepository);
const commandResults = [];

async function run(
  operation,
  operationArgs,
  expectedStatuses = [0],
  options = {},
) {
  const args = gitArguments(operationArgs);
  const executionOptions = {
    cwd: fixture.repository,
    env: { ...environment, ...options.internalEnvironment },
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  };
  const result = options.input
    ? await executeWithInput(git, args, options.input, executionOptions)
    : await execute(git, args, executionOptions);
  commandResults.push({
    operation,
    executable: git,
    arguments: args,
    readOnly: true,
    shell: false,
    timeoutMs: result.timeout,
    outputLimitBytes: result.maxBuffer,
    exitStatus: result.status,
    expectedStatuses,
    timedOut: result.timedOut,
    stdoutBytes: result.stdout.length,
    stderrBytes: result.stderr.length,
    stdinBytes: options.input?.length ?? 0,
    shallowFileOverride: options.internalEnvironment?.GIT_SHALLOW_FILE === "/dev/null",
  });
  if (!expectedStatuses.includes(result.status) || result.timedOut) {
    throw new Error(
      `${operation} failed with ${result.status}: ${result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout;
}

try {
  const repositoryPaths = [
    parseSinglePath(
      await run("repository-top-level", ["rev-parse", "--show-toplevel"]),
    ),
    parseSinglePath(
      await run("repository-git-dir", ["rev-parse", "--absolute-git-dir"]),
    ),
    parseSinglePath(
      await run("repository-common-dir", ["rev-parse", "--git-common-dir"]),
    ),
  ];
  await run("repository-state", [
    "rev-parse",
    "--is-bare-repository",
    "--is-shallow-repository",
    "--show-object-format",
  ]);
  const partialCloneMarker = await run(
    "partial-clone-marker",
    [
      "config",
      "--local",
      "--get-regexp",
      "^(extensions\\.(partialclone|worktreeconfig)|remote\\..*\\.promisor|core\\.worktree|include\\.path|includeif\\..*\\.path)$",
    ],
    [0, 1],
  );
  const localBoundaryConfig = partialCloneMarker.length > 0
    ? boundaryConfigState(partialCloneMarker)
    : { partialClone: false, worktreeConfig: false };
  if (localBoundaryConfig.partialClone) {
    throw new Error("partial clones are rejected before object reads");
  }
  if (localBoundaryConfig.worktreeConfig) {
    const worktreeBoundaryConfig = await run(
      "worktree-config-marker",
      [
        "config",
        "--worktree",
        "--get-regexp",
        "^(extensions\\.partialclone|remote\\..*\\.promisor|core\\.worktree|include\\.path|includeif\\..*\\.path)$",
      ],
      [0, 1],
    );
    if (
      worktreeBoundaryConfig.length > 0 &&
      boundaryConfigState(worktreeBoundaryConfig).partialClone
    ) {
      throw new Error("worktree config partial clones are rejected before object reads");
    }
  }
  const head = requireCompleteSha(
    (await run("head-commit", ["rev-parse", "--verify", "HEAD^{commit}"]))
      .toString("ascii")
      .trim(),
  );
  await run("symbolic-head", ["symbolic-ref", "-q", "HEAD"], [0, 1]);
  const refsOutput = await run("available-refs", [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00",
    "refs/heads",
    "refs/tags",
    "refs/remotes",
  ]);
  const refs = parseRefRecords(refsOutput);
  const validatedTips = [
    ...new Set([
      head,
      ...refs
        .map(({ object, type, peeledObject, peeledType }) =>
          type === "commit"
            ? requireCompleteSha(object)
            : type === "tag" && peeledType === "commit"
              ? requireCompleteSha(peeledObject)
              : null,
        )
        .filter(Boolean),
    ]),
  ].sort();
  const historyOutput = await run("available-history", [
    "rev-list",
    "--parents",
    "--timestamp",
    ...validatedTips,
  ]);
  const historyShas = historyOutput
    .toString("ascii")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => requireCompleteSha(line.split(" ")[1]));
  await run(
    "history-parents",
    ["rev-list", "--stdin", "--no-walk", "--parents"],
    [0],
    {
      input: Buffer.from(`${historyShas.join("\n")}\n`, "ascii"),
      internalEnvironment: { GIT_SHALLOW_FILE: "/dev/null" },
    },
  );
  await run("history-subjects", [
    "show",
    "-s",
    "--no-patch",
    "--no-show-signature",
    "--format=%H%x00%s%x00",
    ...historyShas,
    "--",
  ]);
  await run("commit-detail", [
    "show",
    "-s",
    "--no-patch",
    "--no-show-signature",
    "--format=%H%x00%P%x00%an%x00%aI%x00%cI%x00%B%x00",
    head,
    "--",
  ]);
  const parent = requireCompleteSha(
    (
      await run("parent-commit", [
        "rev-parse",
        "--verify",
        `${head}^1^{commit}`,
      ])
    )
      .toString("ascii")
      .trim(),
  );
  const changedFilesOutput = await run("changed-files", [
    "diff-tree",
    "--no-commit-id",
    "-r",
    "-z",
    "--name-status",
    "-M50%",
    "--no-ext-diff",
    "--no-textconv",
    parent,
    head,
    "--",
  ]);
  await run("changed-file-stats", [
    "diff-tree",
    "--no-commit-id",
    "-r",
    "-z",
    "--numstat",
    "-M50%",
    "--no-ext-diff",
    "--no-textconv",
    parent,
    head,
    "--",
  ]);
  const changedObjectsOutput = await run("changed-file-objects", [
    "diff-tree",
    "--no-commit-id",
    "-r",
    "-z",
    "--raw",
    "--abbrev=40",
    "-M50%",
    "--no-ext-diff",
    "--no-textconv",
    parent,
    head,
    "--",
  ]);
  await run("changed-files-no-renames", [
    "diff-tree",
    "--no-commit-id",
    "-r",
    "-z",
    "--name-status",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    parent,
    head,
    "--",
  ]);
  await run("changed-file-stats-no-renames", [
    "diff-tree",
    "--no-commit-id",
    "-r",
    "-z",
    "--numstat",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    parent,
    head,
    "--",
  ]);
  await run("changed-file-objects-no-renames", [
    "diff-tree",
    "--no-commit-id",
    "-r",
    "-z",
    "--raw",
    "--abbrev=40",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    parent,
    head,
    "--",
  ]);
  const selectedObject = parseChangedObjects(changedObjectsOutput).find(
    (entry) => entry.newPath === "renamed\tname.txt",
  );
  if (!selectedObject) throw new Error("selected changed-file object was missing");
  await run(
    "file-diff",
    [
      "diff",
      "--text",
      "--full-index",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      selectedObject.oldOid,
      selectedObject.newOid,
      "--",
    ],
    [0],
    { maxBuffer: 1024 * 1024 },
  );
  await run("blob-exists", ["cat-file", "-e", `${selectedObject.newOid}^{blob}`]);
  const worktreesOutput = await run("worktree-metadata", [
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)%00%(worktreepath)%00",
    "refs/heads",
  ]);
  await run("object-exists", ["cat-file", "-e", `${head}^{commit}`]);

  const after = await directoryDigest(fixtureRoot ?? suppliedRepository);
  const changedFiles = parseChangedFiles(changedFilesOutput);
  const networkAccess =
    process.env.GITRIGHT_NETWORK_POLICY === "deny" ? "denied" : "unverified";
  const repositoryUnchanged = before === after;
  const verdict =
    networkAccess === "denied" &&
    repositoryUnchanged &&
    commandResults.every((result) => !result.timedOut)
      ? "PASS"
      : "BLOCKED";

  process.stdout.write(
    `${JSON.stringify({
      verdict,
      requiredGitVersion: minimumGitVersion,
      detectedGitVersion,
      gitPath: git,
      networkAccess,
      repositoryUnchanged,
      repositoryDigestBefore: before,
      repositoryDigestAfter: after,
      prerequisiteResults,
      locale: "C",
      encoding: "bytes with explicit UTF-8 decoding",
      repositoryReads: commandResults.length,
      commandResults,
      repositoryPaths,
      refNames: refs.map(({ name }) => name),
      worktreePaths: parseWorktreePaths(worktreesOutput),
      rename: changedFiles.find(({ status }) => status.startsWith("R")),
      changedPaths: changedFiles.flatMap(({ path, oldPath, newPath }) =>
        [path, oldPath, newPath].filter(Boolean),
      ),
      copyDiagnostics: true,
    })}\n`,
  );
  process.exitCode = verdict === "PASS" ? 0 : 2;
} catch {
  const afterFailure = await directoryDigest(fixtureRoot ?? suppliedRepository);
  const failedCommand = commandResults.at(-1);
  process.stdout.write(
    `${JSON.stringify({
      verdict: "BLOCKED",
      requiredGitVersion: minimumGitVersion,
      detectedGitVersion,
      gitPath: git,
      networkAccess:
        process.env.GITRIGHT_NETWORK_POLICY === "deny"
          ? "denied"
          : "unverified",
      repositoryUnchanged: before === afterFailure,
      prerequisiteResults,
      locale: "C",
      encoding: "bytes with explicit UTF-8 decoding",
      repositoryReads: commandResults.length,
      commandResults,
      failure: failedCommand
        ? {
            operation: failedCommand.operation,
            exitStatus: failedCommand.exitStatus,
            timedOut: failedCommand.timedOut,
            stderrBytes: failedCommand.stderrBytes,
          }
        : { operation: "proof-runner", timedOut: false, stderrBytes: 0 },
      copyDiagnostics: true,
    })}\n`,
  );
  process.exitCode = 2;
}
