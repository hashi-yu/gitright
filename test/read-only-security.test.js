import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);
const proof = path.join(
  repositoryRoot,
  "docs/proofs/fixtures/read-only-security/run-proof.sh",
);

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

test("runtime sources contain no network, telemetry, or persistent browser storage APIs", async () => {
  const sources = await Promise.all([
    "plugins/gitright/contract/index.ts",
    "plugins/gitright/contract/payloads.ts",
    "plugins/gitright/contract/schema.ts",
    "plugins/gitright/server/index.ts",
    "plugins/gitright/server/repository-binding.ts",
    "plugins/gitright/server/history-service.ts",
    "plugins/gitright/server/commit-detail-service.ts",
    "plugins/gitright/widget/index.tsx",
  ].map((file) => readFile(path.join(repositoryRoot, file), "utf8")));
  const runtime = sources.join("\n");

  assert.doesNotMatch(
    runtime,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\b/,
  );
  assert.doesNotMatch(
    runtime,
    /\b(?:curl|wget)\b|https?:\/\/|node:(?:http|https|http2|net|tls|dgram|dns|undici)\b|\bBun\.(?:connect|listen|serve|udpSocket)\b/,
  );
  assert.doesNotMatch(runtime, /\b(?:telemetry|analytics|trackingId)\b/i);
  assert.match(runtime, /GIT_CONFIG_NOSYSTEM: "1"/);
  assert.match(runtime, /GIT_NO_REPLACE_OBJECTS: "1"/);
  assert.match(runtime, /GIT_OPTIONAL_LOCKS: "0"/);
  assert.match(runtime, /XDG_CONFIG_HOME: path\.join\(home, "\.config"\)/);
  assert.match(runtime, /core\.hooksPath=\/dev\/null/);
  assert.match(runtime, /--no-ext-diff/);
  assert.match(runtime, /--no-textconv/);
  assert.doesNotMatch(runtime, /safe\.directory/);

  const requiredWorkflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/bun-distribution-proof.yml"),
    "utf8",
  );
  assert.match(
    requiredWorkflow,
    /- name: Enforce the read-only security invariant\n\s+run: npm run proof:security/,
  );
});

test("every public tool category preserves an adversarial repository offline", async (t) => {
  if (!(await canApplyNetworkSandbox())) {
    t.skip("nested macOS sandbox is unavailable in the current test sandbox");
    return;
  }
  const result = await execFile(proof, [], {
    cwd: repositoryRoot,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);

  assert.equal(report.verdict, "PASS");
  assert.equal(report.networkAccess, "denied");
  assert.equal(report.networkSandboxCanary.verified, true);
  assert.match(report.networkSandboxCanary.childErrorCode, /^(?:EACCES|EPERM)$/);
  assert.equal(report.repositoryUnchanged, true);
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(report.mutationWatcherCanary.verified, true);
  assert.deepEqual(report.mutationWatcherCanary.roots, [
    "included-repository",
    "linked-worktree",
    "repository",
    "worktree-config-repository",
  ]);
  assert.deepEqual(report.repositoryMutationEvents, []);
  assert.ok(report.gitChildProcesses.observedCount > 0);
  assert.equal(report.gitChildProcesses.allExited, true);
  assert.deepEqual(report.gitChildProcesses.lingeringPids, []);
  assert.deepEqual(report.maliciousCommandsInvoked, []);
  assert.deepEqual(report.networkAttempts, []);
  assert.deepEqual(report.persistentHomeEntries, []);
  assert.deepEqual(report.persistentTemporaryEntries, []);
  assert.deepEqual(report.categories, [
    "copy-diagnostics",
    "included-config-rejection",
    "worktree-config-rejection",
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
    "forced-process-cancellation",
  ]);
});
