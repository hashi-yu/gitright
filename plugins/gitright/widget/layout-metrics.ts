export const LAYOUT_METRICS = Object.freeze({
  contentInset: 16,
  rowHeight: 40,
  lanePitch: 18,
  lineWidth: 3,
  casingWidth: 6,
  rightInset: 10,
  railCap: 200,
  subjectMinimum: 180,
  curveStrength: 0.65,
  laneColorCount: 8,
  node: Object.freeze({
    radius: 3.5,
    mergeRadius: 4.5,
    mergeStrokeWidth: 2.5,
    casingRadius: 5.5,
    mergeCasingRadius: 7.5,
    selectedCasingRadius: 9.5,
    selectionRingRadius: 8,
    headHaloRadius: 12.5,
  }),
});

export const GRAPH_METRICS = Object.freeze({
  rowHeight: LAYOUT_METRICS.rowHeight,
  lanePitch: LAYOUT_METRICS.lanePitch,
  lineWidth: LAYOUT_METRICS.lineWidth,
  casingWidth: LAYOUT_METRICS.casingWidth,
  // Lane zero sits on the content inset shared with the header text and
  // banners; the narrower right inset keeps the accepted gap between the
  // last lane and the subject column.
  leftInset: LAYOUT_METRICS.contentInset,
  rightInset: LAYOUT_METRICS.rightInset,
  railCap: LAYOUT_METRICS.railCap,
  subjectMinimum: LAYOUT_METRICS.subjectMinimum,
  curveStrength: LAYOUT_METRICS.curveStrength,
});

const LAYOUT_CUSTOM_PROPERTIES = Object.freeze({
  "--gr-content-inset": `${LAYOUT_METRICS.contentInset}px`,
  "--gr-row-height": `${LAYOUT_METRICS.rowHeight}px`,
  "--gr-graph-rail-cap": `${LAYOUT_METRICS.railCap}px`,
  "--gr-subject-minimum": `${LAYOUT_METRICS.subjectMinimum}px`,
  "--gr-node-radius": `${LAYOUT_METRICS.node.radius}px`,
});

type LayoutStyleTarget = Pick<CSSStyleDeclaration, "setProperty">;

export function applyLayoutMetrics(style: LayoutStyleTarget): void {
  for (const [name, value] of Object.entries(LAYOUT_CUSTOM_PROPERTIES)) {
    style.setProperty(name, value);
  }
}
