import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

import {
  pluginRoot,
  repositoryRoot,
  runPluginConversation,
  runPluginRequests,
} from "../test-support/plugin-process.js";

const execFile = promisify(execFileCallback);
const widgetUri = "ui://gitright/repository-state-v2.html";

async function openRepositoryState(workspace) {
  const result = await runPluginRequests([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": {
            workspaces: { [workspace]: {} },
          },
        },
      },
    },
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout).result._meta.repositoryState;
}

test("installed MCP package exposes one model tool and a bundled app resource", async () => {
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/read",
      params: { uri: widgetUri },
    },
  ];

  const result = await runPluginRequests(requests);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  const [toolsResponse, resourcesResponse, resourceResponse] = result.stdout
    .trim()
    .split("\n")
    .map(JSON.parse);

  const tools = toolsResponse.result.tools;
  const modelTools = tools.filter((tool) => tool._meta?.ui?.visibility?.includes("model"));
  assert.deepEqual(modelTools.map((tool) => tool.name), ["open_gitright"]);

  const openTool = tools.find((tool) => tool.name === "open_gitright");
  assert.match(openTool.description, /do not use for generic Git questions/i);
  assert.match(openTool.description, /Gitの履歴を表示して/);
  assert.deepEqual(openTool.inputSchema, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  assert.deepEqual(openTool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(openTool._meta.ui, {
    resourceUri: widgetUri,
    visibility: ["model"],
  });

  const repositoryStateTool = tools.find((tool) => tool.name === "get_repository_state");
  assert.deepEqual(repositoryStateTool._meta.ui, { visibility: ["app"] });
  const historyTool = tools.find((tool) => tool.name === "get_history");
  assert.deepEqual(historyTool._meta.ui, { visibility: ["app"] });
  assert.deepEqual(historyTool.inputSchema, {
    oneOf: [
      {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          refresh: { type: "boolean", const: true },
          snapshotId: { type: "string", pattern: "^[0-9a-f]{64}$" },
          selectedSha: {
            anyOf: [
              { type: "string", pattern: "^[0-9a-f]{40}$" },
              { type: "null" },
            ],
          },
        },
        required: ["refresh", "snapshotId", "selectedSha"],
        additionalProperties: false,
      },
    ],
  });
  const loadMoreTool = tools.find((tool) => tool.name === "load_more");
  assert.deepEqual(loadMoreTool._meta.ui, { visibility: ["app"] });
  const commitDetailTool = tools.find((tool) => tool.name === "get_commit_detail");
  assert.deepEqual(commitDetailTool._meta.ui, { visibility: ["app"] });
  assert.deepEqual(commitDetailTool.inputSchema, {
    type: "object",
    properties: {
      snapshotId: { type: "string", pattern: "^[0-9a-f]{64}$" },
      commitSha: { type: "string", pattern: "^[0-9a-f]{40}$" },
      parentIndex: { type: "integer", minimum: 0, maximum: 999 },
    },
    required: ["snapshotId", "commitSha", "parentIndex"],
    additionalProperties: false,
  });
  const loadMoreFilesTool = tools.find((tool) => tool.name === "load_more_files");
  assert.deepEqual(loadMoreFilesTool._meta.ui, { visibility: ["app"] });
  assert.deepEqual(loadMoreFilesTool.inputSchema, {
    type: "object",
    properties: {
      detailId: { type: "string", pattern: "^[0-9a-f]{64}$" },
      loadedCount: { type: "integer", minimum: 0, maximum: 100000 },
      lastFileId: {
        anyOf: [
          { type: "string", pattern: "^[0-9a-f]{64}$" },
          { type: "null" },
        ],
      },
    },
    required: ["detailId", "loadedCount", "lastFileId"],
    additionalProperties: false,
  });
  const getDiffTool = tools.find((tool) => tool.name === "get_diff");
  assert.deepEqual(getDiffTool._meta.ui, { visibility: ["app"] });
  assert.deepEqual(getDiffTool.inputSchema, {
    type: "object",
    properties: {
      detailId: { type: "string", pattern: "^[0-9a-f]{64}$" },
      fileId: { type: "string", pattern: "^[0-9a-f]{64}$" },
    },
    required: ["detailId", "fileId"],
    additionalProperties: false,
  });

  assert.deepEqual(resourcesResponse.result.resources, [
    {
      uri: widgetUri,
      name: "GitRight v2 app",
      mimeType: "text/html;profile=mcp-app",
    },
  ]);

  assert.equal(resourceResponse.result.contents[0].uri, widgetUri);
  assert.equal(
    resourceResponse.result.contents[0].mimeType,
    "text/html;profile=mcp-app",
  );
  assert.deepEqual(resourceResponse.result.contents[0]._meta.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
  });
  assert.match(
    resourceResponse.result.contents[0].text,
    /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'">/,
  );
  assert.match(resourceResponse.result.contents[0].text, /<div id="gitright-root"><\/div>/);
  assert.match(resourceResponse.result.contents[0].text, /ui\/initialize/);
  assert.match(resourceResponse.result.contents[0].text, /Open GitRight/);
  assert.match(resourceResponse.result.contents[0].text, /requestDisplayMode/);
  assert.match(resourceResponse.result.contents[0].text, /fullscreen/);
  assert.match(resourceResponse.result.contents[0].text, /get_repository_state/);
  assert.match(resourceResponse.result.contents[0].text, /get_history/);
  assert.match(resourceResponse.result.contents[0].text, /load_more/);
  assert.match(resourceResponse.result.contents[0].text, /get_commit_detail/);
  assert.match(resourceResponse.result.contents[0].text, /load_more_files/);
  assert.match(resourceResponse.result.contents[0].text, /get_diff/);
  assert.match(resourceResponse.result.contents[0].text, /Diff truncated/);
  assert.match(resourceResponse.result.contents[0].text, /Old line/);
  assert.match(resourceResponse.result.contents[0].text, /New line/);
  assert.match(resourceResponse.result.contents[0].text, /Graph topology/);
  assert.match(resourceResponse.result.contents[0].text, /Text topology/);
  assert.match(resourceResponse.result.contents[0].text, /Topology view/);
  assert.match(resourceResponse.result.contents[0].text, /graph-commit-list/);
  assert.match(resourceResponse.result.contents[0].text, /graph-row-svg/);
  assert.match(resourceResponse.result.contents[0].text, /graph-edge-indicator/);
  assert.match(resourceResponse.result.contents[0].text, /focusable/);
  assert.match(resourceResponse.result.contents[0].text, /continue beyond the available rows/);
  assert.match(resourceResponse.result.contents[0].text, /loaded commits/);
  assert.match(resourceResponse.result.contents[0].text, /Search loaded commits/);
  assert.match(resourceResponse.result.contents[0].text, /Compare changed files with parent/);
  assert.match(resourceResponse.result.contents[0].text, /Load 500 more/);
  assert.match(resourceResponse.result.contents[0].text, /Refresh/);
  assert.match(resourceResponse.result.contents[0].text, /History changed/);
  assert.match(resourceResponse.result.contents[0].text, /No commits/);
  assert.match(resourceResponse.result.contents[0].text, /worktree/);
  assert.match(resourceResponse.result.contents[0].text, /shallow boundary/);
  assert.match(resourceResponse.result.contents[0].text, /gr-worktree-badge/);
  assert.match(resourceResponse.result.contents[0].text, /gr-statusbar/);
  assert.match(resourceResponse.result.contents[0].text, /gr-sheet/);
  assert.match(resourceResponse.result.contents[0].text, /HEAD \(detached\)/);
  assert.match(resourceResponse.result.contents[0].text, /Repository object is missing/);
  assert.match(resourceResponse.result.contents[0].text, /Repository object is corrupt/);
  assert.match(resourceResponse.result.contents[0].text, /supported snapshot limit/);
  assert.match(resourceResponse.result.contents[0].text, /navigator\.clipboard\.writeText/);
  assert.match(resourceResponse.result.contents[0].text, /Copy diagnostics/);
  assert.match(resourceResponse.result.contents[0].text, /error_code=/);
  assert.match(resourceResponse.result.contents[0].text, /duration_ms=/);
  const widgetSource = await readFile(path.join(pluginRoot, "widget/index.tsx"), "utf8");
  assert.doesNotMatch(
    widgetSource,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\b/,
  );
});

test("installed app seam loads one selected commit, its changed files, and one file diff", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-installed-detail-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  const contents = "installed detail fixture\n";
  const message = "Installed detail fixture\n";
  const stream =
    `blob\nmark :1\ndata ${Buffer.byteLength(contents)}\n${contents}` +
    "commit refs/heads/main\n" +
    "author GitRight Test <gitright-test@example.invalid> 1800000000 +0000\n" +
    "committer GitRight Test <gitright-test@example.invalid> 1800000000 +0000\n" +
    `data ${Buffer.byteLength(message)}\n${message}` +
    "M 100644 :1 detail.txt\n\ndone\n";
  await gitFastImport(repository, stream);
  await execFile("/usr/bin/git", ["-C", repository, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const session = await runPluginConversation(async (request) => {
    await request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": { workspaces: { [repository]: {} } },
        },
      },
    });
    const historyResponse = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_history", arguments: {} },
    });
    const snapshot = historyResponse.result.structuredContent;
    const selected = snapshot.commits[0];
    const detailResponse = await request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_commit_detail",
        arguments: {
          snapshotId: snapshot.snapshotId,
          commitSha: selected.sha,
          parentIndex: 0,
        },
      },
    });
    const detail = detailResponse.result.structuredContent;
    const diffResponse = await request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_diff",
        arguments: {
          detailId: detail.detailId,
          fileId: detail.files[0].fileId,
        },
      },
    });
    return {
      snapshot,
      selected,
      detail,
      diff: diffResponse.result.structuredContent,
    };
  });

  assert.equal(session.code, 0, session.stderr);
  assert.equal(session.stderr, "");
  const { selected, detail, diff } = session.value;
  assert.equal(detail.status, "ready");
  assert.equal(detail.sha, selected.sha);
  assert.deepEqual(detail.parents, selected.parents.map((parent) => parent.sha));
  assert.deepEqual(detail.refs, selected.refs);
  assert.equal(typeof detail.message, "string");
  assert.equal(typeof detail.authorName, "string");
  assert.match(detail.authorDate, /T/);
  assert.match(detail.committerDate, /T/);
  assert.equal(detail.loadedFileCount, detail.files.length);
  assert.ok(detail.loadedFileCount <= 500);
  assert.equal(detail.summary.totalFiles, detail.totalFileCount);
  assert.equal("authorEmail" in detail, false);
  assert.ok(detail.files.every((file) => /^[0-9a-f]{64}$/.test(file.fileId)));
  assert.equal(diff.status, "ready");
  assert.equal(diff.detailId, detail.detailId);
  assert.equal(diff.fileId, detail.files[0].fileId);
  assert.equal(diff.path, "detail.txt");
  assert.deepEqual(diff.statistics, { additions: 1, deletions: 0 });
  assert.ok(diff.lines.some((line) =>
    line.kind === "addition" &&
    line.content === "+installed detail fixture" &&
    line.oldLine === null &&
    line.newLine === 1
  ));
});

test("app-only get_history returns the first pinned available-history snapshot", async () => {
  const result = await runPluginRequests([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": { workspaces: { [repositoryRoot]: {} } },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_history", arguments: {} },
    },
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const [openResponse, historyResponse] = result.stdout.trim().split("\n").map(JSON.parse);
  assert.equal(openResponse.result._meta.repositoryState.status, "ready");
  assert.equal(historyResponse.result.isError, false);
  const snapshot = historyResponse.result.structuredContent;
  assert.equal(snapshot.status, "ready");
  assert.ok(snapshot.loadedCount > 0 && snapshot.loadedCount <= 500);
  assert.equal(snapshot.loadedCount, snapshot.commits.length);
  assert.match(snapshot.snapshotId, /^[0-9a-f]{64}$/);
  assert.match(snapshot.refFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.headSha, await execFile("/usr/bin/git", ["-C", repositoryRoot, "rev-parse", "HEAD"]).then(({ stdout }) => stdout.trim()));
  assert.ok(snapshot.commits.every((commit) => /^[0-9a-f]{40}$/.test(commit.sha)));
});

async function gitFastImport(repository, stream) {
  await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/git", ["-C", repository, "fast-import", "--quiet"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(stderr).toString("utf8")));
    });
    child.stdin.end(stream);
  });
}

test("installed app seam appends the final changed file from a 501-file root commit", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-installed-files-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  let stream = "";
  for (let index = 0; index < 501; index += 1) {
    const contents = `file ${index}\n`;
    stream += "blob\n";
    stream += `mark :${index + 1}\n`;
    stream += `data ${Buffer.byteLength(contents)}\n${contents}`;
  }
  stream += "commit refs/heads/main\n";
  stream += "mark :600\n";
  stream += "author GitRight Test <gitright-test@example.invalid> 1800000000 +0000\n";
  stream += "committer GitRight Test <gitright-test@example.invalid> 1800000000 +0000\n";
  const message = "Bulk files\n";
  stream += `data ${Buffer.byteLength(message)}\n${message}`;
  for (let index = 0; index < 501; index += 1) {
    stream += `M 100644 :${index + 1} ${String(index).padStart(4, "0")}.txt\n`;
  }
  stream += "\ndone\n";
  await gitFastImport(repository, stream);
  await execFile("/usr/bin/git", ["-C", repository, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const session = await runPluginConversation(async (request) => {
    await request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: { "x-codex-turn-metadata": { workspaces: { [repository]: {} } } },
      },
    });
    const historyResponse = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_history", arguments: {} },
    });
    const history = historyResponse.result.structuredContent;
    const detailResponse = await request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_commit_detail",
        arguments: {
          snapshotId: history.snapshotId,
          commitSha: history.commits[0].sha,
          parentIndex: 0,
        },
      },
    });
    const detail = detailResponse.result.structuredContent;
    const pageResponse = await request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "load_more_files",
        arguments: {
          detailId: detail.detailId,
          loadedCount: detail.loadedFileCount,
          lastFileId: detail.files.at(-1).fileId,
        },
      },
    });
    return { detail, page: pageResponse.result.structuredContent };
  });

  assert.equal(session.code, 0, session.stderr);
  assert.equal(session.stderr, "");
  assert.equal(session.value.detail.loadedFileCount, 500);
  assert.equal(session.value.detail.totalFileCount, 501);
  assert.equal(session.value.detail.hasMoreFiles, true);
  assert.equal(session.value.page.status, "ready");
  assert.equal(session.value.page.previousLoadedCount, 500);
  assert.equal(session.value.page.files.length, 1);
  assert.equal(session.value.page.files[0].path, "0500.txt");
  assert.equal(session.value.page.hasMoreFiles, false);
});

test("installed app seam paginates and explicitly refreshes one stable snapshot", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-installed-pagination-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  let stream = "";
  for (let index = 0; index < 501; index += 1) {
    const mark = index + 1;
    const subject = `Commit ${index}`;
    stream += "commit refs/heads/main\n";
    stream += `mark :${mark}\n`;
    stream += `author GitRight Test <gitright-test@example.invalid> ${1_800_000_000 + index} +0000\n`;
    stream += `committer GitRight Test <gitright-test@example.invalid> ${1_800_000_000 + index} +0000\n`;
    stream += `data ${Buffer.byteLength(subject)}\n${subject}\n`;
    if (index > 0) stream += `from :${index}\n`;
    stream += "\n";
  }
  stream += "done\n";
  await gitFastImport(repository, stream);
  await execFile("/usr/bin/git", ["-C", repository, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const session = await runPluginConversation(async (request) => {
    const opened = await request({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": { workspaces: { [repository]: {} } },
        },
      },
    });
    const firstResponse = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_history", arguments: {} },
    });
    const first = firstResponse.result.structuredContent;
    const pageResponse = await request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "load_more",
        arguments: {
          snapshotId: first.snapshotId,
          refFingerprint: first.refFingerprint,
          loadedCount: first.loadedCount,
          lastCommitSha: first.commits.at(-1).sha,
        },
      },
    });
    const page = pageResponse.result.structuredContent;
    const refreshRequest = {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_history",
        arguments: {
          refresh: true,
          snapshotId: first.snapshotId,
          selectedSha: first.commits[20].sha,
        },
        _meta: { "openai/locale": "ja-JP" },
      },
    };
    const duplicateRefreshRequest = {
      ...refreshRequest,
      id: 5,
    };
    const invalidRefreshRequest = {
      ...refreshRequest,
      id: 6,
      params: {
        name: "get_history",
        arguments: { refresh: true, snapshotId: "invalid" },
      },
    };
    const [refreshResponse, duplicateRefreshResponse, invalidRefreshResponse] = await Promise.all([
      request(refreshRequest),
      request(duplicateRefreshRequest),
      request(invalidRefreshRequest),
    ]);
    return {
      opened: opened.result._meta.repositoryState,
      first,
      page,
      refreshed: refreshResponse.result.structuredContent,
      duplicateRefresh: duplicateRefreshResponse.result.structuredContent,
      duplicateRefreshLocale: duplicateRefreshResponse.result._meta["openai/locale"],
      invalidRefresh: invalidRefreshResponse,
    };
  });

  assert.equal(session.code, 0, session.stderr);
  assert.equal(session.stderr, "");
  assert.equal(session.value.opened.status, "ready");
  assert.equal(session.value.first.loadedCount, 500);
  assert.equal(session.value.first.hasMore, true);
  assert.equal(session.value.page.previousLoadedCount, 500);
  assert.equal(session.value.page.commits.length, 1);
  assert.equal(session.value.page.loadedCount, 501);
  assert.equal(session.value.page.hasMore, false);
  assert.notEqual(session.value.refreshed.snapshotId, session.value.first.snapshotId);
  assert.equal(session.value.refreshed.loadedCount, 501);
  assert.deepEqual(session.value.refreshed.selection, {
    status: "reachable",
    sha: session.value.first.commits[20].sha,
  });
  assert.deepEqual(session.value.duplicateRefresh, {
    status: "error",
    message: "History refresh is already in progress",
    code: "refresh-in-progress",
  });
  assert.equal(session.value.duplicateRefreshLocale, "ja");
  assert.deepEqual(session.value.invalidRefresh.error, {
    code: -32602,
    message: "Invalid parameters",
  });
});

test("bundled widget assets stay below the accepted combined gzip budget", async () => {
  const [script, styles] = await Promise.all([
    readFile(path.join(pluginRoot, "dist/widget.js")),
    readFile(path.join(pluginRoot, "dist/widget.css")),
  ]);
  assert.ok(gzipSync(script).length + gzipSync(styles).length <= 250 * 1024);
});

test("open_gitright pins one trusted worktree and keeps repository data out of model content", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-linked-worktree-"));
  const mainRepository = path.join(fixture, "main");
  const trustedContext = path.join(fixture, "linked-worktree");
  await execFile("/usr/bin/git", ["init", "-q", mainRepository]);
  await execFile("/usr/bin/git", [
    "-C",
    mainRepository,
    "-c",
    "user.name=GitRight Test",
    "-c",
    "user.email=gitright-test@example.invalid",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "linked worktree fixture",
  ]);
  await execFile("/usr/bin/git", [
    "-C",
    mainRepository,
    "worktree",
    "add",
    "-q",
    "-b",
    "linked-worktree-test",
    trustedContext,
  ]);
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": {
            workspaces: { [trustedContext]: { label: "host-owned" } },
          },
        },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_repository_state", arguments: {} },
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": {
            workspaces: { "/a/different/repository": {} },
          },
        },
      },
    },
  ];

  const result = await runPluginRequests(requests);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const [openResponse, stateResponse, repeatedOpenResponse] = result.stdout
    .trim()
    .split("\n")
    .map(JSON.parse);
  const { gitVersion, ...openState } = openResponse.result._meta.repositoryState;
  const { gitVersion: stateGitVersion, ...state } = stateResponse.result.structuredContent;
  const { gitVersion: repeatedGitVersion, ...repeatedState } =
    repeatedOpenResponse.result._meta.repositoryState;
  const expectedStateWithoutVersion = {
    status: "ready",
    message: "Repository ready",
    repositoryName: path.basename(trustedContext),
    repositoryPath: await realpath(mainRepository),
    repositoryKind: "linked-worktree",
    branch: "linked-worktree-test",
    worktreeName: path.basename(trustedContext),
  };

  assert.equal(openResponse.result.content.length, 1);
  assert.doesNotMatch(
    openResponse.result.content[0].text,
    new RegExp(path.basename(trustedContext)),
  );
  assert.doesNotMatch(openResponse.result.content[0].text, new RegExp(trustedContext));
  assert.deepEqual(openState, expectedStateWithoutVersion);
  assert.deepEqual(state, expectedStateWithoutVersion);
  assert.deepEqual(repeatedState, expectedStateWithoutVersion);
  assert.equal(stateGitVersion, gitVersion);
  assert.equal(repeatedGitVersion, gitVersion);
  assert.match(gitVersion, /^\d+\.\d+\.\d+$/);
});

test("missing or ambiguous trusted task context fails closed", async () => {
  const ambiguous = await runPluginRequests([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": {
            workspaces: {
              [repositoryRoot]: {},
              "relative-context-must-not-be-ignored": {},
            },
          },
        },
      },
    },
  ]);
  const missing = await runPluginRequests([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "open_gitright", arguments: {} },
    },
  ]);

  for (const result of [ambiguous, missing]) {
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout).result._meta.repositoryState, {
      status: "unavailable",
      message: "Current task repository is unavailable",
    });
  }
});

test("a trusted path outside Git reports unavailable without scanning", async () => {
  const outsideRepository = await mkdtemp(path.join(tmpdir(), "gitright-no-repository-"));
  const result = await runPluginRequests([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_gitright",
        arguments: {},
        _meta: {
          "x-codex-turn-metadata": {
            workspaces: { [outsideRepository]: {} },
          },
        },
      },
    },
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout).result._meta.repositoryState, {
    status: "unavailable",
    message: "Current task repository is unavailable",
  });
});

test("a partial clone is rejected before the repository is pinned", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-partial-clone-"));
  const source = path.join(fixture, "source");
  const origin = path.join(fixture, "origin.git");
  const partialClone = path.join(fixture, "partial");

  await execFile("/usr/bin/git", ["init", "-q", source]);
  await execFile("/usr/bin/git", [
    "-C",
    source,
    "-c",
    "user.name=GitRight Test",
    "-c",
    "user.email=gitright-test@example.invalid",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "partial clone fixture",
  ]);
  await execFile("/usr/bin/git", ["clone", "-q", "--bare", source, origin]);
  await execFile("/usr/bin/git", [
    "-C",
    origin,
    "config",
    "uploadpack.allowFilter",
    "true",
  ]);
  await execFile("/usr/bin/git", [
    "clone",
    "-q",
    "--filter=blob:none",
    pathToFileURL(origin).href,
    partialClone,
  ]);

  const { gitVersion, ...state } = await openRepositoryState(partialClone);
  assert.deepEqual(state, {
    status: "unsupported",
    message: "Partial clones are not supported in this version",
  });
  assert.match(gitVersion, /^\d+\.\d+\.\d+$/);
});

test("the canonical legacy partial-clone marker is rejected", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-legacy-partial-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "core.repositoryFormatVersion",
    "1",
  ]);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "extensions.partialClone",
    "origin",
  ]);

  const { gitVersion, ...state } = await openRepositoryState(repository);
  assert.deepEqual(state, {
    status: "unsupported",
    message: "Partial clones are not supported in this version",
  });
  assert.match(gitVersion, /^\d+\.\d+\.\d+$/);
});

test("an explicitly false promisor marker remains a supported repository", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-promisor-false-"));
  await execFile("/usr/bin/git", ["init", "-q", "-b", "promisor-false-branch", repository]);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "config",
    "remote.origin.promisor",
    "false",
  ]);

  const { gitVersion, ...state } = await openRepositoryState(repository);
  assert.deepEqual(state, {
    status: "ready",
    message: "Repository ready",
    repositoryName: path.basename(repository),
    repositoryPath: await realpath(repository),
    repositoryKind: "repository",
    branch: "promisor-false-branch",
    worktreeName: null,
  });
  assert.match(gitVersion, /^\d+\.\d+\.\d+$/);
});
