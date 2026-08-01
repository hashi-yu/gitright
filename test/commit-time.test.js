import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  formatCommitTimestamp,
  formatRelativeTime,
} from "../plugins/gitright/widget/commit-time.ts";
import { outputSchemas } from "../plugins/gitright/contract/index.ts";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);

/** Formats one recorded date in a child process with its own timezone and locale. */
function formatUnder(environment, recorded) {
  const script = `
    import { formatCommitTimestamp } from ${JSON.stringify(
      path.join(repositoryRoot, "plugins/gitright/widget/commit-time.ts"),
    )};
    process.stdout.write(formatCommitTimestamp(${JSON.stringify(recorded)}));
  `;
  return execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, ...environment },
    encoding: "utf8",
  });
}

test("shows the recorded instant compactly in the viewer's timezone", () => {
  const recorded = "2026-01-01T00:00:00Z";
  assert.equal(formatCommitTimestamp(recorded, "UTC"), "2026-01-01 00:00");
  assert.equal(formatCommitTimestamp(recorded, "Asia/Tokyo"), "2026-01-01 09:00");
  assert.equal(formatCommitTimestamp(recorded, "America/New_York"), "2025-12-31 19:00");
  assert.equal(
    formatCommitTimestamp("2026-07-13T09:10:11+09:00", "UTC"),
    "2026-07-13 00:10",
  );
});

test("follows the viewer's own timezone when none is given", () => {
  assert.equal(
    formatUnder({ TZ: "UTC" }, "2026-01-01T00:00:00Z"),
    "2026-01-01 00:00",
  );
  assert.equal(
    formatUnder({ TZ: "Asia/Tokyo" }, "2026-01-01T00:00:00Z"),
    "2026-01-01 09:00",
  );
});

test("keeps the compact form identical whatever the viewer's locale is", () => {
  const recorded = "2026-01-01T15:04:00Z";
  const english = formatUnder({ TZ: "Asia/Tokyo", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" }, recorded);
  const japanese = formatUnder({ TZ: "Asia/Tokyo", LANG: "ja_JP.UTF-8", LC_ALL: "ja_JP.UTF-8" }, recorded);
  const arabic = formatUnder({ TZ: "Asia/Tokyo", LANG: "ar_EG.UTF-8", LC_ALL: "ar_EG.UTF-8" }, recorded);
  assert.equal(english, "2026-01-02 00:04");
  assert.equal(japanese, english);
  assert.equal(arabic, english);
});

test("uses a fixed midnight hour and no UTC offset", () => {
  assert.equal(formatCommitTimestamp("2026-03-09T00:00:00Z", "UTC"), "2026-03-09 00:00");
  assert.doesNotMatch(formatCommitTimestamp("2026-03-09T12:00:00+09:00", "Asia/Tokyo"), /[+Z]/);
});

test("shows a date the viewer cannot interpret as recorded", () => {
  assert.equal(formatCommitTimestamp("not a date"), "not a date");
  assert.equal(formatCommitTimestamp("2026-01-01T00:00:00 (approx)"), "2026-01-01 00:00");
});

test("keeps relative time wording unchanged in both locales", () => {
  const snapshot = 1_800_000_000;
  assert.equal(formatRelativeTime(snapshot - 1, snapshot, "en"), "just now");
  assert.equal(formatRelativeTime(snapshot - 60, snapshot, "en"), "1 minute ago");
  assert.equal(formatRelativeTime(snapshot - 120, snapshot, "ja"), "2分前");
  assert.equal(formatRelativeTime(snapshot - 86_400, snapshot, "ja"), "1日前");
  assert.equal(formatRelativeTime(snapshot + 100, snapshot, "en"), "just now");
});

test("the seam carries machine-readable commit time only", () => {
  const advertised = JSON.stringify(outputSchemas);
  assert.equal(advertised.includes("relativeCommitterTime"), false);
  assert.match(advertised, /"committerTime"/);
  const commitDetail = outputSchemas.commitDetail.oneOf[0].properties;
  assert.deepEqual(commitDetail.authorDate, { type: "string" });
  assert.deepEqual(commitDetail.committerDate, { type: "string" });
});

test("the server holds no display formatting for commit time", async () => {
  const sources = await Promise.all(
    ["index.ts", "repository-binding.ts", "history-service.ts", "commit-detail-service.ts"]
      .map((file) =>
        readFile(path.join(repositoryRoot, "plugins/gitright/server", file), "utf8")
      ),
  );
  const server = sources.join("\n");
  assert.equal(server.includes("Intl"), false);
  assert.equal(server.includes("defaultLocalDate"), false);
  assert.equal(server.includes("relativeCommitterTime"), false);
  // Git's date-output compatibility knowledge stays next to Git.
  assert.match(server, /canonicalGitDate/);
});
