import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import {
  changedFilePageOutputSchema,
  commitDetailOutputSchema,
  fileDiffOutputSchema,
  historyOutputSchema,
  historyPageOutputSchema,
  launchOutputSchema,
  repositoryStateOutputSchema,
} from "./apps-sdk-contract.ts";
import { createCommitDetailService } from "./commit-detail-service.ts";
import { createHistoryService } from "./history-service.ts";
import {
  createRepositoryBinding,
  systemGitDiagnostics,
  type RepositoryState,
} from "./repository-binding.ts";

declare const Bun: { version: string };

const serverInfo = {
  name: "gitright",
  version: "0.1.0-beta.2",
};

const widgetUri = "ui://gitright/repository-state-v2.html";
const widgetMimeType = "text/html;profile=mcp-app";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

type SupportedLocale = "en" | "ja";

function resolvedLocale(params: unknown): SupportedLocale {
  const locale = (
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as { _meta?: Record<string, unknown> })._meta?.["openai/locale"]
      : undefined
  );
  if (typeof locale !== "string" || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(locale)) {
    return "en";
  }

  const available = new Set<SupportedLocale>(["en", "ja"]);
  const subtags = locale.toLowerCase().split("-");
  while (subtags.length > 0) {
    const candidate = subtags.join("-");
    if (available.has(candidate as SupportedLocale)) return candidate as SupportedLocale;
    subtags.pop();
    if (subtags.at(-1)?.length === 1) subtags.pop();
  }
  return "en";
}

function launchPresentation(state: RepositoryState): {
  structuredContent: { outcome: "opened" | "unavailable" | "unsupported"; reasonCode?: string };
  text: string;
} {
  if (state.status === "ready") {
    return {
      structuredContent: { outcome: "opened" },
      text: "Opened GitRight's read-only repository view.",
    };
  }
  if (state.status === "unavailable") {
    return {
      structuredContent: {
        outcome: "unavailable",
        reasonCode: "repository-unavailable",
      },
      text: "GitRight is unavailable for this task.",
    };
  }

  const reasonCode = state.status === "unsupported"
    ? {
        "Bare repositories are not supported in this version": "bare-repository",
        "Partial clones are not supported in this version": "partial-clone",
        "SHA-256 repositories are not supported in this version": "sha256-repository",
      }[state.message]
    : state.status === "ownership-refused"
      ? "ownership-refused"
      : "git-version-blocked";
  return {
    structuredContent: { outcome: "unsupported", reasonCode },
    text: "GitRight cannot open this repository type.",
  };
}

const openGitRightTool = {
  name: "open_gitright",
  title: "Open GitRight",
  description:
    "Open GitRight's read-only repository view for the current repository-linked task. Use for requests such as 'Open GitRight', 'Show this repository's history in GitRight', or 'Gitの履歴を表示して'. Do not use for generic Git questions such as 'What is git rebase?' or requests to run Git commands.",
  inputSchema: emptyInputSchema,
  outputSchema: launchOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      resourceUri: widgetUri,
      visibility: ["model"],
    },
    "openai/outputTemplate": widgetUri,
  },
};

const getRepositoryStateTool = {
  name: "get_repository_state",
  title: "Get repository state",
  description: "Return the pinned GitRight repository boundary state to the mounted app.",
  inputSchema: emptyInputSchema,
  outputSchema: repositoryStateOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      visibility: ["app"],
    },
  },
};

const getHistoryTool = {
  name: "get_history",
  title: "Get history",
  description:
    "Return the current pinned available-history snapshot, or explicitly refresh it for the mounted app.",
  inputSchema: {
    oneOf: [
      emptyInputSchema,
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
  },
  outputSchema: historyOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      visibility: ["app"],
    },
  },
};

const loadMoreTool = {
  name: "load_more",
  title: "Load more history",
  description:
    "Append the next stable page from the mounted app's pinned history snapshot.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: { type: "string", pattern: "^[0-9a-f]{64}$" },
      refFingerprint: { type: "string", pattern: "^[0-9a-f]{64}$" },
      loadedCount: { type: "integer", minimum: 0, maximum: 100000 },
      lastCommitSha: {
        anyOf: [
          { type: "string", pattern: "^[0-9a-f]{40}$" },
          { type: "null" },
        ],
      },
    },
    required: [
      "snapshotId",
      "refFingerprint",
      "loadedCount",
      "lastCommitSha",
    ],
    additionalProperties: false,
  },
  outputSchema: historyPageOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      visibility: ["app"],
    },
  },
};

const getCommitDetailTool = {
  name: "get_commit_detail",
  title: "Get commit detail",
  description:
    "Return sanitized metadata and the first changed-file page for one loaded commit and parent.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: { type: "string", pattern: "^[0-9a-f]{64}$" },
      commitSha: { type: "string", pattern: "^[0-9a-f]{40}$" },
      parentIndex: { type: "integer", minimum: 0, maximum: 999 },
    },
    required: ["snapshotId", "commitSha", "parentIndex"],
    additionalProperties: false,
  },
  outputSchema: commitDetailOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      visibility: ["app"],
    },
  },
};

const loadMoreFilesTool = {
  name: "load_more_files",
  title: "Load more changed files",
  description:
    "Append the next changed-file page for the mounted app's current commit detail.",
  inputSchema: {
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
  },
  outputSchema: changedFilePageOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      visibility: ["app"],
    },
  },
};

const getDiffTool = {
  name: "get_diff",
  title: "Get file diff",
  description:
    "Return the bounded unified diff for one server-issued changed-file entry in the current commit detail.",
  inputSchema: {
    type: "object",
    properties: {
      detailId: { type: "string", pattern: "^[0-9a-f]{64}$" },
      fileId: { type: "string", pattern: "^[0-9a-f]{64}$" },
    },
    required: ["detailId", "fileId"],
    additionalProperties: false,
  },
  outputSchema: fileDiffOutputSchema,
  annotations: readOnlyAnnotations,
  _meta: {
    ui: {
      visibility: ["app"],
    },
  },
};

const repositoryBinding = createRepositoryBinding();
const historyService = createHistoryService();
const commitDetailService = createCommitDetailService();

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function validEmptyArguments(params: unknown): boolean {
  if (!params || typeof params !== "object") return false;
  const argumentsObject = (params as { arguments?: unknown }).arguments ?? {};
  return (
    typeof argumentsObject === "object" &&
    argumentsObject !== null &&
    !Array.isArray(argumentsObject) &&
    Object.keys(argumentsObject).length === 0
  );
}

function argumentsObject(params: unknown): Record<string, unknown> | null {
  if (!params || typeof params !== "object") return null;
  const value = (params as { arguments?: unknown }).arguments ?? {};
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function refreshArguments(
  params: unknown,
): { snapshotId: string; selectedSha: string | null } | null {
  const value = argumentsObject(params);
  if (!value || Object.keys(value).some((key) => !["refresh", "snapshotId", "selectedSha"].includes(key))) {
    return null;
  }
  if (
    value.refresh !== true ||
    typeof value.snapshotId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.snapshotId) ||
    !(value.selectedSha === null || (
      typeof value.selectedSha === "string" && /^[0-9a-f]{40}$/.test(value.selectedSha)
    ))
  ) {
    return null;
  }
  return { snapshotId: value.snapshotId, selectedSha: value.selectedSha };
}

function loadMoreArguments(params: unknown): {
  snapshotId: string;
  refFingerprint: string;
  loadedCount: number;
  lastCommitSha: string | null;
} | null {
  const value = argumentsObject(params);
  if (
    !value ||
    Object.keys(value).length !== 4 ||
    typeof value.snapshotId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.snapshotId) ||
    typeof value.refFingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.refFingerprint) ||
    !Number.isSafeInteger(value.loadedCount) ||
    (value.loadedCount as number) < 0 ||
    (value.loadedCount as number) > 100_000 ||
    !(value.lastCommitSha === null || (
      typeof value.lastCommitSha === "string" && /^[0-9a-f]{40}$/.test(value.lastCommitSha)
    ))
  ) {
    return null;
  }
  return {
    snapshotId: value.snapshotId,
    refFingerprint: value.refFingerprint,
    loadedCount: value.loadedCount as number,
    lastCommitSha: value.lastCommitSha,
  };
}

function commitDetailArguments(params: unknown): {
  snapshotId: string;
  commitSha: string;
  parentIndex: number;
} | null {
  const value = argumentsObject(params);
  if (
    !value ||
    Object.keys(value).length !== 3 ||
    typeof value.snapshotId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.snapshotId) ||
    typeof value.commitSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(value.commitSha) ||
    !Number.isSafeInteger(value.parentIndex) ||
    (value.parentIndex as number) < 0 ||
    (value.parentIndex as number) > 999
  ) {
    return null;
  }
  return {
    snapshotId: value.snapshotId,
    commitSha: value.commitSha,
    parentIndex: value.parentIndex as number,
  };
}

function changedFilePageArguments(params: unknown): {
  detailId: string;
  loadedCount: number;
  lastFileId: string | null;
} | null {
  const value = argumentsObject(params);
  if (
    !value ||
    Object.keys(value).length !== 3 ||
    typeof value.detailId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.detailId) ||
    !Number.isSafeInteger(value.loadedCount) ||
    (value.loadedCount as number) < 0 ||
    (value.loadedCount as number) > 100_000 ||
    !(value.lastFileId === null || (
      typeof value.lastFileId === "string" && /^[0-9a-f]{64}$/.test(value.lastFileId)
    ))
  ) {
    return null;
  }
  return {
    detailId: value.detailId,
    loadedCount: value.loadedCount as number,
    lastFileId: value.lastFileId,
  };
}

function fileDiffArguments(params: unknown): {
  detailId: string;
  fileId: string;
} | null {
  const value = argumentsObject(params);
  if (
    !value ||
    Object.keys(value).length !== 2 ||
    typeof value.detailId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.detailId) ||
    typeof value.fileId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.fileId)
  ) {
    return null;
  }
  return { detailId: value.detailId, fileId: value.fileId };
}

function widgetHtml(): string {
  const script = readFileSync(new URL("./widget.js", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./widget.css", import.meta.url), "utf8");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'">
    <title>GitRight</title>
    <style>${styles}</style>
  </head>
  <body>
    <div id="gitright-root"></div>
    <script>${script}</script>
  </body>
</html>`;
}

if (process.argv[2] === "--diagnostics") {
  const git = await systemGitDiagnostics();

  send({
    status: git.status,
    server: serverInfo,
    architecture: process.arch,
    runtime: { kind: "bun", version: Bun.version },
    git: {
      version: git.version,
      durationMs: git.durationMs,
      errorCode: git.errorCode,
    },
  });
  process.exit(git.status === "ok" ? 0 : 69);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

type ParsedRequest =
  | { status: "ready"; request: Record<string, unknown> }
  | { status: "parse-error" };

function parseRequest(line: string): ParsedRequest {
  try {
    const value = JSON.parse(line) as unknown;
    return {
      status: "ready",
      request: value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {},
    };
  } catch {
    return { status: "parse-error" };
  }
}

async function handleRequest(parsed: ParsedRequest): Promise<void> {
  if (parsed.status === "parse-error") {
    process.stderr.write(
      "GitRight could not parse an MCP request; request content was not logged.\n",
    );
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const request = parsed.request;

  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo,
      },
    });
    return;
  }

  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: [
          openGitRightTool,
          getRepositoryStateTool,
          getHistoryTool,
          loadMoreTool,
          getCommitDetailTool,
          loadMoreFilesTool,
          getDiffTool,
        ],
      },
    });
    return;
  }

  if (request.method === "resources/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        resources: [
          {
            uri: widgetUri,
            name: "GitRight v2 app",
            mimeType: widgetMimeType,
          },
        ],
      },
    });
    return;
  }

  if (request.method === "resources/read") {
    const uri = (request.params as { uri?: unknown } | undefined)?.uri;
    if (uri !== widgetUri) {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Unknown resource" },
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        contents: [
          {
            uri: widgetUri,
            mimeType: widgetMimeType,
            text: widgetHtml(),
            _meta: {
              "openai/widgetDescription":
                "Browse read-only Git history, commit details, changed files, and diffs in GitRight.",
              ui: {
                prefersBorder: false,
                csp: {
                  connectDomains: [],
                  resourceDomains: [],
                  frameDomains: [],
                },
              },
            },
          },
        ],
      },
    });
    return;
  }

  if (request.method === "tools/call") {
    const params = request.params as { name?: unknown } | undefined;

    if (params?.name === openGitRightTool.name) {
      if (!validEmptyArguments(params)) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const state = await repositoryBinding.open(params);
      const presentation = launchPresentation(state);
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: presentation.structuredContent,
          content: [{ type: "text", text: presentation.text }],
          _meta: {
            repositoryState: state,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    if (params?.name === getRepositoryStateTool.name) {
      if (!validEmptyArguments(params)) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const state = repositoryBinding.current();
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: state,
          content: [],
          _meta: {
            repositoryState: state,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    if (params?.name === getHistoryTool.name) {
      const pinnedRepository = repositoryBinding.pinnedRepository();
      const refresh = refreshArguments(params);
      const empty = validEmptyArguments(params);
      if (!empty && !refresh) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const snapshot = !pinnedRepository
        ? {
            status: "error" as const,
            message: "History is unavailable" as const,
            code: "repository-unavailable",
          }
        : refresh
          ? await historyService.refresh(pinnedRepository, refresh)
          : await historyService.load(pinnedRepository);
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: snapshot,
          content: [],
          _meta: {
            historyStatus: snapshot.status,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    if (params?.name === loadMoreTool.name) {
      const pinnedRepository = repositoryBinding.pinnedRepository();
      const pageRequest = loadMoreArguments(params);
      if (!pageRequest) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const page = pinnedRepository
        ? await historyService.loadMore(pinnedRepository, pageRequest)
        : {
            status: "error" as const,
            message: "History is unavailable" as const,
            code: "repository-unavailable",
          };
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: page,
          content: [],
          _meta: {
            historyStatus: page.status,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    if (params?.name === getCommitDetailTool.name) {
      const detailRequest = commitDetailArguments(params);
      if (!detailRequest) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const pinnedRepository = repositoryBinding.pinnedRepository();
      const loadedCommit = historyService.loadedCommit(
        detailRequest.snapshotId,
        detailRequest.commitSha,
      );
      const detail = !pinnedRepository
        ? {
            status: "error" as const,
            message: "Commit detail is unavailable" as const,
            code: "repository-unavailable",
          }
        : !loadedCommit
          ? {
              status: "error" as const,
              message: "Commit detail request is stale" as const,
              code: "stale-detail",
            }
          : await commitDetailService.load(
              pinnedRepository,
              {
                snapshotId: detailRequest.snapshotId,
                parentIndex: detailRequest.parentIndex,
              },
              loadedCommit,
            );
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: detail,
          content: [],
          _meta: {
            detailStatus: detail.status,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    if (params?.name === loadMoreFilesTool.name) {
      const pageRequest = changedFilePageArguments(params);
      if (!pageRequest) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const pinnedRepository = repositoryBinding.pinnedRepository();
      const page = pinnedRepository
        ? await commitDetailService.loadMoreFiles(pinnedRepository, pageRequest)
        : {
            status: "error" as const,
            message: "Commit detail is unavailable" as const,
            code: "repository-unavailable",
          };
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: page,
          content: [],
          _meta: {
            detailStatus: page.status,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    if (params?.name === getDiffTool.name) {
      const diffRequest = fileDiffArguments(params);
      if (!diffRequest) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32602, message: "Invalid parameters" },
        });
        return;
      }
      const pinnedRepository = repositoryBinding.pinnedRepository();
      const diff = pinnedRepository
        ? await commitDetailService.loadDiff(pinnedRepository, diffRequest)
        : {
            status: "error" as const,
            message: "File diff is unavailable" as const,
            code: "repository-unavailable",
            detailId: diffRequest.detailId,
            fileId: diffRequest.fileId,
            path: null,
          };
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          structuredContent: diff,
          content: [],
          _meta: {
            diffStatus: diff.status,
            "openai/locale": resolvedLocale(params),
          },
          isError: false,
        },
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32602, message: "Invalid parameters" },
    });
    return;
  }

  if (typeof request.id !== "undefined") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "Method not found" },
    });
  }
}

let requestQueue = Promise.resolve();
let refreshQueued = false;

function queuedRefreshCall(
  request: Record<string, unknown>,
): { id: unknown; locale: SupportedLocale } | null {
  const params = request.params as { name?: unknown } | undefined;
  return request.method === "tools/call" &&
    params?.name === getHistoryTool.name &&
    refreshArguments(params)
    ? { id: request.id, locale: resolvedLocale(params) }
    : null;
}

lines.on("line", (line) => {
  const parsed = parseRequest(line);
  const refreshCall = parsed.status === "ready"
    ? queuedRefreshCall(parsed.request)
    : null;
  if (refreshCall && refreshQueued) {
    send({
      jsonrpc: "2.0",
      id: refreshCall.id,
      result: {
        structuredContent: {
          status: "error",
          message: "History refresh is already in progress",
          code: "refresh-in-progress",
        },
        content: [],
        _meta: {
          historyStatus: "error",
          "openai/locale": refreshCall.locale,
        },
        isError: false,
      },
    });
    return;
  }
  if (refreshCall) refreshQueued = true;
  requestQueue = requestQueue
    .then(() => handleRequest(parsed))
    .catch(() => {
      process.stderr.write("GitRight encountered a bounded MCP processing error.\n");
    })
    .finally(() => {
      if (refreshCall) refreshQueued = false;
    });
});
