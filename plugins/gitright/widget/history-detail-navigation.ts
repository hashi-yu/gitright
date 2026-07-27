export type HistoryTopologyMode = "graph" | "text";

export type HistoryPresentation = {
  query: string;
  topologyMode: HistoryTopologyMode;
  graphScrollLeft: number;
};

export type HistoryReturnTarget = {
  originatingSha: string;
  verticalScrollTop: number;
  graphScrollLeft: number;
};

export function createHistoryPresentation(): HistoryPresentation {
  return {
    query: "",
    topologyMode: "graph",
    graphScrollLeft: 0,
  };
}

export function updateHistoryPresentation(
  current: HistoryPresentation,
  update: Partial<HistoryPresentation>,
): HistoryPresentation {
  return { ...current, ...update };
}

export function captureHistoryReturnTarget(
  originatingSha: string,
  verticalScrollTop: number,
  graphScrollLeft: number,
): HistoryReturnTarget {
  return {
    originatingSha,
    verticalScrollTop: Number.isFinite(verticalScrollTop) && verticalScrollTop >= 0
      ? verticalScrollTop
      : 0,
    graphScrollLeft: Number.isFinite(graphScrollLeft) && graphScrollLeft >= 0
      ? graphScrollLeft
      : 0,
  };
}
