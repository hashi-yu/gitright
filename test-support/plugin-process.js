import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

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
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  function request(message) {
    return new Promise((resolve, reject) => {
      if (waiters.has(message.id)) {
        reject(new Error(`duplicate request id: ${message.id}`));
        return;
      }
      waiters.set(message.id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      for (const waiter of waiters.values()) {
        waiter.reject(new Error("plugin process closed before responding"));
      }
      waiters.clear();
      resolve({ code, signal });
    });
  });

  try {
    const value = await interact(request);
    child.stdin.end();
    const closed = await completion;
    return { ...closed, stderr, value };
  } catch (error) {
    child.stdin.end();
    await completion;
    throw error;
  }
}
