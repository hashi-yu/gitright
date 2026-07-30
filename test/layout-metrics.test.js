import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyLayoutMetrics,
  GRAPH_METRICS,
  LAYOUT_METRICS,
} from "../plugins/gitright/widget/layout-metrics.ts";

test("publishes the accepted layout metrics as immutable production constants", () => {
  assert.deepEqual(LAYOUT_METRICS, {
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
    node: {
      radius: 3.5,
      mergeRadius: 4.5,
      mergeStrokeWidth: 2.5,
      casingRadius: 5.5,
      mergeCasingRadius: 7.5,
      selectedCasingRadius: 9.5,
      selectionRingRadius: 8,
      headHaloRadius: 12.5,
    },
  });
  assert.equal(Object.isFrozen(LAYOUT_METRICS), true);
  assert.equal(Object.isFrozen(LAYOUT_METRICS.node), true);
  assert.deepEqual(GRAPH_METRICS, {
    rowHeight: 40,
    lanePitch: 18,
    lineWidth: 3,
    casingWidth: 6,
    leftInset: 16,
    rightInset: 10,
    railCap: 200,
    subjectMinimum: 180,
    curveStrength: 0.65,
  });
  assert.equal(Object.isFrozen(GRAPH_METRICS), true);
  assert.equal(GRAPH_METRICS.leftInset, LAYOUT_METRICS.contentInset);
  assert.equal(GRAPH_METRICS.rowHeight, LAYOUT_METRICS.rowHeight);
});

test("injects CSS custom properties from the layout metrics", () => {
  const properties = new Map();
  applyLayoutMetrics({
    setProperty(name, value) {
      properties.set(name, value);
    },
  });

  assert.deepEqual(Object.fromEntries(properties), {
    "--gr-content-inset": "16px",
    "--gr-row-height": "40px",
    "--gr-graph-rail-cap": "200px",
    "--gr-subject-minimum": "180px",
    "--gr-node-radius": "3.5px",
  });
});
