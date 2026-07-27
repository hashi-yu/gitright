import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const serverInfo = {
  name: "gitright",
  version: "0.1.0-beta.1",
};

const openGitRightTool = {
  name: "open_gitright",
  description: "Open the read-only GitRight distribution proof.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (process.argv[2] === "--diagnostics") {
  const git = spawnSync("/usr/bin/git", ["--version"], {
    encoding: "utf8",
    env: {},
    timeout: 5_000,
  });

  send({
    status: git.status === 0 ? "ok" : "error",
    server: serverInfo,
    architecture: process.arch,
    runtime: { kind: "bun", path: process.execPath, version: Bun.version },
    git: {
      path: "/usr/bin/git",
      version: git.status === 0 ? git.stdout.trim() : "unavailable",
    },
  });
  process.exit(git.status === 0 ? 0 : 69);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on("line", (line) => {
  let request: Record<string, unknown>;

  try {
    request = JSON.parse(line) as Record<string, unknown>;
  } catch {
    process.stderr.write(
      "GitRight could not parse an MCP request; request content was not logged.\n",
    );
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  if (request.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo,
      },
    });
    return;
  }

  if (request.method === "tools/list") {
    send({ jsonrpc: "2.0", id: request.id, result: { tools: [openGitRightTool] } });
    return;
  }

  if (request.method === "tools/call") {
    const params = request.params as
      | { name?: unknown; arguments?: Record<string, unknown> }
      | undefined;
    const argumentsObject = params?.arguments ?? {};
    if (
      params?.name !== openGitRightTool.name ||
      typeof argumentsObject !== "object" ||
      argumentsObject === null ||
      Object.keys(argumentsObject).length !== 0
    ) {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Invalid parameters" },
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        content: [
          {
            type: "text",
            text: "GitRight's architecture-neutral plugin package is running offline.",
          },
        ],
        isError: false,
      },
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
});
