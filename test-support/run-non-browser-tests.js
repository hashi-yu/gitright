import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(repositoryRoot, "test");
const testFiles = readdirSync(testDirectory)
  .filter((file) => file.endsWith(".test.js") && file !== "packaged-app-host.test.js")
  .sort()
  .map((file) => path.join("test", file));

if (testFiles.length === 0) {
  throw new Error("no non-browser tests found");
}

const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...testFiles],
  { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
