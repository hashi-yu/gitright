function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function restoreMissingNulls(
  value: Record<string, unknown>,
  fields: readonly string[],
): { value: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const restored = { ...value };
  for (const field of fields) {
    if (!(field in value)) {
      restored[field] = null;
      changed = true;
    }
  }
  return { value: restored, changed };
}

function restoreOmittedChangedFileNulls(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.files)) return value;
  let changed = false;
  const files = value.files.map((file) => {
    if (!isRecord(file)) return file;
    const restored = restoreMissingNulls(file, ["oldPath", "additions", "deletions"]);
    changed ||= restored.changed;
    return restored.value;
  });
  return changed ? { ...value, files } : value;
}

export function restoreOmittedHistoryNulls(value: unknown): unknown {
  if (!isRecord(value) || value.status !== "ready") return value;
  if ("snapshotTime" in value || "headSha" in value) {
    return restoreMissingNulls(value, ["headSha"]).value;
  }
  if ("previousLoadedCount" in value || "previousLastCommitSha" in value) {
    return restoreMissingNulls(value, ["previousLastCommitSha"]).value;
  }
  return value;
}

export function restoreOmittedCommitDetailNulls(value: unknown): unknown {
  const withFiles = restoreOmittedChangedFileNulls(value);
  if (!isRecord(withFiles) || withFiles.status !== "ready") return withFiles;
  return restoreMissingNulls(withFiles, ["selectedParentIndex", "selectedParentSha"]).value;
}

export function restoreOmittedChangedFilePageNulls(value: unknown): unknown {
  const withFiles = restoreOmittedChangedFileNulls(value);
  if (!isRecord(withFiles) || withFiles.status !== "ready") return withFiles;
  return restoreMissingNulls(withFiles, ["previousLastFileId"]).value;
}

export function restoreOmittedFileDiffNulls(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.status === "error") {
    return restoreMissingNulls(value, ["path"]).value;
  }
  if (value.status !== "ready") return value;

  let restored = restoreMissingNulls(value, ["oldPath", "truncatedBy"]);
  const statistics = restored.value.statistics;
  if (isRecord(statistics)) {
    const restoredStatistics = restoreMissingNulls(statistics, ["additions", "deletions"]);
    if (restoredStatistics.changed) {
      restored = {
        value: { ...restored.value, statistics: restoredStatistics.value },
        changed: true,
      };
    }
  }

  const lines = restored.value.lines;
  if (!Array.isArray(lines)) return restored.changed ? restored.value : value;
  let linesChanged = false;
  const restoredLines = lines.map((line) => {
    if (!isRecord(line)) return line;
    const restoredLine = restoreMissingNulls(line, ["oldLine", "newLine"]);
    linesChanged ||= restoredLine.changed;
    return restoredLine.value;
  });
  return linesChanged ? { ...restored.value, lines: restoredLines } : restored.value;
}
