import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  repositoryRoot,
  runPluginConversation,
  runPluginRequests,
} from "../test-support/plugin-process.js";

const execFile = promisify(execFileCallback);

function openRequest(id, locale, workspace) {
  const turnMetadata = workspace
    ? { "x-codex-turn-metadata": { workspaces: { [workspace]: {} } } }
    : {};
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "open_gitright",
      arguments: {},
      _meta: { ...turnMetadata, "openai/locale": locale },
    },
  };
}

async function openGitRight(locale, workspace) {
  const result = await runPluginRequests([openRequest(1, locale, workspace)]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout).result;
}

function schemaError(value, schema, at = "$") {
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => !schemaError(value, candidate, at));
    if (matches.length !== 1) return `${at} matched ${matches.length} oneOf variants`;
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.some((candidate) => !schemaError(value, candidate, at));
    if (!matches) return `${at} did not match anyOf`;
  }
  if ("const" in schema && !Object.is(value, schema.const)) {
    return `${at} did not match const`;
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${at} did not match enum`;
  }
  if (Array.isArray(schema.type)) {
    const matched = schema.type.some(
      (candidate) => !schemaError(value, { ...schema, type: candidate }, at),
    );
    if (!matched) return `${at} did not match its type array`;
  }
  if (schema.type === "null" && value !== null) return `${at} was not null`;
  if (schema.type === "string") {
    if (typeof value !== "string") return `${at} was not a string`;
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${at} was shorter than minLength`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${at} was longer than maxLength`;
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      return `${at} did not match pattern`;
    }
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    return `${at} was not a boolean`;
  }
  if (schema.type === "number" && typeof value !== "number") {
    return `${at} was not a number`;
  }
  if (schema.type === "integer" && !Number.isInteger(value)) {
    return `${at} was not an integer`;
  }
  if (["integer", "number"].includes(schema.type)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${at} was below minimum`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${at} was above maximum`;
    }
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${at} was not an array`;
    for (let index = 0; index < value.length; index += 1) {
      const error = schemaError(value[index], schema.items, `${at}[${index}]`);
      if (error) return error;
    }
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return `${at} was not an object`;
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) return `${at}.${required} was missing`;
    }
    if (schema.additionalProperties === false && schema.properties) {
      const unknown = Object.keys(value).find((key) => !(key in schema.properties));
      if (unknown) return `${at}.${unknown} was not declared`;
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        const error = schemaError(value[key], propertySchema, `${at}.${key}`);
        if (error) return error;
      }
    }
  }
  return null;
}

function assertMatchesSchema(value, schema, label) {
  assert.equal(schemaError(value, schema), null, label);
}

function assertClosedObjectSchemas(schema, at = "$") {
  if (schema.type === "object" && schema.properties) {
    assert.equal(schema.additionalProperties, false, `${at} must reject undeclared fields`);
  }
  for (const key of ["oneOf", "anyOf"]) {
    for (const [index, candidate] of (schema[key] ?? []).entries()) {
      assertClosedObjectSchemas(candidate, `${at}.${key}[${index}]`);
    }
  }
  for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
    assertClosedObjectSchemas(propertySchema, `${at}.properties.${key}`);
  }
  if (schema.items) assertClosedObjectSchemas(schema.items, `${at}.items`);
}

test("packaged MCP advertises one exact v2 Apps SDK contract", async () => {
  const listed = await runPluginRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 2, method: "resources/list", params: {} },
  ]);

  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(listed.stderr, "");
  const [toolsResponse, resourcesResponse] = listed.stdout.trim().split("\n").map(JSON.parse);
  const tools = toolsResponse.result.tools;
  const resources = resourcesResponse.result.resources;
  const widgetUri = "ui://gitright/repository-state-v2.html";

  assert.equal(tools.length, 7);
  assert.ok(tools.every((tool) => tool.outputSchema?.type === "object"));
  assert.deepEqual(
    tools.filter((tool) => tool._meta.ui.visibility.includes("model")).map((tool) => tool.name),
    ["open_gitright"],
  );
  assert.ok(
    tools.filter((tool) => tool.name !== "open_gitright")
      .every((tool) => JSON.stringify(tool._meta.ui.visibility) === '["app"]'),
  );
  const expectedMetadata = {
    open_gitright: ["Open GitRight", ["model"]],
    get_repository_state: ["Get repository state", ["app"]],
    get_history: ["Get history", ["app"]],
    load_more: ["Load more history", ["app"]],
    get_commit_detail: ["Get commit detail", ["app"]],
    load_more_files: ["Load more changed files", ["app"]],
    get_diff: ["Get file diff", ["app"]],
  };
  for (const tool of tools) {
    assert.equal(tool.title, expectedMetadata[tool.name][0]);
    assert.deepEqual(tool._meta.ui.visibility, expectedMetadata[tool.name][1]);
    assert.ok(tool.description.length > 20);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  }

  const openTool = tools.find((tool) => tool.name === "open_gitright");
  assert.equal(openTool.title, "Open GitRight");
  assert.match(openTool.description, /'Open GitRight'/);
  assert.match(openTool.description, /'Show this repository's history in GitRight'/);
  assert.match(openTool.description, /Gitの履歴を表示して/);
  assert.match(openTool.description, /Do not use for generic Git questions/);
  assert.match(openTool.description, /'What is git rebase\?'/);
  assert.deepEqual(openTool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  });
  assert.equal(openTool._meta.ui.resourceUri, widgetUri);
  assert.equal(openTool._meta["openai/outputTemplate"], widgetUri);
  assert.deepEqual(openTool.outputSchema, {
    type: "object",
    properties: {
      outcome: { type: "string", enum: ["opened", "unavailable", "unsupported"] },
      reasonCode: {
        type: "string",
        enum: [
          "repository-unavailable",
          "bare-repository",
          "partial-clone",
          "sha256-repository",
          "ownership-refused",
          "git-version-blocked",
        ],
      },
    },
    required: ["outcome"],
    additionalProperties: false,
  });

  assert.deepEqual(resources, [{
    uri: widgetUri,
    name: "GitRight v2 app",
    mimeType: "text/html;profile=mcp-app",
  }]);
  assert.doesNotMatch(JSON.stringify({ tools, resources }), /repository-state-v1/);
  const resource = await runPluginRequests([{
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: widgetUri },
  }]);
  assert.equal(resource.code, 0, resource.stderr);
  assert.equal(resource.stderr, "");
  const content = JSON.parse(resource.stdout).result.contents[0];
  assert.equal(content.uri, widgetUri);
  assert.equal(content.mimeType, "text/html;profile=mcp-app");
  assert.equal(
    content._meta["openai/widgetDescription"],
    "Browse read-only Git history, commit details, changed files, and diffs in GitRight.",
  );
  assert.equal(content._meta.ui.prefersBorder, false);
  assert.deepEqual(content._meta.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
    frameDomains: [],
  });
  assert.equal("domain" in content._meta.ui, false);
});

test("open_gitright returns only bounded launch outcomes to the model", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "gitright-contract-"));
  const bareRepository = path.join(fixture, "bare.git");
  await execFile("/usr/bin/git", ["init", "--bare", "-q", bareRepository]);

  const opened = await openGitRight("ja-JP", repositoryRoot);
  const unavailable = await openGitRight("en-GB", undefined);
  const unsupported = await openGitRight("fr-FR", bareRepository);

  assert.deepEqual(opened.structuredContent, { outcome: "opened" });
  assert.deepEqual(unavailable.structuredContent, {
    outcome: "unavailable",
    reasonCode: "repository-unavailable",
  });
  assert.deepEqual(unsupported.structuredContent, {
    outcome: "unsupported",
    reasonCode: "bare-repository",
  });
  assert.equal(opened._meta["openai/locale"], "ja");
  assert.equal(unavailable._meta["openai/locale"], "en");
  assert.equal(unsupported._meta["openai/locale"], "en");

  for (const result of [opened, unavailable, unsupported]) {
    assert.equal(result.isError, false);
    assert.equal(result.content.length, 1);
    assert.deepEqual(Object.keys(result.content[0]).sort(), ["text", "type"]);
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.length <= 80);
    const modelVisible = JSON.stringify({
      structuredContent: result.structuredContent,
      content: result.content,
    });
    for (const forbidden of [
      "repositoryName",
      "repositoryPath",
      "sha",
      "subject",
      "message",
      "author",
      "ref",
      "history",
      "file",
      "diff",
    ]) {
      assert.doesNotMatch(modelVisible, new RegExp(forbidden, "i"));
    }
  }
});

test("every app-only tool advertises and returns a closed success-or-error schema", async () => {
  const listed = await runPluginRequests([
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  ]);
  const tools = JSON.parse(listed.stdout).result.tools;
  const opaqueId = "0".repeat(64);
  const sha = "0".repeat(40);
  const calls = [
    ["get_repository_state", {}],
    ["get_history", {}],
    ["load_more", {
      snapshotId: opaqueId,
      refFingerprint: opaqueId,
      loadedCount: 0,
      lastCommitSha: null,
    }],
    ["get_commit_detail", { snapshotId: opaqueId, commitSha: sha, parentIndex: 0 }],
    ["load_more_files", { detailId: opaqueId, loadedCount: 0, lastFileId: null }],
    ["get_diff", { detailId: opaqueId, fileId: opaqueId }],
  ];
  const responses = await runPluginRequests(calls.map(([name, args], index) => ({
    jsonrpc: "2.0",
    id: index + 1,
    method: "tools/call",
    params: {
      name,
      arguments: args,
      _meta: { "openai/locale": "ja-Latn-JP" },
    },
  })));
  assert.equal(responses.code, 0, responses.stderr);
  assert.equal(responses.stderr, "");
  const foreignToolErrors = {
    get_history: {
      status: "error",
      message: "History page boundary is invalid",
      code: "invalid-page-boundary",
    },
    load_more: {
      status: "error",
      message: "History refresh request is stale",
      code: "stale-refresh",
    },
    get_commit_detail: {
      status: "error",
      message: "Changed-file page boundary is invalid",
      code: "invalid-file-page-boundary",
    },
    load_more_files: {
      status: "error",
      message: "Commit detail request is stale",
      code: "stale-detail",
    },
  };

  for (const response of responses.stdout.trim().split("\n").map(JSON.parse)) {
    const [name] = calls[response.id - 1];
    const tool = tools.find((candidate) => candidate.name === name);
    assertClosedObjectSchemas(tool.outputSchema, `${name}.outputSchema`);
    assertMatchesSchema(
      response.result.structuredContent,
      tool.outputSchema,
      `${name} response must match outputSchema`,
    );
    if (response.result.structuredContent.status === "error") {
      assert.notEqual(
        schemaError(
          { ...response.result.structuredContent, code: "not-a-real-code" },
          tool.outputSchema,
        ),
        null,
        `${name} must reject undeclared error codes`,
      );
    }
    if (foreignToolErrors[name]) {
      assert.notEqual(
        schemaError(foreignToolErrors[name], tool.outputSchema),
        null,
        `${name} must reject another tool's bounded error`,
      );
    }
    assert.equal(response.result._meta["openai/locale"], "ja");
  }
});

test("declared schemas validate the packaged app's rich success results", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "gitright-contract-success-"));
  await execFile("/usr/bin/git", ["init", "-q", repository]);
  await writeFile(path.join(repository, "contract.txt"), "contract fixture\n");
  await execFile("/usr/bin/git", ["-C", repository, "add", "contract.txt"]);
  await execFile("/usr/bin/git", [
    "-C",
    repository,
    "-c",
    "user.name=GitRight Test",
    "-c",
    "user.email=gitright-test@example.invalid",
    "commit",
    "-q",
    "-m",
    "Contract fixture",
  ]);

  const session = await runPluginConversation(async (request) => {
    const listed = await request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const opened = await request(openRequest(2, "en-US", repository));
    const repositoryState = await request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "get_repository_state", arguments: {} },
    });
    const history = await request({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_history", arguments: {} },
    });
    const snapshot = history.result.structuredContent;
    const detail = await request({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_commit_detail",
        arguments: {
          snapshotId: snapshot.snapshotId,
          commitSha: snapshot.commits[0].sha,
          parentIndex: 0,
        },
      },
    });
    const diff = await request({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_diff",
        arguments: {
          detailId: detail.result.structuredContent.detailId,
          fileId: detail.result.structuredContent.files[0].fileId,
        },
      },
    });
    return { listed, opened, repositoryState, history, detail, diff };
  });
  assert.equal(session.code, 0, session.stderr);
  assert.equal(session.stderr, "");
  const tools = session.value.listed.result.tools;
  const modelVisibleLaunch = JSON.stringify({
    structuredContent: session.value.opened.result.structuredContent,
    content: session.value.opened.result.content,
  });
  const headSha = session.value.history.result.structuredContent.commits[0].sha;
  for (const repositoryData of [
    repository,
    path.basename(repository),
    headSha,
    "Contract fixture",
    "GitRight Test",
    "refs/heads",
    "contract.txt",
    "contract fixture",
  ]) {
    assert.doesNotMatch(modelVisibleLaunch, new RegExp(repositoryData, "i"));
  }
  for (const [name, response] of [
    ["open_gitright", session.value.opened],
    ["get_repository_state", session.value.repositoryState],
    ["get_history", session.value.history],
    ["get_commit_detail", session.value.detail],
    ["get_diff", session.value.diff],
  ]) {
    const schema = tools.find((tool) => tool.name === name).outputSchema;
    assertMatchesSchema(
      response.result.structuredContent,
      schema,
      `${name} success must match outputSchema`,
    );
  }
});
