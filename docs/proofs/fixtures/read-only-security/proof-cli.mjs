#!/usr/bin/env node

import { spawn, execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { directoryDigest } from "../repository-digest.mjs";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const launcher = join(repositoryRoot, "plugins/gitright/dist/launch");
const fixtureRootIndex = process.argv.indexOf("--fixture-root");
const fixtureRoot = fixtureRootIndex >= 0 ? process.argv[fixtureRootIndex + 1] : null;

if (!fixtureRoot) {
  process.stderr.write("usage: proof-cli.mjs --fixture-root <path>\n");
  process.exit(64);
}

const repository = join(fixtureRoot, "adversarial repository $(touch escaped)");
const linkedWorktree = join(fixtureRoot, "linked\nworktree");
const includedRepository = join(fixtureRoot, "included-config repository");
const worktreeConfigRepository = join(fixtureRoot, "worktree-config repository");
const outside = join(fixtureRoot, "outside");
const networkAttemptLog = join(outside, "NETWORK_ATTEMPTS");
const gitChildLog = join(outside, "GIT_CHILDREN");
const sentinels = {
  hook: join(outside, "HOOK_INVOKED"),
  filter: join(outside, "FILTER_INVOKED"),
  fsmonitor: join(outside, "FSMONITOR_INVOKED"),
  pager: join(outside, "PAGER_INVOKED"),
  trace: join(outside, "GIT_TRACE_INHERITED"),
  ssh: join(outside, "SSH_COMMAND_INVOKED"),
};

const setupEnvironment = {
  ...process.env,
  HOME: join(fixtureRoot, "setup-home"),
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

async function git(args, expected = [0]) {
  try {
    const result = await execFile("/usr/bin/git", ["-C", repository, ...args], {
      env: setupEnvironment,
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!expected.includes(0)) throw new Error(`unexpected success: git ${args[0]}`);
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const status = Number.isInteger(error.code) ? Number(error.code) : null;
    if (!expected.includes(status)) throw error;
    return {
      status,
      stdout: Buffer.isBuffer(error.stdout) ? error.stdout : Buffer.from(error.stdout ?? ""),
      stderr: Buffer.isBuffer(error.stderr) ? error.stderr : Buffer.from(error.stderr ?? ""),
    };
  }
}

async function commandScript(path, sentinel) {
  await writeFile(
    path,
    `#!/bin/sh\nprintf '%s\\n' invoked > '${sentinel}'\n/usr/bin/curl -fsS --max-time 1 http://127.0.0.1:9/ >/dev/null 2>&1 || true\nexit 91\n`,
  );
  await chmod(path, 0o755);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function findBun() {
  const candidates = [
    ...(process.env.PATH ?? "").split(":"),
  ].filter(Boolean).map((entry) => join(entry, "bun"));
  for (const candidate of candidates) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error("security proof requires Bun in PATH");
}

async function createNetworkGuard() {
  const guardBin = join(outside, "guard-bin");
  const detector = join(outside, "network-detector.mjs");
  const realBun = await findBun();
  await mkdir(guardBin, { recursive: true });
  await writeFile(
    detector,
    `import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";

const marker = process.env.GITRIGHT_NETWORK_ATTEMPT_MARKER;
const gitChildMarker = process.env.GITRIGHT_GIT_CHILD_MARKER;
if (!marker) throw new Error("network detector marker is missing");
if (!gitChildMarker) throw new Error("Git child marker is missing");
function attempted(surface) {
  appendFileSync(marker, surface + "\\n");
  throw new Error("GitRight network attempt blocked: " + surface);
}
for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: (..._arguments) => attempted(name),
  });
}
const require = createRequire(import.meta.url);
const surfaces = {
  "node:http": ["request", "get", "createServer"],
  "node:https": ["request", "get", "createServer"],
  "node:http2": ["connect", "createServer", "createSecureServer"],
  "node:net": ["connect", "createConnection", "createServer"],
  "node:tls": ["connect", "createServer"],
  "node:dgram": ["createSocket"],
  "node:dns": ["lookup", "resolve", "resolve4", "resolve6", "reverse"],
};
for (const [moduleName, names] of Object.entries(surfaces)) {
  const api = require(moduleName);
  for (const name of names) {
    Object.defineProperty(api, name, {
      configurable: true,
      value: (..._arguments) => attempted(moduleName + "." + name),
    });
  }
}
for (const name of ["connect", "listen", "serve", "udpSocket"]) {
  if (typeof Bun?.[name] !== "function") continue;
  Bun[name] = (..._arguments) => attempted("Bun." + name);
}
const childProcess = require("node:child_process");
const originalExecFile = childProcess.execFile;
Object.defineProperty(childProcess, "execFile", {
  configurable: true,
  value: (...arguments_) => {
    const child = originalExecFile(...arguments_);
    if (arguments_[0] === "/usr/bin/git") {
      appendFileSync(gitChildMarker, String(child.pid) + "\\n");
    }
    return child;
  },
});
`,
  );
  const wrapper = join(guardBin, "bun");
  await writeFile(
    wrapper,
    `#!/bin/sh
set -eu
if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
  exec ${shellQuote(realBun)} --version
fi
exec ${shellQuote(realBun)} --preload ${shellQuote(detector)} "$@"
`,
  );
  await chmod(wrapper, 0o755);
  const canaryLog = join(outside, "NETWORK_DETECTOR_CANARY");
  await execFile(wrapper, [
    "-e",
    'try { fetch("http://127.0.0.1:9/"); } catch {}',
  ], {
    env: {
      ...process.env,
      GITRIGHT_NETWORK_ATTEMPT_MARKER: canaryLog,
      GITRIGHT_GIT_CHILD_MARKER: join(outside, "NETWORK_CANARY_CHILDREN"),
    },
  });
  assert((await readFile(canaryLog, "utf8")).trim() === "fetch", "network detector canary failed");
  await unlink(canaryLog);
  return guardBin;
}

async function runFastImport(stream) {
  await new Promise((resolveImport, reject) => {
    const child = spawn("/usr/bin/git", ["-C", repository, "fast-import", "--quiet"], {
      env: setupEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0 && signal === null) resolveImport();
      else reject(new Error(`fast-import failed (${code ?? signal}): ${stderr}`));
    });
    child.stdin.end(stream);
  });
}

async function createPaginationHistory() {
  let stream = "blob\nmark :1\ndata 11\npagination\n";
  for (let index = 0; index < 10_000; index += 1) {
    const mark = index + 2;
    const message = `pagination ${index}`;
    stream += `commit refs/heads/pagination\nmark :${mark}\n`;
    stream += `author GitRight Security <security@example.invalid> ${1_000_000_000 + index} +0000\n`;
    stream += `committer GitRight Security <security@example.invalid> ${1_000_000_000 + index} +0000\n`;
    stream += `data ${Buffer.byteLength(message)}\n${message}\n`;
    if (index > 0) stream += `from :${mark - 1}\n`;
    stream += "M 100644 :1 pagination.txt\n\n";
  }
  stream += "done\n";
  await runFastImport(stream);
}

async function createFixture() {
  await mkdir(repository, { recursive: true });
  await mkdir(includedRepository, { recursive: true });
  await mkdir(worktreeConfigRepository, { recursive: true });
  await mkdir(outside, { recursive: true });
  await mkdir(setupEnvironment.HOME, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "OUTSIDE SECRET MUST NOT BE READ\n");
  await writeFile(join(outside, "attributes"), "* diff=evil filter=evil\n");
  await writeFile(join(outside, "order"), "../../outside/secret.txt\n");
  await writeFile(join(outside, "excludes"), "*\n");

  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository], {
    env: setupEnvironment,
  });
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", includedRepository], {
    env: setupEnvironment,
  });
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", worktreeConfigRepository], {
    env: setupEnvironment,
  });
  const includedConfig = join(outside, "included-boundary.gitconfig");
  await writeFile(
    includedConfig,
    `[remote "origin"]\n\tpromisor = true\n[core]\n\tworktree = ${outside}\n`,
  );
  await execFile(
    "/usr/bin/git",
    ["-C", includedRepository, "config", "--local", "include.path", includedConfig],
    { env: setupEnvironment },
  );
  await execFile(
    "/usr/bin/git",
    ["-C", worktreeConfigRepository, "config", "--local", "extensions.worktreeConfig", "true"],
    { env: setupEnvironment },
  );
  await execFile(
    "/usr/bin/git",
    ["-C", worktreeConfigRepository, "config", "--worktree", "include.path", includedConfig],
    { env: setupEnvironment },
  );
  await git(["config", "user.name", "GitRight Security Fixture"]);
  await git(["config", "user.email", "security@example.invalid"]);
  await mkdir(join(repository, "page"), { recursive: true });
  await Promise.all(Array.from({ length: 501 }, (_, index) =>
    writeFile(
      join(repository, "page", `${String(index).padStart(3, "0")}.txt`),
      `root ${index}\n`,
    )
  ));
  await writeFile(join(repository, ".gitattributes"), "*.txt diff=evil filter=evil\n");
  await writeFile(join(repository, "conflict.txt"), "base\n");
  await writeFile(join(repository, "--upload-pack=$(touch SHOULD_NOT_EXIST).txt"), "literal\n");
  await writeFile(join(repository, ":(attr:evil).txt"), "literal magic\n");
  await symlink("../../outside/secret.txt", join(repository, "tracked-link"));
  await git(["add", "-A", "--"]);
  await git(["commit", "-q", "-m", "root fixture <script>SECRET_IDENTITY</script>"]);
  const rootSha = (await git(["rev-parse", "HEAD"])).stdout.toString("ascii").trim();
  await createPaginationHistory();
  await git(["update-ref", "refs/heads/evil;touch-NOT-RUN", rootSha]);
  await git(["branch", "worktree-branch", rootSha]);
  await git(["worktree", "add", "-q", linkedWorktree, "worktree-branch"]);

  await writeFile(join(repository, "page/000.txt"), "second commit\n");
  await git(["add", "--", "page/000.txt"]);
  await git(["commit", "-q", "-m", "second fixture"]);
  await git(["branch", "side"]);
  await writeFile(join(repository, "conflict.txt"), "main side\n");
  await git(["add", "--", "conflict.txt"]);
  await git(["commit", "-q", "-m", "main conflict side"]);
  await git(["switch", "-q", "side"]);
  await writeFile(join(repository, "conflict.txt"), "branch side\n");
  await git(["add", "--", "conflict.txt"]);
  await git(["commit", "-q", "-m", "branch conflict side"]);
  await git(["switch", "-q", "main"]);
  await git(["merge", "--no-edit", "side"], [1]);

  await writeFile(join(repository, "staged-only.txt"), "staged\n");
  await git(["add", "--", "staged-only.txt"]);
  await writeFile(join(repository, "page/001.txt"), "unstaged\n");
  await writeFile(join(repository, "untracked $(touch NEVER).txt"), "untracked\n");
  await symlink(outside, join(repository, "untracked-directory-link"));

  const commands = join(repository, "malicious-commands");
  const hooks = join(repository, "evil-hooks");
  await mkdir(commands);
  await mkdir(hooks);
  await commandScript(join(hooks, "post-checkout"), sentinels.hook);
  await commandScript(join(commands, "filter"), sentinels.filter);
  await commandScript(join(commands, "fsmonitor"), sentinels.fsmonitor);
  await commandScript(join(commands, "pager"), sentinels.pager);
  await commandScript(join(commands, "ssh"), sentinels.ssh);

  await git(["config", "core.hooksPath", hooks]);
  await git(["config", "diff.external", join(commands, "filter")]);
  await git(["config", "diff.evil.command", join(commands, "filter")]);
  await git(["config", "diff.evil.textconv", join(commands, "filter")]);
  await git(["config", "filter.evil.clean", join(commands, "filter")]);
  await git(["config", "filter.evil.smudge", join(commands, "filter")]);
  await git(["config", "core.attributesFile", join(outside, "attributes")]);
  await git(["config", "core.excludesFile", join(outside, "excludes")]);
  await git(["config", "diff.orderFile", join(outside, "order")]);
  await git(["config", "core.pager", join(commands, "pager")]);
  await git(["config", "core.fsmonitor", join(commands, "fsmonitor")]);

  const globalConfig = join(outside, "global.gitconfig");
  const xdgConfigHome = join(outside, "xdg-config-home");
  await mkdir(join(xdgConfigHome, "git"), { recursive: true });
  await writeFile(
    globalConfig,
    `[safe]\n\tdirectory = *\n[core]\n\tworktree = ${outside}\n[alias]\n\trev-list = !${join(commands, "filter")}\n`,
  );
  await writeFile(
    join(xdgConfigHome, "git/config"),
    `[safe]\n\tdirectory = *\n[core]\n\tbare = true\n[alias]\n\trev-list = !${join(commands, "filter")}\n`,
  );
  const guardBin = await createNetworkGuard();
  return { rootSha, globalConfig, xdgConfigHome, guardBin, commands };
}

async function digestIfPresent(path) {
  try {
    return await directoryDigest(path);
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

async function fileHash(path) {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

async function workingTreeDigest() {
  const hash = createHash("sha256");
  const entries = (await readdir(repository)).filter((entry) => entry !== ".git").sort();
  for (const entry of entries) {
    hash.update(entry);
    hash.update("\0");
    hash.update(await directoryDigest(join(repository, entry)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function lockfiles(root) {
  const found = [];
  async function visit(path, relative) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      if (relative.endsWith(".lock")) found.push(relative);
      return;
    }
    for (const entry of (await readdir(path)).sort()) {
      await visit(join(path, entry), relative ? `${relative}/${entry}` : entry);
    }
  }
  await visit(root, "");
  return found;
}

async function repositorySnapshot() {
  const gitDirectory = join(repository, ".git");
  return {
    repositoryDigest: await directoryDigest(repository),
    refsDigest: await digestIfPresent(join(gitDirectory, "refs")),
    headChecksum: await fileHash(join(gitDirectory, "HEAD")),
    packedRefsChecksum: await fileHash(join(gitDirectory, "packed-refs")),
    indexChecksum: await fileHash(join(gitDirectory, "index")),
    workingTreeDigest: await workingTreeDigest(),
    configChecksum: await fileHash(join(gitDirectory, "config")),
    worktreeMetadataDigest: await digestIfPresent(join(gitDirectory, "worktrees")),
    linkedWorktreeDigest: await directoryDigest(linkedWorktree),
    includedRepositoryDigest: await directoryDigest(includedRepository),
    worktreeConfigRepositoryDigest: await directoryDigest(worktreeConfigRepository),
    gitDirectoryDigest: await directoryDigest(gitDirectory),
    lockfiles: await lockfiles(gitDirectory),
  };
}

async function monitorRepositoryMutations() {
  const events = [];
  const canaryEvents = new Set();
  const roots = [
    { label: "repository", path: repository },
    { label: "linked-worktree", path: linkedWorktree },
    { label: "included-repository", path: includedRepository },
    { label: "worktree-config-repository", path: worktreeConfigRepository },
  ];
  const canaryName = ".gitright-security-watch-canary";
  const watchers = roots.map(({ label, path: root }) => {
    const watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (filename === canaryName) {
        canaryEvents.add(label);
        return;
      }
      events.push(`${label}:${eventType}:${filename ?? ""}`);
    });
    watcher.on("error", (error) => events.push(`watch-error:${error.code ?? "unknown"}`));
    return watcher;
  });

  const deadline = Date.now() + 5_000;
  let attempt = 0;
  while (canaryEvents.size !== roots.length && Date.now() < deadline) {
    attempt += 1;
    await Promise.all(
      roots
        .filter(({ label }) => !canaryEvents.has(label))
        .map(({ path: root }) =>
          writeFile(join(root, canaryName), `watch canary ${attempt}\n`),
        ),
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  const missingCanaries = roots
    .map(({ label }) => label)
    .filter((label) => !canaryEvents.has(label));
  assert(
    missingCanaries.length === 0,
    `repository mutation watcher canary failed: missing ${missingCanaries.join(", ")}`,
  );
  await Promise.all(
    roots.map(({ path: root }) => unlink(join(root, canaryName))),
  );

  return {
    events,
    canary: {
      verified: true,
      roots: [...canaryEvents].sort(),
    },
    async close() {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      for (const watcher of watchers) watcher.close();
    },
  };
}

function requestMessage(id, name, args, meta = undefined) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args, ...meta },
  };
}

function startPlugin(environment) {
  const child = spawn(launcher, [], {
    cwd: join(repositoryRoot, "plugins/gitright"),
    env: environment,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const waiters = new Map();
  let stderr = "";
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    const waiter = waiters.get(response.id);
    if (!waiter) return;
    waiters.delete(response.id);
    waiter.resolve(response);
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolveClosed, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolveClosed({ code, signal }));
  });
  return {
    child,
    closed,
    stderr: () => stderr,
    request(message) {
      return new Promise((resolveRequest, reject) => {
        waiters.set(message.id, { resolve: resolveRequest, reject });
        child.stdin.write(`${JSON.stringify(message)}\n`);
      });
    },
    notify(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyInheritedNetworkSandbox() {
  assert(
    process.env.GITRIGHT_NETWORK_POLICY === "deny",
    "security proof did not declare the deny-network policy",
  );
  const result = await execFile(process.execPath, [
    "-e",
    `const net = require("node:net");
const server = net.createServer();
server.once("error", (error) => {
  process.stdout.write(String(error.code || "unknown"));
  process.exit(0);
});
server.listen(0, "127.0.0.1", () => process.exit(42));`,
  ], {
    encoding: "utf8",
    timeout: 2_000,
  });
  const errorCode = result.stdout.trim();
  assert(
    ["EACCES", "EPERM"].includes(errorCode),
    `network sandbox child canary was not denied (${errorCode || "no error"})`,
  );
  return { verified: true, childErrorCode: errorCode };
}

async function exerciseBoundaryConfigRejection(
  environment,
  targetRepository,
  requestId,
  category,
) {
  const session = startPlugin(environment);
  const open = await session.request(requestMessage(
    requestId,
    "open_gitright",
    {},
    {
      _meta: {
        "x-codex-turn-metadata": { workspaces: { [targetRepository]: {} } },
      },
    },
  ));
  assert(
    open.result?._meta?.repositoryState?.status === "unavailable",
    `${category} bypassed the boundary probe`,
  );
  session.child.stdin.end();
  const closed = await session.closed;
  assert(closed.code === 0 && closed.signal === null, "included-config session did not exit cleanly");
  assert(session.stderr() === "", "included-config session wrote diagnostics");
  return category;
}

async function exerciseTools(environment, rootSha) {
  const session = startPlugin(environment);
  const open = await session.request(requestMessage(
    1,
    "open_gitright",
    {},
    {
      _meta: {
        "x-codex-turn-metadata": { workspaces: { [repository]: {} } },
      },
    },
  ));
  assert(open.result?._meta?.repositoryState?.status === "ready", "repository did not pin");
  const state = await session.request(requestMessage(2, "get_repository_state", {}));
  assert(state.result?.structuredContent?.status === "ready", "repository state failed");
  const historyResponse = await session.request(requestMessage(3, "get_history", {}));
  const history = historyResponse.result?.structuredContent;
  assert(history?.status === "ready", "history failed");
  assert(history.hasMore, "history pagination fixture was not loaded");
  const historyPageResponse = await session.request(requestMessage(8, "load_more", {
    snapshotId: history.snapshotId,
    refFingerprint: history.refFingerprint,
    loadedCount: history.loadedCount,
    lastCommitSha: history.commits.at(-1).sha,
  }));
  assert(
    historyPageResponse.result?.structuredContent?.status === "ready",
    "history pagination failed",
  );
  const root = history.commits.find((commit) => commit.sha === rootSha);
  assert(root, "root fixture was not loaded");
  const detailResponse = await session.request(requestMessage(4, "get_commit_detail", {
    snapshotId: history.snapshotId,
    commitSha: root.sha,
    parentIndex: 0,
  }));
  const detail = detailResponse.result?.structuredContent;
  assert(detail?.status === "ready", "detail failed");
  assert(detail.loadedFileCount === 500 && detail.hasMoreFiles, "changed-file page missing");
  const pageResponse = await session.request(requestMessage(5, "load_more_files", {
    detailId: detail.detailId,
    loadedCount: detail.loadedFileCount,
    lastFileId: detail.files.at(-1).fileId,
  }));
  assert(pageResponse.result?.structuredContent?.status === "ready", "changed-file page failed");
  const selectedFile = detail.files.find((file) => file.path.endsWith(".txt"));
  assert(selectedFile, "diff fixture was not loaded");
  const diffResponse = await session.request(requestMessage(6, "get_diff", {
    detailId: detail.detailId,
    fileId: selectedFile.fileId,
  }));
  assert(diffResponse.result?.structuredContent?.status === "ready", "diff failed");
  const refreshResponse = await session.request(requestMessage(7, "get_history", {
    refresh: true,
    snapshotId: history.snapshotId,
    selectedSha: history.commits[0].sha,
  }));
  assert(refreshResponse.result?.structuredContent?.status === "ready", "refresh failed");

  const invalidCalls = [
    requestMessage(20, "open_gitright", { repository, ref: "--all" }),
    requestMessage(21, "get_history", { ref: "--all", path: "../../outside" }),
    requestMessage(22, "load_more", { ref: "HEAD", path: "../../outside" }),
    requestMessage(23, "get_commit_detail", {
      snapshotId: history.snapshotId,
      commitSha: "HEAD",
      parentIndex: 0,
      path: "../../outside",
    }),
    requestMessage(24, "load_more_files", { detailId: detail.detailId, path: "../../outside" }),
    requestMessage(25, "get_diff", { detailId: detail.detailId, path: "../../outside" }),
  ];
  for (const invalid of invalidCalls) {
    const response = await session.request(invalid);
    assert(response.error?.code === -32602, `invalid input reached ${invalid.params.name}`);
  }
  const stale = await session.request(requestMessage(26, "get_diff", {
    detailId: "a".repeat(64),
    fileId: "b".repeat(64),
  }));
  assert(stale.result?.structuredContent?.status === "error", "stale diff did not fail closed");
  const cancellationRequest = session.request(requestMessage(29, "get_diff", {
    detailId: detail.detailId,
    fileId: selectedFile.fileId,
  }));
  session.notify({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 29, reason: "security proof cancellation" },
  });
  const cancelledResponse = await cancellationRequest;
  assert(cancelledResponse.result?.structuredContent?.status === "ready", "cancel target failed");
  const afterCancellation = await session.request(requestMessage(30, "get_repository_state", {}));
  assert(afterCancellation.result?.structuredContent?.status === "ready", "cancel notification changed state");
  const resource = await session.request({
    jsonrpc: "2.0",
    id: 28,
    method: "resources/read",
    params: { uri: "ui://gitright/repository-state-v2.html" },
  });
  assert(
    resource.result?.contents?.[0]?._meta?.ui?.csp?.connectDomains?.length === 0,
    "widget connect domains were not empty",
  );
  session.child.stdin.end();
  const closed = await session.closed;
  assert(closed.code === 0 && closed.signal === null, "tool session did not exit cleanly");
  assert(session.stderr() === "", "tool session wrote diagnostics");
  return [
    "repository-state",
    "history",
    "history-pagination",
    "detail",
    "changed-file",
    "diff",
    "refresh",
    "error",
    "cancellation-notification",
    "widget-csp",
  ];
}

async function recordedGitChildren() {
  try {
    return (await readFile(gitChildLog, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function stopNextGitChild(previousCount) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const children = await recordedGitChildren();
    for (const pid of children.slice(previousCount)) {
      try {
        process.kill(pid, "SIGSTOP");
        return pid;
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 2));
  }
  throw new Error("forced cancellation did not observe an active Git child");
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function verifyAllRecordedGitChildrenExited() {
  const observedPids = [...new Set(await recordedGitChildren())];
  assert(observedPids.length > 0, "security proof did not observe any production Git child");
  const deadline = Date.now() + 2_000;
  let lingeringPids = observedPids.filter(processExists);
  while (lingeringPids.length > 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    lingeringPids = observedPids.filter(processExists);
  }
  return {
    observedCount: observedPids.length,
    allExited: lingeringPids.length === 0,
    lingeringPids,
  };
}

async function exerciseForcedCancellation(environment) {
  const session = startPlugin(environment);
  const open = await session.request(requestMessage(
    40,
    "open_gitright",
    {},
    {
      _meta: {
        "x-codex-turn-metadata": { workspaces: { [repository]: {} } },
      },
    },
  ));
  assert(open.result?._meta?.repositoryState?.status === "ready", "cancellation session did not pin");
  const previousGitChildCount = (await recordedGitChildren()).length;
  session.notify(requestMessage(41, "get_history", {}));
  const gitPid = await stopNextGitChild(previousGitChildCount);
  session.child.kill("SIGTERM");
  const closed = await session.closed;
  assert(closed.signal === "SIGTERM" || closed.code !== 0, "forced cancellation did not stop runtime");
  await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  const gitStillExists = processExists(gitPid);
  if (gitStillExists) process.kill(gitPid, "SIGKILL");
  assert(!gitStillExists, "forced cancellation left a Git child running");
  return "forced-process-cancellation";
}

async function exerciseDiagnostics(environment, rootSha) {
  const result = await execFile(launcher, ["--diagnostics"], {
    cwd: join(repositoryRoot, "plugins/gitright"),
    env: environment,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 2_000,
  });
  assert(result.stderr === "", "diagnostics wrote stderr");
  const diagnostics = JSON.parse(result.stdout);
  assert(diagnostics.status === "ok", "diagnostics did not pass");
  assert(
    JSON.stringify(Object.keys(diagnostics.runtime).sort()) === JSON.stringify(["kind", "version"]),
    "runtime diagnostics exposed an unexpected field",
  );
  assert(
    JSON.stringify(Object.keys(diagnostics.git).sort()) ===
      JSON.stringify(["durationMs", "errorCode", "version"]),
    "Git diagnostics exposed an unexpected field",
  );
  assert(
    Number.isFinite(diagnostics.git.durationMs) && diagnostics.git.durationMs >= 0,
    "Git diagnostics duration was invalid",
  );
  const serialized = JSON.stringify(diagnostics);
  for (const secret of [repository, outside, rootSha, "SECRET_IDENTITY", "refs/heads/main"]) {
    assert(!serialized.includes(secret), "diagnostics exposed repository content");
  }
  return "copy-diagnostics";
}

const fixture = await createFixture();
const runtimeHome = join(fixtureRoot, "runtime-home");
const runtimeTmp = join(fixtureRoot, "runtime-tmp");
await mkdir(runtimeHome);
await mkdir(runtimeTmp);
const runtimeEnvironment = {
  HOME: runtimeHome,
  TMPDIR: runtimeTmp,
  PATH: `${fixture.guardBin}:${process.env.PATH ?? ""}`,
  LANG: "C",
  LC_ALL: "C",
  GITRIGHT_NETWORK_ATTEMPT_MARKER: networkAttemptLog,
  GITRIGHT_GIT_CHILD_MARKER: gitChildLog,
  GIT_DIR: outside,
  GIT_WORK_TREE: outside,
  GIT_CONFIG_GLOBAL: fixture.globalConfig,
  XDG_CONFIG_HOME: fixture.xdgConfigHome,
  GIT_EXTERNAL_DIFF: join(fixture.commands, "filter"),
  GIT_TRACE: sentinels.trace,
  GIT_SSH_COMMAND: join(fixture.commands, "ssh"),
  GIT_ASKPASS: join(fixture.commands, "ssh"),
};

const networkSandboxCanary = await verifyInheritedNetworkSandbox();
const before = await repositorySnapshot();
const mutationMonitor = await monitorRepositoryMutations();
const categories = [await exerciseDiagnostics(runtimeEnvironment, fixture.rootSha)];
categories.push(await exerciseBoundaryConfigRejection(
  runtimeEnvironment,
  includedRepository,
  60,
  "included-config-rejection",
));
categories.push(await exerciseBoundaryConfigRejection(
  runtimeEnvironment,
  worktreeConfigRepository,
  61,
  "worktree-config-rejection",
));
categories.push(...(await exerciseTools(runtimeEnvironment, fixture.rootSha)));
categories.push(await exerciseForcedCancellation(runtimeEnvironment));
await mutationMonitor.close();
const gitChildProcesses = await verifyAllRecordedGitChildrenExited();
const after = await repositorySnapshot();
const invokedSentinels = [];
for (const [name, path] of Object.entries(sentinels)) {
  try {
    await lstat(path);
    invokedSentinels.push(name);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const homeEntries = await readdir(runtimeHome);
const temporaryEntries = await readdir(runtimeTmp);
let networkAttempts = [];
try {
  networkAttempts = (await readFile(networkAttemptLog, "utf8")).trim().split("\n").filter(Boolean);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const checks = Object.fromEntries(
  Object.keys(before).map((key) => [key, JSON.stringify(before[key]) === JSON.stringify(after[key])]),
);
const repositoryUnchanged = Object.values(checks).every(Boolean);
const networkAccess = networkSandboxCanary.verified ? "denied" : "unverified";
const verdict = repositoryUnchanged &&
  mutationMonitor.canary.verified &&
  mutationMonitor.events.length === 0 &&
  gitChildProcesses.allExited &&
  invokedSentinels.length === 0 &&
  homeEntries.length === 0 &&
  temporaryEntries.length === 0 &&
  networkAttempts.length === 0 &&
  networkAccess === "denied"
  ? "PASS"
  : "FAIL";

process.stdout.write(`${JSON.stringify({
  verdict,
  networkAccess,
  networkSandboxCanary,
  repositoryUnchanged,
  repositoryMutationEvents: mutationMonitor.events,
  mutationWatcherCanary: mutationMonitor.canary,
  gitChildProcesses,
  checks,
  categories,
  maliciousCommandsInvoked: invokedSentinels,
  networkAttempts,
  persistentHomeEntries: homeEntries,
  persistentTemporaryEntries: temporaryEntries,
  before,
  after,
})}\n`);
process.exit(verdict === "PASS" ? 0 : 1);
