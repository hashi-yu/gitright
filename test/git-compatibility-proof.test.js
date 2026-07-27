import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";

const execFile = promisify(execFileCallback);
const proofCli = new URL(
  "../docs/proofs/fixtures/git-compatibility/proof-cli.mjs",
  import.meta.url,
);

async function runProof(args, options = {}) {
  const command = options.offline ? "/usr/bin/sandbox-exec" : process.execPath;
  const commandArgs = options.offline
    ? [
        "-p",
        "(version 1) (allow default) (deny network*)",
        process.execPath,
        proofCli.pathname,
        ...args,
      ]
    : [proofCli.pathname, ...args];
  const result = await execFile(command, commandArgs, {
    env: {
      ...process.env,
      GITRIGHT_NETWORK_POLICY: options.offline ? "deny" : "unverified",
    },
    maxBuffer: 4 * 1024 * 1024,
  }).catch((error) => error);
  return JSON.parse(result.stdout);
}

async function canApplyNetworkSandbox() {
  try {
    await execFile("/usr/bin/sandbox-exec", [
      "-p",
      "(version 1) (allow default) (deny network*)",
      "/usr/bin/true",
    ]);
    return true;
  } catch {
    return false;
  }
}

test("unsupported Git is rejected before any repository read", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitright-old-git-"));
  const fakeGit = join(root, "git");
  const calls = join(root, "calls");

  await writeFile(
    fakeGit,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'git version 2.29.9'
  exit 0
fi
exit 99
`,
  );
  await chmod(fakeGit, 0o755);

  const result = await runProof([
    "--git",
    fakeGit,
    "--repository",
    join(root, "must-not-be-read"),
  ]);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.requiredGitVersion, "2.30.0");
  assert.equal(result.detectedGitVersion, "2.29.9");
  assert.equal(result.copyDiagnostics, true);
  assert.equal(result.repositoryReads, 0);
  assert.equal(result.prerequisiteResults[0].operation, "git-version");
  assert.equal(await readFile(calls, "utf8"), "--version\n");
});

test("missing Git is rejected before any repository read", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitright-missing-git-"));
  const result = await runProof([
    "--git",
    join(root, "missing-git"),
    "--repository",
    join(root, "must-not-be-read"),
  ]);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.requiredGitVersion, "2.30.0");
  assert.equal(result.detectedGitVersion, "unavailable");
  assert.equal(result.copyDiagnostics, true);
  assert.equal(result.repositoryReads, 0);
});

test("current macOS system Git executes the complete read-only allowlist offline", async (t) => {
  if (!(await canApplyNetworkSandbox())) {
    t.skip("nested macOS sandbox is unavailable in the current test sandbox");
    return;
  }
  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "gitright-'quoted\npath-proof-"),
  );
  const result = await runProof(
    ["--git", "/usr/bin/git", "--fixture-root", fixtureRoot],
    { offline: true },
  );

  assert.equal(result.verdict, "PASS");
  assert.equal(result.requiredGitVersion, "2.30.0");
  assert.match(result.detectedGitVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(result.networkAccess, "denied");
  assert.equal(result.repositoryUnchanged, true);
  assert.equal(result.locale, "C");
  assert.equal(result.encoding, "bytes with explicit UTF-8 decoding");
  const canonicalFixtureRoot = await realpath(fixtureRoot);
  assert.deepEqual(result.repositoryPaths, [
    join(canonicalFixtureRoot, "repository"),
    join(canonicalFixtureRoot, "repository", ".git"),
    ".git",
  ]);
  assert.equal(result.commandResults.length, 24);
  assert.deepEqual(
    result.commandResults.map(({ operation }) => operation),
    [
      "repository-top-level",
      "repository-git-dir",
      "repository-common-dir",
      "repository-state",
      "partial-clone-marker",
      "worktree-config-marker",
      "head-commit",
      "symbolic-head",
      "available-refs",
      "available-history",
      "history-parents",
      "history-subjects",
      "commit-detail",
      "parent-commit",
      "changed-files",
      "changed-file-stats",
      "changed-file-objects",
      "changed-files-no-renames",
      "changed-file-stats-no-renames",
      "changed-file-objects-no-renames",
      "file-diff",
      "blob-exists",
      "worktree-metadata",
      "object-exists",
    ],
  );
  assert.ok(result.commandResults.every(({ readOnly }) => readOnly));
  assert.ok(result.commandResults.every(({ shell }) => shell === false));
  assert.ok(result.commandResults.every(({ timedOut }) => !timedOut));
  const renameAwareReads = result.commandResults.filter(({ operation }) =>
    ["changed-files", "changed-file-stats", "changed-file-objects"].includes(operation)
  );
  assert.ok(renameAwareReads.every(({ arguments: args }) => args.includes("-M50%")));
  assert.ok(renameAwareReads.every(({ arguments: args }) => !args.includes("-C")));
  const renameFallbackReads = result.commandResults.filter(({ operation }) =>
    operation.endsWith("-no-renames")
  );
  assert.equal(renameFallbackReads.length, 3);
  assert.ok(renameFallbackReads.every(({ arguments: args }) => args.includes("--no-renames")));
  assert.ok(renameFallbackReads.every(({ arguments: args }) => !args.includes("-M50%")));
  assert.ok(renameFallbackReads.every(({ arguments: args }) => !args.includes("-C")));
  assert.equal(
    result.commandResults.find(({ operation }) => operation === "history-parents")
      .shallowFileOverride,
    true,
  );
  assert.ok(
    result.commandResults.find(({ operation }) => operation === "history-parents")
      .stdinBytes > 0,
  );
  assert.ok(
    result.commandResults.every(({ stderrBytes }) => stderrBytes === 0),
  );
  assert.ok(result.refNames.includes("refs/remotes/origin/main"));
  assert.ok(result.refNames.includes("refs/tags/v1"));
  assert.ok(
    result.worktreePaths.some((path) => path.includes("linked\nworktree")),
  );
  assert.equal(result.rename.oldPath, "odd\nname.txt");
  assert.equal(result.rename.newPath, "renamed\tname.txt");
  assert.ok(result.changedPaths.includes("invalid-\\xFF.txt"));
});

test("a timed-out Git read returns bounded Copy diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitright-timeout-git-"));
  const repository = join(root, "repository");
  const fakeGit = join(root, "git");
  await mkdir(repository);
  await writeFile(
    fakeGit,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'git version 2.50.1'
  exit 0
fi
sleep 3
`,
  );
  await chmod(fakeGit, 0o755);

  const result = await runProof(["--git", fakeGit, "--repository", repository]);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.copyDiagnostics, true);
  assert.equal(result.failure.operation, "repository-top-level");
  assert.equal(result.failure.timedOut, true);
  assert.equal(result.failure.stderrBytes, 0);
  assert.equal(result.repositoryReads, 1);
  assert.deepEqual(await readdir(repository), []);
});

test("unvalidated object IDs are rejected before reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitright-invalid-object-"));
  const repository = join(root, "repository");
  const fakeGit = join(root, "git");
  await mkdir(repository);
  await writeFile(
    fakeGit,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'git version 2.50.1'
  exit 0
fi
case "$*" in
  *"rev-parse --show-toplevel"*) printf '%s\\n' "$PWD" ;;
  *"rev-parse --absolute-git-dir"*) printf '%s\\n' "$PWD/.git" ;;
  *"rev-parse --git-common-dir"*) printf '%s\\n' '.git' ;;
  *"rev-parse --is-bare-repository"*) printf '%s\\n' false false sha1 ;;
  *"config --local --get-regexp"*) exit 1 ;;
  *"rev-parse --verify HEAD"*) printf '%s\\n' 'not-a-complete-sha' ;;
  *) exit 99 ;;
esac
`,
  );
  await chmod(fakeGit, 0o755);

  const result = await runProof(["--git", fakeGit, "--repository", repository]);

  assert.equal(result.verdict, "BLOCKED");
  assert.deepEqual(
    result.commandResults.map(({ operation }) => operation),
    [
      "repository-top-level",
      "repository-git-dir",
      "repository-common-dir",
      "repository-state",
      "partial-clone-marker",
      "head-commit",
    ],
  );
  assert.equal(result.repositoryReads, 6);
});

test("partial clone is rejected before any object read", async () => {
  const root = await mkdtemp(join(tmpdir(), "gitright-partial-clone-"));
  const repository = join(root, "repository");
  const fakeGit = join(root, "git");
  const calls = join(root, "calls");
  await mkdir(repository);
  await writeFile(
    fakeGit,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'git version 2.50.1'
  exit 0
fi
case "$*" in
  *"rev-parse --show-toplevel"*) printf '%s\\n' "$PWD" ;;
  *"rev-parse --absolute-git-dir"*) printf '%s\\n' "$PWD/.git" ;;
  *"rev-parse --git-common-dir"*) printf '%s\\n' '.git' ;;
  *"rev-parse --is-bare-repository"*) printf '%s\\n' false false sha1 ;;
  *"config --local --get-regexp"*) printf '%s\\n' 'remote.origin.promisor true' ;;
  *) exit 99 ;;
esac
`,
  );
  await chmod(fakeGit, 0o755);

  const result = await runProof(["--git", fakeGit, "--repository", repository]);

  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.repositoryUnchanged, true);
  assert.deepEqual(
    result.commandResults.map(({ operation }) => operation),
    [
      "repository-top-level",
      "repository-git-dir",
      "repository-common-dir",
      "repository-state",
      "partial-clone-marker",
    ],
  );
  assert.equal(result.repositoryReads, 5);
  assert.doesNotMatch(
    await readFile(calls, "utf8"),
    /(?:^| )(?:cat-file|rev-list|show|diff|diff-tree)(?: |$)/m,
  );
});

test(
  "minimum supported Git executes the complete allowlist offline",
  { skip: !process.env.GITRIGHT_MINIMUM_GIT },
  async (t) => {
    if (!(await canApplyNetworkSandbox())) {
      t.skip("nested macOS sandbox is unavailable in the current test sandbox");
      return;
    }
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), "gitright-minimum-git-proof-"),
    );
    const result = await runProof(
      [
        "--git",
        process.env.GITRIGHT_MINIMUM_GIT,
        "--fixture-root",
        fixtureRoot,
      ],
      { offline: true },
    );

    assert.equal(result.verdict, "PASS");
    assert.equal(result.requiredGitVersion, "2.30.0");
    assert.equal(result.detectedGitVersion, "2.30.0");
    assert.equal(result.networkAccess, "denied");
    assert.equal(result.repositoryUnchanged, true);
    assert.ok(
      result.worktreePaths.some((path) => path.includes("linked\nworktree")),
    );
    assert.ok(result.changedPaths.includes("invalid-\\xFF.txt"));
  },
);
