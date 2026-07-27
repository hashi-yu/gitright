import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { startPackagedAppHost } from "../test-support/packaged-app-host.js";

const execFile = promisify(execFileCallback);

async function waitUntil(predicate, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function contrastRatios(locator, queries) {
  return locator.evaluate((root, requestedQueries) => {
    const channels = (value) => {
      const values = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!values || values.length !== 3) throw new Error(`unsupported computed color: ${value}`);
      return values.map((channel) => channel / 255);
    };
    const luminance = (value) => channels(value)
      .map((channel) => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return requestedQueries.flatMap((query) => {
      const elements = query.selector ? [...root.querySelectorAll(query.selector)] : [root];
      return elements.map((element) => {
        const styles = getComputedStyle(element);
        const foregroundValue = query.foregroundProperties
          .map((property) => styles[property])
          .find((value) => value && value !== "none");
        if (!foregroundValue) throw new Error("contrast target has no foreground color");
        const backgroundElement = query.backgroundClosest
          ? element.closest(query.backgroundClosest)
          : element;
        if (!backgroundElement) throw new Error("contrast target has no background element");
        const foreground = luminance(foregroundValue);
        const background = luminance(
          getComputedStyle(backgroundElement)[query.backgroundProperty],
        );
        return (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05);
      });
    });
  }, queries);
}

async function computedContrast(locator, foregroundProperty = "color", backgroundProperty = "backgroundColor") {
  const [ratio] = await contrastRatios(locator, [{
    foregroundProperties: [foregroundProperty],
    backgroundProperty,
  }]);
  return ratio;
}

async function graphContrasts(widget) {
  return contrastRatios(widget.locator(".graph-commit-list"), [{
    selector: ".graph-path-color, .graph-node",
    foregroundProperties: ["stroke", "fill"],
    backgroundClosest: ".gr-row",
    backgroundProperty: "backgroundColor",
  }]);
}

function toolCallNames(host) {
  return host.messages
    .filter(({ message }) => message.method === "tools/call")
    .map(({ message }) => message.params.name);
}

function commitDetailRequests(host) {
  return host.messages
    .filter(({ message }) =>
      message.method === "tools/call" && message.params.name === "get_commit_detail"
    )
    .map(({ message }) => message.params.arguments.commitSha);
}

async function waitForSheetCommit(widget, sha) {
  await widget.locator(".gr-sha code", { hasText: sha }).waitFor();
}

async function revParse(repository, reference) {
  return (await execFile("/usr/bin/git", ["-C", repository, "rev-parse", reference]))
    .stdout.trim();
}

async function execFileWithInput(file, args, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function createRepository({
  commitCount = 1,
  changedFileCount = 1,
  empty = false,
  includeLongChangedFilePath = false,
  includeMerge = false,
  includeOctopus = false,
} = {}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "gitright-browser-host-"));
  const repository = path.join(temporaryRoot, "repository");
  await mkdir(repository);
  await execFile("/usr/bin/git", ["init", "-q", "-b", "main", repository]);
  if (empty) return repository;
  await writeFile(path.join(repository, "fixture.txt"), "browser host fixture\n");
  await Promise.all(Array.from({ length: changedFileCount - 1 }, (_, index) =>
    writeFile(
      path.join(repository, `fixture-${String(index + 2).padStart(3, "0")}.txt`),
      `browser host fixture ${index + 2}\n`,
    )
  ));
  if (includeLongChangedFilePath) {
    const longPath = path.join(
      repository,
      "docs",
      "examples",
      "product-verification",
      "very-long-changed-file-viewport-fixture.json",
    );
    await mkdir(path.dirname(longPath), { recursive: true });
    await writeFile(longPath, "narrow changed-file layout fixture\n");
  }
  await execFile("/usr/bin/git", ["-C", repository, "add", "."]);
  await execFile(
    "/usr/bin/git",
    [
      "-C",
      repository,
      "-c",
      "user.name=GitRight Test",
      "-c",
      "user.email=gitright-test@example.invalid",
      "commit",
      "-q",
      "-m",
      "Browser host fixture",
    ],
    {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
      },
    },
  );
  if (commitCount > 1) {
    const firstSha = (await execFile("/usr/bin/git", ["-C", repository, "rev-parse", "HEAD"]))
      .stdout.trim();
    const commands = [];
    let parent = firstSha;
    for (let index = 2; index <= commitCount; index += 1) {
      const mark = `:${index}`;
      const message = `Browser history fixture ${index}`;
      const content = `browser host fixture ${index}\n`;
      commands.push(
        "commit refs/heads/main",
        `mark ${mark}`,
        `author GitRight Test <gitright-test@example.invalid> ${1767225600 + index} +0000`,
        `committer GitRight Test <gitright-test@example.invalid> ${1767225600 + index} +0000`,
        `data ${Buffer.byteLength(message)}`,
        message,
        `from ${parent}`,
        "M 100644 inline fixture.txt",
        `data ${Buffer.byteLength(content)}`,
        content,
        "",
      );
      parent = mark;
    }
    commands.push("done", "");
    await execFileWithInput(
      "/usr/bin/git",
      ["-C", repository, "fast-import", "--quiet"],
      commands.join("\n"),
    );
  }
  if (includeMerge) {
    // Distinct committer times keep the topological order between the two
    // merge parents deterministic (equal times tie-break on full SHA).
    const datedEnv = (date) => ({
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
    await execFile("/usr/bin/git", ["-C", repository, "checkout", "-q", "-b", "side"]);
    await writeFile(path.join(repository, "side.txt"), "side branch\n");
    await execFile("/usr/bin/git", ["-C", repository, "add", "side.txt"]);
    await execFile(
      "/usr/bin/git",
      [
        "-C",
        repository,
        "-c",
        "user.name=GitRight Test",
        "-c",
        "user.email=gitright-test@example.invalid",
        "commit",
        "-q",
        "-m",
        "Browser side fixture",
      ],
      datedEnv("2026-01-02T00:00:00Z"),
    );
    await execFile("/usr/bin/git", ["-C", repository, "checkout", "-q", "main"]);
    await writeFile(path.join(repository, "main.txt"), "main branch\n");
    await execFile("/usr/bin/git", ["-C", repository, "add", "main.txt"]);
    await execFile(
      "/usr/bin/git",
      [
        "-C",
        repository,
        "-c",
        "user.name=GitRight Test",
        "-c",
        "user.email=gitright-test@example.invalid",
        "commit",
        "-q",
        "-m",
        "Browser main fixture",
      ],
      datedEnv("2026-01-03T00:00:00Z"),
    );
    await execFile(
      "/usr/bin/git",
      [
        "-C",
        repository,
        "-c",
        "user.name=GitRight Test",
        "-c",
        "user.email=gitright-test@example.invalid",
        "merge",
        "-q",
        "--no-ff",
        "side",
        "-m",
        "Browser merge fixture",
      ],
      datedEnv("2026-01-04T00:00:00Z"),
    );
  }
  if (includeOctopus) {
    const baseSha = (await execFile("/usr/bin/git", ["-C", repository, "rev-parse", "HEAD"]))
      .stdout.trim();
    const branches = [];
    for (let index = 1; index <= 20; index += 1) {
      const branch = `octopus-${String(index).padStart(2, "0")}`;
      const file = `branch-${String(index).padStart(2, "0")}.txt`;
      branches.push(branch);
      await execFile("/usr/bin/git", ["-C", repository, "checkout", "-q", "-b", branch, baseSha]);
      await writeFile(path.join(repository, file), `${branch}\n`);
      await execFile("/usr/bin/git", ["-C", repository, "add", file]);
      await execFile(
        "/usr/bin/git",
        [
          "-C",
          repository,
          "-c",
          "user.name=GitRight Test",
          "-c",
          "user.email=gitright-test@example.invalid",
          "commit",
          "-q",
          "-m",
          `Browser ${branch} fixture`,
        ],
      );
    }
    await execFile("/usr/bin/git", ["-C", repository, "checkout", "-q", "main"]);
    await execFile(
      "/usr/bin/git",
      [
        "-C",
        repository,
        "-c",
        "user.name=GitRight Test",
        "-c",
        "user.email=gitright-test@example.invalid",
        "merge",
        "-q",
        "--no-ff",
        ...branches,
        "-m",
        "Browser octopus fixture",
      ],
    );
  }
  return repository;
}

test("packaged browser fixture creates one 501-commit continuation boundary", async () => {
  const repository = await createRepository({ commitCount: 501 });
  const count = await execFile("/usr/bin/git", ["-C", repository, "rev-list", "--count", "HEAD"]);
  assert.equal(count.stdout.trim(), "501");
});

test("packaged browser octopus fixture exposes a horizontally scrollable parent fan-out", async () => {
  const repository = await createRepository({ includeOctopus: true });
  const head = await execFile("/usr/bin/git", ["-C", repository, "rev-list", "--parents", "-n", "1", "HEAD"]);
  assert.equal(head.stdout.trim().split(" ").length, 22);
  const parentTwoDiff = await execFile(
    "/usr/bin/git",
    ["-C", repository, "diff", "--name-only", "HEAD^2", "HEAD"],
  );
  assert.match(parentTwoDiff.stdout, /^branch-02\.txt$/m);
});

test("packaged app host restores and minimizes widget state across remounts", async () => {
  const repository = await createRepository({ commitCount: 20 });
  const selectedSha = await revParse(repository, "HEAD~1");
  const headSha = await revParse(repository, "HEAD");
  const validState = {
    version: 1,
    mode: "text",
    query: "Browser",
    selectedSha,
    launcherHandoff: false,
  };
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { displayMode: "fullscreen" },
    widgetState: validState,
  });

  const widgetStateMessages = () => host.messages.filter(
    ({ direction, message }) =>
      direction === "widget-to-host" && message.method === "host/set-widget-state",
  );
  const waitForSynchronizedState = async (previousCount) => {
    await waitUntil(
      () => widgetStateMessages().length > previousCount,
      "widget state did not synchronize after remount",
    );
    return widgetStateMessages().at(-1).message.params.widgetState;
  };
  const assertExactStateBoundary = (state, expected) => {
    assert.deepEqual(state, expected);
    assert.deepEqual(
      Object.keys(state).sort(),
      ["launcherHandoff", "mode", "query", "selectedSha", "version"],
    );
    for (const prohibited of [
      "repository",
      "history",
      "message",
      "author",
      "refs",
      "path",
      "parentIndex",
      "fileId",
      "diff",
      "status",
      "scrollTop",
      "graphScrollLeft",
      "matchCursor",
    ]) {
      assert.equal(prohibited in state, false);
    }
  };

  try {
    await host.widget.getByRole("heading", { name: "Text topology" }).waitFor();
    assert.equal(
      await host.widget.getByLabel("Search loaded commits (subject, SHA, or ref)").inputValue(),
      "Browser",
    );
    // The persisted selection wins over the HEAD default...
    assert.equal(
      await host.widget.locator(`[data-commit-sha="${selectedSha}"]`)
        .getAttribute("aria-selected"),
      "true",
    );
    // ...and the persistent sheet is populated with that commit from mount.
    await waitForSheetCommit(host.widget, selectedSha);
    assertExactStateBoundary(await waitForSynchronizedState(0), validState);
    assert.deepEqual(toolCallNames(host), ["get_history", "get_commit_detail"]);
    assert.deepEqual(commitDetailRequests(host), [selectedSha]);

    // Selecting another row updates the sheet in place; there is no
    // drill-down navigation and the topology heading never leaves.
    let previousCount = widgetStateMessages().length;
    await host.widget.locator(`[data-commit-sha="${headSha}"]`).click();
    await waitForSheetCommit(host.widget, headSha);
    assert.equal(
      await host.widget.getByRole("heading", { name: "Text topology" }).isVisible(),
      true,
    );
    assertExactStateBoundary(await waitForSynchronizedState(previousCount), {
      ...validState,
      selectedSha: headSha,
    });

    previousCount = widgetStateMessages().length;
    await host.widget.getByRole("button", { name: "Graph" }).click();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    const exactUnicodeQuery = "🙂".repeat(256);
    await host.widget.getByLabel("Search loaded commits (subject, SHA, or ref)")
      .fill(`${exactUnicodeQuery}extra`);
    await waitUntil(
      () => {
        const state = widgetStateMessages().at(-1)?.message.params.widgetState;
        return state?.mode === "graph" &&
          state.query === exactUnicodeQuery &&
          state.selectedSha === headSha;
      },
      "meaningful view changes did not synchronize as bounded widget state",
    );
    assert.equal(widgetStateMessages().length > previousCount, true);
    assertExactStateBoundary(widgetStateMessages().at(-1).message.params.widgetState, {
      version: 1,
      mode: "graph",
      query: exactUnicodeQuery,
      selectedSha: headSha,
      launcherHandoff: false,
    });

    // An unknown persisted SHA falls back to the HEAD default selection.
    previousCount = widgetStateMessages().length;
    await host.setWidgetState({
      version: 1,
      mode: "graph",
      query: "",
      selectedSha: "f".repeat(40),
    });
    await host.remount();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    await waitForSheetCommit(host.widget, headSha);
    assert.equal(await host.widget.locator('[aria-selected="true"][data-commit-sha]').count(), 1);
    assert.equal(
      await host.widget.locator('[aria-selected="true"][data-commit-sha]')
        .getAttribute("data-commit-sha"),
      headSha,
    );
    assertExactStateBoundary(await waitForSynchronizedState(previousCount), {
      version: 1,
      mode: "graph",
      query: "",
      selectedSha: headSha,
      launcherHandoff: false,
    });

    // Garbage state resets to defaults plus the HEAD auto-selection.
    previousCount = widgetStateMessages().length;
    await host.setWidgetState({
      version: 99,
      mode: "text",
      query: "q".repeat(257),
      selectedSha: "invalid",
      repository: repository,
      message: "must not survive",
      path: "fixture.txt",
      parentIndex: 4,
      fileId: "secret",
      diff: "secret",
      status: "loading",
      scrollTop: 900,
      graphScrollLeft: 300,
    });
    await host.remount();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    assert.equal(
      await host.widget.getByLabel("Search loaded commits (subject, SHA, or ref)").inputValue(),
      "",
    );
    await waitForSheetCommit(host.widget, headSha);
    assertExactStateBoundary(await waitForSynchronizedState(previousCount), {
      version: 1,
      mode: "graph",
      query: "",
      selectedSha: headSha,
      launcherHandoff: false,
    });

    previousCount = widgetStateMessages().length;
    await host.setWidgetState(null);
    await host.remount();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    await waitForSheetCommit(host.widget, headSha);
    assertExactStateBoundary(await waitForSynchronizedState(previousCount), {
      version: 1,
      mode: "graph",
      query: "",
      selectedSha: headSha,
      launcherHandoff: false,
    });

    assert.equal(
      host.messages.some(({ message }) =>
        message.method === "ui/update-model-context" || message.method === "ui/message"
      ),
      false,
    );
  } finally {
    await host.close();
  }
});

test("packaged app host sends only an explicitly handed-off commit SHA", async () => {
  const repository = await createRepository({ commitCount: 2 });
  const firstSha = await revParse(repository, "HEAD~1");
  const secondSha = await revParse(repository, "HEAD");
  const contextUpdates = (host) => host.messages.filter(
    ({ direction, message }) =>
      direction === "widget-to-host" && message.method === "ui/update-model-context",
  );
  const sentMessages = (host) => host.messages.filter(
    ({ direction, message }) =>
      direction === "widget-to-host" && message.method === "ui/message",
  );

  const supportedHost = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { displayMode: "fullscreen", locale: "ja-JP" },
    hostCapabilities: { updateModelContext: { text: {} } },
  });
  try {
    await supportedHost.widget.getByRole("heading", { name: "グラフトポロジー" }).waitFor();
    // The sheet auto-populates with HEAD, but nothing is sent implicitly.
    await waitForSheetCommit(supportedHost.widget, secondSha);
    const handoff = supportedHost.widget.getByRole("button", {
      name: "コミットSHAを会話で使う",
    });
    await handoff.waitFor();
    assert.equal(contextUpdates(supportedHost).length, 0);

    await supportedHost.widget.locator(`[data-commit-sha="${firstSha}"]`).click();
    await waitForSheetCommit(supportedHost.widget, firstSha);
    await waitUntil(
      () => handoff.isEnabled(),
      "the selected commit handoff did not unlock",
    );
    assert.equal(contextUpdates(supportedHost).length, 0);
    await handoff.click();
    await supportedHost.widget.getByText(
      "コミットSHAを会話コンテキストに追加しました。",
      { exact: true },
    ).waitFor();
    await waitUntil(
      () => contextUpdates(supportedHost).length === 1,
      "one explicit handoff did not emit exactly one context update",
    );
    assert.deepEqual(contextUpdates(supportedHost)[0].message.params, {
      content: [{ type: "text", text: firstSha }],
    });
    assert.equal(sentMessages(supportedHost).length, 0);

    // Selecting another commit resets the handoff status and still
    // requires one new explicit activation.
    await supportedHost.widget.locator(`[data-commit-sha="${secondSha}"]`).click();
    await waitForSheetCommit(supportedHost.widget, secondSha);
    assert.equal(
      await supportedHost.widget.getByText(
        "コミットSHAを会話コンテキストに追加しました。",
        { exact: true },
      ).count(),
      0,
    );
    assert.equal(contextUpdates(supportedHost).length, 1);
    await waitUntil(
      () => handoff.isEnabled(),
      "the newly selected commit handoff did not unlock",
    );
    await handoff.click();
    await waitUntil(
      () => contextUpdates(supportedHost).length === 2,
      "a newly selected commit did not require one new explicit handoff",
    );
    assert.deepEqual(contextUpdates(supportedHost)[1].message.params, {
      content: [{ type: "text", text: secondSha }],
    });
    assert.equal(sentMessages(supportedHost).length, 0);
  } finally {
    await supportedHost.close();
  }

  const unsupportedHost = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { displayMode: "fullscreen", locale: "en-US" },
    hostCapabilities: {},
  });
  try {
    await unsupportedHost.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    await waitForSheetCommit(unsupportedHost.widget, secondSha);
    // Without the updateModelContext capability the handoff block does not
    // render at all.
    assert.equal(
      await unsupportedHost.widget.getByRole("button", {
        name: "Use commit SHA in conversation",
      }).count(),
      0,
    );
    assert.equal(await unsupportedHost.widget.locator(".gr-handoff").count(), 0);
    assert.equal(contextUpdates(unsupportedHost).length, 0);
    assert.equal(sentMessages(unsupportedHost).length, 0);
  } finally {
    await unsupportedHost.close();
  }
});

test("packaged app host shows sheet skeletons while the next selection loads", async () => {
  const repository = await createRepository({ commitCount: 2 });
  const headSha = await revParse(repository, "HEAD");
  const firstSha = await revParse(repository, "HEAD~1");
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
    toolCallScript: {
      get_commit_detail: [{}, { delayMs: 800 }],
    },
  });

  try {
    // Mount auto-selects HEAD and populates the persistent sheet.
    await waitForSheetCommit(host.widget, headSha);

    await host.widget.locator(`[data-commit-sha="${firstSha}"]`).click();
    // The sheet subject follows the selection immediately...
    await host.widget.locator(".gr-detail-subject", { hasText: "Browser host fixture" })
      .waitFor();
    // ...while stale detail and file data are replaced by inert skeletons.
    const skeletons = host.widget.locator(".gr-skeleton");
    await waitUntil(
      async () => await skeletons.count() === 2,
      "detail and changed-file skeletons did not appear",
    );
    assert.deepEqual(
      await skeletons.evaluateAll((elements) => elements.map((element) => ({
        ariaHidden: element.getAttribute("aria-hidden"),
        bars: element.querySelectorAll("span").length,
      }))),
      [
        { ariaHidden: "true", bars: 6 },
        { ariaHidden: "true", bars: 5 },
      ],
    );
    assert.equal(await host.widget.locator(".gr-sha code").count(), 0);
    assert.equal(await host.widget.locator(".gr-file").count(), 0);
    assert.equal(
      await host.widget.getByText("Loading commit detail…", { exact: true }).count(),
      1,
    );
    assert.deepEqual(
      await host.widget.getByText("Loading commit detail…", { exact: true }).evaluate(
        (element) => {
          const style = getComputedStyle(element);
          return {
            clip: style.clip,
            clipPath: style.clipPath,
            height: style.height,
            overflow: style.overflow,
            whiteSpace: style.whiteSpace,
            width: style.width,
          };
        },
      ),
      {
        clip: "rect(0px, 0px, 0px, 0px)",
        clipPath: "inset(50%)",
        height: "1px",
        overflow: "hidden",
        whiteSpace: "nowrap",
        width: "1px",
      },
    );
    // The history list stays interactive during a detail load.
    assert.equal(await host.widget.locator("[data-commit-sha]").count(), 2);
    assert.equal(
      await host.widget.locator(`[data-commit-sha="${firstSha}"]`)
        .getAttribute("aria-disabled"),
      null,
    );

    await waitForSheetCommit(host.widget, firstSha);
    await skeletons.waitFor({ state: "detached" });
  } finally {
    await host.close();
  }
});

test("packaged app host debounces detail requests across rapid selection movement", async () => {
  const repository = await createRepository({ commitCount: 4 });
  const headSha = await revParse(repository, "HEAD");
  const skippedSha = await revParse(repository, "HEAD~1");
  const targetSha = await revParse(repository, "HEAD~2");
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
  });

  try {
    await waitForSheetCommit(host.widget, headSha);
    assert.deepEqual(commitDetailRequests(host), [headSha]);

    // Two selection moves inside one task stay within the 150 ms debounce
    // window, so the interim commit's detail is never requested.
    await host.widget.locator(".gr-graph").evaluate((graph, shas) => {
      for (const sha of shas) {
        graph.querySelector(`[data-commit-sha="${sha}"]`).click();
      }
    }, [skippedSha, targetSha]);
    await waitForSheetCommit(host.widget, targetSha);
    assert.equal(
      await host.widget.locator(`[data-commit-sha="${targetSha}"]`)
        .getAttribute("aria-selected"),
      "true",
    );
    assert.deepEqual(commitDetailRequests(host), [headSha, targetSha]);
  } finally {
    await host.close();
  }
});

test("packaged app host keeps a failed commit selection on unlocked history", async () => {
  const repository = await createRepository();
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
    toolCallScript: {
      get_commit_detail: [{
        result: {
          structuredContent: {
            status: "error",
            message: "Commit detail is unavailable",
            code: "detail-unavailable",
          },
        },
      }],
    },
  });

  try {
    // Mount auto-selects HEAD; its failed detail surfaces as a sheet notice.
    await host.widget.getByText("Commit detail is unavailable", { exact: true }).waitFor();
    const row = host.widget.locator("[data-commit-sha]");
    assert.equal(await row.getAttribute("aria-selected"), "true");
    assert.equal(await row.getAttribute("aria-disabled"), null);
    assert.equal(await row.evaluate((element) => element.tabIndex), 0);
  } finally {
    await host.close();
  }
});

test("packaged app host rejects a changed-file page that resolves after reselection", async () => {
  const repository = await createRepository({ commitCount: 2, changedFileCount: 501 });
  const headSha = await revParse(repository, "HEAD");
  const firstSha = await revParse(repository, "HEAD~1");
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
    toolCallScript: { load_more_files: [{ delayMs: 500 }] },
  });

  try {
    await waitForSheetCommit(host.widget, headSha);
    await host.widget.locator(`[data-commit-sha="${firstSha}"]`).click();
    await host.widget.getByText("500 of 501 loaded", { exact: true }).waitFor();
    await host.widget.getByRole("button", { name: "Load 500 more files" }).click();
    const loadMoreFilesRequest = () => host.messages.find(({ direction, message }) =>
      direction === "widget-to-host" &&
      message.method === "tools/call" &&
      message.params?.name === "load_more_files"
    );
    await waitUntil(
      () => loadMoreFilesRequest() !== undefined,
      "the changed-file page request was not dispatched",
    );
    const loadMoreFilesRequestId = loadMoreFilesRequest().message.id;
    // Reselecting another commit invalidates the in-flight page; the server
    // replaces its active detail, so the delayed response resolves as a
    // stale error — wait for the response by id, whatever its content.
    await host.widget.locator(`[data-commit-sha="${headSha}"]`).click();
    await waitForSheetCommit(host.widget, headSha);
    await waitUntil(
      () => host.messages.some(({ direction, message }) =>
        direction === "host-to-widget" && message.id === loadMoreFilesRequestId
      ),
      "the delayed changed-file response did not resolve after reselection",
    );

    // The stale page must not leak into the newly selected commit's sheet.
    assert.equal(
      await host.widget.getByText("1 changed file", { exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await host.widget.getByText("500 of 501 loaded", { exact: true }).count(),
      0,
    );

    await host.widget.locator(`[data-commit-sha="${firstSha}"]`).click();
    await host.widget.getByText("500 of 501 loaded", { exact: true }).waitFor();
  } finally {
    await host.close();
  }
});

test("packaged app host drives the live launcher-to-diff path", async () => {
  const repository = await createRepository({ includeOctopus: true });
  const headSha = await revParse(repository, "HEAD");
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: {
      locale: "ja-JP",
      theme: "dark",
      displayMode: "inline",
      maxHeight: 900,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    displayModeRequest: { outcome: "resolve", mode: "fullscreen" },
  });

  try {
    assert.match(host.resource.uri, /^ui:\/\/gitright\/.+\.html$/);
    assert.equal(host.resource.mimeType, "text/html;profile=mcp-app");
    assert.equal(
      await host.widget.getByRole("button", { name: "Open GitRight" }).isVisible(),
      true,
    );
    assert.ok(host.messages.some(({ message }) => message.method === "ui/initialize"));
    assert.ok(
      host.messages.some(({ message }) => message.method === "ui/notifications/initialized"),
    );
    assert.ok(
      host.messages.some(
        ({ direction, message }) => direction === "host-to-widget" &&
          message.method === "ui/notifications/tool-result",
      ),
    );

    const open = host.widget.getByRole("button", { name: "Open GitRight" });
    await open.focus();
    await open.press("Enter");
    await host.widget.getByRole("heading", { name: "グラフトポロジー" }).waitFor();
    assert.equal(await host.widget.locator("html").getAttribute("data-display-mode"), "fullscreen");
    assert.equal(
      await host.widget.locator("main").evaluate((element) => getComputedStyle(element).borderTopWidth),
      "0px",
    );
    assert.ok(await computedContrast(host.widget.locator("main")) >= 4.5);

    // The persistent sheet is populated from mount: HEAD (the octopus
    // merge) is selected without any navigation.
    await host.widget.locator(".gr-detail-subject", { hasText: "Browser octopus fixture" })
      .waitFor();
    await waitForSheetCommit(host.widget, headSha);
    assert.equal(
      await host.widget.locator(`[data-commit-sha="${headSha}"]`)
        .getAttribute("aria-selected"),
      "true",
    );

    const graphRail = host.widget.locator(".graph-rail-viewport").first();
    const graphScrollLeft = await graphRail.evaluate((element) => {
      const next = Math.min(64, element.scrollWidth - element.clientWidth);
      element.scrollLeft = next;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
      return next;
    });
    assert.ok(graphScrollLeft > 0);

    const parentTwo = host.widget.getByRole("button", { name: /^親 2 / });
    await parentTwo.click();
    // aria-pressed reflects the requested parent immediately; the reloaded
    // changed-file list follows. Parent 2 (octopus-01) already contains
    // branch-01.txt, so its diff holds the other 19 branch files.
    assert.equal(await parentTwo.getAttribute("aria-pressed"), "true");
    await waitUntil(
      async () => await host.widget.locator(".gr-file").count() === 19,
      "the parent-2 changed-file list did not replace the parent-1 list",
    );
    assert.equal(
      await host.widget.getByRole("button", { name: /branch-01\.txt/ }).count(),
      0,
    );
    const badgeContrasts = await contrastRatios(host.widget.locator(".gr-files"), [{
      selector: ".gr-badge",
      foregroundProperties: ["color"],
      backgroundClosest: ".gr-sheet",
      backgroundProperty: "backgroundColor",
    }]);
    assert.ok(badgeContrasts.length > 0);
    assert.ok(Math.min(...badgeContrasts) >= 4.5);

    const changedFile = host.widget.getByRole("button", { name: /branch-02\.txt/ });
    const fileId = await changedFile.getAttribute("data-file-id");
    await changedFile.click();
    // Selecting a changed file overlays the graph while the persistent
    // detail + files sheet remains visible and interactive below it.
    const diffLayer = host.widget.locator(".gr-history > .gr-diff-layer");
    await diffLayer.waitFor();
    assert.deepEqual(
      await diffLayer.evaluate((layer) => {
        const history = layer.parentElement;
        if (!history?.classList.contains("gr-history")) {
          throw new Error("diff layer is not attached to the graph region");
        }
        const layerBounds = layer.getBoundingClientRect();
        const historyBounds = history.getBoundingClientRect();
        return {
          zIndex: getComputedStyle(layer).zIndex,
          topInset: layerBounds.top - historyBounds.top,
          rightInset: historyBounds.right - layerBounds.right,
          bottomInset: historyBounds.bottom - layerBounds.bottom,
          leftInset: layerBounds.left - historyBounds.left,
        };
      }),
      { zIndex: "4", topInset: 0, rightInset: 10, bottomInset: 4, leftInset: 10 },
    );
    assert.equal(await host.widget.locator(".gr-sheetwrap section.gr-detail").count(), 1);
    assert.equal(await host.widget.locator(".gr-sheetwrap section.gr-files").count(), 1);
    assert.equal(await host.widget.locator(".gr-sheetwrap section.gr-diff").count(), 0);
    const diffScroll = host.widget.locator(".gr-diff-scroll");
    await diffScroll.waitFor();
    // The unique unified-diff label lives on the scroll container only.
    assert.equal(
      await diffScroll.getAttribute("aria-label"),
      "branch-02.txt の統合差分",
    );
    assert.equal(
      await host.widget.getByLabel("branch-02.txt の統合差分").count(),
      1,
    );
    await waitUntil(
      () => diffScroll.evaluate((element) => document.activeElement === element),
      "focus did not move to the unified diff",
    );
    assert.ok(await host.widget.locator("tr.diff-addition").count() > 0);

    // Layout invariant: the document never scrolls; only designed
    // containers may scroll vertically.
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => {
        const designed = ["gr-graph", "gr-sheet", "gr-detail", "gr-files", "gr-diff-scroll"];
        return {
          documentScrolls:
            document.documentElement.scrollHeight > document.documentElement.clientHeight,
          undesignedVerticalScrollers: Array.from(document.querySelectorAll("main *"))
            .filter((element) => {
              const overflowY = getComputedStyle(element).overflowY;
              return (overflowY === "auto" || overflowY === "scroll") &&
                element.scrollHeight > element.clientHeight;
            })
            .map((element) => String(element.className))
            .filter((className) => !designed.some((name) => className.includes(name))),
        };
      }),
      { documentScrolls: false, undesignedVerticalScrollers: [] },
    );

    const returnedFile = host.widget.locator(`.gr-file[data-file-id="${fileId}"]`);
    const waitForClosedDiff = async (message) => {
      await diffLayer.waitFor({ state: "detached" });
      assert.equal(await host.widget.locator("section.gr-diff").count(), 0, message);
    };
    const waitForReturnedFileFocus = (message) => waitUntil(
      () => returnedFile.evaluate((element) => document.activeElement === element),
      message,
    );

    // The explicit close button immediately detaches the layer under the
    // host's reduced-motion preference and restores file focus.
    await host.widget.getByRole("button", { name: "差分を閉じる" }).click();
    await waitForClosedDiff("the close button did not detach the diff layer");
    await waitForReturnedFileFocus(
      "focus did not return after closing the diff with the close button",
    );

    // Re-clicking the selected file toggles the layer closed.
    await changedFile.click();
    await diffLayer.waitFor();
    await host.widget.locator(".gr-diff-scroll").waitFor();
    await changedFile.click();
    await waitForClosedDiff("the selected-file toggle did not detach the diff layer");
    await waitForReturnedFileFocus(
      "focus did not return after toggling the selected file",
    );

    // Escape is the equivalent keyboard close path.
    await changedFile.click();
    await diffLayer.waitFor();
    await host.widget.locator(".gr-diff-scroll").waitFor();
    await host.pressKey("Escape");
    await waitForClosedDiff("Escape did not detach the diff layer");
    await waitForReturnedFileFocus("focus did not return after Escape");

    // Parent changes close the overlay synchronously before the replacement
    // detail loads.
    await changedFile.click();
    await diffLayer.waitFor();
    await host.widget.locator(".gr-diff-scroll").waitFor();
    await parentTwo.click();
    assert.equal(await diffLayer.count(), 1);
    const parentOne = host.widget.getByRole("button", { name: /^親 1 / });
    await parentOne.click();
    await waitForClosedDiff("parent selection did not close the diff layer");
    assert.equal(await parentOne.getAttribute("aria-pressed"), "true");
    await waitUntil(
      async () => await host.widget.locator(".gr-file").count() === 20,
      "the parent-1 changed-file list did not load",
    );
    // Overlay open/close and parent-driven sheet replacement preserve the
    // user's horizontal graph position.
    assert.equal(await host.widget.locator(".graph-rail-viewport").first().evaluate(
      (element) => element.scrollLeft,
    ), graphScrollLeft);

    // Commit selection has the same immediate-close contract. The layer
    // covers pointer input over the graph, so dispatch the row's native
    // activation directly to model a keyboard/programmatic selection.
    await changedFile.click();
    await diffLayer.waitFor();
    await host.widget.locator(".gr-diff-scroll").waitFor();
    const otherCommit = host.widget.locator("[data-commit-sha]").nth(1);
    const otherCommitSha = await otherCommit.getAttribute("data-commit-sha");
    assert.notEqual(otherCommitSha, null);
    await otherCommit.evaluate((element) => element.click());
    await waitForClosedDiff("commit selection did not close the diff layer");
    await waitForSheetCommit(host.widget, otherCommitSha);

    // The sheet never unmounts across any close path.
    assert.equal(await host.widget.locator(".gr-sheetwrap section.gr-detail").count(), 1);
    assert.equal(await host.widget.locator(".gr-sheetwrap section.gr-files").count(), 1);

    assert.equal(toolCallNames(host)[0], "get_history");
    assert.ok(toolCallNames(host).filter((name) => name === "get_commit_detail").length >= 4);
    assert.equal(toolCallNames(host).filter((name) => name === "get_diff").length, 5);
    // CSP invariant: the packaged widget never reaches the network.
    assert.deepEqual(host.networkRequests, []);
  } finally {
    await host.close();
  }
});

test("packaged app abandons a canceled pane entrance instead of staying hidden", async () => {
  const repository = await createRepository({ commitCount: 3 });
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 1000, height: 700 },
    hostContext: { displayMode: "fullscreen" },
    widgetState: {
      version: 1,
      mode: "graph",
      query: "",
      selectedSha: null,
      launcherHandoff: true,
    },
    reducedMotion: "no-preference",
  });
  try {
    // The one-shot entrance must actually arm before the host interferes.
    await host.widget.locator("main.gr-entrance").waitFor();
    // A dynamic reduced-motion flip cancels every CSS animation without
    // ever firing animationend — exactly what a host-side animation
    // suppression during a pane resize does. The entrance previously
    // waited for that lost event forever, leaving everything but the
    // wordmark at opacity 0.
    await host.page.emulateMedia({ reducedMotion: "reduce" });
    await waitUntil(
      () => host.widget.locator("main.gitright-app").evaluate((main) =>
        !main.classList.contains("gr-entrance") &&
        getComputedStyle(main.querySelector(".gr-history")).opacity === "1"),
      "canceled entrance never released the hidden complete view",
    );
  } finally {
    await host.close();
  }
});

test("packaged app keeps long changed-file rows inside the supported 380px viewport", async () => {
  const repository = await createRepository({ includeLongChangedFilePath: true });
  const fullPath =
    "docs/examples/product-verification/" +
    "very-long-changed-file-viewport-fixture.json";
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
  });

  try {
    // Mount auto-selects the only commit; its files populate the sheet.
    const row = host.widget.getByRole("button", {
      name: /very-long-changed-file-viewport-fixture\.json/,
    });
    await row.waitFor();
    assert.equal(await row.getAttribute("title"), fullPath);
    assert.match(await row.getAttribute("aria-label"), new RegExp(fullPath));
    assert.equal(
      await row.locator(".gr-file-name").textContent(),
      "very-long-changed-file-viewport-fixture.json",
    );
    assert.equal(
      await row.locator(".gr-file-dir").textContent(),
      "docs/examples/product-verification/",
    );
    assert.equal(
      await host.widget.getByLabel("Search loaded changed files").count(),
      0,
      "the file search must stay hidden below six loaded entries",
    );

    // The compact text preserves the recorded wall time without timezone
    // conversion, while the complete recorded/local strings stay on hover.
    for (const label of ["Author date", "Committer date"]) {
      const dateRow = host.widget.locator(".gr-meta > div").filter({ hasText: label });
      const dateCell = dateRow.locator("dd");
      assert.equal(await dateCell.locator("time").textContent(), "2026-01-01 00:00");
      assert.equal(
        await dateCell.locator("time").getAttribute("datetime"),
        "2026-01-01T00:00:00Z",
      );
      assert.match(
        await dateCell.getAttribute("title"),
        /^2026-01-01T00:00:00Z · .+$/,
      );
    }

    const layout = await row.evaluate((button) => {
      const list = button.closest(".gr-file-list");
      const item = button.closest("li");
      const panel = button.closest(".gr-files");
      const fileName = button.querySelector(".gr-file-name");
      if (!list || !item || !panel || !fileName) {
        throw new Error("changed-file row is incomplete");
      }
      const viewportWidth = document.documentElement.clientWidth;
      const panelRight = panel.getBoundingClientRect().right;
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      };
      const documentWidth = {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
      const boxes = {
        list: rect(list),
        item: rect(item),
        button: rect(button),
        fileName: rect(fileName),
      };
      const fileNameStyle = getComputedStyle(fileName);
      return {
        viewportWidth,
        panelRight,
        documentWidth,
        boxes,
        fileNameStyle: {
          overflow: fileNameStyle.overflow,
          textOverflow: fileNameStyle.textOverflow,
          whiteSpace: fileNameStyle.whiteSpace,
        },
        fits: {
          document: documentWidth.scrollWidth <= viewportWidth,
          list: boxes.list.right <= panelRight && boxes.list.scrollWidth <= boxes.list.clientWidth,
          item: boxes.item.right <= panelRight && boxes.item.scrollWidth <= boxes.item.clientWidth,
          button: boxes.button.right <= panelRight && boxes.button.scrollWidth <= boxes.button.clientWidth,
          fileName: boxes.fileName.right <= panelRight &&
            boxes.fileName.scrollWidth > boxes.fileName.clientWidth,
        },
      };
    });
    assert.deepEqual(
      layout.fits,
      { document: true, list: true, item: true, button: true, fileName: true },
      JSON.stringify(layout),
    );
    assert.deepEqual(
      layout.fileNameStyle,
      { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    );
  } finally {
    await host.close();
  }
});

test("packaged app shows changed-file search at the six-entry boundary", async () => {
  const repository = await createRepository({ changedFileCount: 6 });
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
  });

  try {
    await waitUntil(
      async () => await host.widget.locator(".gr-file").count() === 6,
      "the six changed files did not populate the sheet",
    );
    const search = host.widget.getByLabel("Search loaded changed files");
    await search.waitFor();
    await search.fill("fixture-006");
    await host.widget.getByText("1 of 6 loaded files", { exact: true }).waitFor();
    assert.equal(await host.widget.locator(".gr-file").count(), 1);
    assert.equal(
      await host.widget.locator(".gr-file-name").textContent(),
      "fixture-006.txt",
    );
  } finally {
    await host.close();
  }
});

test("packaged app exposes exact session-only developer viewport metrics", async () => {
  const repository = await createRepository();
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
  });

  try {
    const metrics = host.widget.locator("[data-developer-viewport-metrics]");
    assert.equal(await metrics.count(), 0);

    await host.focusWidget();
    await host.pressKey("Control+Alt+Shift+W");
    await host.widget.getByText("380 × 900 CSS px · supported minimum", { exact: true }).waitFor();
    assert.equal(await metrics.getAttribute("aria-hidden"), "true");

    await host.setViewport({ width: 420, height: 760 });
    await host.widget.getByText("420 × 760 CSS px · supported width", { exact: true }).waitFor();

    await host.pressKey("Control+Alt+Shift+W");
    await waitUntil(() => metrics.count().then((count) => count === 0),
      "developer viewport metrics did not hide after the second shortcut");
  } finally {
    await host.close();
  }
});

test("packaged app host observes every public launch outcome", async () => {
  const openedRepository = await createRepository();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "gitright-browser-outcomes-"));
  const unavailableDirectory = path.join(temporaryRoot, "not-a-repository");
  const unsupportedRepository = path.join(temporaryRoot, "bare.git");
  await mkdir(unavailableDirectory);
  await execFile("/usr/bin/git", ["init", "--bare", "-q", unsupportedRepository]);

  for (const [trustedRepositoryContext, expected, heading, stateView] of [
    [openedRepository, { outcome: "opened" }, "Graph topology", false],
    [unavailableDirectory, {
      outcome: "unavailable",
      reasonCode: "repository-unavailable",
    }, "Current task repository is unavailable", true],
    [unsupportedRepository, {
      outcome: "unsupported",
      reasonCode: "bare-repository",
    }, "Bare repositories are not supported in this version", true],
  ]) {
    const host = await startPackagedAppHost({ trustedRepositoryContext });
    try {
      assert.deepEqual(host.initialToolResult.structuredContent, expected);
      await host.widget.getByRole("button", { name: "Open GitRight" }).click();
      await host.widget.getByRole("heading", { name: heading }).waitFor();
      assert.equal(await host.widget.locator("main.gr-stateview").count(), stateView ? 1 : 0);
      // Non-loading repository states announce as alerts; ready views have none.
      assert.equal(await host.widget.getByRole("alert").count(), stateView ? 1 : 0);
      if (stateView) {
        assert.equal(await host.widget.locator(".gr-state").getAttribute("role"), "alert");
      }
    } finally {
      await host.close();
    }
  }
});

test("packaged app host scripts display outcomes and live host context", async () => {
  const repository = await createRepository();
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: {
      locale: "en-US",
      theme: "light",
      displayMode: "inline",
      maxHeight: 900,
      safeArea: { top: 1, right: 2, bottom: 3, left: 4 },
    },
    widgetState: { version: 1, mode: "graph", query: "", selectedSha: null },
    displayModeRequest: [
      { outcome: "reject" },
      { outcome: "throw" },
      { outcome: "undefined" },
      { outcome: "resolve", mode: "inline" },
      { outcome: "resolve", mode: "pip" },
      { outcome: "resolve", mode: "fullscreen", delayMs: 50 },
    ],
  });

  try {
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => ({
        maxHeight: window.openai.maxHeight,
        safeArea: window.openai.safeArea,
        widgetState: window.openai.widgetState,
        bodyPadding: {
          top: getComputedStyle(document.body).paddingTop,
          right: getComputedStyle(document.body).paddingRight,
          bottom: getComputedStyle(document.body).paddingBottom,
          left: getComputedStyle(document.body).paddingLeft,
        },
      })),
      {
        maxHeight: 900,
        safeArea: { insets: { top: 1, right: 2, bottom: 3, left: 4 } },
        widgetState: { version: 1, mode: "graph", query: "", selectedSha: null },
        bodyPadding: { top: "9px", right: "10px", bottom: "11px", left: "12px" },
      },
    );
    await host.setHostContext({ theme: "dark" });
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => ({
        lang: document.documentElement.lang,
        theme: document.documentElement.dataset.theme,
        displayMode: document.documentElement.dataset.displayMode,
        maxHeight: getComputedStyle(document.documentElement)
          .getPropertyValue("--host-max-height").trim(),
        safeLeft: getComputedStyle(document.documentElement)
          .getPropertyValue("--host-safe-area-left").trim(),
      })),
      {
        lang: "en",
        theme: "dark",
        displayMode: "inline",
        maxHeight: "900px",
        safeLeft: "4px",
      },
    );
    await host.setHostContext({ theme: "light" });
    const open = host.widget.getByRole("button", { name: "Open GitRight" });
    const expectedStatuses = [
      "The right pane did not open. Try again.",
      "The right pane did not open. Try again.",
      "GitRight opens only in the right pane. Try again.",
      "GitRight opens only in the right pane. Try again.",
      "GitRight opens only in the right pane. Try again.",
    ];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const requestsBeforeActivation = host.messages.filter(
        ({ message }) => message.method === "host/request-display-mode",
      ).length;
      await open.click();
      await host.widget.getByText(expectedStatuses[attempt], { exact: true }).waitFor();
      assert.equal(await open.isVisible(), true);
      assert.equal(await open.isEnabled(), true);
      assert.equal(
        host.messages.filter(({ message }) => message.method === "host/request-display-mode").length,
        requestsBeforeActivation + 1,
      );
      assert.deepEqual(
        host.messages
          .filter(({ message }) => message.method === "tools/call")
          .map(({ message }) => message.params.name),
        [],
      );
      assert.equal(await host.widget.getByRole("heading", { name: "Graph topology" }).count(), 0);
    }
    const delayedRequestStartedAt = performance.now();
    await open.click();
    await host.widget.getByText("Opening the right pane…", { exact: true }).waitFor();
    assert.equal(await open.isDisabled(), true);
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    assert.ok(performance.now() - delayedRequestStartedAt >= 40);
    assert.equal(
      await host.widget.getByRole("heading", { name: "Graph topology" }).isVisible(),
      true,
    );
    assert.equal(
      host.messages.filter(({ message }) => message.method === "host/request-display-mode").length,
      6,
    );
    await host.widget.getByRole("heading", { name: "Graph topology" }).evaluate((element) => {
      element.dataset.hostContextIdentity = "preserve";
    });

    await host.setHostContext({
      locale: "ja-JP",
      theme: "dark",
      displayMode: "fullscreen",
      maxHeight: 840,
      safeArea: { top: 8, right: 7, bottom: 6, left: 5 },
    });
    assert.equal(
      await host.widget.getByRole("heading", { name: "グラフトポロジー" }).isVisible(),
      true,
    );
    assert.equal(
      await host.widget.getByRole("heading", { name: "グラフトポロジー" })
        .getAttribute("data-host-context-identity"),
      "preserve",
    );
    assert.equal(await host.widget.locator("html").getAttribute("lang"), "ja");
    assert.equal(await host.widget.locator("html").getAttribute("data-theme"), "dark");
    assert.ok(await computedContrast(host.widget.locator("main")) >= 4.5);
    assert.equal(await host.widget.locator("html").getAttribute("data-display-mode"), "fullscreen");
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => ({
        maxHeight: getComputedStyle(document.documentElement).getPropertyValue("--host-max-height").trim(),
        safeTop: getComputedStyle(document.documentElement).getPropertyValue("--host-safe-area-top").trim(),
        safeRight: getComputedStyle(document.documentElement).getPropertyValue("--host-safe-area-right").trim(),
        safeBottom: getComputedStyle(document.documentElement).getPropertyValue("--host-safe-area-bottom").trim(),
        safeLeft: getComputedStyle(document.documentElement).getPropertyValue("--host-safe-area-left").trim(),
        bodyPadding: {
          top: getComputedStyle(document.body).paddingTop,
          right: getComputedStyle(document.body).paddingRight,
          bottom: getComputedStyle(document.body).paddingBottom,
          left: getComputedStyle(document.body).paddingLeft,
        },
      })),
      {
        maxHeight: "840px",
        safeTop: "8px",
        safeRight: "7px",
        safeBottom: "6px",
        safeLeft: "5px",
        bodyPadding: { top: "8px", right: "7px", bottom: "6px", left: "5px" },
      },
    );
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => ({
        displayMode: window.openai.displayMode,
        maxHeight: window.openai.maxHeight,
        safeArea: window.openai.safeArea,
      })),
      {
        displayMode: "fullscreen",
        maxHeight: 840,
        safeArea: { insets: { top: 8, right: 7, bottom: 6, left: 5 } },
      },
    );
    await host.setHostContext({ safeAreaInsets: { top: 12 } });
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => ({
        safeTop: getComputedStyle(document.documentElement)
          .getPropertyValue("--host-safe-area-top").trim(),
        safeRight: getComputedStyle(document.documentElement)
          .getPropertyValue("--host-safe-area-right").trim(),
        safeBottom: getComputedStyle(document.documentElement)
          .getPropertyValue("--host-safe-area-bottom").trim(),
        safeLeft: getComputedStyle(document.documentElement)
          .getPropertyValue("--host-safe-area-left").trim(),
      })),
      { safeTop: "12px", safeRight: "7px", safeBottom: "6px", safeLeft: "5px" },
    );
    assert.equal(
      host.messages.some(({ message }) =>
        message.method === "ui/notifications/host-context-changed" &&
          message.params.displayMode === "fullscreen"
      ),
      true,
    );
    assert.deepEqual(
      host.messages.findLast(({ message }) =>
        message.method === "ui/notifications/host-context-changed"
      )?.message.params,
      { safeAreaInsets: { top: 12 } },
    );
    // The widget persists its HEAD auto-selection once the snapshot loads;
    // inject host state only after that write so it cannot land in between.
    await waitUntil(
      () =>
        host.messages.some(({ direction, message }) =>
          direction === "widget-to-host" &&
          message.method === "host/set-widget-state" &&
          message.params.widgetState?.selectedSha !== null
        ),
      "the widget did not persist its initial HEAD selection",
    );
    await host.setWidgetState({ version: 1, mode: "text", query: "fixture", selectedSha: null });
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => window.openai.widgetState),
      { version: 1, mode: "text", query: "fixture", selectedSha: null },
    );

    await host.widget.locator(".graph-rail-viewport").first().waitFor();
    const narrow = await host.capture();
    assert.deepEqual(
      await host.widget.locator("html").evaluate(() => {
        const designed = ["gr-graph", "gr-sheet", "gr-detail", "gr-files", "gr-diff-scroll"];
        return {
          documentScrolls:
            document.documentElement.scrollHeight > document.documentElement.clientHeight,
          undesignedVerticalScrollers: Array.from(document.querySelectorAll("main *"))
            .filter((element) => {
              const overflowY = getComputedStyle(element).overflowY;
              return (overflowY === "auto" || overflowY === "scroll") &&
                element.scrollHeight > element.clientHeight;
            })
            .map((element) => String(element.className))
            .filter((className) => !designed.some((name) => className.includes(name))),
          graphHorizontalOverflow: (() => {
            const rail = document.querySelector(".graph-rail-viewport");
            return rail ? getComputedStyle(rail).overflowX : null;
          })(),
        };
      }),
      {
        documentScrolls: false,
        undesignedVerticalScrollers: [],
        graphHorizontalOverflow: "auto",
      },
    );
    await host.setViewport({ width: 720, height: 900 });
    const wide = await host.capture();
    assert.notDeepEqual(narrow, wide);
  } finally {
    await host.close();
  }
});

test("packaged app host can omit the display-mode capability", async () => {
  const repository = await createRepository();
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    displayModeRequest: { outcome: "missing" },
  });

  try {
    const open = host.widget.getByRole("button", { name: "Open GitRight" });
    assert.equal(
      await open.isVisible(),
      true,
    );
    assert.equal(
      await host.widget.locator("html").evaluate(() => window.openai.requestDisplayMode),
      undefined,
    );
    assert.equal(
      host.messages.some(({ message }) => message.method === "host/request-display-mode"),
      false,
    );
    await open.click();
    await host.widget.getByText("The right pane is unavailable in this host.", { exact: true }).waitFor();
    assert.equal(await open.isVisible(), true);
    assert.equal(await open.isEnabled(), true);
    assert.equal(await host.widget.getByRole("heading", { name: "Graph topology" }).count(), 0);
    assert.deepEqual(
      host.messages
        .filter(({ message }) => message.method === "tools/call")
        .map(({ message }) => message.params.name),
      [],
    );
    assert.equal(
      host.messages.some(({ message }) => message.method === "host/request-display-mode"),
      false,
    );
  } finally {
    await host.close();
  }
});

test("packaged history controls operate one real paginated snapshot", async () => {
  const repository = await createRepository({ commitCount: 501 });
  const headSha = await revParse(repository, "HEAD");
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: {
      locale: "en-US",
      theme: "light",
      displayMode: "inline",
      maxHeight: 900,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    displayModeRequest: { outcome: "resolve", mode: "fullscreen" },
    toolCallScript: { get_history: [{}, { delayMs: 600 }] },
  });

  try {
    await host.widget.getByRole("button", { name: "Open GitRight" }).click();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    await host.widget.getByText("500 commits loaded", { exact: true }).waitFor();

    // Mount auto-selects HEAD; rows are listbox options with
    // complete accessible labels.
    assert.equal(
      await host.widget.locator('ol[role="listbox"]').getAttribute("aria-label"),
      "Commit history",
    );
    const headRow = host.widget.locator(`[data-commit-sha="${headSha}"]`);
    assert.equal(await headRow.getAttribute("role"), "option");
    assert.equal(await headRow.getAttribute("aria-selected"), "true");
    const graphLabel = await headRow.getAttribute("aria-label");
    assert.match(graphLabel, /^Selected; Browser history fixture 501/);
    assert.match(graphLabel, /commit/);
    assert.match(graphLabel, /lane 1/);
    assert.match(graphLabel, /parent [0-9a-f]{7}/);
    assert.match(graphLabel, /main/);

    const continuationStatus = host.widget.getByRole("status").filter({ hasText: /parent lane/ });
    assert.equal(await continuationStatus.isVisible(), true);
    assert.equal(
      await host.widget.getByRole("button", { name: /Load continuation/ }).isVisible(),
      true,
    );
    assert.equal(await host.widget.getByRole("button", { name: /Load 500 more/ }).isVisible(), true);

    const lightGraphContrasts = await graphContrasts(host.widget);
    assert.ok(lightGraphContrasts.length > 0);
    assert.ok(Math.min(...lightGraphContrasts) >= 3);
    await host.setHostContext({ theme: "dark" });
    const darkGraphContrasts = await graphContrasts(host.widget);
    assert.ok(darkGraphContrasts.length > 0);
    assert.ok(Math.min(...darkGraphContrasts) >= 3);
    await host.setHostContext({ theme: "light" });

    // Reduced motion keeps the topology segment static.
    assert.equal(
      await host.widget.locator(".gr-seg").evaluate((element) =>
        [element, ...element.querySelectorAll("*")].every((node) => {
          const styles = getComputedStyle(node);
          return styles.animationDuration.split(",").every((value) => parseFloat(value) === 0) &&
            styles.transitionDuration.split(",").every((value) => parseFloat(value) === 0);
        })
      ),
      true,
    );

    // Graph/Text is an icon segment of toggle buttons over one snapshot.
    const graphMode = host.widget.getByRole("button", { name: "Graph" });
    const textMode = host.widget.getByRole("button", { name: "Text" });
    assert.equal(await graphMode.getAttribute("aria-pressed"), "true");
    await textMode.click();
    await host.widget.getByRole("heading", { name: "Text topology" }).waitFor();
    assert.equal(await textMode.getAttribute("aria-pressed"), "true");
    assert.equal(await graphMode.getAttribute("aria-pressed"), "false");
    assert.equal(await host.widget.locator("ol.text-commit-list").count(), 1);

    // Search: matches annotate the full topology; rows are never
    // filtered, non-matches dim, and the field reports "current / total".
    const search = host.widget.getByLabel("Search loaded commits (subject, SHA, or ref)");
    const matchCount = host.widget.locator(".gr-search .gr-matchcount");
    await search.fill("Browser history fixture 250");
    await waitUntil(
      async () => await matchCount.textContent() === "1 / 1",
      "the search field did not report 1 / 1",
    );
    assert.equal(await host.widget.locator("[data-commit-sha]").count(), 500);
    assert.equal(await host.widget.locator(".gr-row.gr-dim").count(), 499);
    assert.equal(await host.widget.locator(".gr-row.gr-match-current").count(), 1);
    assert.equal(
      await host.widget.locator(".gr-row.gr-match .gr-subject mark").textContent(),
      "Browser history fixture 250",
    );
    // Match navigation never moves the selection.
    assert.equal(
      await host.widget.locator('[aria-selected="true"][data-commit-sha]')
        .getAttribute("data-commit-sha"),
      headSha,
    );
    assert.equal(
      await host.widget.getByRole("status").filter({ hasText: "Match 1 of 1" }).count(),
      1,
    );

    await search.fill("fixture");
    await waitUntil(
      async () => await matchCount.textContent() === "1 / 500",
      "the search field did not report 1 / 500",
    );
    assert.equal(await host.widget.locator(".gr-row.gr-dim").count(), 0);
    assert.match(
      await host.widget.locator(".gr-row.gr-match-current").getAttribute("aria-label"),
      /Browser history fixture 501/,
    );
    await search.press("Enter");
    await waitUntil(
      async () => await matchCount.textContent() === "2 / 500",
      "Enter did not advance to the next match",
    );
    assert.match(
      await host.widget.locator(".gr-row.gr-match-current").getAttribute("aria-label"),
      /Browser history fixture 500/,
    );
    await search.press("Shift+Enter");
    await waitUntil(
      async () => await matchCount.textContent() === "1 / 500",
      "Shift+Enter did not step back to the previous match",
    );
    await host.widget.getByRole("button", { name: "Next match" }).click();
    await waitUntil(
      async () => await matchCount.textContent() === "2 / 500",
      "the next-match control did not advance the match",
    );
    assert.equal(
      await host.widget.getByRole("status").filter({ hasText: "Match 2 of 500" }).count(),
      1,
    );
    await host.widget.getByRole("button", { name: "Previous match" }).click();
    await waitUntil(
      async () => await matchCount.textContent() === "1 / 500",
      "the previous-match control did not step back",
    );
    await search.fill("");
    await waitUntil(
      async () => await host.widget.locator(".gr-matchnav").count() === 0,
      "clearing the query did not remove the match navigation",
    );

    // Row selection updates the sheet in place; arrows move selection and
    // focus together while the sheet follows.
    await graphMode.click();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    const midRow = host.widget.getByRole("option", { name: /Browser history fixture 500;/ });
    await midRow.click();
    await waitUntil(
      async () => await midRow.getAttribute("aria-selected") === "true",
      "clicking a row did not select it",
    );
    await host.widget.locator(".gr-detail-subject", { hasText: "Browser history fixture 500" })
      .waitFor();
    assert.equal(await midRow.locator(".graph-selection-ring").count(), 1);
    const midSha = await midRow.getAttribute("data-commit-sha");

    await midRow.press("ArrowDown");
    const nextRow = host.widget.getByRole("option", { name: /Browser history fixture 499;/ });
    await waitUntil(
      async () => await nextRow.getAttribute("aria-selected") === "true",
      "ArrowDown did not move the selection",
    );
    await waitUntil(
      () => nextRow.evaluate((element) => document.activeElement === element),
      "ArrowDown did not move focus with the selection",
    );
    await host.widget.locator(".gr-detail-subject", { hasText: "Browser history fixture 499" })
      .waitFor();
    await nextRow.press("ArrowUp");
    await waitUntil(
      async () => await midRow.getAttribute("aria-selected") === "true",
      "ArrowUp did not move the selection back",
    );

    // Refresh locks row selection until the new snapshot lands, then
    // restores the previous selection.
    const refresh = host.widget.locator(".gr-refresh");
    const historyCallsBeforeRefresh = host.messages.filter(
      ({ message }) => message.method === "tools/call" && message.params.name === "get_history",
    ).length;
    await refresh.click();
    assert.equal(await refresh.getAttribute("aria-busy"), "true");
    assert.equal(await headRow.getAttribute("aria-disabled"), "true");
    assert.equal(await headRow.evaluate((element) => element.tabIndex), -1);
    await waitUntil(
      () => host.messages.filter(
        ({ message }) => message.method === "tools/call" && message.params.name === "get_history",
      ).length === historyCallsBeforeRefresh + 1,
      "refresh did not issue exactly one get_history call",
    );
    await waitUntil(
      () => refresh.isEnabled(),
      "refresh did not settle before the next operation",
    );
    assert.equal(await headRow.getAttribute("aria-disabled"), null);
    assert.equal(await headRow.evaluate((element) => element.tabIndex), 0);
    assert.equal(
      await host.widget.locator('[aria-selected="true"][data-commit-sha]')
        .getAttribute("data-commit-sha"),
      midSha,
    );
    assert.equal(
      host.messages.filter(
        ({ message }) => message.method === "tools/call" && message.params.name === "get_history",
      ).length,
      historyCallsBeforeRefresh + 1,
    );

    // Pagination against the real 501-commit snapshot.
    const loadContinuation = host.widget.getByRole("button", { name: /Load continuation/ });
    const loadMore = host.widget.getByRole("button", { name: /Load 500 more/ });
    await waitUntil(
      async () => await loadContinuation.isEnabled() && await loadMore.isEnabled(),
      "pagination controls did not re-enable after refresh",
    );
    await loadContinuation.click();
    await host.widget.getByText("501 commits loaded", { exact: true }).waitFor();
    assert.equal(await host.widget.getByRole("button", { name: /Load continuation/ }).count(), 0);
    assert.equal(await host.widget.getByRole("button", { name: /Load 500 more/ }).count(), 0);
  } finally {
    await host.close();
  }
});

test("packaged app completes the keyboard journey at 200 percent Japanese text", async () => {
  const repository = await createRepository({ commitCount: 3, includeMerge: true });
  const headSha = await revParse(repository, "HEAD");
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: {
      locale: "ja-JP",
      theme: "dark",
      displayMode: "inline",
      maxHeight: 900,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    displayModeRequest: { outcome: "resolve", mode: "fullscreen" },
  });

  try {
    async function assertEnlargedLayout(surface) {
      assert.deepEqual(
        await host.widget.locator("html").evaluate(() => ({
          documentOverflowsHorizontally:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
          mainLandmarks: document.querySelectorAll("main").length,
          unnamedButtons: Array.from(document.querySelectorAll("button"))
            .filter((button) => !(
              button.getAttribute("aria-label")?.trim() || button.textContent?.trim()
            ))
            .length,
          animatedElements: Array.from(document.querySelectorAll("main *"))
            .filter((element) => {
              const style = getComputedStyle(element);
              return style.animationDuration.split(",").some((value) => parseFloat(value) > 0) ||
                style.transitionDuration.split(",").some((value) => parseFloat(value) > 0);
            }).length,
        })),
        {
          documentOverflowsHorizontally: false,
          mainLandmarks: 1,
          unnamedButtons: 0,
          animatedElements: 0,
        },
        `200 percent ${surface} layout regressed`,
      );
    }
    async function waitForFocus(locator, message) {
      await waitUntil(
        () => locator.evaluate((element) => document.activeElement === element),
        message,
      );
    }

    const open = host.widget.getByRole("button", { name: "Open GitRight" });
    await open.waitFor();
    await host.widget.locator("html").evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await assertEnlargedLayout("launcher");
    assert.equal(await host.widget.getByRole("status").getAttribute("aria-live"), "polite");
    await host.focusWidget();
    await host.pressKey("Tab");
    await waitForFocus(open, "keyboard did not reach the launcher action");
    await host.pressKey("Enter");
    await host.widget.getByRole("heading", { name: "グラフトポロジー" }).waitFor();
    await assertEnlargedLayout("history");

    const svgs = host.widget.locator("svg");
    assert.ok(await svgs.count() > 0);
    assert.equal(
      await svgs.evaluateAll((elements) => elements.every((svg) =>
        svg.getAttribute("aria-hidden") === "true" &&
        svg.getAttribute("focusable") === "false" &&
        svg.querySelectorAll("[tabindex], a, button").length === 0
      )),
      true,
    );

    // Search-first header: Tab lands in the search field.
    await host.focusWidget();
    await host.pressKey("Tab");
    const search = host.widget.getByLabel("読み込み済みコミットを検索（件名、SHA、ref）");
    await waitForFocus(search, "keyboard did not reach the search field");
    await host.typeText("Browser merge fixture");
    const matchCount = host.widget.locator(".gr-search .gr-matchcount");
    await waitUntil(
      async () => await matchCount.textContent() === "1 / 1",
      "the ja search field did not report 1 / 1",
    );
    assert.equal(
      await host.widget.getByRole("status").filter({ hasText: "1件中1件目のマッチ" }).count(),
      1,
    );
    assert.equal(await host.widget.locator(".gr-row.gr-dim").count(), 5);
    assert.equal(
      await host.widget.locator(".gr-row.gr-match-current").getAttribute("data-commit-sha"),
      headSha,
    );

    // HEAD (the merge commit) was auto-selected at mount; its detail
    // populates the persistent sheet.
    await waitForSheetCommit(host.widget, headSha);
    const handoff = host.widget.getByRole("button", { name: "コミットSHAを会話で使う" });
    await waitUntil(() => handoff.isEnabled(), "mounted commit detail did not finish loading");

    // Match navigation and the header controls are keyboard reachable.
    await host.pressKey("Tab");
    await waitForFocus(
      host.widget.getByRole("button", { name: "前のマッチ" }),
      "keyboard did not reach the previous-match control",
    );
    await host.pressKey("Tab");
    await waitForFocus(
      host.widget.getByRole("button", { name: "次のマッチ" }),
      "keyboard did not reach the next-match control",
    );
    await host.pressKey("Tab");
    await waitForFocus(
      host.widget.getByRole("button", { name: "グラフ" }),
      "keyboard did not reach the Graph segment",
    );
    await host.pressKey("Tab");
    await waitForFocus(
      host.widget.getByRole("button", { name: "テキスト" }),
      "keyboard did not reach the Text segment",
    );
    await host.pressKey("Tab");
    await waitForFocus(
      host.widget.getByRole("button", { name: "更新" }),
      "keyboard did not reach Refresh",
    );
    await host.pressKey("Tab");
    const mergeRow = host.widget.locator(`[data-commit-sha="${headSha}"]`);
    await waitForFocus(mergeRow, "keyboard did not reach the first history row");
    assert.deepEqual(await mergeRow.evaluate((element) => ({
      outlineStyle: getComputedStyle(element).outlineStyle,
      outlineWidth: getComputedStyle(element).outlineWidth,
    })), { outlineStyle: "solid", outlineWidth: "2px" });

    // Arrow keys move selection and focus together; the sheet follows
    // without taking focus.
    await host.pressKey("ArrowDown");
    const secondRow = host.widget.getByRole("option", { name: /Browser main fixture/ });
    await waitUntil(
      async () => await secondRow.getAttribute("aria-selected") === "true",
      "ArrowDown did not move the selection",
    );
    await waitForFocus(secondRow, "ArrowDown did not move focus with the selection");
    await host.widget.locator(".gr-detail-subject", { hasText: "Browser main fixture" })
      .waitFor();
    await host.pressKey("ArrowUp");
    await waitUntil(
      async () => await mergeRow.getAttribute("aria-selected") === "true",
      "ArrowUp did not restore the merge selection",
    );
    await host.widget.locator(".gr-detail-subject", { hasText: "Browser merge fixture" })
      .waitFor();
    await waitForSheetCommit(host.widget, headSha);
    await waitUntil(() => handoff.isEnabled(), "the merge detail did not reload");
    await assertEnlargedLayout("selected history");

    // Tab travels through the remaining rows into the persistent sheet.
    for (let step = 0; step < 6; step += 1) await host.pressKey("Tab");
    const copySha = host.widget.getByRole("button", { name: "SHAをコピー" });
    await waitForFocus(copySha, "keyboard did not reach the sheet after the history rows");
    await host.pressKey("Tab");
    const parentOne = host.widget.getByRole("button", { name: /^親 1 / });
    await waitForFocus(parentOne, "keyboard did not reach the first parent option");
    await host.pressKey("Tab");
    const parentTwo = host.widget.getByRole("button", { name: /^親 2 / });
    await waitForFocus(parentTwo, "keyboard did not reach the second parent option");
    await host.pressKey("Enter");
    await waitUntil(
      async () => await parentTwo.getAttribute("aria-pressed") === "true",
      "keyboard did not activate the second parent",
    );
    // Parent selection replaces stale sheet content with skeletons. Resume
    // the keyboard journey from the selected option after the detail reload.
    const changedFile = host.widget.getByRole("button", { name: /main\.txt/ });
    await changedFile.waitFor();
    await waitUntil(() => handoff.isEnabled(), "the parent-2 detail did not finish loading");
    await parentTwo.focus();
    await waitForFocus(parentTwo, "focus could not return to the selected parent");

    await host.pressKey("Tab");
    await waitForFocus(handoff, "keyboard did not reach the conversation handoff");
    await host.pressKey("Enter");
    await host.widget.getByRole("status").filter({
      hasText: "コミットSHAを会話コンテキストに追加しました。",
    }).waitFor();
    await host.pressKey("Tab");
    await waitForFocus(changedFile, "keyboard did not reach the changed-file entry");
    await host.pressKey("Enter");
    const diffScroll = host.widget.locator(".gr-diff-scroll");
    await diffScroll.waitFor();
    await waitForFocus(diffScroll, "200 percent diff did not receive focus");
    await assertEnlargedLayout("diff");

    // The layer close button is keyboard reachable and returns focus to the
    // changed file (reduced motion makes the close immediate in this host).
    await host.pressKey("Shift+Tab");
    await waitForFocus(
      host.widget.getByRole("button", { name: "差分を閉じる" }),
      "keyboard did not reach the diff close action",
    );
    await host.pressKey("Enter");
    await host.widget.locator(".gr-diff-layer").waitFor({ state: "detached" });
    await changedFile.waitFor();
    await waitForFocus(changedFile, "focus did not return to the changed-file entry");
    await assertEnlargedLayout("restored sheet");

    assert.equal(
      await host.widget.getByText("6件を読み込み済み", { exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await host.widget.locator('footer[aria-label="現在のリポジトリ状態"]').count(),
      1,
    );
  } finally {
    await host.close();
  }
});

test("packaged app presents the repository status bar", async () => {
  const abbreviate = (value) => value.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
  const readyRepositoryState = (host) => {
    const state = host.initialToolResult._meta?.repositoryState;
    assert.equal(state?.status, "ready");
    return state;
  };

  const repository = await createRepository();
  const repositoryHost = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
  });
  try {
    const statusBar = repositoryHost.widget.locator(
      'footer[aria-label="Current repository status"]',
    );
    await statusBar.waitFor();
    const state = readyRepositoryState(repositoryHost);
    assert.equal(state.repositoryKind, "repository");
    assert.equal(state.repositoryPath, await realpath(repository));
    assert.equal(state.branch, "main");
    assert.equal(state.worktreeName, null);
    assert.equal(await statusBar.locator(".gr-status-item").count(), 2);
    const pathItem = statusBar.locator(".gr-status-path");
    assert.equal(await pathItem.getAttribute("title"), state.repositoryPath);
    assert.equal(
      await pathItem.locator("code").textContent(),
      abbreviate(state.repositoryPath),
    );
    assert.equal(
      await pathItem.getAttribute("aria-label"),
      `Repository location: ${abbreviate(state.repositoryPath)}`,
    );
    const branchItem = statusBar.locator(".gr-status-item").nth(1);
    assert.equal(await branchItem.locator("code").textContent(), "main");
    assert.equal(await branchItem.getAttribute("aria-label"), "Branch: main");
  } finally {
    await repositoryHost.close();
  }

  const worktree = path.join(path.dirname(repository), "linked-worktree");
  await execFile(
    "/usr/bin/git",
    ["-C", repository, "worktree", "add", "-q", "-b", "gitright-linked", worktree],
  );
  const worktreeHost = await startPackagedAppHost({
    trustedRepositoryContext: worktree,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
  });
  try {
    const statusBar = worktreeHost.widget.locator(
      'footer[aria-label="Current repository status"]',
    );
    await statusBar.waitFor();
    const state = readyRepositoryState(worktreeHost);
    assert.equal(state.repositoryKind, "linked-worktree");
    assert.equal(state.branch, "gitright-linked");
    assert.equal(state.worktreeName, "linked-worktree");
    assert.equal(await statusBar.locator(".gr-status-item").count(), 3);
    assert.equal(
      await statusBar.locator(".gr-status-path").getAttribute("title"),
      state.repositoryPath,
    );
    const worktreeItem = statusBar.locator(".gr-status-item").nth(2);
    assert.equal(await worktreeItem.locator("code").textContent(), "linked-worktree");
    assert.equal(await worktreeItem.getAttribute("aria-label"), "worktree: linked-worktree");
  } finally {
    await worktreeHost.close();
  }

  await execFile("/usr/bin/git", ["-C", repository, "checkout", "-q", "--detach"]);
  const detachedHost = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    hostContext: { locale: "en-US", theme: "light", displayMode: "fullscreen" },
  });
  try {
    const statusBar = detachedHost.widget.locator(
      'footer[aria-label="Current repository status"]',
    );
    await statusBar.waitFor();
    const state = readyRepositoryState(detachedHost);
    assert.equal(state.branch, null);
    assert.equal(state.worktreeName, null);
    assert.equal(await statusBar.locator(".gr-status-item").count(), 2);
    const branchItem = statusBar.locator(".gr-status-item").nth(1);
    assert.equal(await branchItem.locator("code").textContent(), "HEAD (detached)");
    assert.equal(await branchItem.getAttribute("aria-label"), "Branch: HEAD (detached)");
  } finally {
    await detachedHost.close();
  }
});

async function captureHistoryAtSupportedWidths(repository) {
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: {
      locale: "en-US",
      theme: "light",
      displayMode: "inline",
      maxHeight: 900,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    displayModeRequest: { outcome: "resolve", mode: "fullscreen" },
  });

  try {
    await host.widget.getByRole("button", { name: "Open GitRight" }).click();
    await host.widget.getByRole("heading", { name: "Graph topology" }).waitFor();
    // The heading renders before the history and sheet finish loading;
    // capture only the steady state (detail SHA implies both are loaded).
    await host.widget.locator(".gr-sha code").waitFor();
    const narrow = await host.capture();
    await host.setViewport({ width: 720, height: 900 });
    const wide = await host.capture();
    return { narrow, wide };
  } finally {
    await host.close();
  }
}

test("packaged app captures are deterministic across independent hosts", async () => {
  // One repository for both hosts: the status bar renders the real
  // repository path, so a fresh mkdtemp suffix would change pixels.
  const repository = await createRepository();
  const first = await captureHistoryAtSupportedWidths(repository);
  const second = await captureHistoryAtSupportedWidths(repository);
  assert.deepEqual(first.narrow, second.narrow);
  assert.deepEqual(first.wide, second.wide);
});

async function captureTypography(locale, theme) {
  const repository = await createRepository();
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 380, height: 900 },
    hostContext: {
      locale,
      theme,
      displayMode: "fullscreen",
      maxHeight: 900,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
  try {
    return await host.typographyFingerprint(
      locale === "ja-JP" ? "グラフトポロジー" : "Graph topology",
    );
  } finally {
    await host.close();
  }
}

test("packaged app resolves identical Japanese fallback typography across themes", async () => {
  const observations = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const [locale, theme] of [
      ["en-US", "light"],
      ["ja-JP", "light"],
      ["en-US", "dark"],
      ["ja-JP", "dark"],
    ]) {
      const fingerprint = await captureTypography(locale, theme);
      if (locale === "ja-JP") observations.push({ theme, ...fingerprint });
    }
  }
  assert.equal(
    new Set(observations.map(({ widthPx }) => widthPx)).size,
    1,
    JSON.stringify(observations),
  );
});

async function captureJapaneseEmptyState(repository) {
  const host = await startPackagedAppHost({
    trustedRepositoryContext: repository,
    viewport: { width: 720, height: 900 },
    hostContext: {
      locale: "ja-JP",
      theme: "light",
      displayMode: "fullscreen",
      maxHeight: 900,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  });
  try {
    await host.widget.locator(".gr-history-message", { hasText: "コミットはありません" })
      .waitFor();
    return await host.capture();
  } finally {
    await host.close();
  }
}

test("packaged app captures identical Japanese empty states after font cache changes", async () => {
  // One repository for both captures: the status bar renders its real path.
  const repository = await createRepository({ empty: true });
  const before = await captureJapaneseEmptyState(repository);
  await captureTypography("ja-JP", "light");
  await captureTypography("ja-JP", "dark");
  const after = await captureJapaneseEmptyState(repository);
  assert.deepEqual(after, before);
});
