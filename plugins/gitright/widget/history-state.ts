export type HistoryStateCommit = {
  sha: string;
};

export type HistoryStateSelection =
  | { status: "none" }
  | { status: "reachable" | "unreachable" | "missing"; sha: string };

export type HistoryStateSnapshot<TCommit extends HistoryStateCommit> = {
  status: "ready";
  snapshotId: string;
  snapshotTime: number;
  refFingerprint: string;
  headSha: string | null;
  loadedCount: number;
  pageSize: 500;
  hasContinuation: boolean;
  hasMore: boolean;
  commits: TCommit[];
  selection: HistoryStateSelection;
};

export type HistoryStatePage<TCommit extends HistoryStateCommit> = {
  status: "ready";
  snapshotId: string;
  refFingerprint: string;
  previousLoadedCount: number;
  previousLastCommitSha: string | null;
  loadedCount: number;
  pageSize: 500;
  hasContinuation: boolean;
  hasMore: boolean;
  commits: TCommit[];
};

export type AppendHistoryPageResult<TCommit extends HistoryStateCommit> =
  | {
      status: "ready";
      snapshot: HistoryStateSnapshot<TCommit>;
    }
  | {
      status: "error";
      message: "History page boundary is invalid";
      snapshot: HistoryStateSnapshot<TCommit>;
    };

function invalidPage<TCommit extends HistoryStateCommit>(
  snapshot: HistoryStateSnapshot<TCommit>,
): AppendHistoryPageResult<TCommit> {
  return {
    status: "error",
    message: "History page boundary is invalid",
    snapshot,
  };
}

export function appendHistoryPage<TCommit extends HistoryStateCommit>(
  snapshot: HistoryStateSnapshot<TCommit>,
  page: HistoryStatePage<TCommit>,
): AppendHistoryPageResult<TCommit> {
  const previousLastCommitSha = snapshot.commits.at(-1)?.sha ?? null;
  if (
    page.snapshotId !== snapshot.snapshotId ||
    page.refFingerprint !== snapshot.refFingerprint ||
    page.pageSize !== 500 ||
    page.previousLoadedCount !== snapshot.loadedCount ||
    page.previousLastCommitSha !== previousLastCommitSha ||
    page.commits.length === 0 ||
    page.commits.length > 500 ||
    page.loadedCount !== snapshot.loadedCount + page.commits.length
  ) {
    return invalidPage(snapshot);
  }

  const existingShas = new Set(snapshot.commits.map((commit) => commit.sha));
  const pageShas = new Set<string>();
  for (const commit of page.commits) {
    if (existingShas.has(commit.sha) || pageShas.has(commit.sha)) {
      return invalidPage(snapshot);
    }
    pageShas.add(commit.sha);
  }

  return {
    status: "ready",
    snapshot: {
      ...snapshot,
      loadedCount: page.loadedCount,
      hasContinuation: page.hasContinuation,
      hasMore: page.hasMore,
      commits: [...snapshot.commits, ...page.commits],
    },
  };
}

export type HistoryUiState<TCommit extends HistoryStateCommit> = {
  snapshot: HistoryStateSnapshot<TCommit>;
  selectedSha: string | null;
  selectedCommit: TCommit | null;
  scrollTop: number;
  notice: string | null;
};

export function createHistoryRefreshGuard() {
  let refreshing = false;
  return {
    begin(): boolean {
      if (refreshing) return false;
      refreshing = true;
      return true;
    },
    end(): void {
      refreshing = false;
    },
    allowsSelection(): boolean {
      return !refreshing;
    },
    captureReplacementScroll(readScrollTop: () => number): number {
      return readScrollTop();
    },
  };
}

export function replaceHistorySnapshot<TCommit extends HistoryStateCommit>(
  current: HistoryUiState<TCommit>,
  snapshot: HistoryStateSnapshot<TCommit>,
  selection: HistoryStateSelection,
): HistoryUiState<TCommit> {
  if (selection.status === "none") {
    return {
      ...current,
      snapshot,
      selectedSha: null,
      selectedCommit: null,
      notice: null,
    };
  }

  if (selection.status === "reachable") {
    const selectedCommit =
      snapshot.commits.find((commit) => commit.sha === selection.sha) ??
      current.selectedCommit;
    return {
      ...current,
      snapshot,
      selectedSha: selection.sha,
      selectedCommit,
      notice: null,
    };
  }

  if (selection.status === "unreachable") {
    return {
      ...current,
      snapshot,
      selectedSha: selection.sha,
      selectedCommit: current.selectedCommit,
      notice: "No longer reachable from current refs",
    };
  }

  return {
    ...current,
    snapshot,
    selectedSha: null,
    selectedCommit: null,
    notice: "Selected commit is no longer available",
  };
}
