#!/usr/bin/env node

/**
 * Captures the five reference images of the visual baseline.
 *
 * The set covers every pairwise combination of pane width, theme, and locale
 * plus the launcher, and it is reviewed by a human at release time. Nothing
 * compares these images automatically, so this script only has to make them
 * reproducible: one fixture repository at a fixed neutral path, a pinned
 * snapshot time, no host surface color, and a run that fails if the browser
 * reaches the network.
 *
 * Usage: node docs/proofs/fixtures/visual-baseline/capture-reference-set.mjs [OUTPUT_DIRECTORY]
 */
import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { startPackagedAppHost } from "../../../../test-support/packaged-app-host.js";

const execFile = promisify(execFileCallback);

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const defaultOutputDirectory = path.join(import.meta.dirname, "reference");

// The status bar renders the repository's real path, so the fixture lives at
// a fixed neutral location instead of a temporary directory: a mkdtemp suffix
// or a home directory would put machine-specific text into a public image.
// The path is written in its macOS canonical form, because the server resolves
// /tmp to /private/tmp before the widget ever sees it.
const fixtureRepository = "/private/tmp/gitright-visual-fixture";
const fixtureHome = "/private/tmp/gitright-visual-fixture-home";
const unavailableDirectory = "/private/tmp/gitright-visual-unavailable";

const viewportHeightPx = 900;
const historySnapshotTime = 1_767_225_605;
const serverEnvironment = {
  TZ: "UTC",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
};
// The captures are taken without a host-published surface color, so the widget
// paints against its own fallbacks. Reviewers need to know which colors they
// are looking at, so the manifest records them.
const surfaceFallbackColors = { light: "#f2f3f7", dark: "#1c1c1e" };

const isolatedGitArguments = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "commit.gpgSign=false",
  "-c",
  "tag.gpgSign=false",
];

// The manifest reports the conditions from these same tables, so a capture
// and the conditions recorded beside it cannot drift apart.
const widths = { narrow: 380, wide: 720 };
const themes = ["light", "dark"];
const localeTags = { en: "en-US", ja: "ja-JP" };

const referenceCases = [
  { file: "history-narrow-dark-ja.png", surface: "history", width: "narrow", theme: "dark", locale: "ja" },
  { file: "diff-narrow-light-en.png", surface: "diff", width: "narrow", theme: "light", locale: "en" },
  { file: "search-wide-light-ja.png", surface: "search", width: "wide", theme: "light", locale: "ja" },
  { file: "unavailable-wide-dark-en.png", surface: "unavailable", width: "wide", theme: "dark", locale: "en" },
  { file: "launcher-narrow-dark-en.png", surface: "launcher", width: "narrow", theme: "dark", locale: "en" },
];

const copy = {
  en: {
    graphHeading: "Graph topology",
    unifiedDiff: "Unified diff for baseline.txt",
    unavailable: "Current task repository is unavailable",
  },
  ja: {
    graphHeading: "グラフトポロジー",
    unifiedDiff: "baseline.txt の統合差分",
    unavailable: "現在のタスクのリポジトリを利用できません",
  },
};

function isolatedGitEnvironment() {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith("GIT_") && typeof value === "string") environment[name] = value;
  }
  return {
    ...environment,
    HOME: fixtureHome,
    XDG_CONFIG_HOME: path.join(fixtureHome, ".config"),
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function createFixtureRepository() {
  await rm(fixtureRepository, { recursive: true, force: true });
  await rm(fixtureHome, { recursive: true, force: true });
  await mkdir(fixtureRepository, { recursive: true });
  await mkdir(fixtureHome, { recursive: true });
  const environment = isolatedGitEnvironment();
  await execFile(
    "/usr/bin/git",
    [...isolatedGitArguments, "init", "-q", "-b", "main", "--template=", fixtureRepository],
    { env: environment },
  );

  const commitFixture = async (subject, date, files) => {
    for (const [file, contents] of Object.entries(files)) {
      await writeFile(path.join(fixtureRepository, file), contents);
      await execFile(
        "/usr/bin/git",
        [...isolatedGitArguments, "-C", fixtureRepository, "add", file],
        { env: environment },
      );
    }
    await execFile(
      "/usr/bin/git",
      [
        ...isolatedGitArguments,
        "-C",
        fixtureRepository,
        "-c",
        "user.name=Example",
        "-c",
        "user.email=example@example.invalid",
        "commit",
        "-q",
        "-m",
        subject,
      ],
      { env: { ...environment, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } },
    );
  };

  // Three commits so the search surface shows a non-matching sunken row and a
  // `1 / 2` match position.
  await commitFixture("Initial import", "2025-12-30T00:00:00Z", {
    "README.txt": "GitRight visual baseline repository\n",
  });
  await commitFixture("Add baseline document", "2025-12-31T00:00:00Z", {
    "baseline.txt": "GitRight visual baseline\n",
  });
  await commitFixture("Visual baseline fixture", "2026-01-01T00:00:00Z", {
    "baseline.txt": "GitRight visual baseline\nrevised for the route-map chrome\n",
  });
}

function displayModeOf(testCase) {
  return testCase.surface === "launcher" ? "inline" : "fullscreen";
}

function hostContextOf(testCase) {
  return {
    locale: localeTags[testCase.locale],
    theme: testCase.theme,
    displayMode: displayModeOf(testCase),
    maxHeight: viewportHeightPx,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    // Left unpublished on purpose: the widget falls back to its own surface
    // color, which is the state the reference set is reviewed in.
    surfaceBackgroundColor: null,
  };
}

/**
 * Waits until the complete view has finished mounting against the fixture:
 * HEAD is selected at mount, so its changed file has to be loaded before a
 * capture shows a settled sheet.
 */
async function waitForReadyHistory(host, locale) {
  await host.widget.getByRole("heading", { name: copy[locale].graphHeading }).waitFor();
  const headRow = host.widget.getByRole("option", { name: /Visual baseline fixture/ });
  await headRow.waitFor();
  if (await headRow.getAttribute("aria-selected") !== "true") {
    throw new Error("HEAD is not selected by default when history mounts");
  }
  // The changed-file entry is disabled until commit detail finishes loading,
  // so matching only the enabled button is the wait.
  const baselineFile = host.widget.getByRole("button", {
    name: /baseline\.txt/,
    disabled: false,
  });
  await baselineFile.waitFor();
  return baselineFile;
}

async function reachSurface(host, testCase) {
  const { locale } = testCase;
  if (testCase.surface === "launcher") {
    // Reduced motion keeps the hint at its resting opacity, so the launcher is
    // already in its hint-visible state at mount.
    await host.widget.getByRole("button", { name: "Open GitRight" }).waitFor();
    return;
  }
  if (testCase.surface === "unavailable") {
    await host.widget.getByRole("alert").filter({ hasText: copy[locale].unavailable }).first()
      .waitFor();
    return;
  }
  const baselineFile = await waitForReadyHistory(host, locale);
  if (testCase.surface === "history") return;
  if (testCase.surface === "search") {
    await host.widget.getByRole("searchbox").fill("baseline");
    await host.widget.getByText("1 / 2", { exact: true }).waitFor();
    return;
  }
  await baselineFile.click();
  await host.widget.getByLabel(copy[locale].unifiedDiff).waitFor();
}

async function captureCase(outputDirectory, testCase, observations) {
  const host = await startPackagedAppHost({
    trustedRepositoryContext: testCase.surface === "unavailable"
      ? unavailableDirectory
      : fixtureRepository,
    viewport: { width: widths[testCase.width], height: viewportHeightPx },
    hostContext: hostContextOf(testCase),
    historySnapshotTime,
    serverEnvironment,
    reducedMotion: "reduce",
  });
  try {
    observations.resource ??= { uri: host.resource.uri, mimeType: host.resource.mimeType };
    observations.browser ??= { engine: host.browserInfo.engine, version: host.browserInfo.version };
    await reachSurface(host, testCase);
    await writeFile(path.join(outputDirectory, testCase.file), await host.capture());
    observations.networkRequests.push(...host.networkRequests);
  } finally {
    await host.close();
  }
}

/**
 * Replaces the reviewed set with a freshly captured one. The swap happens
 * only after every capture succeeded and the network check passed, so a
 * failed run leaves the previous set in place rather than a half-written one.
 */
async function publishSet(stagingDirectory, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of await readdir(outputDirectory)) {
    if (entry.endsWith(".png") || entry === "manifest.json") {
      await rm(path.join(outputDirectory, entry));
    }
  }
  for (const entry of await readdir(stagingDirectory)) {
    await copyFile(path.join(stagingDirectory, entry), path.join(outputDirectory, entry));
  }
}

async function main() {
  const outputDirectory = path.resolve(process.argv[2] ?? defaultOutputDirectory);
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), "gitright-visual-baseline-"));

  await createFixtureRepository();
  await rm(unavailableDirectory, { recursive: true, force: true });
  await mkdir(unavailableDirectory, { recursive: true });

  const observations = { resource: null, browser: null, networkRequests: [] };
  for (const testCase of referenceCases) {
    await captureCase(stagingDirectory, testCase, observations);
  }
  if (observations.networkRequests.length !== 0) {
    throw new Error(
      `GitRight made browser network requests: ${JSON.stringify(observations.networkRequests)}`,
    );
  }

  const manifest = {
    version: 2,
    packagedResource: observations.resource,
    captureInputs: {
      browser: observations.browser,
      viewportHeightPx,
      widths,
      themes,
      locales: localeTags,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      timezone: "UTC",
      hostSurfaceBackgroundColor: { published: false, fallback: surfaceFallbackColors },
      historySnapshotTime,
      browserNetworkPolicy: "block-and-record-http-and-https",
      serverEnvironment,
      fixtureRepositoryPath: fixtureRepository,
    },
    captures: referenceCases.map((testCase) => ({
      file: testCase.file,
      surface: testCase.surface,
      widthPx: widths[testCase.width],
      theme: testCase.theme,
      locale: testCase.locale,
      displayMode: displayModeOf(testCase),
    })),
  };
  await writeFile(
    path.join(stagingDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await publishSet(stagingDirectory, outputDirectory);
  await rm(stagingDirectory, { recursive: true, force: true });
  process.stdout.write(`visual_baseline_captures=${referenceCases.length}\n`);
  process.stdout.write(`visual_baseline_network_requests=${observations.networkRequests.length}\n`);
  process.stdout.write(`visual_baseline_output=${path.relative(repositoryRoot, outputDirectory)}\n`);
}

await main();
