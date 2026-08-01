export type GitRightLocale = "en" | "ja";

type CommitRole = "root" | "commit" | "merge" | "octopus merge";
type FileStatus = "added" | "modified" | "deleted" | "renamed" | "type-changed" | "unknown";
type DiffLineKind = "header" | "hunk" | "context" | "addition" | "deletion" | "meta";

export type Copy = ReturnType<typeof createEnglishCopy>;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function createEnglishCopy() {
  return {
    locale: "en" as GitRightLocale,
    openingRepository: "Opening repository…",
    checkingRepository: "Checking the trusted repository context for this task.",
    openFromRepositoryTask: "Open GitRight from a repository-linked Codex task.",
    openInRightPane: "Open GitRight",
    openingRightPane: "Opening the right pane…",
    rightPaneUnavailable: "The right pane is unavailable in this host.",
    rightPaneFailed: "The right pane did not open. Try again.",
    rightPaneUnsupported: "GitRight opens only in the right pane. Try again.",
    graphTopology: "Graph topology",
    textTopology: "Text topology",
    topologyView: "Topology view",
    graph: "Graph",
    text: "Text",
    refresh: "Refresh",
    refreshing: "Refreshing…",
    searchLoadedCommits: "Search loaded commits (subject, SHA, or ref)",
    searchPlaceholder: "Search",
    previousMatch: "Previous match",
    nextMatch: "Next match",
    commitHistory: "Commit history",
    loadingHistory: "Loading available history…",
    historyUnavailable: "History unavailable",
    noCommits: "No commits",
    noMatchingCommits: "No loaded commits match.",
    loading: "Loading…",
    loadMore: "Load 500 more",
    loadContinuation: "Load continuation",
    refs: "Refs",
    completeRefSet: "Complete ref set",
    worktree: "worktree",
    shallowBoundary: "shallow boundary",
    continuation: "continues",
    selected: "Selected",
    notSelected: "Not selected",
    diffTruncated: "Diff truncated",
    originalFileStatistics: "Original file statistics",
    oldLine: "Old line",
    newLine: "New line",
    plainTextDiff: "Plain text diff",
    commitDetail: "Commit detail",
    closeDiff: "Close diff",
    metaSha: "SHA",
    metaParents: "Parents",
    copySha: "Copy SHA",
    shaCopied: "SHA copied",
    repositoryStatus: "Current repository status",
    repositoryLocation: "Repository location",
    branchLabel: "Branch",
    detachedHead: "HEAD (detached)",
    useCommitShaInConversation: "Use commit SHA in conversation",
    sharingCommitSha: "Sharing commit SHA…",
    commitShaShared: "Commit SHA added to conversation context.",
    conversationHandoffUnavailable: "Conversation handoff is unavailable in this host.",
    conversationHandoffFailed: "Commit SHA could not be added to conversation context.",
    loadingCommitDetail: "Loading commit detail…",
    renameDetectionSkipped: "Rename detection skipped",
    noCommitMessage: "(no commit message)",
    noSubject: "(no subject)",
    author: "Author",
    noAuthorName: "(no author name)",
    authorDate: "Author date",
    committerDate: "Committer date",
    compareWithParent: "Compare changed files with parent",
    noDirectParents: "None (root commit)",
    noRefs: "No refs point to this commit.",
    changedFiles: "Changed files",
    searchLoadedFiles: "Search loaded changed files",
    fileSearchPlaceholder: "New path, old path, or status",
    noChangedFiles: "No changed files.",
    noMatchingFiles: "No loaded files match.",
    loadingFiles: "Loading files…",
    loadMoreFiles: "Load 500 more files",
    binary: "binary",
    diagnosticsCopied: "Diagnostics copied",
    copyFailed: "Copy failed",
    copyDiagnostics: "Copy diagnostics",
    loadedCommits: (count: number) => `${count} ${plural(count, "commit")} loaded`,
    searchMatchStatus: (current: number, total: number) =>
      total === 0 ? "No loaded commits match." : `Match ${current} of ${total}`,
    changedFilesCount: (count: number) => `${count} changed ${plural(count, "file")}`,
    graphBoundary: (count: number) =>
      `${count} parent ${plural(count, "lane")} continue beyond the available rows.`,
    loadingDiff: (path: string) => `Loading diff for ${path}…`,
    unifiedDiffFor: (path: string) => `Unified diff for ${path}`,
    parent: (index: number) => `Parent ${index}`,
    loadedFiles: (loaded: number, total: number) => `${loaded} of ${total} loaded`,
    fileSearchResult: (visible: number, loaded: number) => `${visible} of ${loaded} loaded files`,
    fileSummary: (files: number, additions: number, deletions: number, binaries: number) =>
      `${files} ${plural(files, "file")} · +${additions} −${deletions}${
        binaries > 0 ? ` · ${binaries} binary` : ""
      }`,
    requiredGit: (required: string, detected: string) =>
      `Required ${required}; detected ${detected}.`,
    roleName: (role: CommitRole): string => role,
    fileStatus: (status: FileStatus) => status === "type-changed"
      ? "Type changed"
      : `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`,
    fileStatusBadge: (status: FileStatus): string => ({
      added: "A",
      modified: "M",
      deleted: "D",
      renamed: "R",
      "type-changed": "T",
      unknown: "?",
    })[status],
    diffKind: (kind: DiffLineKind) => ({
      header: "Diff header",
      hunk: "Diff hunk",
      context: "Context line",
      addition: "Added line",
      deletion: "Deleted line",
      meta: "Diff metadata",
    })[kind],
    additionsDeletions: (additions: number, deletions: number) =>
      `additions ${additions}, deletions ${deletions}`,
    oldToNewPath: (oldPath: string, path: string) => `${oldPath} to ${path}`,
    parentLoaded: (sha: string) => `parent ${sha}`,
    parentContinuation: (sha: string) => `parent ${sha} continues beyond the loaded page`,
    parentShallow: (sha: string) => `parent ${sha} is beyond the shallow boundary`,
    noDirectParentLabel: "No direct parents; root commit",
    lane: (lane: number) => `lane ${lane}`,
    refSet: (refs: string) => `refs ${refs}`,
    noRefLabel: "no refs",
    offscreenParents: (left: number, right: number) =>
      `offscreen direct parents left ${left}, right ${right}`,
    worktreeRef: (name: string) => `${name} (worktree)`,
    fileSelection: (selected: boolean): string => selected ? "Selected" : "Not selected",
  };
}

function createJapaneseCopy(): Copy {
  return {
    ...createEnglishCopy(),
    locale: "ja",
    openingRepository: "リポジトリを開いています…",
    checkingRepository: "このタスクの信頼されたリポジトリ情報を確認しています。",
    openFromRepositoryTask: "リポジトリにリンクされた Codex タスクから GitRight を開いてください。",
    openInRightPane: "Open GitRight",
    openingRightPane: "右ペインを開いています…",
    rightPaneUnavailable: "このホストでは右ペインを利用できません。",
    rightPaneFailed: "右ペインを開けませんでした。もう一度お試しください。",
    rightPaneUnsupported: "GitRightは右ペインでのみ開きます。もう一度お試しください。",
    graphTopology: "グラフトポロジー",
    textTopology: "テキストトポロジー",
    topologyView: "トポロジー表示",
    graph: "グラフ",
    text: "テキスト",
    refresh: "更新",
    refreshing: "更新中…",
    searchLoadedCommits: "読み込み済みコミットを検索（件名、SHA、ref）",
    searchPlaceholder: "検索",
    previousMatch: "前のマッチ",
    nextMatch: "次のマッチ",
    commitHistory: "コミット履歴",
    loadingHistory: "利用可能な履歴を読み込み中…",
    historyUnavailable: "履歴を利用できません",
    noCommits: "コミットはありません",
    noMatchingCommits: "一致する読み込み済みコミットはありません。",
    loading: "読み込み中…",
    loadMore: "さらに500件読み込む",
    loadContinuation: "続きを読み込む",
    refs: "ref",
    completeRefSet: "すべてのref",
    worktree: "作業ツリー",
    shallowBoundary: "浅い履歴の境界",
    continuation: "続きあり",
    selected: "選択中",
    notSelected: "未選択",
    diffTruncated: "差分は途中までです",
    originalFileStatistics: "元ファイルの統計",
    oldLine: "変更前の行",
    newLine: "変更後の行",
    plainTextDiff: "プレーンテキスト差分",
    commitDetail: "コミット詳細",
    closeDiff: "差分を閉じる",
    metaSha: "SHA",
    metaParents: "親",
    copySha: "SHAをコピー",
    shaCopied: "SHAをコピーしました",
    repositoryStatus: "現在のリポジトリ状態",
    repositoryLocation: "リポジトリの場所",
    branchLabel: "ブランチ",
    detachedHead: "HEAD (detached)",
    useCommitShaInConversation: "コミットSHAを会話で使う",
    sharingCommitSha: "コミットSHAを共有中…",
    commitShaShared: "コミットSHAを会話コンテキストに追加しました。",
    conversationHandoffUnavailable: "このホストでは会話への引き渡しを利用できません。",
    conversationHandoffFailed: "コミットSHAを会話コンテキストに追加できませんでした。",
    loadingCommitDetail: "コミット詳細を読み込み中…",
    renameDetectionSkipped: "名前変更の検出を省略しました",
    noCommitMessage: "（コミットメッセージなし）",
    noSubject: "（件名なし）",
    author: "作成者",
    noAuthorName: "（作成者名なし）",
    authorDate: "作成日時",
    committerDate: "コミット日時",
    compareWithParent: "親ごとの変更ファイル比較",
    noDirectParents: "なし（rootコミット）",
    noRefs: "このコミットを指すrefはありません。",
    changedFiles: "変更ファイル",
    searchLoadedFiles: "読み込み済み変更ファイルを検索",
    fileSearchPlaceholder: "新しいパス、古いパス、状態",
    noChangedFiles: "変更ファイルはありません。",
    noMatchingFiles: "一致する読み込み済みファイルはありません。",
    loadingFiles: "ファイルを読み込み中…",
    loadMoreFiles: "さらに500ファイル読み込む",
    binary: "バイナリ",
    diagnosticsCopied: "診断情報をコピーしました",
    copyFailed: "コピーに失敗しました",
    copyDiagnostics: "診断情報をコピー",
    loadedCommits: (count) => `${count}件を読み込み済み`,
    searchMatchStatus: (current, total) =>
      total === 0 ? "一致する読み込み済みコミットはありません。" : `${total}件中${current}件目のマッチ`,
    changedFilesCount: (count) => `変更ファイル ${count}件`,
    graphBoundary: (count) => `${count}本の親レーンが表示行の先へ続きます。`,
    loadingDiff: (path) => `${path} の差分を読み込み中…`,
    unifiedDiffFor: (path) => `${path} の統合差分`,
    parent: (index) => `親 ${index}`,
    loadedFiles: (loaded, total) => `${total}件中${loaded}件を読み込み済み`,
    fileSearchResult: (visible, loaded) => `読み込み済み${loaded}件中${visible}件`,
    fileSummary: (files, additions, deletions, binaries) =>
      `${files}ファイル · +${additions} −${deletions}${binaries > 0 ? ` · バイナリ${binaries}件` : ""}`,
    requiredGit: (required, detected) => `必要: ${required}、検出: ${detected}。`,
    roleName: (role) => ({
      root: "rootコミット",
      commit: "コミット",
      merge: "マージ",
      "octopus merge": "オクトパスマージ",
    })[role],
    fileStatus: (status) => ({
      added: "追加",
      modified: "変更",
      deleted: "削除",
      renamed: "名前変更",
      "type-changed": "種類変更",
      unknown: "不明",
    })[status],
    diffKind: (kind) => ({
      header: "差分ヘッダー",
      hunk: "差分ハンク",
      context: "前後行",
      addition: "追加行",
      deletion: "削除行",
      meta: "差分メタデータ",
    })[kind],
    additionsDeletions: (additions, deletions) => `追加 ${additions}、削除 ${deletions}`,
    oldToNewPath: (oldPath, path) => `${oldPath} から ${path}`,
    parentLoaded: (sha) => `親 ${sha}`,
    parentContinuation: (sha) => `親 ${sha} は読み込み範囲外へ続きます`,
    parentShallow: (sha) => `親 ${sha} は浅い履歴の境界の先です`,
    noDirectParentLabel: "直接の親なし、rootコミット",
    lane: (lane) => `レーン ${lane}`,
    refSet: (refs) => `ref ${refs}`,
    noRefLabel: "refなし",
    offscreenParents: (left, right) => `画面外の直接の親 左 ${left}、右 ${right}`,
    worktreeRef: (name) => `${name} (作業ツリー)`,
    fileSelection: (selected) => selected ? "選択中" : "未選択",
  };
}

const englishCopy = createEnglishCopy();
const japaneseCopy = createJapaneseCopy();

export function resolveLocale(locale: string | null | undefined): GitRightLocale {
  if (!locale?.trim()) return "en";
  let candidate: string;
  try {
    candidate = Intl.getCanonicalLocales(locale.trim())[0]?.toLowerCase() ?? "";
  } catch {
    return "en";
  }
  while (candidate) {
    if (candidate === "ja") return "ja";
    if (candidate === "en") return "en";
    const separator = candidate.lastIndexOf("-");
    if (separator < 0) break;
    candidate = candidate.slice(0, separator);
    const finalSubtag = candidate.slice(candidate.lastIndexOf("-") + 1);
    if (finalSubtag.length === 1) {
      candidate = candidate.slice(0, candidate.lastIndexOf("-"));
    }
  }
  return "en";
}

export function copyFor(locale: GitRightLocale): Copy {
  return locale === "ja" ? japaneseCopy : englishCopy;
}

const japaneseServiceMessages = new Map<string, string>([
  ["Repository ready", "リポジトリの準備完了"],
  ["Current task repository is unavailable", "現在のタスクのリポジトリを利用できません"],
  ["Bare repositories are not supported in this version", "このバージョンはbareリポジトリに対応していません"],
  ["Partial clones are not supported in this version", "このバージョンはpartial cloneに対応していません"],
  ["SHA-256 repositories are not supported in this version", "このバージョンはSHA-256リポジトリに対応していません"],
  ["Git refused this repository because its ownership is not trusted", "所有権が信頼されていないためGitがこのリポジトリを拒否しました"],
  ["Resolve the repository trust outside GitRight, then open a new task", "GitRightの外でリポジトリの信頼設定を解決してから、新しいタスクを開いてください"],
  ["Git 2.30.0 or newer is required", "Git 2.30.0以降が必要です"],
  ["History is unavailable", "履歴を利用できません"],
  ["History exceeds GitRight's supported snapshot limit", "履歴がGitRightのスナップショット上限を超えています"],
  ["History page boundary is invalid", "履歴ページの境界が不正です"],
  ["History refresh is already in progress", "履歴を更新中です"],
  ["History refresh request is stale", "履歴の更新要求が古くなりました"],
  ["History changed — Refresh to continue", "履歴が変更されました — 続行するには更新してください"],
  ["No longer reachable from current refs", "現在のrefから到達できなくなりました"],
  ["Selected commit is no longer available", "選択したコミットを利用できなくなりました"],
  ["Repository is temporarily locked — Refresh to retry", "リポジトリは一時的にロックされています — 更新して再試行してください"],
  ["Repository object is missing", "リポジトリのオブジェクトがありません"],
  ["Repository object is corrupt", "リポジトリのオブジェクトが破損しています"],
  ["Commit detail is unavailable", "コミット詳細を利用できません"],
  ["Commit detail request is stale", "コミット詳細の要求が古くなりました"],
  ["Changed-file request timed out", "変更ファイルの要求がタイムアウトしました"],
  ["Changed-file page boundary is invalid", "変更ファイルページの境界が不正です"],
  ["File diff is unavailable", "ファイル差分を利用できません"],
  ["File diff request is stale", "ファイル差分の要求が古くなりました"],
  ["GitRight could not read this history snapshot.", "GitRightはこの履歴スナップショットを読み取れませんでした。"],
  ["Open GitRight from a repository-linked task.", "リポジトリにリンクされたタスクからGitRightを開いてください。"],
]);

export function translateServiceMessage(message: string, copy: Copy): string {
  return copy.locale === "ja" ? japaneseServiceMessages.get(message) ?? message : message;
}

export function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export type CommitAccessibilityInput = {
  subject: string;
  selected: boolean;
  role: CommitRole;
  lane?: number;
  parents: Array<{ shortSha: string; state: "loaded" | "continuation" | "shallow" }>;
  refs: Array<{ name: string; worktree: boolean }>;
  shortSha: string;
  relativeTime: string;
  offscreenParents?: { left: number; right: number };
};

export function commitAccessibilityLabel(copy: Copy, input: CommitAccessibilityInput): string {
  const parents = input.parents.length === 0
    ? copy.noDirectParentLabel
    : input.parents.map((parent) => parent.state === "loaded"
      ? copy.parentLoaded(parent.shortSha)
      : parent.state === "shallow"
        ? copy.parentShallow(parent.shortSha)
        : copy.parentContinuation(parent.shortSha)).join(", ");
  const refs = input.refs.length === 0
    ? copy.noRefLabel
    : input.refs.map((ref) => ref.worktree ? copy.worktreeRef(ref.name) : ref.name).join(", ");
  const parts = [
    input.selected ? copy.selected : copy.notSelected,
    input.subject || copy.noSubject,
    copy.roleName(input.role),
    input.lane === undefined ? null : copy.lane(input.lane),
    parents,
    copy.refSet(refs),
    input.shortSha,
    input.relativeTime,
  ];
  if (input.offscreenParents) {
    parts.push(copy.offscreenParents(
      input.offscreenParents.left,
      input.offscreenParents.right,
    ));
  }
  return parts.filter((part): part is string => part !== null).join("; ");
}

export type FileAccessibilityInput = {
  selected: boolean;
  status: FileStatus;
  path: string;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
};

export function fileAccessibilityLabel(copy: Copy, input: FileAccessibilityInput): string {
  const path = input.oldPath ? copy.oldToNewPath(input.oldPath, input.path) : input.path;
  const statistics = input.additions === null || input.deletions === null
    ? copy.binary
    : copy.additionsDeletions(input.additions, input.deletions);
  return [
    copy.fileSelection(input.selected),
    copy.fileStatus(input.status),
    path,
    statistics,
  ].join("; ");
}

export type DiffLineAccessibilityInput = {
  kind: DiffLineKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

export function diffLineAccessibilityLabel(
  copy: Copy,
  input: DiffLineAccessibilityInput,
): string {
  const lines = input.oldLine === null && input.newLine === null
    ? null
    : `${copy.oldLine} ${input.oldLine ?? "—"}; ${copy.newLine} ${input.newLine ?? "—"}`;
  return [copy.diffKind(input.kind), lines, input.content]
    .filter((part): part is string => part !== null)
    .join("; ");
}
