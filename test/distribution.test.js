import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runPluginRequests } from "../test-support/plugin-process.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repositoryRoot, "plugins/gitright");
const launcher = path.join(repositoryRoot, "plugins/gitright/dist/launch");
const packageProof = path.join(
  repositoryRoot,
  "docs/proofs/fixtures/bun-distribution/run-package-proof.sh",
);
const distProof = path.join(
  repositoryRoot,
  "docs/proofs/fixtures/bun-distribution/check-dist.sh",
);

async function run(command, args, options) {
  return await new Promise((resolve, reject) => {
    const { input, ...spawnOptions } = options;
    const child = spawn(command, args, spawnOptions);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

async function fakeBun(directory, version) {
  await mkdir(directory, { recursive: true });
  const executable = path.join(directory, "bun");
  await writeFile(
    executable,
    `#!/bin/sh\nif [ "\${1-}" = "--version" ]; then\n  printf '%s\\n' '${version}'\n  exit 0\nfi\nprintf 'bun=%s\\n' "$0"\nprintf 'args=%s\\n' "$*"\n`,
    { mode: 0o755 },
  );
  return executable;
}

async function runPreflightWithPathBun(version, args = []) {
  const root = await mkdtemp(path.join(tmpdir(), "gitright-preflight-"));
  const bin = path.join(root, "bin");
  const bun = await fakeBun(bin, version);
  const result = await run(launcher, args, {
    cwd: repositoryRoot,
    env: { HOME: path.join(root, "home"), PATH: bin },
  });
  return { bun, result };
}

test("plugin source follows the accepted production layout", async () => {
  assert.deepEqual((await readdir(pluginRoot)).sort(), [
    ".codex-plugin",
    ".mcp.json",
    "dist",
    "server",
    "skills",
    "widget",
  ]);
});

test("production Git reads use execFile argument arrays, including fixed stdin", async () => {
  const binding = await readFile(
    path.join(pluginRoot, "server/repository-binding.ts"),
    "utf8",
  );

  assert.match(binding, /execFileCallback\(/);
  assert.match(binding, /child\.stdin\?\.end\(input\)/);
  assert.doesNotMatch(binding, /\bspawn\b/);
  assert.doesNotMatch(binding, /\bshell\s*:/);
});

test("explicit GitRight invocation is routed only through open_gitright", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  const skill = await readFile(path.join(pluginRoot, "skills/gitright/SKILL.md"), "utf8");

  assert.equal(manifest.skills, "./skills/");
  assert.deepEqual(manifest.interface.defaultPrompt, [
    "Open GitRight using only its open_gitright tool. If unavailable, stop without running shell or Git commands.",
  ]);
  assert.match(skill, /Call only the `open_gitright` tool/);
  assert.match(skill, /Gitの履歴を表示して/);
  assert.match(skill, /Do not open GitRight for generic questions about Git/);
  assert.match(skill, /Never run Shell, Git commands, or repository-reading tools as a fallback/);
  assert.match(skill, /If `open_gitright` is unavailable or fails to start, stop/);
});

test("bundled MCP config declares the plugin root as its working directory", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  );
  const mcpServers = JSON.parse(await readFile(path.join(pluginRoot, ".mcp.json"), "utf8"));

  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(mcpServers, {
    mcpServers: {
      gitright: {
        command: "./dist/launch",
        args: [],
        cwd: ".",
        default_tools_approval_mode: "auto",
      },
    },
  });
});

test("runtime preflight launches the prebuilt server with minimum supported Bun from PATH", async () => {
  const { bun, result } = await runPreflightWithPathBun("1.3.14", ["--diagnostics"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, new RegExp(`bun=${bun.replaceAll("/", "\\/")}`));
  assert.match(result.stdout, /args=.*\/plugins\/gitright\/dist\/server\.js --diagnostics/);
});

test("runtime preflight rejects too-old Bun with an actionable read-only diagnostic", async () => {
  const { result } = await runPreflightWithPathBun("1.3.13");

  assert.equal(result.code, 78);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Bun 1\.3\.13 is too old/);
  assert.match(result.stderr, />=1\.3\.14 <2\.0\.0/);
  assert.match(result.stderr, /did not change your environment/);
});

test("runtime preflight rejects an unsupported Bun major version", async () => {
  const { result } = await runPreflightWithPathBun("2.0.0");

  assert.equal(result.code, 78);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Bun 2\.0\.0 uses an unsupported major version/);
  assert.match(result.stderr, />=1\.3\.14 <2\.0\.0/);
});

test("runtime preflight does not echo unrecognized version output", async () => {
  const { result } = await runPreflightWithPathBun("NOT_A_VERSION_SECRET_SENTINEL");

  assert.equal(result.code, 78);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Bun reported an unrecognized version/);
  assert.doesNotMatch(result.stderr, /SECRET_SENTINEL/);
});

test("runtime preflight finds Bun in the standard user installation path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitright preflight "));
  const home = path.join(root, "home with spaces");
  const bun = await fakeBun(path.join(home, ".bun/bin"), "1.9.0");

  const result = await run(launcher, ["--diagnostics"], {
    cwd: repositoryRoot,
    env: { HOME: home, PATH: "/usr/bin:/bin" },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, new RegExp(`bun=${bun.replaceAll("/", "\\/")}`));
});

test("runtime diagnostics expose versions without executable or repository paths", async () => {
  const result = await run(launcher, ["--diagnostics"], {
    cwd: repositoryRoot,
    env: process.env,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const diagnostics = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(diagnostics.runtime).sort(), ["kind", "version"]);
  assert.deepEqual(Object.keys(diagnostics.git).sort(), [
    "durationMs",
    "errorCode",
    "version",
  ]);
  assert.equal(diagnostics.git.errorCode, null);
  assert.ok(Number.isFinite(diagnostics.git.durationMs));
  assert.ok(diagnostics.git.durationMs >= 0);
  assert.doesNotMatch(result.stdout, new RegExp(repositoryRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(result.stdout, /refs\/heads|[0-9a-f]{40}/);
});

test("runtime preflight reports missing Bun without changing the user environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gitright-preflight-"));
  const home = path.join(root, "home");
  await mkdir(home);
  await writeFile(path.join(home, "sentinel"), "unchanged");
  const before = await readdir(home);

  const result = await run(launcher, [], {
    cwd: repositoryRoot,
    env: { HOME: home, PATH: "/usr/bin:/bin" },
  });

  assert.equal(result.code, 127);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Bun was not found in PATH or a standard installation path/);
  assert.match(result.stderr, /did not change your environment/);
  assert.deepEqual(await readdir(home), before);
});

test("architecture-neutral plugin package initializes without a source install", async () => {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "gitright-distribution-test", version: "0.0.0" },
    },
  };

  const result = await runPluginRequests([request]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "gitright", version: "0.1.0-beta.1" },
    },
  });
});

test("architecture-neutral package runs the read-only open_gitright proof operation", async () => {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "open_gitright", arguments: {} },
    },
  ];

  const result = await runPluginRequests(requests);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const [list, call] = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(list.result.tools[0].name, "open_gitright");
  assert.deepEqual(list.result.tools[0].inputSchema, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  assert.deepEqual(list.result.tools[0].annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.equal(call.result.isError, false);
  assert.deepEqual(call.result.structuredContent, {
    outcome: "unavailable",
    reasonCode: "repository-unavailable",
  });
  assert.match(call.result.content[0].text, /unavailable for this task/);
  assert.deepEqual(call.result._meta.repositoryState, {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
});

test("distribution proof runs only the staged plugin package with network denied", async (t) => {
  const result = await run(packageProof, [], {
    cwd: repositoryRoot,
    env: process.env,
  });

  if (result.code === 71 && /sandbox_apply: Operation not permitted/.test(result.stderr)) {
    t.skip("nested macOS sandbox is unavailable in the current test sandbox");
    return;
  }

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /verdict=PASS/);
  assert.match(result.stdout, /package_source_tree_present=false/);
  assert.match(result.stdout, /source_checkout_present=true/);
  assert.match(result.stdout, /node_modules_present=false/);
  assert.match(result.stdout, /local_build_performed=false/);
  assert.match(result.stdout, /network_access=denied/);
  assert.match(result.stdout, /git_preflight=PASS/);
  assert.match(result.stdout, /package_bytes=[1-9][0-9]*/);
  assert.match(result.stdout, /payload_bytes=[1-9][0-9]*/);
  assert.match(result.stdout, /package_sha256=[a-f0-9]{64}/);
  assert.match(result.stdout, /payload_sha256=[a-f0-9]{64}/);
  assert.match(result.stdout, /mcp_initialize=PASS/);
  assert.match(result.stdout, /representative_operation=PASS/);
  assert.match(result.stdout, /history_operation=PASS/);
  assert.match(result.stdout, /repository_unchanged=true/);
  assert.match(result.stdout, /repository_digest_before=([a-f0-9]{64})/);
  assert.match(result.stdout, /repository_digest_after=([a-f0-9]{64})/);
  assert.match(result.stdout, /diagnostics=PASS/);
});

test("pinned Bun deterministically rebuilds the committed server bundle", async () => {
  const result = await run(distProof, [], {
    cwd: repositoryRoot,
    env: process.env,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /bun_version=1\.3\.14/);
  assert.match(result.stdout, /byte_identical=true/);
  assert.match(result.stdout, /committed_dist_matches=true/);
  assert.match(result.stdout, /widget_bytes=[1-9][0-9]*/);
});
