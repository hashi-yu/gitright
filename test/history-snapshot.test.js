import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createHistoryService } from "../plugins/gitright/server/history-service.ts";

const execFile = promisify(execFileCallback);

const merge = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const parentB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const parentC = "cccccccccccccccccccccccccccccccccccccccc";
const root = "dddddddddddddddddddddddddddddddddddddddd";
const continuation = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

function result(stdout, status = 0) {
  return {
    status,
    signal: null,
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
    timedOut: false,
  };
}

test("loads one deterministic Text topology snapshot through the history service", async () => {
  const calls = [];
  const outputs = {
    head: `${merge}\n`,
    "symbolic-head": "refs/heads/main\n",
    refs: [
      `refs/heads/feature\0${merge}\0commit\0\0\0`,
      `refs/heads/main\0${merge}\0commit\0\0\0`,
      `refs/remotes/origin/main\0${merge}\0commit\0\0\0`,
      `refs/tags/v1.0.0\0${merge}\0commit\0\0\0`,
    ].join("\n") + "\n",
    "worktree-branches": [
      "refs/heads/feature\0\0",
      "refs/heads/main\0/tmp/linked-worktree\0",
    ].join("\n") + "\n",
    "history-page": [
      `1700000300 ${merge} ${parentC} ${parentB} ${continuation}`,
      `1700000200 ${parentC} ${root}`,
      `1700000200 ${parentB} ${root}`,
      `1700000100 ${root}`,
    ].join("\n") + "\n",
    "history-parents": [
      `${merge} ${parentC} ${parentB} ${continuation}`,
      `${parentC} ${root}`,
      `${parentB} ${root}`,
      root,
    ].join("\n") + "\n",
    "history-subjects": [
      `${merge}\0Merge three lines\0`,
      `${parentB}\0Build B\0`,
      `${parentC}\0Build C\0`,
      `${root}\0Root commit\0`,
    ].join("\n") + "\n",
  };
  const service = createHistoryService(
    {
      history: async (cwd, operation, objectIds = []) => {
        calls.push({ cwd, operation, objectIds });
        return result(outputs[operation]);
      },
    },
    () => 1_700_000_600,
  );

  const snapshot = await service.load("/tmp/pinned-repository");

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 4);
  assert.equal(snapshot.pageSize, 500);
  assert.equal(snapshot.snapshotTime, 1_700_000_600);
  assert.equal(snapshot.headSha, merge);
  assert.deepEqual(
    snapshot.commits.map((commit) => commit.sha),
    [merge, parentB, parentC, root],
    "unrelated commits with equal committer times use ascending full SHA",
  );

  const mergeRow = snapshot.commits[0];
  assert.equal(mergeRow.subject, "Merge three lines");
  assert.equal(mergeRow.shortSha, merge.slice(0, 7));
  assert.equal(mergeRow.relativeCommitterTime, "5 minutes ago");
  assert.equal(mergeRow.topologyRole, "octopus merge");
  assert.equal(mergeRow.shallowBoundary, false);
  assert.deepEqual(mergeRow.parents, [
    { sha: parentC, loaded: true },
    { sha: parentB, loaded: true },
    { sha: continuation, loaded: false },
  ]);
  assert.deepEqual(
    mergeRow.refs.map((ref) => ({ name: ref.name, kind: ref.kind, checkedOut: ref.checkedOut })),
    [
      { name: "HEAD", kind: "head", checkedOut: true },
      { name: "main", kind: "local-branch", checkedOut: true },
      { name: "feature", kind: "local-branch", checkedOut: false },
      { name: "origin/main", kind: "remote-branch", checkedOut: false },
      { name: "v1.0.0", kind: "tag", checkedOut: false },
    ],
  );
  assert.deepEqual(mergeRow.inlineRefs.map((ref) => ref.name), ["HEAD", "main", "feature"]);
  assert.equal(mergeRow.additionalRefCount, 2);

  assert.deepEqual(
    calls.map((call) => call.operation),
    [
      "head",
      "symbolic-head",
      "refs",
      "worktree-branches",
      "history-page",
      "history-parents",
      "history-subjects",
      "head",
      "symbolic-head",
      "refs",
      "worktree-branches",
    ],
  );
  assert.ok(calls.every((call) => call.cwd === "/tmp/pinned-repository"));
  assert.deepEqual(calls.find((call) => call.operation === "history-page").objectIds, [merge]);
  assert.deepEqual(calls.find((call) => call.operation === "history-parents").objectIds, [merge, parentC, parentB, root]);
  assert.deepEqual(calls.find((call) => call.operation === "history-subjects").objectIds, [merge, parentB, parentC, root]);
});

test("detached HEAD is explicit and no local branch is marked as its checkout", async () => {
  const outputs = {
    head: `${merge}\n`,
    "symbolic-head": "",
    refs: `refs/heads/main\0${merge}\0commit\0\0\0\n`,
    "worktree-branches": "refs/heads/main\0\0\n",
    "history-page": `1700000300 ${merge}\n`,
    "history-parents": `${merge}\n`,
    "history-subjects": `${merge}\0Detached commit\0\n`,
  };
  const service = createHistoryService({
    history: async (_cwd, operation) =>
      operation === "symbolic-head" ? result("", 1) : result(outputs[operation]),
  });

  const snapshot = await service.load("/tmp/detached-repository");

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(
    snapshot.commits[0].refs.map(({ name, checkedOut }) => ({ name, checkedOut })),
    [
      { name: "HEAD (detached)", checkedOut: true },
      { name: "main", checkedOut: false },
    ],
  );
});

test("linked worktrees share refs and mark only branches checked out elsewhere", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-linked-refs-"));
  const mainRepository = path.join(fixture, "main");
  const linkedRepository = path.join(fixture, "linked");
  await execFile("/usr/bin/git", ["init", "-q", mainRepository]);
  await git(mainRepository, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(mainRepository, [
    "-c",
    "user.name=GitRight Test",
    "-c",
    "user.email=gitright-test@example.invalid",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "Shared worktree tip",
  ]);
  await git(mainRepository, [
    "worktree",
    "add",
    "-q",
    "-b",
    "linked-test",
    linkedRepository,
  ]);

  const before = await repositoryDigest(linkedRepository);
  const snapshot = await createHistoryService().load(linkedRepository);
  const after = await repositoryDigest(linkedRepository);

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(
    snapshot.commits[0].refs
      .filter((ref) => ref.kind === "local-branch")
      .map(({ name, checkedOut }) => ({ name, checkedOut })),
    [
      { name: "main", checkedOut: true },
      { name: "linked-test", checkedOut: false },
    ],
  );
  assert.equal(after, before);
});

test("an unborn repository returns No commits data without inspecting the working tree", async () => {
  const calls = [];
  const service = createHistoryService({
    history: async (_cwd, operation) => {
      calls.push(operation);
      if (operation === "head") return result("", 128);
      if (operation === "symbolic-head") return result("refs/heads/main\n");
      if (operation === "refs" || operation === "worktree-branches") return result("");
      throw new Error(`unborn repository must not run ${operation}`);
    },
  });

  const snapshot = await service.load("/tmp/unborn-repository");

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 0);
  assert.deepEqual(snapshot.commits, []);
  assert.deepEqual(calls, [
    "head", "symbolic-head", "refs", "worktree-branches",
    "head", "symbolic-head", "refs", "worktree-branches",
  ]);
});

test("caps the initial page at 500 and keeps the next direct parent as a continuation", async () => {
  const shas = Array.from({ length: 501 }, (_, index) => (index + 1).toString(16).padStart(40, "0"));
  const loaded = shas.slice(0, 500);
  const outputs = {
    head: `${loaded[0]}\n`,
    "symbolic-head": "refs/heads/main\n",
    refs: `refs/heads/main\0${loaded[0]}\0commit\0\0\0\n`,
    "worktree-branches": "refs/heads/main\0/tmp/worktree\0\n",
    "history-page": loaded
      .map((sha, index) => `${1_700_001_000 - index} ${sha} ${shas[index + 1]}`)
      .join("\n") + "\n",
    "history-parents": loaded.map((sha, index) => `${sha} ${shas[index + 1]}`).join("\n") + "\n",
    "history-subjects": loaded.map((sha, index) => `${sha}\0Commit ${index}\0`).join("\n") + "\n",
  };
  const service = createHistoryService(
    {
      history: async (_cwd, operation) => result(outputs[operation]),
    },
    () => 1_700_002_000,
  );

  const started = performance.now();
  const snapshot = await service.load("/tmp/pinned-repository");
  const duration = performance.now() - started;

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 500);
  assert.equal(snapshot.commits.length, 500);
  assert.equal(snapshot.hasContinuation, true);
  assert.ok(duration < 300, `500-commit parse and topology layout took ${duration.toFixed(3)} ms`);
  assert.deepEqual(snapshot.commits.at(-1).parents, [{ sha: shas[500], loaded: false }]);
  for (let index = 0; index < 499; index += 1) {
    assert.deepEqual(snapshot.commits[index].parents, [{ sha: snapshot.commits[index + 1].sha, loaded: true }]);
  }
});

async function git(repository, args, environment = {}) {
  const { stdout } = await execFile("/usr/bin/git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  return stdout.trim();
}

async function gitWithInput(repository, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/git", ["-C", repository, ...args], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(stderr).toString("utf8")));
    });
    child.stdin.end(input);
  });
}

async function repositoryDigest(root) {
  const hash = createHash("sha256");

  async function visit(relative) {
    const absolute = path.join(root, relative);
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const child = path.join(relative, entry.name);
      const stats = await lstat(path.join(root, child));
      hash.update(`${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}\0${stats.mode}\0${child}\0`);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isSymbolicLink()) hash.update(await readlink(path.join(root, child)));
      else hash.update(await readFile(path.join(root, child)));
      hash.update("\0");
    }
  }

  await visit("");
  return hash.digest("hex");
}

function priorityKahn(commits) {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const remainingChildren = new Map(commits.map((commit) => [commit.sha, 0]));
  for (const commit of commits) {
    for (const parent of commit.parents) {
      if (bySha.has(parent)) {
        remainingChildren.set(parent, remainingChildren.get(parent) + 1);
      }
    }
  }

  const ready = commits.filter((commit) => remainingChildren.get(commit.sha) === 0);
  const ordered = [];
  while (ready.length > 0) {
    ready.sort(
      (left, right) =>
        right.committerTime - left.committerTime ||
        (left.sha < right.sha ? -1 : left.sha > right.sha ? 1 : 0),
    );
    const commit = ready.shift();
    ordered.push(commit);
    for (const parent of commit.parents) {
      if (!bySha.has(parent)) continue;
      const remaining = remainingChildren.get(parent) - 1;
      remainingChildren.set(parent, remaining);
      if (remaining === 0) ready.push(bySha.get(parent));
    }
  }
  return ordered;
}

test("system Git loads linear, branch, merge, multiple-root, and octopus history without mutation", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-history-fixture-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  const tree = await git(repository, ["write-tree"]);
  const identity = {
    GIT_AUTHOR_NAME: "GitRight Test",
    GIT_AUTHOR_EMAIL: "gitright-test@example.invalid",
    GIT_COMMITTER_NAME: "GitRight Test",
    GIT_COMMITTER_EMAIL: "gitright-test@example.invalid",
  };
  async function commit(subject, time, parents = []) {
    return await git(
      repository,
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", subject],
      {
        ...identity,
        GIT_AUTHOR_DATE: `${time} +0000`,
        GIT_COMMITTER_DATE: `${time} +0000`,
      },
    );
  }

  const rootOne = await commit("Root one", 1_700_000_100);
  const linear = await commit("Linear child", 1_700_000_200, [rootOne]);
  const branch = await commit("Branch child", 1_700_000_300, [rootOne]);
  const merged = await commit("Merge branches", 1_700_000_400, [linear, branch]);
  const rootTwo = await commit("Root two", 1_700_000_500);
  const rootThree = await commit("Root three", 1_700_000_500);
  const octopus = await commit("Octopus merge", 1_700_000_700, [merged, rootTwo, rootThree]);

  await git(repository, ["update-ref", "refs/heads/main", octopus]);
  await git(repository, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(repository, ["update-ref", "refs/heads/feature", branch]);
  await git(repository, ["update-ref", "refs/remotes/origin/main", octopus]);
  await git(repository, ["tag", "-a", "v1.0.0", "-m", "Release v1", merged], {
    ...identity,
    GIT_COMMITTER_DATE: "1700000800 +0000",
  });

  const before = await repositoryDigest(repository);
  const snapshot = await createHistoryService(undefined, () => 1_700_001_000).load(repository);
  const after = await repositoryDigest(repository);

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 7);
  assert.equal(snapshot.hasContinuation, false);
  assert.equal(after, before, "history reads must not change any repository byte");

  const indexBySha = new Map(snapshot.commits.map((commit, index) => [commit.sha, index]));
  for (const child of snapshot.commits) {
    for (const parent of child.parents) {
      if (parent.loaded) {
        assert.ok(indexBySha.get(child.sha) < indexBySha.get(parent.sha), `${child.sha} precedes ${parent.sha}`);
      }
    }
  }
  assert.equal(snapshot.commits.filter((commit) => commit.topologyRole === "root").length, 3);
  assert.equal(snapshot.commits.filter((commit) => commit.topologyRole === "merge").length, 1);
  assert.equal(snapshot.commits.filter((commit) => commit.topologyRole === "octopus merge").length, 1);
  assert.deepEqual(snapshot.commits[0].parents.map((parent) => parent.sha), [merged, rootTwo, rootThree]);
  assert.ok(snapshot.commits.find((commit) => commit.sha === merged).refs.some((ref) => ref.name === "v1.0.0"));
  assert.deepEqual(snapshot.commits.find((commit) => commit.sha === octopus).inlineRefs.map((ref) => ref.name), [
    "HEAD",
    "main",
    "origin/main",
  ]);
});

test("the 500-commit page selects globally newer commits across two long unrelated roots", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-date-order-fixture-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  let stream = "";
  let nextMark = 1;
  for (const branchName of ["a", "b"]) {
    let parentMark = null;
    for (let index = 0; index < 300; index += 1) {
      const mark = nextMark++;
      const subject = `${branchName.toUpperCase()} ${index}`;
      const time = 1_700_000_000 + index * 2 + (branchName === "b" ? 1 : 0);
      stream += `commit refs/heads/${branchName}\n`;
      stream += `mark :${mark}\n`;
      stream += `author GitRight Test <gitright-test@example.invalid> ${time} +0000\n`;
      stream += `committer GitRight Test <gitright-test@example.invalid> ${time} +0000\n`;
      stream += `data ${Buffer.byteLength(subject)}\n${subject}\n`;
      if (parentMark !== null) stream += `from :${parentMark}\n`;
      stream += "\n";
      parentMark = mark;
    }
  }
  stream += "done\n";
  await gitWithInput(repository, ["fast-import", "--quiet"], stream);
  await git(repository, ["symbolic-ref", "HEAD", "refs/heads/a"]);

  const before = await repositoryDigest(repository);
  const snapshot = await createHistoryService().load(repository);
  const after = await repositoryDigest(repository);

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 500);
  assert.equal(snapshot.commits.filter((commit) => commit.subject.startsWith("A ")).length, 250);
  assert.equal(snapshot.commits.filter((commit) => commit.subject.startsWith("B ")).length, 250);
  assert.deepEqual(snapshot.commits.slice(0, 4).map((commit) => commit.subject), [
    "B 299",
    "A 299",
    "B 298",
    "A 298",
  ]);
  assert.ok(snapshot.commits.some((commit) => commit.subject === "A 50"));
  assert.ok(snapshot.commits.some((commit) => commit.subject === "B 50"));
  assert.ok(!snapshot.commits.some((commit) => commit.subject === "A 49"));
  assert.ok(!snapshot.commits.some((commit) => commit.subject === "B 49"));
  assert.equal(after, before);
});

test("the 500-commit page applies the full-SHA tie-break before truncating equal-time histories", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-sha-order-fixture-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  let stream = "";
  let nextMark = 1;
  for (const branchName of ["a", "b"]) {
    let parentMark = null;
    for (let index = 0; index < 300; index += 1) {
      const mark = nextMark++;
      const subject = `${branchName.toUpperCase()} ${index}`;
      stream += `commit refs/heads/${branchName}\n`;
      stream += `mark :${mark}\n`;
      stream += "author GitRight Test <gitright-test@example.invalid> 1700000000 +0000\n";
      stream += "committer GitRight Test <gitright-test@example.invalid> 1700000000 +0000\n";
      stream += `data ${Buffer.byteLength(subject)}\n${subject}\n`;
      if (parentMark !== null) stream += `from :${parentMark}\n`;
      stream += "\n";
      parentMark = mark;
    }
  }
  stream += "done\n";
  await gitWithInput(repository, ["fast-import", "--quiet"], stream);
  await git(repository, ["symbolic-ref", "HEAD", "refs/heads/a"]);

  const rawHistory = await git(repository, [
    "rev-list",
    "--parents",
    "--timestamp",
    "refs/heads/a",
    "refs/heads/b",
  ]);
  const allCommits = rawHistory.split("\n").map((line) => {
    const [rawTime, sha, ...parents] = line.split(" ");
    return { sha, committerTime: Number(rawTime), parents };
  });
  const expected = priorityKahn(allCommits).slice(0, 500).map((commit) => commit.sha);

  const snapshot = await createHistoryService().load(repository);

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 500);
  assert.deepEqual(snapshot.commits.map((commit) => commit.sha), expected);
});

test("a reachable history larger than 2 MiB still returns its first 500 rows", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-large-history-fixture-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  let stream = "";
  let parentMark = null;
  for (let index = 0; index < 24_000; index += 1) {
    const mark = index + 1;
    const subject = `Commit ${index}`;
    stream += "commit refs/heads/main\n";
    stream += `mark :${mark}\n`;
    stream += `author GitRight Test <gitright-test@example.invalid> ${1_700_000_000 + index} +0000\n`;
    stream += `committer GitRight Test <gitright-test@example.invalid> ${1_700_000_000 + index} +0000\n`;
    stream += `data ${Buffer.byteLength(subject)}\n${subject}\n`;
    if (parentMark !== null) stream += `from :${parentMark}\n`;
    stream += "\n";
    parentMark = mark;
  }
  stream += "done\n";
  await gitWithInput(repository, ["fast-import", "--quiet"], stream);
  await git(repository, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  const snapshot = await createHistoryService(
    undefined,
    undefined,
    () => 0,
  ).load(repository);

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 500);
  assert.equal(snapshot.commits[0].subject, "Commit 23999");
  assert.equal(snapshot.commits.at(-1).subject, "Commit 23500");
  assert.equal(snapshot.hasContinuation, true);
});

test("a 6,001-wide DAG selects 500 rows within the processing budget", async () => {
  const shas = Array.from({ length: 6_001 }, (_, index) =>
    (index + 1).toString(16).padStart(40, "0"),
  );
  const outputs = {
    head: `${shas[0]}\n`,
    "symbolic-head": "refs/heads/main\n",
    refs: `refs/heads/main\0${shas[0]}\0commit\0\0\0\n`,
    "worktree-branches": "refs/heads/main\0/tmp/worktree\0\n",
    "history-page": shas.map((sha) => `1700000000 ${sha}`).join("\n") + "\n",
  };
  const service = createHistoryService(
    {
      history: async (_cwd, operation, objectIds = []) => {
        if (operation === "history-parents") {
          return result(objectIds.join("\n") + "\n");
        }
        if (operation === "history-subjects") {
          return result(objectIds.map((sha) => `${sha}\0Subject ${sha}\0`).join("\n") + "\n");
        }
        return result(outputs[operation]);
      },
    },
    () => 1_700_000_100,
  );

  const started = performance.now();
  const snapshot = await service.load("/tmp/pinned-repository");
  const duration = performance.now() - started;

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.commits.map((commit) => commit.sha), shas.slice(0, 500));
  assert.ok(duration < 300, `wide-DAG page selection took ${duration.toFixed(3)} ms`);
});

test("an explicitly bounded candidate graph surfaces a stable size-limit error", async () => {
  const shas = Array.from({ length: 100_001 }, (_, index) =>
    (index + 1).toString(16).padStart(40, "0"),
  );
  const service = createHistoryService({
    history: async (_cwd, operation) => {
      if (operation === "head") return result(`${shas[0]}\n`);
      if (operation === "symbolic-head") return result("refs/heads/main\n");
      if (operation === "refs") {
        return result(`refs/heads/main\0${shas[0]}\0commit\0\0\0\n`);
      }
      if (operation === "worktree-branches") {
        return result("refs/heads/main\0/tmp/worktree\0\n");
      }
      if (operation === "history-page") {
        return result(shas.map((sha) => `1700000000 ${sha}`).join("\n") + "\n");
      }
      throw new Error(`unexpected operation: ${operation}`);
    },
  });

  assert.deepEqual(await service.load("/tmp/pinned-repository"), {
    status: "error",
    message: "History exceeds GitRight's supported snapshot limit",
    code: "history-too-large",
  });
});

test("a history metadata output limit surfaces the same stable size-limit error", async () => {
  const service = createHistoryService({
    history: async (_cwd, operation) => {
      if (operation === "head") return result(`${merge}\n`);
      if (operation === "symbolic-head") return result("refs/heads/main\n");
      if (operation === "refs") {
        return result(`refs/heads/main\0${merge}\0commit\0\0\0\n`);
      }
      if (operation === "worktree-branches") {
        return result("refs/heads/main\0/tmp/worktree\0\n");
      }
      if (operation === "history-page") {
        return {
          ...result("", null),
          outputLimited: true,
        };
      }
      throw new Error(`unexpected operation: ${operation}`);
    },
  });

  assert.deepEqual(await service.load("/tmp/pinned-repository"), {
    status: "error",
    message: "History exceeds GitRight's supported snapshot limit",
    code: "history-too-large",
  });
});

test("the in-process deadline surfaces a stable processing-limit error", async () => {
  const shas = Array.from({ length: 4_096 }, (_, index) =>
    (index + 1).toString(16).padStart(40, "0"),
  );
  let monotonicTime = 0;
  const service = createHistoryService(
    {
      history: async (_cwd, operation) => {
        if (operation === "head") return result(`${shas[0]}\n`);
        if (operation === "symbolic-head") return result("refs/heads/main\n");
        if (operation === "refs") {
          return result(`refs/heads/main\0${shas[0]}\0commit\0\0\0\n`);
        }
        if (operation === "worktree-branches") {
          return result("refs/heads/main\0/tmp/worktree\0\n");
        }
        if (operation === "history-page") {
          return result(shas.map((sha) => `1700000000 ${sha}`).join("\n") + "\n");
        }
        throw new Error(`unexpected operation: ${operation}`);
      },
    },
    () => 1_700_000_100,
    () => {
      monotonicTime += 300;
      return monotonicTime;
    },
  );

  assert.deepEqual(await service.load("/tmp/pinned-repository"), {
    status: "error",
    message: "History exceeds GitRight's supported snapshot limit",
    code: "history-processing-limit",
  });
});

test("a shallow boundary keeps its raw direct parent as an unloaded continuation", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-shallow-history-"));
  const source = path.join(fixture, "source");
  const shallow = path.join(fixture, "shallow");
  await execFile("/usr/bin/git", ["init", "-q", source]);
  const commitArguments = [
    "-c",
    "user.name=GitRight Test",
    "-c",
    "user.email=gitright-test@example.invalid",
    "commit",
    "--allow-empty",
    "-q",
  ];
  await git(source, [...commitArguments, "-m", "Shallow parent"]);
  await git(source, [...commitArguments, "-m", "Shallow tip"]);
  const expectedParent = await git(source, ["rev-parse", "HEAD^"]);
  await execFile("/usr/bin/git", [
    "clone",
    "-q",
    "--depth=1",
    pathToFileURL(source).href,
    shallow,
  ]);

  const before = await repositoryDigest(shallow);
  const snapshot = await createHistoryService().load(shallow);
  const after = await repositoryDigest(shallow);

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.loadedCount, 1);
  assert.equal(snapshot.hasContinuation, true);
  assert.equal(snapshot.commits[0].topologyRole, "commit");
  assert.equal(snapshot.commits[0].shallowBoundary, true);
  assert.deepEqual(snapshot.commits[0].parents, [{ sha: expectedParent, loaded: false }]);
  assert.equal(after, before);
});

test("a shallow boundary child still precedes its raw parent when another local ref loads it", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-shallow-loaded-parent-"));
  const source = path.join(fixture, "source");
  const shallow = path.join(fixture, "shallow");
  await execFile("/usr/bin/git", ["init", "-q", source]);
  await git(source, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  const commitArguments = [
    "-c",
    "user.name=GitRight Test",
    "-c",
    "user.email=gitright-test@example.invalid",
    "commit",
    "--allow-empty",
    "-q",
  ];
  await git(source, [...commitArguments, "-m", "Newer-time parent"], {
    GIT_AUTHOR_DATE: "1700000200 +0000",
    GIT_COMMITTER_DATE: "1700000200 +0000",
  });
  const parent = await git(source, ["rev-parse", "HEAD"]);
  await git(source, ["update-ref", "refs/heads/parent", parent]);
  await git(source, [...commitArguments, "-m", "Older-time child"], {
    GIT_AUTHOR_DATE: "1700000100 +0000",
    GIT_COMMITTER_DATE: "1700000100 +0000",
  });
  const child = await git(source, ["rev-parse", "HEAD"]);
  await execFile("/usr/bin/git", [
    "clone",
    "-q",
    "--depth=1",
    "--branch",
    "main",
    pathToFileURL(source).href,
    shallow,
  ]);
  await git(shallow, [
    "fetch",
    "-q",
    "--depth=1",
    "origin",
    "refs/heads/parent:refs/heads/parent",
  ]);

  const before = await repositoryDigest(shallow);
  const snapshot = await createHistoryService().load(shallow);
  const after = await repositoryDigest(shallow);

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.commits.map((commit) => commit.sha), [child, parent]);
  assert.equal(snapshot.commits[0].shallowBoundary, true);
  assert.deepEqual(snapshot.commits[0].parents, [{ sha: parent, loaded: true }]);
  assert.equal(snapshot.hasContinuation, false);
  assert.equal(after, before);
});
