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
