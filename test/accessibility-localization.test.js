import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import {
  commitAccessibilityLabel,
  copyFor,
  diffLineAccessibilityLabel,
  fileAccessibilityLabel,
  formatRelativeTime,
  isActivationKey,
  resolveLocale,
  translateServiceMessage,
} from "../plugins/gitright/widget/localization.ts";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname);

test("uses RFC 4647 lookup for Japanese regional tags and predictable English fallback", () => {
  assert.equal(resolveLocale("ja"), "ja");
  assert.equal(resolveLocale("ja-JP"), "ja");
  assert.equal(resolveLocale("JA-jp"), "ja");
  assert.equal(resolveLocale("ja-Kana-JP"), "ja");
  assert.equal(resolveLocale("ja-JP-u-ca-japanese"), "ja");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("en-GB-x-codex"), "en");
  assert.equal(resolveLocale("fr-FR"), "en");
  assert.equal(resolveLocale("not_a_locale"), "en");
  assert.equal(resolveLocale(undefined), "en");
});

test("localizes complete chrome and service states without changing repository text", () => {
  const en = copyFor("en");
  const ja = copyFor("ja");

  assert.equal(en.graphTopology, "Graph topology");
  assert.equal(ja.graphTopology, "グラフトポロジー");
  assert.equal(en.openInRightPane, "Open GitRight");
  assert.equal(ja.openInRightPane, "Open GitRight");
  assert.equal(en.openingRightPane, "Opening the right pane…");
  assert.equal(ja.openingRightPane, "右ペインを開いています…");
  assert.equal(en.rightPaneUnavailable, "The right pane is unavailable in this host.");
  assert.equal(ja.rightPaneUnavailable, "このホストでは右ペインを利用できません。");
  assert.equal(en.rightPaneFailed, "The right pane did not open. Try again.");
  assert.equal(ja.rightPaneFailed, "右ペインを開けませんでした。もう一度お試しください。");
  assert.equal(en.rightPaneUnsupported, "GitRight opens only in the right pane. Try again.");
  assert.equal(ja.rightPaneUnsupported, "GitRightは右ペインでのみ開きます。もう一度お試しください。");
  assert.equal(en.useCommitShaInConversation, "Use commit SHA in conversation");
  assert.equal(ja.useCommitShaInConversation, "コミットSHAを会話で使う");
  assert.equal(en.commitShaShared, "Commit SHA added to conversation context.");
  assert.equal(ja.commitShaShared, "コミットSHAを会話コンテキストに追加しました。");
  assert.equal(
    en.conversationHandoffUnavailable,
    "Conversation handoff is unavailable in this host.",
  );
  assert.equal(
    ja.conversationHandoffUnavailable,
    "このホストでは会話への引き渡しを利用できません。",
  );
  assert.equal(en.searchPlaceholder, "Search");
  assert.equal(ja.searchPlaceholder, "検索");
  assert.equal(en.previousMatch, "Previous match");
  assert.equal(ja.previousMatch, "前のマッチ");
  assert.equal(en.nextMatch, "Next match");
  assert.equal(ja.nextMatch, "次のマッチ");
  assert.equal(en.searchMatchStatus(2, 4), "Match 2 of 4");
  assert.equal(ja.searchMatchStatus(2, 4), "4件中2件目のマッチ");
  assert.equal(en.searchMatchStatus(0, 0), "No loaded commits match.");
  assert.equal(ja.searchMatchStatus(0, 0), "一致する読み込み済みコミットはありません。");
  assert.equal(en.loadedCommits(141), "141 commits loaded");
  assert.equal(ja.loadedCommits(141), "141件を読み込み済み");
  assert.equal(en.changedFilesCount(3), "3 changed files");
  assert.equal(ja.changedFilesCount(3), "変更ファイル 3件");
  assert.equal(en.closeDiff, "Close diff");
  assert.equal(ja.closeDiff, "差分を閉じる");
  for (const removedKey of ["backToDetail", "lastGoodReadOnly", "local"]) {
    assert.equal(removedKey in en, false);
    assert.equal(removedKey in ja, false);
  }
  assert.equal(en.detachedHead, "HEAD (detached)");
  assert.equal(ja.detachedHead, "HEAD (detached)");
  assert.equal(ja.repositoryStatus, "現在のリポジトリ状態");
  assert.equal(ja.repositoryLocation, "リポジトリの場所");
  assert.equal(ja.branchLabel, "ブランチ");
  assert.equal(ja.copySha, "SHAをコピー");
  assert.equal(ja.commitHistory, "コミット履歴");
  assert.equal(en.fileStatusBadge("added"), "A");
  assert.equal(ja.fileStatusBadge("renamed"), "R");
  assert.equal(ja.changedFiles, "変更ファイル");
  assert.equal(ja.oldLine, "変更前の行");
  assert.equal(ja.worktree, "作業ツリー");
  assert.equal(ja.shallowBoundary, "浅い履歴の境界");
  assert.equal(ja.loadingDiff("src/そのまま.ts"), "src/そのまま.ts の差分を読み込み中…");
  assert.equal(
    translateServiceMessage("History is unavailable", ja),
    "履歴を利用できません",
  );
  assert.equal(
    translateServiceMessage("No longer reachable from current refs", ja),
    "現在のrefから到達できなくなりました",
  );
  assert.equal(
    translateServiceMessage("Selected commit is no longer available", ja),
    "選択したコミットを利用できなくなりました",
  );
  assert.equal(
    translateServiceMessage("repository-provided text", ja),
    "repository-provided text",
  );
});

test("formats snapshot-relative time in the selected locale", () => {
  const snapshot = 1_800_000_000;
  assert.equal(formatRelativeTime(snapshot - 5, snapshot, "en"), "5 seconds ago");
  assert.equal(formatRelativeTime(snapshot - 3_600, snapshot, "en"), "1 hour ago");
  assert.equal(formatRelativeTime(snapshot - 3_600, snapshot, "ja"), "1時間前");
  assert.equal(formatRelativeTime(snapshot, snapshot, "ja"), "たった今");
});

test("commit labels expose selection, role, lane, parents, refs, and boundaries", () => {
  const label = commitAccessibilityLabel(copyFor("ja"), {
    subject: "Repository subject — 変更しない",
    selected: true,
    role: "octopus merge",
    lane: 4,
    parents: [
      { shortSha: "1111111", state: "loaded" },
      { shortSha: "2222222", state: "continuation" },
      { shortSha: "3333333", state: "shallow" },
    ],
    refs: [
      { name: "feature/そのまま", worktree: true },
      { name: "v1.0", worktree: false },
    ],
    shortSha: "abcdef0",
    relativeTime: "2日前",
    offscreenParents: { left: 1, right: 2 },
  });

  assert.match(label, /^選択中;/);
  assert.match(label, /Repository subject — 変更しない/);
  assert.match(label, /オクトパスマージ/);
  assert.match(label, /レーン 4/);
  assert.match(label, /2222222.*読み込み範囲外/);
  assert.match(label, /3333333.*浅い履歴の境界/);
  assert.match(label, /feature\/そのまま.*作業ツリー/);
  assert.match(label, /画面外の直接の親 左 1、右 2/);
});

test("file and diff labels preserve paths and expose status and hunk meaning", () => {
  const ja = copyFor("ja");
  const file = fileAccessibilityLabel(ja, {
    selected: true,
    status: "renamed",
    path: "新しい 名前.ts",
    oldPath: "古い 名前.ts",
    additions: 2,
    deletions: 1,
  });
  assert.match(file, /選択中/);
  assert.match(file, /名前変更/);
  assert.match(file, /古い 名前\.ts/);
  assert.match(file, /新しい 名前\.ts/);
  assert.match(file, /追加 2、削除 1/);

  const hunk = diffLineAccessibilityLabel(ja, {
    kind: "hunk",
    content: "@@ -1,2 +1,3 @@",
    oldLine: null,
    newLine: null,
  });
  assert.equal(hunk, "差分ハンク; @@ -1,2 +1,3 @@");
});

test("standard Enter and Space activation is shared by commit rows", () => {
  assert.equal(isActivationKey("Enter"), true);
  assert.equal(isActivationKey(" "), true);
  assert.equal(isActivationKey("Spacebar"), false);
  assert.equal(isActivationKey("ArrowDown"), false);
});

test("the GitRight visual layer defines its tokens and never shows the UA mark yellow", async () => {
  const styles = await readFile(
    path.join(repositoryRoot, "plugins/gitright/widget/styles.css"),
    "utf8",
  );

  // GitRight-defined tokens, light and dark, on system typography.
  assert.match(styles, /html\[data-theme="light"\]\s*\{[^}]*--gr-surface:\s*#fbfbfd/);
  assert.match(styles, /html\[data-theme="light"\]\s*\{[^}]*--gr-text:\s*#1d1d1f/);
  assert.match(styles, /html\[data-theme="light"\]\s*\{[^}]*--gr-accent:\s*#007aff/);
  assert.match(styles, /html\[data-theme="dark"\]\s*\{[^}]*--gr-surface:\s*#1c1c1e/);
  assert.match(styles, /html\[data-theme="dark"\]\s*\{[^}]*--gr-accent:\s*#0a84ff/);
  assert.match(styles, /--gr-add:\s*#1e7a3c/);
  assert.match(styles, /--gr-del:\s*#c4362b/);
  assert.match(styles, /--gr-font:\s*-apple-system/);
  assert.doesNotMatch(styles, /@openai\/apps-sdk-ui/);
  assert.doesNotMatch(styles, /--color-(?:text|surface|border|background)\b/);

  // the UA default <mark> yellow must be reset.
  assert.match(styles, /mark\s*\{[^}]*background:\s*transparent/);

  // only text sinks on non-matching rows; lane rails keep their look.
  assert.match(
    styles,
    /\.gr-row\.gr-dim \.gr-subject,\s*\.gr-row\.gr-dim \.gr-refs\s*\{[^}]*opacity:\s*0\.35/,
  );
  assert.doesNotMatch(styles, /\.gr-dim[^{]*(?:rail|svg|path)[^{]*\{/);

  // Focus visibility and selection emphasis use the accent, not hue alone.
  assert.match(styles, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gr-accent\)/);
  assert.match(styles, /\.graph-selection-ring\s*\{[^}]*stroke:\s*var\(--gr-accent\)/);
  assert.match(styles, /\.gr-row\[aria-selected="true"\]\s*\{[^}]*--graph-panel/);

  // Diff semantics carry text signals (::first-letter) in addition to tint.
  assert.match(styles, /\.diff-addition \.diff-line-content code::first-letter/);
  assert.match(styles, /\.diff-deletion \.diff-line-content code::first-letter/);
});

test("production widget keeps one row target, hidden SVG, responsive data, and reduced motion", async () => {
  const [source, styles, bundledStyles] = await Promise.all([
    readFile(path.join(repositoryRoot, "plugins/gitright/widget/index.tsx"), "utf8"),
    readFile(path.join(repositoryRoot, "plugins/gitright/widget/styles.css"), "utf8"),
    readFile(path.join(repositoryRoot, "plugins/gitright/dist/widget.css"), "utf8"),
  ]);

  const row = source.slice(source.indexOf("function HistoryRow"), source.indexOf("function HistoryList"));
  const view = source.slice(source.indexOf("function GitRightView"), source.indexOf("function App"));
  const launcher = source.slice(source.indexOf("function App"), source.indexOf("const rootElement"));

  // no Apps SDK UI dependency anywhere in the widget source.
  assert.doesNotMatch(source, /@openai\/apps-sdk-ui/);

  // §13: the commit row is the single keyboard target; its SVG never becomes
  // a second Tab stop; the rail viewport is not tabbable.
  assert.match(row, /role="option"[\s\S]*aria-selected=\{selected\}/);
  assert.match(row, /className="graph-rail-viewport"[\s\S]*tabIndex=\{-1\}/);
  assert.match(row, /aria-hidden="true"[\s\S]*focusable="false"/);
  assert.match(row, /aria-label=\{commitAccessibilityLabel\(copy/);
  assert.doesNotMatch(row, /<details|<summary|CompleteRefsPopover/);

  // §13: Up and Down arrows move the commit selection within the list.
  assert.match(row, /"ArrowDown"[\s\S]*onStepSelection\(commit, 1\)/);
  assert.match(row, /"ArrowUp"[\s\S]*onStepSelection\(commit, -1\)/);

  // §13: hidden headings and labels preserve the semantic outline where the
  // visual design removed visible text.
  assert.match(view, /className="visually-hidden"[\s\S]*copy\.graphTopology/);
  assert.match(view, /aria-label=\{copy\.searchLoadedCommits\}/);
  assert.match(view, /role="listbox"|aria-labelledby="gr-history-heading"/);

  // match navigation is keyboard reachable and announced politely.
  assert.match(view, /aria-label=\{copy\.previousMatch\}/);
  assert.match(view, /aria-label=\{copy\.nextMatch\}/);
  assert.match(view, /role="status" aria-live="polite">\s*\{searchAnnouncement\}/);
  assert.match(view, /navigateMatch\(event\.shiftKey \? -1 : 1\)/);

  // the sheet is persistent — selection never navigates away, the
  // diff overlays only the graph, and detail requests debounce.
  assert.match(view, /className="gr-sheetwrap"/);
  assert.doesNotMatch(view, /surface === "history"/);
  assert.match(view, /className=\{`gr-diff-layer/);
  assert.match(source, /aria-label=\{copy\.closeDiff\}/);
  assert.doesNotMatch(source, /copy\.(?:backToDetail|lastGoodReadOnly|local)\b/);
  assert.match(source, /DETAIL_REQUEST_DEBOUNCE_MS = 150/);
  assert.match(view, /setTimeout\(\(\) => \{[\s\S]*loadCommitDetail/);

  // Loading replaces stale sheet data with inert skeletons, while the file
  // rows retain their two-line path structure and full-path labels.
  assert.match(source, /className="gr-skeleton" aria-hidden="true"/);
  assert.match(source, /className="gr-file-name"/);
  assert.match(source, /className="gr-file-dir"/);
  assert.match(source, /title=\{file\.oldPath \? `\$\{file\.oldPath\} → \$\{file\.path\}` : file\.path\}/);

  // §2: the status bar renders app-only repository state.
  assert.match(source, /function StatusBar/);
  assert.match(source, /aria-label=\{copy\.repositoryStatus\}/);
  assert.match(source, /statusBarItems\(/);

  // Diff view keeps its focusable scroll region and labelled lines.
  assert.match(source, /className="gr-diff-scroll"[\s\S]*tabIndex=\{0\}/);
  assert.match(source, /diffViewport\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /aria-label=\{fileAccessibilityLabel\(copy/);
  assert.match(source, /aria-label=\{diffLineAccessibilityLabel\(copy, line\)\}/);

  // Host environment handling is unchanged.
  assert.match(source, /resolveHostEnvironment\(value,[\s\S]*globals:\s*window\.openai/);
  assert.match(source, /root\.lang = presentation\.lang/);
  assert.match(source, /data-theme/);

  // No hidden network or storage surface.
  assert.doesNotMatch(
    source,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB)\b/,
  );

  // Launcher keeps its explicit activation contract.
  assert.match(launcher, /requestDisplayMode\(\{ mode: "fullscreen" \}\)/);
  assert.match(launcher, /role="status"[\s\S]*aria-live="polite"/);
  assert.doesNotMatch(launcher, /setTimeout|setInterval|requestAnimationFrame|\.click\(\)/);

  // Layout supports the host environment: safe areas, max height, fullscreen,
  // the 380px rail budget, and reduced motion.
  assert.match(styles, /padding-top:\s*calc\([^;]*--host-safe-area-top/);
  assert.match(styles, /max-height:\s*var\(--host-max-height\)/);
  assert.match(styles, /html\[data-display-mode="fullscreen"\]/);
  assert.match(styles, /min\(.*200px.*calc\(100% - 180px\)\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none !important/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none !important/);
  assert.match(styles, /@keyframes gr-pulse\s*\{/);
  assert.match(styles, /\.gr-skeleton span\s*\{[^}]*animation:\s*gr-pulse/);
  assert.match(styles, /\.gr-diff-layer\s*\{[^}]*z-index:\s*4[^}]*animation:\s*gr-diff-layer-in/);
  assert.match(styles, /\.gr-diff-layer-closing\s*\{[^}]*animation:\s*gr-diff-layer-out/);
  assert.match(
    styles,
    /\.gr-diff-layer-switch-forward\s*\{[^}]*animation:\s*gr-diff-layer-in-right/,
  );
  assert.match(
    styles,
    /\.gr-diff-layer-switch-backward\s*\{[^}]*animation:\s*gr-diff-layer-in-left/,
  );
  assert.match(
    styles,
    /\.gr-diff-layer-switch-out-left\s*\{[^}]*animation:\s*gr-diff-layer-out-left/,
  );
  assert.match(
    styles,
    /\.gr-diff-layer-switch-out-right\s*\{[^}]*animation:\s*gr-diff-layer-out-right/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.gr-diff-layer[\s\S]*animation:\s*none/,
  );
  assert.match(styles, /html\[data-theme="dark"\]/);

  // The bundled stylesheet stays self-contained.
  assert.doesNotMatch(bundledStyles, /url\(\s*["']?https?:\/\//);
  assert.match(bundledStyles, /--gr-font:\s*-apple-system/);
});
