export type ChangedFileStateEntry = {
  fileId: string;
  status: string;
  path: string;
  oldPath: string | null;
};

export type ChangedFileStateDetail<TFile extends ChangedFileStateEntry> = {
  detailId: string;
  loadedFileCount: number;
  totalFileCount: number;
  hasMoreFiles: boolean;
  files: TFile[];
};

export type ChangedFileStatePage<TFile extends ChangedFileStateEntry> = {
  status: "ready";
  detailId: string;
  previousLoadedCount: number;
  previousLastFileId: string | null;
  loadedCount: number;
  totalCount: number;
  pageSize: 500;
  hasMoreFiles: boolean;
  files: TFile[];
};

export type AppendChangedFilePageResult<TFile extends ChangedFileStateEntry> =
  | { status: "ready"; detail: ChangedFileStateDetail<TFile> }
  | {
      status: "error";
      message: "Changed-file page boundary is invalid";
      detail: ChangedFileStateDetail<TFile>;
    };

export type ChangedFilePageRequestToken = {
  detailId: string;
  generation: number;
};

export function createChangedFilePageGuard() {
  let generation = 0;
  let activeDetailId: string | null = null;
  return {
    begin(detailId: string): ChangedFilePageRequestToken {
      generation += 1;
      activeDetailId = detailId;
      return { detailId, generation };
    },
    invalidate(): void {
      generation += 1;
      activeDetailId = null;
    },
    accepts(token: ChangedFilePageRequestToken): boolean {
      return token.generation === generation && token.detailId === activeDetailId;
    },
  };
}

function invalidPage<TFile extends ChangedFileStateEntry>(
  detail: ChangedFileStateDetail<TFile>,
): AppendChangedFilePageResult<TFile> {
  return {
    status: "error",
    message: "Changed-file page boundary is invalid",
    detail,
  };
}

export function appendChangedFilePage<TFile extends ChangedFileStateEntry>(
  detail: ChangedFileStateDetail<TFile>,
  page: ChangedFileStatePage<TFile>,
): AppendChangedFilePageResult<TFile> {
  const previousLastFileId = detail.files.at(-1)?.fileId ?? null;
  if (
    page.detailId !== detail.detailId ||
    page.pageSize !== 500 ||
    page.previousLoadedCount !== detail.loadedFileCount ||
    page.previousLastFileId !== previousLastFileId ||
    page.files.length === 0 ||
    page.files.length > 500 ||
    page.loadedCount !== detail.loadedFileCount + page.files.length ||
    page.totalCount !== detail.totalFileCount ||
    page.loadedCount > page.totalCount ||
    page.hasMoreFiles !== (page.loadedCount < page.totalCount)
  ) {
    return invalidPage(detail);
  }

  const fileIds = new Set(detail.files.map((file) => file.fileId));
  for (const file of page.files) {
    if (fileIds.has(file.fileId)) return invalidPage(detail);
    fileIds.add(file.fileId);
  }
  return {
    status: "ready",
    detail: {
      ...detail,
      loadedFileCount: page.loadedCount,
      hasMoreFiles: page.hasMoreFiles,
      files: [...detail.files, ...page.files],
    },
  };
}

export function searchLoadedChangedFiles<TFile extends ChangedFileStateEntry>(
  files: readonly TFile[],
  query: string,
): TFile[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...files];
  return files.filter((file) =>
    file.path.toLocaleLowerCase().includes(needle) ||
    file.oldPath?.toLocaleLowerCase().includes(needle) ||
    file.status.toLocaleLowerCase().includes(needle),
  );
}
