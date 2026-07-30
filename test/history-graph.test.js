import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  appendHistoryGraphLayout,
  computeGraphRail,
  countOffscreenParents,
  createHistoryGraphLayout,
  graphRowGeometry,
  minimumLaneReveal,
} from "../plugins/gitright/widget/history-graph.ts";

const fixture = JSON.parse(
  await readFile(new URL("../docs/proofs/fixtures/ten-lane-variant-e.json", import.meta.url), "utf8"),
);
function historyCommit(commit, index, commits = fixture.commits) {
  const byId = new Map(commits.map((item) => [item.id, item]));
  return {
    sha: commit.sha,
    subject: commit.subject,
    parents: commit.parentIds.map((id) => ({ sha: byId.get(id).sha, loaded: true })),
    refs: commit.id === fixture.headId
      ? [{ name: "HEAD", fullName: "HEAD", kind: "head", checkedOut: true }]
      : [],
    topologyRole: commit.parentIds.length === 0
      ? "root"
      : commit.parentIds.length === 1
        ? "commit"
        : commit.parentIds.length === 2
          ? "merge"
          : "octopus merge",
    committerTime: 2_000_000_000 - index,
  };
}

function fixtureHistory() {
  return fixture.commits.map((commit, index) => historyCommit(commit, index));
}

function sha(value) {
  return value.toString(16).padStart(40, "0");
}

function simpleCommit(value, parents = [], options = {}) {
  return {
    sha: sha(value),
    subject: `Commit ${value}`,
    parents: parents.map((parent) => ({ sha: sha(parent), loaded: options.loaded ?? true })),
    refs: options.head
      ? [{ name: "HEAD", fullName: "HEAD", kind: "head", checkedOut: true }]
      : [],
    topologyRole: parents.length === 0 ? "root" : parents.length === 1 ? "commit" : "merge",
    committerTime: 2_000_000_000 - value,
  };
}

test("derives the accepted ten-lane Variant E placement only from SHAs, parents, and refs", () => {
  const history = fixtureHistory();
  const layout = createHistoryGraphLayout(history);
  const idBySha = new Map(fixture.commits.map((commit) => [commit.sha, commit.id]));
  const ids = (lanes) => lanes.map((laneSha) => idBySha.get(laneSha) ?? null);

  assert.equal(layout.rows.length, 21);
  assert.equal(layout.maximumOccupiedLaneCount, 11);
  assert.equal(layout.laneCount, 11);
  assert.equal(layout.graphWidth, 206);
  assert.equal(layout.rows.flatMap((row) => row.routes).length, 32);
  assert.deepEqual(layout.openLanes, []);

  const expectedRows = new Map(fixture.layout.rows.map((row) => [row.sha, row]));
  for (const row of layout.rows) {
    const expected = expectedRows.get(row.sha);
    assert.ok(expected, `fixture row ${row.sha} must exist`);
    assert.equal(row.lane, expected.lane, `lane for ${expected.id}`);
    assert.equal(
      row.continuesFromAbove,
      expected.continuesFromAbove,
      `continuation state for ${expected.id}`,
    );
    assert.deepEqual(
      ids(row.activeBefore),
      expected.activeBefore,
      `active lanes before ${expected.id}`,
    );
    assert.deepEqual(
      ids(row.activeAfter),
      expected.activeAfter,
      `active lanes after ${expected.id}`,
    );
    assert.deepEqual(
      row.routes.map(({
        parentSha,
        childLane,
        parentLane,
        parentIndex,
        parentAlreadyActive,
        trackLane,
        fanOffset,
      }) => ({
        parentId: idBySha.get(parentSha),
        childLane,
        parentLane,
        parentIndex,
        parentAlreadyActive,
        trackLane,
        fanOffset,
      })),
      expected.routes.map(({
        parentId,
        childLane,
        parentLane,
        parentIndex,
        parentAlreadyActive,
        trackLane,
        fanOffset,
      }) => ({
        parentId,
        childLane,
        parentLane,
        parentIndex,
        parentAlreadyActive,
        trackLane,
        fanOffset,
      })),
      `direct parent routes for ${expected.id}`,
    );
  }

  const head = layout.rows.find((row) => row.sha === history[0].sha);
  const ordinaryMerge = layout.rows.find((row) =>
    row.sha === fixture.commits.find((commit) => commit.id === "ordinaryMerge").sha
  );
  const octopus = layout.rows.find((row) =>
    row.sha === fixture.commits.find((commit) => commit.id === "octopusMerge").sha
  );
  assert.equal(head.lane, 0);
  assert.equal(ordinaryMerge.routes.length, 2);
  assert.equal(octopus.routes.length, 4);

  const reuseBranch = layout.rows.find((row) =>
    row.sha === fixture.commits.find((commit) => commit.id === "reuseBranch").sha
  );
  const fanInMerge = layout.rows.find((row) =>
    row.sha === fixture.commits.find((commit) => commit.id === "fanInMerge").sha
  );
  assert.deepEqual(ids(reuseBranch.activeAfter), ["fanInMerge", "fanInMerge"]);
  assert.equal(reuseBranch.routes[0].parentAlreadyActive, true);
  assert.equal(reuseBranch.routes[0].parentLane, reuseBranch.lane);
  assert.deepEqual(ids(fanInMerge.activeBefore), ["fanInMerge", "fanInMerge"]);

  const fork = layout.rows.find((row) =>
    row.sha === fixture.commits.find((commit) => commit.id === "fork").sha
  );
  assert.equal(fork.activeBefore.filter((laneSha) => laneSha === fork.sha).length, 10);
  assert.equal(
    graphRowGeometry(fork).paths.filter((path) =>
      path.kind === "parent-route" && path.parentIndex === null
    ).length,
    9,
    "the shared parent row converges nine held branch tracks into its node",
  );
});

test("appending history keeps existing row objects and lane assignments fixed", () => {
  const history = fixtureHistory();
  const firstPage = createHistoryGraphLayout(history.slice(0, 9));
  const prefix = [...firstPage.rows];
  const appended = appendHistoryGraphLayout(firstPage, history.slice(9));
  const oneShot = createHistoryGraphLayout(history);

  assert.equal(appended.rows.length, history.length);
  for (const [index, row] of prefix.entries()) {
    assert.equal(appended.rows[index], row);
  }
  assert.deepEqual(
    appended.rows.map((row) => ({
      sha: row.sha,
      lane: row.lane,
      continuesFromAbove: row.continuesFromAbove,
      activeBefore: row.activeBefore,
      activeAfter: row.activeAfter,
      routes: row.routes.map((route) => [route.childLane, route.parentLane, route.parentIndex]),
    })),
    oneShot.rows.map((row) => ({
      sha: row.sha,
      lane: row.lane,
      continuesFromAbove: row.continuesFromAbove,
      activeBefore: row.activeBefore,
      activeAfter: row.activeAfter,
      routes: row.routes.map((route) => [route.childLane, route.parentLane, route.parentIndex]),
    })),
  );
});

test("keeps HEAD on lane zero while independently placing multiple roots", () => {
  const unrelatedTip = simpleCommit(20, [19]);
  unrelatedTip.refs = [{
    name: "other-worktree",
    fullName: "refs/heads/other-worktree",
    kind: "local-branch",
    checkedOut: true,
  }];
  const head = simpleCommit(10, [9], { head: true });
  const unrelatedRoot = simpleCommit(19);
  const headRoot = simpleCommit(9);
  const layout = createHistoryGraphLayout([unrelatedTip, head, unrelatedRoot, headRoot]);

  assert.equal(layout.rows.find((row) => row.sha === head.sha).lane, 0);
  assert.equal(layout.rows.find((row) => row.sha === headRoot.sha).lane, 0);
  assert.notEqual(layout.rows.find((row) => row.sha === unrelatedTip.sha).lane, 0);
  assert.ok(layout.rows.every((row) => row.lane >= 0));
});

test("reserves lane zero when the captured HEAD is not present in the first 500 rows", () => {
  const capturedHead = simpleCommit(10_000, [9_999], { head: true });
  const firstPageCommits = Array.from({ length: 500 }, (_, index) =>
    simpleCommit(index + 1)
  );
  const firstPage = createHistoryGraphLayout(firstPageCommits, capturedHead.sha);

  assert.ok(firstPage.rows.every((row) => row.lane === 1));
  assert.ok(firstPage.rows.every((row) => row.continuesFromAbove === false));
  assert.ok(firstPage.openLanes.every((sha) => sha === null));

  const appended = appendHistoryGraphLayout(firstPage, [
    capturedHead,
    simpleCommit(9_999),
  ]);
  assert.equal(appended.rows[500].lane, 0);
  assert.equal(appended.rows[501].lane, 0);
  assert.equal(appended.rows[0], firstPage.rows[0]);
});

test("keeps an initially unloaded captured HEAD parent and its first-parent chain on lane zero", () => {
  const capturedHead = simpleCommit(2, [1], { head: true });
  const featureTip = simpleCommit(3, [2], { loaded: false });
  const firstPage = createHistoryGraphLayout([featureTip], capturedHead.sha);

  assert.equal(firstPage.rows[0].lane, 1);
  assert.equal(firstPage.rows[0].routes[0].parentLane, 0);
  assert.equal(firstPage.rows[0].routes[0].trackLane, 1);

  const appended = appendHistoryGraphLayout(firstPage, [
    capturedHead,
    simpleCommit(1),
  ]);
  assert.equal(appended.rows[1].lane, 0);
  assert.equal(appended.rows[2].lane, 0);
  assert.equal(appended.rows[0], firstPage.rows[0]);
});

test("reserves a continuation parent lane until the later page arrives and handles a shallow boundary", () => {
  const tip = simpleCommit(3, [2], { head: true, loaded: false });
  const firstPage = createHistoryGraphLayout([tip]);
  assert.equal(firstPage.rows[0].routes[0].parentSha, sha(2));
  assert.equal(firstPage.openLanes[0], sha(2));

  const appended = appendHistoryGraphLayout(firstPage, [simpleCommit(2, [1]), simpleCommit(1)]);
  assert.equal(appended.rows[1].lane, 0);
  assert.equal(appended.rows[2].lane, 0);
  assert.deepEqual(appended.openLanes, []);

  const missingBoundary = createHistoryGraphLayout([
    simpleCommit(6, [5], { head: true, loaded: false }),
  ]);
  assert.deepEqual(missingBoundary.openLanes, [sha(5)]);
});

test("emits cased single-row cubic geometry with separated merge siblings", () => {
  const layout = createHistoryGraphLayout(fixtureHistory());
  const octopusSha = fixture.commits.find((commit) => commit.id === "octopusMerge").sha;
  const row = layout.rows.find((candidate) => candidate.sha === octopusSha);
  const geometry = graphRowGeometry(row);

  assert.equal(geometry.height, 40);
  assert.ok(geometry.paths.every((path) => path.lineWidth === 3 && path.casingWidth === 6));
  assert.ok(geometry.paths.every((path) => !path.d.includes("NaN")));
  assert.ok(geometry.paths.every((path) => {
    const numbers = path.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const yValues = numbers.filter((_, index) => index % 2 === 1);
    return yValues.every((value) => value >= 0 && value <= 40);
  }));

  const directParentCurves = geometry.paths.filter((path) => path.kind === "parent-route");
  assert.equal(directParentCurves.length, 4);
  assert.equal(new Set(directParentCurves.map((path) => path.d)).size, 4);
  assert.ok(directParentCurves.every((path) => /^M \d+(?:\.\d+)? 20 C /.test(path.d)));
  const verticalLanes = geometry.paths
    .filter((path) => path.kind === "vertical")
    .map((path) => path.lane);
  assert.deepEqual(verticalLanes, [...verticalLanes].sort((left, right) => right - left));
});

test("holds a branch lane to its first parent and mirrors the fork with a convergence curve", () => {
  const layout = createHistoryGraphLayout([
    simpleCommit(5, [4, 3], { head: true }),
    simpleCommit(4, [2]),
    simpleCommit(3, [2]),
    simpleCommit(2, [1]),
    simpleCommit(1),
  ]);

  const mergeGeometry = graphRowGeometry(layout.rows[0]);
  assert.deepEqual(
    mergeGeometry.paths.filter((path) => path.kind === "parent-route").map((path) => path.d),
    [
      "M 16 20 C 16 34 34 28 34 40",
      "M 16 20 C 16 32 16 26 16 40",
    ],
    "0.65-strength fork curves stay inside the lower half of the child row",
  );

  const branchRow = layout.rows[2];
  assert.equal(branchRow.lane, 1);
  assert.deepEqual(branchRow.activeBefore, [sha(2), sha(3)]);
  assert.deepEqual(branchRow.activeAfter, [sha(2), sha(2)]);
  assert.deepEqual(
    branchRow.routes.map((route) => ({
      childLane: route.childLane,
      parentLane: route.parentLane,
      parentAlreadyActive: route.parentAlreadyActive,
      trackLane: route.trackLane,
    })),
    [{
      childLane: 1,
      parentLane: 1,
      parentAlreadyActive: true,
      trackLane: 1,
    }],
    "the branch duplicates its active first parent into its own lane instead of returning early",
  );

  const parentRow = layout.rows[3];
  assert.equal(parentRow.lane, 0);
  assert.deepEqual(parentRow.activeBefore, [sha(2), sha(2)]);
  assert.deepEqual(parentRow.activeAfter, [sha(1)]);
  assert.deepEqual(
    graphRowGeometry(parentRow).paths.map(({ kind, lane, parentIndex, d }) => ({
      kind,
      lane,
      parentIndex,
      d,
    })),
    [
      {
        kind: "vertical",
        lane: 0,
        parentIndex: null,
        d: "M 16 0 L 16 20",
      },
      {
        kind: "parent-route",
        lane: 1,
        parentIndex: null,
        d: "M 34 0 C 34 13 16 7 16 20",
      },
      {
        kind: "parent-route",
        lane: 0,
        parentIndex: 0,
        d: "M 16 20 C 16 33 16 27 16 40",
      },
    ],
    "the held branch enters the parent node through the upper-half mirror curve",
  );
});

test("draws only real vertical intervals at roots and independently introduced tips", () => {
  const root = simpleCommit(1, [], { head: true });
  const rootRow = createHistoryGraphLayout([root]).rows[0];
  assert.equal(rootRow.continuesFromAbove, false);
  assert.deepEqual(graphRowGeometry(rootRow).paths, []);

  const linear = createHistoryGraphLayout([
    simpleCommit(3, [2], { head: true }),
    simpleCommit(2, [1]),
    simpleCommit(1),
  ]);
  assert.deepEqual(
    graphRowGeometry(linear.rows[0]).paths.map((path) => path.kind),
    ["parent-route"],
    "the first visible tip starts at its node rather than above the row",
  );
  assert.equal(
    graphRowGeometry(linear.rows[1]).paths.find((path) => path.kind === "vertical").d,
    "M 16 0 L 16 20",
    "an existing lane stops at its commit node before the next parent route",
  );

  const unrelatedTip = simpleCommit(20, [19]);
  const laterHead = simpleCommit(10, [9], { head: true });
  const multipleRoots = createHistoryGraphLayout(
    [unrelatedTip, laterHead, simpleCommit(19), simpleCommit(9)],
    laterHead.sha,
  );
  assert.deepEqual(
    graphRowGeometry(multipleRoots.rows[0]).paths.map((path) => path.kind),
    ["parent-route"],
    "the reserved HEAD lane does not appear through an earlier unrelated row",
  );
});

test("keeps the metro fixture within the 380px rail cap and confines wider topology to the rail", () => {
  assert.deepEqual(computeGraphRail(380, 200), {
    paneWidth: 380,
    railWidth: 200,
    subjectWidth: 180,
    graphWidth: 200,
    overflows: false,
  });
  // With lane zero on the 16px content inset the ten-lane fixture reaches
  // 206px, so the widest accepted topology scrolls inside the capped rail.
  assert.deepEqual(computeGraphRail(380, 206), {
    paneWidth: 380,
    railWidth: 200,
    subjectWidth: 180,
    graphWidth: 206,
    overflows: true,
  });
  assert.deepEqual(computeGraphRail(380, 236), {
    paneWidth: 380,
    railWidth: 200,
    subjectWidth: 180,
    graphWidth: 236,
    overflows: true,
  });
});

test("reveals a selected lane minimally and counts hidden direct parents by direction", () => {
  assert.equal(minimumLaneReveal(40, 100, 48), 40);
  assert.equal(minimumLaneReveal(40, 100, 24), 8);
  assert.equal(minimumLaneReveal(40, 100, 154), 64);
  assert.equal(minimumLaneReveal(40, 100, 154, 200), 64);

  assert.deepEqual(
    countOffscreenParents(
      [0, 4, 6, 12],
      { scrollLeft: 72, railWidth: 100 },
    ),
    { left: 1, right: 1 },
  );
});

test("aligns lane zero with the 16px content inset in both modes", () => {
  const tip = createHistoryGraphLayout([simpleCommit(2, [1], { head: true }), simpleCommit(1)]);
  assert.equal(graphRowGeometry(tip.rows[0]).nodeX, 16, "lane zero sits on the content inset");
  assert.equal(createHistoryGraphLayout([simpleCommit(1)]).graphWidth, 26);

  const branch = createHistoryGraphLayout([
    simpleCommit(5, [4, 3], { head: true }),
    simpleCommit(4, [2]),
    simpleCommit(3, [2]),
    simpleCommit(2, [1]),
    simpleCommit(1),
  ]);
  // The lane pitch and the 10px gap between the last lane and the subject
  // stay as accepted: only the left inset grows.
  assert.equal(graphRowGeometry(branch.rows[2]).nodeX, 34);
  assert.equal(branch.graphWidth, 44);

});
