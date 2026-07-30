export const GRAPH_METRICS = Object.freeze({
  rowHeight: 40,
  lanePitch: 18,
  lineWidth: 3,
  casingWidth: 6,
  // Lane zero sits on the 16px content inset shared with the header text and
  // the banners; the narrower right inset keeps the accepted 10px gap between
  // the last lane and the subject column.
  leftInset: 16,
  rightInset: 10,
  railCap: 200,
  subjectMinimum: 180,
  curveStrength: 0.65,
});

export type GraphCommit = {
  sha: string;
  parents: ReadonlyArray<{ sha: string }>;
  refs?: ReadonlyArray<{ kind: string; checkedOut?: boolean }>;
};

export type GraphRoute = {
  childSha: string;
  parentSha: string;
  parentIndex: number;
  childLane: number;
  parentLane: number;
  parentAlreadyActive: boolean;
  trackLane: number;
  fanOffset: number;
};

export type HistoryGraphRow = {
  rowIndex: number;
  sha: string;
  lane: number;
  continuesFromAbove: boolean;
  activeBefore: ReadonlyArray<string | null>;
  activeAfter: ReadonlyArray<string | null>;
  routes: ReadonlyArray<GraphRoute>;
};

export type HistoryGraphLayout = {
  rows: ReadonlyArray<HistoryGraphRow>;
  openLanes: ReadonlyArray<string | null>;
  maximumOccupiedLaneCount: number;
  maximumLaneIndex: number;
  laneCount: number;
  graphWidth: number;
  headSha: string | null;
};

export type GraphPath = {
  d: string;
  lane: number;
  kind: "vertical" | "parent-route";
  lineWidth: number;
  casingWidth: number;
  parentIndex: number | null;
};

export type GraphRowGeometry = {
  width: number;
  height: number;
  nodeX: number;
  paths: GraphPath[];
};

function laneX(lane: number): number {
  return GRAPH_METRICS.leftInset + lane * GRAPH_METRICS.lanePitch;
}

function graphWidth(maximumLaneIndex: number): number {
  return (
    GRAPH_METRICS.leftInset + GRAPH_METRICS.rightInset +
    Math.max(0, maximumLaneIndex) * GRAPH_METRICS.lanePitch
  );
}

function firstFreeLane(slots: ReadonlyArray<string | null>, start = 0): number {
  let lane = start;
  while (slots[lane] != null) lane += 1;
  return lane;
}

function trimOpenLanes(slots: Array<string | null>): void {
  while (slots.length > 0 && slots.at(-1) == null) slots.pop();
}

function explicitHead(commits: readonly GraphCommit[]): string | null {
  return commits.find((commit) =>
    commit.refs?.some((ref) => ref.kind === "head")
  )?.sha ?? null;
}

function appendRows(
  current: HistoryGraphLayout,
  commits: readonly GraphCommit[],
): HistoryGraphLayout {
  if (commits.length === 0) return current;

  const slots = [...current.openLanes];
  const rows = [...current.rows];
  const seen = new Set(rows.map((row) => row.sha));
  let maximumOccupiedLaneCount = current.maximumOccupiedLaneCount;
  let maximumLaneIndex = current.maximumLaneIndex;

  for (const commit of commits) {
    if (seen.has(commit.sha)) {
      throw new Error(`History graph contains duplicate commit ${commit.sha}`);
    }
    seen.add(commit.sha);

    let childLane = slots.indexOf(commit.sha);
    const continuesFromAbove = childLane !== -1;
    if (!continuesFromAbove) {
      const isHead = commit.sha === current.headSha;
      if (isHead && slots[0] == null) {
        childLane = 0;
      } else if (current.headSha && slots[0] == null) {
        childLane = firstFreeLane(slots, 1);
      } else if (slots.length === 0) {
        childLane = 0;
      } else {
        // Lane zero belongs to the HEAD first-parent chain while that chain is live.
        childLane = firstFreeLane(slots, current.headSha ? 1 : 0);
      }
      slots[childLane] = commit.sha;
    }

    const activeBefore = [...slots];
    // Every lane carrying this sha terminates here: the commit's own
    // lane plus any branch lanes that persisted down to converge on it.
    for (let lane = 0; lane < slots.length; lane += 1) {
      if (slots[lane] === commit.sha) slots[lane] = null;
    }
    const routes: GraphRoute[] = [];

    for (const [parentIndex, parent] of commit.parents.entries()) {
      let parentLane = slots.indexOf(parent.sha);
      const parentAlreadyActive = parentLane !== -1;
      if (parentAlreadyActive && parentIndex === 0 && parentLane !== childLane &&
        slots[childLane] == null) {
        // A branch whose first parent is already drawn elsewhere keeps
        // its own lane down to the parent's row (metro convergence);
        // the parent row draws the sideways arrival into its node.
        slots[childLane] = parent.sha;
        parentLane = childLane;
      }
      if (!parentAlreadyActive) {
        if (parent.sha === current.headSha && slots[0] == null) {
          parentLane = 0;
        } else {
          parentLane = parentIndex === 0 && slots[childLane] == null
            ? childLane
            : firstFreeLane(slots, 1);
        }
        slots[parentLane] = parent.sha;
      }

      routes.push({
        childSha: commit.sha,
        parentSha: parent.sha,
        parentIndex,
        childLane,
        parentLane,
        parentAlreadyActive,
        trackLane: parentIndex === 0 ? childLane : parentLane,
        fanOffset: commit.parents.length > 1
          ? (parentIndex - (commit.parents.length - 1) / 2) * 2
          : 0,
      });
    }

    trimOpenLanes(slots);
    const activeAfter = [...slots];
    maximumOccupiedLaneCount = Math.max(
      maximumOccupiedLaneCount,
      activeBefore.filter(Boolean).length,
      activeAfter.filter(Boolean).length,
    );
    maximumLaneIndex = Math.max(
      maximumLaneIndex,
      childLane,
      ...routes.flatMap((route) => [route.childLane, route.parentLane]),
    );
    rows.push(Object.freeze({
      rowIndex: rows.length,
      sha: commit.sha,
      lane: childLane,
      continuesFromAbove,
      activeBefore: Object.freeze(activeBefore),
      activeAfter: Object.freeze(activeAfter),
      routes: Object.freeze(routes.map((route) => Object.freeze(route))),
    }));
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    openLanes: Object.freeze([...slots]),
    maximumOccupiedLaneCount,
    maximumLaneIndex,
    laneCount: maximumLaneIndex + 1,
    graphWidth: graphWidth(maximumLaneIndex),
    headSha: current.headSha,
  });
}

export function createHistoryGraphLayout(
  commits: readonly GraphCommit[],
  capturedHeadSha: string | null | undefined = undefined,
): HistoryGraphLayout {
  const headSha = capturedHeadSha === undefined
    ? explicitHead(commits) ?? commits[0]?.sha ?? null
    : capturedHeadSha;
  const openLanes: Array<string | null> = [];
  const empty: HistoryGraphLayout = Object.freeze({
    rows: Object.freeze([]),
    openLanes: Object.freeze(openLanes),
    maximumOccupiedLaneCount: 0,
    maximumLaneIndex: -1,
    laneCount: 0,
    graphWidth: graphWidth(-1),
    headSha,
  });
  return appendRows(empty, commits);
}

export function appendHistoryGraphLayout(
  current: HistoryGraphLayout,
  commits: readonly GraphCommit[],
): HistoryGraphLayout {
  return appendRows(current, commits);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function routePath(route: GraphRoute): string {
  const startX = laneX(route.childLane);
  const endX = laneX(route.parentLane);
  const startY = GRAPH_METRICS.rowHeight / 2;
  const endY = GRAPH_METRICS.rowHeight;
  const transition = endY - startY;
  const strength = transition * GRAPH_METRICS.curveStrength;
  const firstControlY = Math.min(endY, Math.max(startY, startY + strength + route.fanOffset));
  const secondControlY = Math.min(endY, Math.max(startY, endY - strength + route.fanOffset));
  return [
    "M", formatNumber(startX), formatNumber(startY),
    "C", formatNumber(startX), formatNumber(firstControlY),
    formatNumber(endX), formatNumber(secondControlY),
    formatNumber(endX), formatNumber(endY),
  ].join(" ");
}

// Mirror of routePath, drawn in the top half of the commit's own row: a
// branch lane that persisted down to this commit curves sideways into
// the node (the metro convergence, matching the fork above).
function convergePath(fromLane: number, toLane: number): string {
  const startX = laneX(fromLane);
  const endX = laneX(toLane);
  const endY = GRAPH_METRICS.rowHeight / 2;
  const strength = endY * GRAPH_METRICS.curveStrength;
  return [
    "M", formatNumber(startX), "0",
    "C", formatNumber(startX), formatNumber(strength),
    formatNumber(endX), formatNumber(endY - strength),
    formatNumber(endX), formatNumber(endY),
  ].join(" ");
}

export function graphRowGeometry(row: HistoryGraphRow): GraphRowGeometry {
  const verticals = row.activeBefore
    .flatMap<GraphPath>((sha, lane) => {
      if (sha == null || (lane === row.lane && !row.continuesFromAbove)) return [];
      if (sha === row.sha && lane !== row.lane) return [];
      const endY = lane === row.lane
        ? GRAPH_METRICS.rowHeight / 2
        : GRAPH_METRICS.rowHeight;
      return [{
        d: `M ${formatNumber(laneX(lane))} 0 L ${formatNumber(laneX(lane))} ${endY}`,
        lane,
        kind: "vertical",
        lineWidth: GRAPH_METRICS.lineWidth,
        casingWidth: GRAPH_METRICS.casingWidth,
        parentIndex: null,
      }];
    })
    .sort((left, right) => right.lane - left.lane);
  const convergences = row.activeBefore
    .flatMap<GraphPath>((sha, lane) => {
      if (sha !== row.sha || lane === row.lane) return [];
      return [{
        d: convergePath(lane, row.lane),
        lane,
        kind: "parent-route",
        lineWidth: GRAPH_METRICS.lineWidth,
        casingWidth: GRAPH_METRICS.casingWidth,
        parentIndex: null,
      }];
    })
    .sort((left, right) => right.lane - left.lane);
  const routes = [...row.routes]
    .sort((left, right) => right.parentLane - left.parentLane || right.parentIndex - left.parentIndex)
    .map<GraphPath>((route) => ({
      d: routePath(route),
      lane: route.trackLane,
      kind: "parent-route",
      lineWidth: GRAPH_METRICS.lineWidth,
      casingWidth: GRAPH_METRICS.casingWidth,
      parentIndex: route.parentIndex,
    }));
  const lanes = [
    row.lane,
    ...convergences.map((path) => path.lane),
    ...row.routes.flatMap((route) => [route.childLane, route.parentLane]),
  ];
  return {
    width: graphWidth(Math.max(...lanes)),
    height: GRAPH_METRICS.rowHeight,
    nodeX: laneX(row.lane),
    paths: [...verticals, ...convergences, ...routes],
  };
}

export function computeGraphRail(paneWidth: number, contentWidth: number) {
  const railWidth = Math.max(
    0,
    Math.min(contentWidth, GRAPH_METRICS.railCap, paneWidth - GRAPH_METRICS.subjectMinimum),
  );
  return {
    paneWidth,
    railWidth,
    subjectWidth: paneWidth - railWidth,
    graphWidth: contentWidth,
    overflows: contentWidth > railWidth,
  };
}

export function minimumLaneReveal(
  scrollLeft: number,
  railWidth: number,
  position: number,
  graphContentWidth = Number.POSITIVE_INFINITY,
): number {
  let next = scrollLeft;
  // Reveal the lane together with the inset on the side it entered from, so
  // scrolling back to lane zero lands on the left edge of the rail.
  if (position < scrollLeft) {
    next = position - GRAPH_METRICS.leftInset;
  } else if (position > scrollLeft + railWidth) {
    next = position + GRAPH_METRICS.rightInset - railWidth;
  }
  const maximum = Math.max(0, graphContentWidth - railWidth);
  return Math.min(Math.max(0, next), maximum);
}

export function countOffscreenParents(
  parentLanes: readonly number[],
  viewport: { scrollLeft: number; railWidth: number },
): { left: number; right: number } {
  const leftEdge = viewport.scrollLeft;
  const rightEdge = viewport.scrollLeft + viewport.railWidth;
  let left = 0;
  let right = 0;
  for (const parentLane of parentLanes) {
    const position = laneX(parentLane);
    if (position < leftEdge) left += 1;
    else if (position > rightEdge) right += 1;
  }
  return { left, right };
}

export function graphLaneX(lane: number): number {
  return laneX(lane);
}
