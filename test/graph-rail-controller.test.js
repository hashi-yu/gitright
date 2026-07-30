import assert from "node:assert/strict";
import { test } from "node:test";

import { createGraphRailController } from "../plugins/gitright/widget/graph-rail-controller.ts";

function railElement(clientWidth = 200) {
  return { scrollLeft: 0, clientWidth };
}

test("registering a rail restores the current scroll offset", () => {
  const controller = createGraphRailController({
    graphWidth: 400,
    scrollLeft: 120,
    onScrollLeftChange: () => {},
  });
  const element = railElement();
  controller.register("a", element);
  assert.equal(element.scrollLeft, 120);
});

test("scrollTo drives every rail except the source and reports the offset", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: (next) => reported.push(next),
  });
  const source = railElement();
  const follower = railElement();
  controller.register("a", source);
  controller.register("b", follower);
  source.scrollLeft = 60;
  controller.scrollTo(60, source);
  assert.equal(follower.scrollLeft, 60);
  assert.equal(source.scrollLeft, 60);
  assert.deepEqual(reported, [60]);
});

test("revealLane scrolls just far enough to show the lane with its inset", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: (next) => reported.push(next),
  });
  const element = railElement(150);
  controller.register("a", element);
  // Lane at x=300 sits right of the 150px viewport: reveal it together with
  // the 10px right inset → 300 + 10 - 150 = 160.
  controller.revealLane(300);
  assert.equal(element.scrollLeft, 160);
  // Lane at x=60 is now left of the viewport: land it on the left edge with
  // the 16px left inset → 60 - 16 = 44.
  controller.revealLane(60);
  assert.equal(element.scrollLeft, 44);
  // A lane already in view leaves the offset untouched and still reports.
  controller.revealLane(100);
  assert.equal(element.scrollLeft, 44);
  assert.deepEqual(reported, [160, 44, 44]);
});

test("revealParent reveals the nearest offscreen lane in the given direction", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    scrollLeft: 100,
    onScrollLeftChange: (next) => reported.push(next),
  });
  const element = railElement(150);
  controller.register("a", element);
  element.scrollLeft = 100;
  // Viewport is [100, 250]. Candidates at 20 and 60 are offscreen left;
  // the nearest is 60 → 60 - 16 = 44.
  controller.revealParent("left", [20, 60, 120]);
  assert.equal(element.scrollLeft, 44);
  // Viewport is now [44, 194]. Candidates at 260 and 320 are offscreen right;
  // the nearest is 260 → 260 + 10 - 150 = 120.
  controller.revealParent("right", [120, 260, 320]);
  assert.equal(element.scrollLeft, 120);
  // No candidate beyond the viewport: nothing moves, nothing is reported.
  controller.revealParent("right", [130]);
  assert.equal(element.scrollLeft, 120);
  assert.deepEqual(reported, [44, 120]);
});

test("scrollTo clamps to the scrollable range of the rail", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: (next) => reported.push(next),
  });
  const element = railElement(150);
  controller.register("a", element);
  controller.scrollTo(1000);
  // Content is 400px wide in a 150px rail: 250px is the furthest scroll.
  assert.equal(element.scrollLeft, 250);
  controller.scrollTo(-20);
  assert.equal(element.scrollLeft, 0);
  assert.deepEqual(reported, [250, 0]);
});

test("before any rail is measured, clamping assumes the 200px rail cap", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: (next) => reported.push(next),
  });
  controller.scrollTo(1000);
  assert.deepEqual(reported, [200]);
});

test("setScrollLeft aligns every rail without echoing a change event", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: (next) => reported.push(next),
  });
  const first = railElement(150);
  const second = railElement(150);
  controller.register("a", first);
  controller.register("b", second);
  controller.setScrollLeft(80);
  assert.equal(first.scrollLeft, 80);
  assert.equal(second.scrollLeft, 80);
  assert.deepEqual(reported, []);
  // The externally applied offset is the baseline for the next reveal:
  // lane x=60 is left of the [80, 230] viewport → 60 - 16 = 44.
  controller.revealLane(60);
  assert.equal(first.scrollLeft, 44);
  assert.deepEqual(reported, [44]);
});

test("rail width measurements are reported as rails register and resize", () => {
  const widths = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: () => {},
    onRailWidthChange: (width) => widths.push(width),
  });
  const element = railElement(150);
  controller.register("a", element);
  assert.deepEqual(widths, [150]);
  // The rail was resized by the pane before this scroll event arrived.
  element.clientWidth = 180;
  controller.scrollTo(30, element);
  assert.deepEqual(widths, [150, 180]);
});

test("setGraphWidth widens the scrollable range when more commits load", () => {
  const reported = [];
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: (next) => reported.push(next),
  });
  const element = railElement(150);
  controller.register("a", element);
  controller.setGraphWidth(600);
  controller.scrollTo(1000);
  // Content grew to 600px in a 150px rail: 450px is the furthest scroll.
  assert.deepEqual(reported, [450]);
});

test("an unregistered rail stops following scroll synchronization", () => {
  const controller = createGraphRailController({
    graphWidth: 400,
    onScrollLeftChange: () => {},
  });
  const element = railElement(150);
  controller.register("a", element);
  controller.register("a", null);
  controller.scrollTo(90);
  assert.equal(element.scrollLeft, 0);
});
