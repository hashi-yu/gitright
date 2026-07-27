import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatViewportMetrics,
  isViewportMetricsShortcut,
} from "../plugins/gitright/widget/viewport-metrics.ts";

test("developer viewport metrics report exact CSS pixels behind the dedicated shortcut", () => {
  assert.equal(formatViewportMetrics(380, 900), "380 × 900 CSS px · supported minimum");
  assert.equal(formatViewportMetrics(319, 900), "319 × 900 CSS px · below 380px support");
  assert.equal(isViewportMetricsShortcut({
    altKey: true,
    code: "KeyW",
    ctrlKey: true,
    metaKey: false,
    repeat: false,
    shiftKey: true,
  }), true);
  assert.equal(isViewportMetricsShortcut({
    altKey: true,
    code: "KeyW",
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    shiftKey: true,
  }), false);
  assert.equal(isViewportMetricsShortcut({
    altKey: true,
    code: "KeyW",
    ctrlKey: true,
    metaKey: false,
    repeat: true,
    shiftKey: true,
  }), false);
});
