import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpClient } from "./mcp-client.js";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const pluginRoot = path.join(repositoryRoot, "plugins/gitright");
const launcher = path.join(pluginRoot, "dist/launch");

export async function runPluginRequests(requests) {
  const root = await mkdtemp(path.join(tmpdir(), "gitright-plugin-process-"));

  return await new Promise((resolve, reject) => {
    const child = spawn(launcher, [], {
      cwd: pluginRoot,
      env: { HOME: path.join(root, "home"), PATH: process.env.PATH },
    });
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
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
  });
}

export async function runPluginConversation(interact) {
  const root = await mkdtemp(path.join(tmpdir(), "gitright-plugin-process-"));
  const child = spawn(launcher, [], {
    cwd: pluginRoot,
    env: { HOME: path.join(root, "home"), PATH: process.env.PATH },
  });
  const client = createMcpClient({
    input: child.stdout,
    output: child.stdin,
    closedError: () => new Error("plugin process closed before responding"),
    rejectPendingOnInvalidJson: false,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      client.processClosed({ code, signal });
      resolve({ code, signal });
    });
  });

  try {
    const value = await interact(client.sendRequest);
    child.stdin.end();
    const closed = await completion;
    return { ...closed, stderr, value };
  } catch (error) {
    child.stdin.end();
    await completion;
    throw error;
  }
}
