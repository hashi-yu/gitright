import { minimumLaneReveal } from "./history-graph.ts";
import { GRAPH_METRICS } from "./layout-metrics.ts";

// The mutable surface of a rail DOM node the controller drives. Tests inject
// plain objects; the widget passes real HTMLDivElements.
export type GraphRailElement = {
  scrollLeft: number;
  readonly clientWidth: number;
};

export type GraphRailController = {
  register(key: string, element: GraphRailElement | null): void;
  scrollTo(position: number, source?: GraphRailElement): void;
  revealLane(position: number): void;
  revealParent(direction: "left" | "right", positions: readonly number[]): void;
  setScrollLeft(position: number): void;
  setGraphWidth(width: number): void;
};

export function createGraphRailController(options: {
  graphWidth: number;
  scrollLeft?: number;
  onScrollLeftChange: (scrollLeft: number) => void;
  onRailWidthChange?: (railWidth: number) => void;
}): GraphRailController {
  let scrollLeft = options.scrollLeft ?? 0;
  let graphWidth = options.graphWidth;
  let railWidth = Math.min(graphWidth, GRAPH_METRICS.railCap);
  const elements = new Map<string, GraphRailElement>();

  function measure(element: GraphRailElement): void {
    if (element.clientWidth > 0 && element.clientWidth !== railWidth) {
      railWidth = element.clientWidth;
      options.onRailWidthChange?.(railWidth);
    }
  }

  function align(position: number, skip?: GraphRailElement): void {
    for (const element of elements.values()) {
      if (element !== skip && element.scrollLeft !== position) {
        element.scrollLeft = position;
      }
    }
  }

  function scrollTo(position: number, source?: GraphRailElement): void {
    const maximum = Math.max(0, graphWidth - railWidth);
    const clamped = Math.min(Math.max(0, position), maximum);
    scrollLeft = clamped;
    align(clamped, source);
    if (source && source.scrollLeft !== clamped) source.scrollLeft = clamped;
    options.onScrollLeftChange(clamped);
    if (source) measure(source);
  }

  function revealLane(position: number): void {
    scrollTo(
      minimumLaneReveal(scrollLeft, railWidth, position, graphWidth),
    );
  }

  return {
    register(key, element) {
      if (!element) {
        elements.delete(key);
        return;
      }
      elements.set(key, element);
      element.scrollLeft = scrollLeft;
      measure(element);
    },
    scrollTo,
    revealLane,
    revealParent(direction, positions) {
      const candidates = positions
        .filter((position) => direction === "left"
          ? position < scrollLeft
          : position > scrollLeft + railWidth)
        .sort((left, right) => left - right);
      const position = direction === "left" ? candidates.at(-1) : candidates[0];
      if (position === undefined) return;
      revealLane(position);
    },
    setScrollLeft(position) {
      scrollLeft = position;
      align(position);
    },
    setGraphWidth(width) {
      graphWidth = width;
    },
  };
}
