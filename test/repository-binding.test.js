import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  classifyGitFailure,
  cleanGitEnvironment,
  createRepositoryBinding,
  retryTransientGitRead,
} from "../plugins/gitright/server/repository-binding.ts";

const execFile = promisify(execFileCallback);

const trustedWorkspace = "/tmp/gitright-trusted-workspace";

function toolParams(workspaces) {
  return {
    name: "open_gitright",
    arguments: {},
    _meta: {
      "x-codex-turn-metadata": { workspaces },
    },
  };
}

function result(stdout, status = 0, stderr = "", timedOut = false) {
  return {
    status,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    timedOut,
  };
}

test("inherited XDG Git configuration cannot supply safe.directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitright-xdg-config-"));
  const xdgHome = path.join(root, "xdg");
  await mkdir(path.join(xdgHome, "git"), { recursive: true });
  await writeFile(path.join(xdgHome, "git/config"), "[safe]\n\tdirectory = *\n");
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdgHome;
  try {
    const environment = cleanGitEnvironment();
    assert.equal(
      environment.XDG_CONFIG_HOME,
      path.join(String(environment.HOME), ".config"),
    );
    assert.equal(environment.GIT_CONFIG_GLOBAL, "/dev/null");
    await assert.rejects(
      execFile("/usr/bin/git", ["config", "--global", "--get-all", "safe.directory"], {
        env: environment,
        encoding: "utf8",
      }),
      (error) => error.code === 1 && error.stdout === "",
    );
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("classifies missing, corrupt, and transient-lock Git failures without exposing stderr", () => {
  assert.equal(
    classifyGitFailure(result("", 128, "fatal: bad object 0123456789012345678901234567890123456789\n")),
    "missing-object",
  );
  assert.equal(
    classifyGitFailure(result("", 128, "fatal: git cat-file 0123456789012345678901234567890123456789: bad file\n")),
    "missing-object",
  );
  assert.equal(
    classifyGitFailure(result("", 128, "fatal: unable to read 0123456789012345678901234567890123456789\n")),
    "missing-object",
  );
  assert.equal(
    classifyGitFailure(result("", 128, "error: object file .git/objects/aa/bb is corrupt\n")),
    "corrupt-object",
  );
  assert.equal(
    classifyGitFailure(result("", 128, "fatal: Unable to create '.git/packed-refs.lock': File exists.\n")),
    "transient-lock",
  );
  assert.equal(classifyGitFailure(result("fatal text in stdout only", 128)), null);
});

test("retries transient Git locks for no more than five seconds", async () => {
  let monotonicTime = 0;
  let attempts = 0;
  const waits = [];
  const locked = result(
    "",
    128,
    "fatal: cannot lock ref 'refs/heads/main': is at one value but expected another\n",
  );

  const exhausted = await retryTransientGitRead(
    async (timeoutMs) => {
      attempts += 1;
      monotonicTime += timeoutMs;
      return locked;
    },
    () => monotonicTime,
    async (milliseconds) => {
      waits.push(milliseconds);
      monotonicTime += milliseconds;
    },
  );

  assert.equal(exhausted, locked);
  assert.equal(monotonicTime, 5_000);
  assert.ok(attempts > 1);
  assert.ok(waits.every((milliseconds) => milliseconds > 0 && milliseconds <= 1_000));

  monotonicTime = 0;
  attempts = 0;
  const recovered = await retryTransientGitRead(
    async (timeoutMs) => {
      attempts += 1;
      monotonicTime += Math.min(timeoutMs, 10);
      return attempts < 3 ? locked : result("ok\n");
    },
    () => monotonicTime,
    async (milliseconds) => {
      monotonicTime += milliseconds;
    },
  );
  assert.equal(recovered.status, 0);
  assert.equal(attempts, 3);
  assert.ok(monotonicTime < 5_000);
});

function fakeGit(versionResult) {
  const repositoryCalls = [];
  return {
    repositoryCalls,
    executor: {
      version: async () => versionResult,
      repository: async (cwd, operation) => {
        repositoryCalls.push({ cwd, operation });
        throw new Error("repository command must not run for a blocked prerequisite");
      },
    },
  };
}

test("missing, unrecognized, and old Git block before any repository read", async () => {
  const cases = [
    { version: result("", null), detected: "unavailable" },
    { version: result("secret-not-a-version\n"), detected: "unrecognized" },
    { version: result("git version 2.29.9\n"), detected: "2.29.9" },
  ];

  for (const item of cases) {
    const git = fakeGit(item.version);
    const times = [100, 112.3456];
    const binding = createRepositoryBinding(
      git.executor,
      undefined,
      () => times.shift() ?? 112.3456,
    );

    assert.deepEqual(await binding.open(toolParams({ [trustedWorkspace]: {} })), {
      status: "blocked",
      message: "Git 2.30.0 or newer is required",
      requiredGitVersion: "2.30.0",
      detectedGitVersion: item.detected,
      durationMs: 12.346,
      errorCode: "git-version-blocked",
    });
    assert.deepEqual(git.repositoryCalls, []);
  }
});

test("one supported trusted context is discovered once and then pinned", async () => {
  const repositoryRoot = "/tmp/example-repository";
  const trustedContext = path.join(repositoryRoot, "nested");
  const gitDirectory = path.join(repositoryRoot, ".git/worktrees/example");
  const commonDirectory = path.join(repositoryRoot, ".git");
  const repositoryCalls = [];
  const outputs = {
    boundary: "false\nfalse\nsha1\n",
    "partial-clone": "",
    "top-level": `${repositoryRoot}\n`,
    "git-directory": `${gitDirectory}\n`,
    "common-directory": `${commonDirectory}\n`,
    "symbolic-head": "refs/heads/feature/pinned-branch\n",
  };
  const binding = createRepositoryBinding(
    {
      version: async () => result("git version 2.30.0\n"),
      repository: async (cwd, operation) => {
        repositoryCalls.push({ cwd, operation });
        return operation === "partial-clone"
          ? result(outputs[operation], 1)
          : result(outputs[operation]);
      },
    },
    async (value) => value,
  );

  const expected = {
    status: "ready",
    message: "Repository ready",
    repositoryName: "example-repository",
    repositoryPath: repositoryRoot,
    repositoryKind: "linked-worktree",
    branch: "feature/pinned-branch",
    worktreeName: "example-repository",
    gitVersion: "2.30.0",
  };
  assert.deepEqual(await binding.open(toolParams({ [trustedContext]: {} })), expected);
  assert.deepEqual(
    await binding.open(toolParams({ "/tmp/a-different-repository": {} })),
    expected,
  );
  assert.equal(binding.pinnedRepository(), repositoryRoot);
  assert.equal(repositoryCalls.length, 6);
  assert.ok(repositoryCalls.every((call) => call.cwd === trustedContext));
});

test("a detached HEAD stays ready with a null branch", async () => {
  const repositoryRoot = "/tmp/example-repository";
  const outputs = {
    boundary: "false\nfalse\nsha1\n",
    "partial-clone": "",
    "top-level": `${repositoryRoot}\n`,
    "git-directory": `${repositoryRoot}/.git\n`,
    "common-directory": `${repositoryRoot}/.git\n`,
  };
  const binding = createRepositoryBinding(
    {
      version: async () => result("git version 2.30.0\n"),
      repository: async (_cwd, operation) =>
        operation === "partial-clone" || operation === "symbolic-head"
          ? result("", 1)
          : result(outputs[operation]),
    },
    async (value) => value,
  );

  assert.deepEqual(await binding.open(toolParams({ [repositoryRoot]: {} })), {
    status: "ready",
    message: "Repository ready",
    repositoryName: "example-repository",
    repositoryPath: repositoryRoot,
    repositoryKind: "repository",
    branch: null,
    worktreeName: null,
    gitVersion: "2.30.0",
  });
});

test("an unreadable or malformed symbolic HEAD fails closed", async () => {
  const repositoryRoot = "/tmp/example-repository";
  const outputs = {
    boundary: "false\nfalse\nsha1\n",
    "partial-clone": "",
    "top-level": `${repositoryRoot}\n`,
    "git-directory": `${repositoryRoot}/.git\n`,
    "common-directory": `${repositoryRoot}/.git\n`,
  };

  for (const symbolicHead of [
    result("", 128, "fatal: unable to read HEAD\n"),
    result("refs/remotes/origin/main\n"),
    result("refs/heads/\n"),
    result("refs/heads/unterminated"),
  ]) {
    const binding = createRepositoryBinding(
      {
        version: async () => result("git version 2.30.0\n"),
        repository: async (_cwd, operation) =>
          operation === "partial-clone"
            ? result("", 1)
            : operation === "symbolic-head"
              ? symbolicHead
              : result(outputs[operation]),
      },
      async (value) => value,
    );

    assert.deepEqual(await binding.open(toolParams({ [repositoryRoot]: {} })), {
      status: "unavailable",
      message: "Current task repository is unavailable",
    });
    assert.equal(binding.pinnedRepository(), null);
  }
});

test("ambiguous context and bare repositories fail closed", async () => {
  const noReadCalls = [];
  const ambiguous = createRepositoryBinding({
    version: async () => result("git version 2.50.1\n"),
    repository: async (...args) => {
      noReadCalls.push(args);
      throw new Error("ambiguous context must not read a repository");
    },
  });
  assert.deepEqual(
    await ambiguous.open(toolParams({ [trustedWorkspace]: {}, relative: {} })),
    {
      status: "unavailable",
      message: "Current task repository is unavailable",
    },
  );
  assert.deepEqual(noReadCalls, []);

  const bareCalls = [];
  const bare = createRepositoryBinding({
    version: async () => result("git version 2.50.1\n"),
    repository: async (cwd, operation) => {
      bareCalls.push({ cwd, operation });
      return result("true\nfalse\nsha1\n");
    },
  });
  assert.deepEqual(await bare.open(toolParams({ [trustedWorkspace]: {} })), {
    status: "unsupported",
    message: "Bare repositories are not supported in this version",
    gitVersion: "2.50.1",
  });
  assert.equal(bareCalls.length, 1);
});

test("SHA-256 repositories stop at the binding boundary with an explicit unsupported state", async () => {
  const calls = [];
  const binding = createRepositoryBinding({
    version: async () => result("git version 2.50.1\n"),
    repository: async (cwd, operation) => {
      calls.push({ cwd, operation });
      return result("false\nfalse\nsha256\n");
    },
  });

  assert.deepEqual(await binding.open(toolParams({ [trustedWorkspace]: {} })), {
    status: "unsupported",
    message: "SHA-256 repositories are not supported in this version",
    gitVersion: "2.50.1",
  });
  assert.deepEqual(calls, [{ cwd: trustedWorkspace, operation: "boundary" }]);
  assert.equal(binding.pinnedRepository(), null);
});

test("partial clones and dubious ownership surface bounded unsupported states", async () => {
  const partial = createRepositoryBinding({
    version: async () => result("git version 2.50.1\n"),
    repository: async (_cwd, operation) => {
      if (operation === "boundary") return result("false\nfalse\nsha1\n");
      if (operation === "partial-clone") {
        return result("remote.origin.promisor true\n");
      }
      throw new Error("partial clone must stop before repository discovery");
    },
  });
  assert.deepEqual(await partial.open(toolParams({ [trustedWorkspace]: {} })), {
    status: "unsupported",
    message: "Partial clones are not supported in this version",
    gitVersion: "2.50.1",
  });
  assert.equal(partial.pinnedRepository(), null);

  const sensitivePath = "/private/secret/repository";
  const ownership = createRepositoryBinding({
    version: async () => result("git version 2.50.1\n"),
    repository: async () =>
      result(
        "",
        128,
        `fatal: detected dubious ownership in repository at '${sensitivePath}'\nTo add an exception, call git config --global --add safe.directory ...\n`,
      ),
  });
  const ownershipState = await ownership.open(toolParams({ [trustedWorkspace]: {} }));
  assert.deepEqual(ownershipState, {
    status: "ownership-refused",
    message: "Git refused this repository because its ownership is not trusted",
    guidance: "Resolve the repository trust outside GitRight, then open a new task",
    gitVersion: "2.50.1",
  });
  assert.doesNotMatch(JSON.stringify(ownershipState), new RegExp(sensitivePath));
  assert.equal(ownership.pinnedRepository(), null);
});

test("a local core.worktree override cannot redirect the pinned repository", async () => {
  const calls = [];
  const binding = createRepositoryBinding({
    version: async () => result("git version 2.50.1\n"),
    repository: async (cwd, operation) => {
      calls.push({ cwd, operation });
      if (operation === "boundary") return result("false\nfalse\nsha1\n");
      if (operation === "partial-clone") {
        return result("core.worktree /private/escaped-worktree\n");
      }
      throw new Error("unsafe worktree config must stop before repository discovery");
    },
  });

  assert.deepEqual(await binding.open(toolParams({ [trustedWorkspace]: {} })), {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
  assert.deepEqual(calls.map(({ operation }) => operation), ["boundary", "partial-clone"]);
  assert.equal(binding.pinnedRepository(), null);
});

test("a repository-local include cannot inject effective boundary config", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-local-include-"));
  const repository = path.join(fixture, "repository");
  const includedConfig = path.join(fixture, "included.gitconfig");
  t.after(() => rm(fixture, { recursive: true, force: true }));

  await execFile("/usr/bin/git", ["init", "-q", repository]);
  await writeFile(
    includedConfig,
    `[remote "origin"]\n\tpromisor = true\n[core]\n\tworktree = ${path.join(fixture, "escaped")}\n`,
  );
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "--local",
    "include.path",
    includedConfig,
  ]);

  const binding = createRepositoryBinding();
  assert.deepEqual(await binding.open(toolParams({ [repository]: {} })), {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
  assert.equal(binding.pinnedRepository(), null);
});

test("a repository-local conditional include cannot inject boundary config", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-local-include-if-"));
  const repository = path.join(fixture, "repository");
  const includedConfig = path.join(fixture, "included.gitconfig");
  t.after(() => rm(fixture, { recursive: true, force: true }));

  await execFile("/usr/bin/git", ["init", "-q", repository]);
  await writeFile(includedConfig, `[remote "origin"]\n\tpromisor = true\n`);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "--local",
    `includeIf.gitdir:${repository}/.path`,
    includedConfig,
  ]);

  const binding = createRepositoryBinding();
  assert.deepEqual(await binding.open(toolParams({ [repository]: {} })), {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
  assert.equal(binding.pinnedRepository(), null);
});

test("repository worktree config cannot inject effective boundary config", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-worktree-config-"));
  const repository = path.join(fixture, "repository");
  const includedConfig = path.join(fixture, "included.gitconfig");
  t.after(() => rm(fixture, { recursive: true, force: true }));

  await execFile("/usr/bin/git", ["init", "-q", repository]);
  await writeFile(includedConfig, `[remote "origin"]\n\tpromisor = true\n`);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "--local",
    "extensions.worktreeConfig",
    "true",
  ]);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "--worktree",
    "include.path",
    includedConfig,
  ]);

  const binding = createRepositoryBinding();
  assert.deepEqual(await binding.open(toolParams({ [repository]: {} })), {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
  assert.equal(binding.pinnedRepository(), null);
});

test("a reported top level that does not contain the trusted context fails closed", async () => {
  const escapedRoot = "/private/escaped-worktree";
  const outputs = {
    boundary: "false\nfalse\nsha1\n",
    "partial-clone": "",
    "top-level": `${escapedRoot}\n`,
    "git-directory": `${escapedRoot}/.git\n`,
    "common-directory": `${escapedRoot}/.git\n`,
    "symbolic-head": "refs/heads/main\n",
  };
  const binding = createRepositoryBinding(
    {
      version: async () => result("git version 2.50.1\n"),
      repository: async (_cwd, operation) =>
        operation === "partial-clone"
          ? result(outputs[operation], 1)
          : result(outputs[operation]),
    },
    async (value) => value,
  );

  assert.deepEqual(await binding.open(toolParams({ [trustedWorkspace]: {} })), {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
  assert.equal(binding.pinnedRepository(), null);
});
