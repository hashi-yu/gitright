export type FileDiffRequestToken = {
  detailId: string;
  fileId: string;
  generation: number;
};

export function createFileDiffRequestGuard() {
  let generation = 0;
  let activeDetailId: string | null = null;
  let activeFileId: string | null = null;

  return {
    begin(detailId: string, fileId: string): FileDiffRequestToken {
      generation += 1;
      activeDetailId = detailId;
      activeFileId = fileId;
      return { detailId, fileId, generation };
    },
    invalidate(): void {
      generation += 1;
      activeDetailId = null;
      activeFileId = null;
    },
    accepts(token: FileDiffRequestToken): boolean {
      return (
        token.generation === generation &&
        token.detailId === activeDetailId &&
        token.fileId === activeFileId
      );
    },
  };
}
