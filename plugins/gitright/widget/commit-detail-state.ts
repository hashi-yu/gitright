export type CommitDetailLoadState<T> = {
  detail: T | null;
  notice: string | null;
};

export type CommitSelectionLoadState<T> = CommitDetailLoadState<T> & {
  surface: "history" | "detail";
  loading: boolean;
};

type CommitDetailSelection = {
  snapshotId: string;
  sha: string;
  parents: readonly string[];
  selectedParentIndex: number | null;
};

export function commitDetailMatchesSelection(
  detail: CommitDetailSelection,
  snapshotId: string | null,
  sha: string | null,
  parentIndex: number,
): boolean {
  const selectedParentIndex = detail.parents.length === 0 ? null : parentIndex;
  return detail.snapshotId === snapshotId &&
    detail.sha === sha &&
    detail.selectedParentIndex === selectedParentIndex;
}

export function beginCommitSelectionLoad<T>(
  cachedDetail: T | null,
): CommitSelectionLoadState<T> {
  return cachedDetail === null
    ? { surface: "history", detail: null, notice: null, loading: true }
    : { surface: "detail", detail: cachedDetail, notice: null, loading: false };
}

export function finishCommitSelectionLoad<T>(
  detail: T,
): CommitSelectionLoadState<T> {
  return { surface: "detail", detail, notice: null, loading: false };
}

export function failCommitSelectionLoad<T = never>(
  message: string,
): CommitSelectionLoadState<T> {
  return { surface: "history", detail: null, notice: message, loading: false };
}

export function beginCommitDetailLoad<T>(
  retainedDetail: T | null,
): CommitDetailLoadState<T> {
  return {
    detail: retainedDetail,
    notice: null,
  };
}

export function failCommitDetailLoad<T>(
  lastGood: T | null,
  message: string,
): CommitDetailLoadState<T> {
  return { detail: lastGood, notice: message };
}

export function finishCommitDetailLoad<T>(
  detail: T,
): CommitDetailLoadState<T> {
  return { detail, notice: null };
}
