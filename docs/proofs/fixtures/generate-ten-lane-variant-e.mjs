#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(HERE, "ten-lane-variant-e.json");

const METRICS = Object.freeze({
  paneWidth: 380,
  railCap: 200,
  subjectMinimum: 180,
  lanePitch: 18,
  lineWidth: 3,
  casingWidth: 6,
  leftInset: 16,
  rightInset: 10,
  rowHeight: 40,
  curveStrength: 0.65,
});

function git(cwd, args, input = undefined, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    input,
    env: { ...process.env, ...env },
  }).trim();
}

function buildRealDag() {
  const repository = mkdtempSync(join(tmpdir(), "gitright-ten-lane-"));
  const generatedById = new Map();
  let sequence = 0;

  try {
    git(repository, ["init", "--quiet", "--initial-branch=main"]);
    const tree = git(repository, ["mktree"], "");

    const commit = (id, subject, parentIds = []) => {
      sequence += 1;
      const parents = parentIds.flatMap((parentId) => ["-p", generatedById.get(parentId).sha]);
      const timestamp = 978307200 + sequence;
      const sha = git(
        repository,
        ["commit-tree", tree, ...parents],
        `${subject}\n`,
        {
          GIT_AUTHOR_NAME: "GitRight Fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_AUTHOR_DATE: `${timestamp} +0000`,
          GIT_COMMITTER_NAME: "GitRight Fixture",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_DATE: `${timestamp} +0000`,
        },
      );
      // Keep symbolic IDs only as metadata after object creation. In particular,
      // do not retain the input parentIds that were used to write the object.
      generatedById.set(id, { id, sha });
      return id;
    };

    commit("root", "Root");
    commit("fork", "Fan out ten live tracks", ["root"]);
    for (let lane = 1; lane <= 9; lane += 1) {
      commit(`branch${lane}`, `Concurrent branch ${lane}`, ["fork"]);
    }
    commit("main", "HEAD first-parent track", ["fork"]);
    commit("ordinaryMerge", "Ordinary merge", ["main", "branch1"]);
    commit("octopusMerge", "Four-parent octopus", [
      "ordinaryMerge",
      "branch2",
      "branch3",
      "branch4",
    ]);
    commit("crissCrossLeft", "Criss-cross left", ["branch5", "branch6"]);
    commit("crissCrossRight", "Criss-cross right", ["branch6", "branch5"]);
    commit("crissCrossJoin", "Join criss-cross pair", [
      "octopusMerge",
      "crissCrossLeft",
      "crissCrossRight",
    ]);
    commit("fanInMerge", "Fan in remaining branches", [
      "crissCrossJoin",
      "branch7",
      "branch8",
      "branch9",
    ]);
    commit("reuseBranch", "Reuse a released lane", ["fanInMerge"]);
    commit("mainAfterFanOut", "Continue after fan out", ["fanInMerge"]);
    commit("head", "Merge reused lane", ["mainAfterFanOut", "reuseBranch"]);

    const expectedHeadSha = generatedById.get("head").sha;
    git(repository, ["update-ref", "refs/heads/main", expectedHeadSha]);
    const headSha = git(repository, ["rev-parse", "HEAD"]);
    assert.equal(
      headSha,
      expectedHeadSha,
      "symbolic HEAD must resolve to the generated head commit",
    );

    const symbolicIdBySha = new Map(
      [...generatedById.values()].map(({ id, sha }) => [sha, id]),
    );
    const commitsBySha = readGitGraph(repository, symbolicIdBySha);
    return { commitsBySha, headSha };
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
}

function readGitGraph(repository, symbolicIdBySha) {
  const commitsBySha = new Map();
  const graphLines = git(repository, ["rev-list", "--parents", "HEAD"]).split("\n");

  for (const line of graphLines) {
    const [sha, ...parentShas] = line.split(" ");
    const id = symbolicIdBySha.get(sha);
    assert.ok(id, `reachable Git object ${sha} must have symbolic metadata`);
    const [timestampText, subject] = git(repository, [
      "show",
      "-s",
      "--format=%ct%x00%s",
      sha,
    ]).split("\0");
    commitsBySha.set(sha, {
      id,
      sha,
      subject,
      parentShas,
      timestamp: Number(timestampText),
    });
  }

  assert.equal(
    commitsBySha.size,
    symbolicIdBySha.size,
    "every generated commit must be reachable from HEAD",
  );
  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parentShas) {
      assert.ok(
        commitsBySha.has(parentSha),
        `${commit.id} parent ${parentSha} must exist in the Git-object graph`,
      );
    }
  }
  return commitsBySha;
}

function deriveHistoryOrder(commitsBySha) {
  const childCounts = new Map([...commitsBySha.keys()].map((sha) => [sha, 0]));

  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parentShas) {
      childCounts.set(parentSha, childCounts.get(parentSha) + 1);
    }
  }

  const ready = [...commitsBySha.values()].filter((commit) => childCounts.get(commit.sha) === 0);
  const historyOrder = [];
  const sortReady = () => ready.sort((a, b) => b.timestamp - a.timestamp || a.sha.localeCompare(b.sha));
  sortReady();

  while (ready.length > 0) {
    const next = ready.shift();
    historyOrder.push(next.sha);
    for (const parentSha of next.parentShas) {
      childCounts.set(parentSha, childCounts.get(parentSha) - 1);
      if (childCounts.get(parentSha) === 0) ready.push(commitsBySha.get(parentSha));
    }
    sortReady();
  }

  assert.equal(historyOrder.length, commitsBySha.size, "Git-object graph must be acyclic and produce a complete History order");
  return historyOrder;
}

function firstFreeLane(slots, start = 0) {
  let lane = start;
  while (slots[lane] != null) lane += 1;
  return lane;
}

function deriveLayout(commitsBySha, historyOrder, headSha) {
  const slots = [];
  const rows = [];
  let maximumOccupiedLaneCount = 0;
  let maximumLaneIndex = -1;

  for (const [rowIndex, sha] of historyOrder.entries()) {
    const commit = commitsBySha.get(sha);
    let childLane = slots.indexOf(sha);
    const continuesFromAbove = childLane !== -1;
    if (!continuesFromAbove) {
      if (sha === headSha && slots[0] == null) {
        childLane = 0;
      } else if (headSha && slots[0] == null) {
        childLane = firstFreeLane(slots, 1);
      } else if (slots.length === 0) {
        childLane = 0;
      } else {
        childLane = firstFreeLane(slots, headSha ? 1 : 0);
      }
      slots[childLane] = sha;
    }

    const activeBefore = [...slots];
    const routes = [];
    // A commit can occupy several lanes because each first-parent branch keeps
    // its own metro track until this row. All of those intervals terminate at
    // the node before its outgoing parent routes are allocated.
    for (let lane = 0; lane < slots.length; lane += 1) {
      if (slots[lane] === sha) slots[lane] = null;
    }

    for (const [parentIndex, parentSha] of commit.parentShas.entries()) {
      let parentLane = slots.indexOf(parentSha);
      const parentAlreadyActive = parentLane !== -1;

      if (
        parentAlreadyActive &&
        parentIndex === 0 &&
        parentLane !== childLane &&
        slots[childLane] == null
      ) {
        // Preserve the branch's track through the remaining rows. The parent
        // row will converge this duplicate SHA sideways into its node.
        slots[childLane] = parentSha;
        parentLane = childLane;
      }
      if (!parentAlreadyActive) {
        if (parentSha === headSha && slots[0] == null) {
          parentLane = 0;
        } else {
          parentLane = parentIndex === 0 && slots[childLane] == null
            ? childLane
            : firstFreeLane(slots, 1);
        }
        slots[parentLane] = parentSha;
      }

      const fanOffset = commit.parentShas.length > 1
        ? (parentIndex - (commit.parentShas.length - 1) / 2) * 2
        : 0;
      routes.push({
        childSha: sha,
        parentSha,
        parentIndex,
        childLane,
        parentLane,
        parentAlreadyActive,
        trackLane: parentIndex === 0 ? childLane : parentLane,
        curveStrength: METRICS.curveStrength,
        fanOffset,
      });
    }

    while (slots.length > 0 && slots.at(-1) == null) slots.pop();
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

    rows.push({
      rowIndex,
      sha,
      lane: childLane,
      continuesFromAbove,
      activeBefore,
      activeAfter,
      routes,
    });
  }

  return {
    rows,
    maximumOccupiedLaneCount,
    maximumLaneIndex,
    laneCount: maximumLaneIndex + 1,
    graphWidth:
      METRICS.leftInset +
      METRICS.rightInset +
      METRICS.lanePitch * Math.max(0, maximumLaneIndex),
    openLanes: [...slots],
  };
}

function isAncestor(commitsBySha, ancestorSha, descendantSha) {
  const pending = [descendantSha];
  const seen = new Set();
  while (pending.length > 0) {
    const sha = pending.pop();
    if (sha === ancestorSha) return true;
    if (seen.has(sha)) continue;
    seen.add(sha);
    pending.push(...commitsBySha.get(sha).parentShas);
  }
  return false;
}

function validate(commitsBySha, historyOrder, layout) {
  const commitsById = new Map([...commitsBySha.values()].map((commit) => [commit.id, commit]));
  const rowById = new Map(layout.rows.map((row) => [commitsBySha.get(row.sha).id, row]));
  const childShasByParent = new Map([...commitsBySha.keys()].map((sha) => [sha, []]));
  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parentShas) childShasByParent.get(parentSha).push(commit.sha);
  }

  for (const commit of commitsBySha.values()) {
    for (const parentSha of commit.parentShas) {
      assert.ok(
        historyOrder.indexOf(commit.sha) < historyOrder.indexOf(parentSha),
        `${commit.id} must render before parent ${commitsBySha.get(parentSha).id}`,
      );
    }
  }

  const ordinary = commitsById.get("ordinaryMerge");
  const octopus = commitsById.get("octopusMerge");
  const fanIn = commitsById.get("fanInMerge");
  const left = commitsById.get("crissCrossLeft");
  const right = commitsById.get("crissCrossRight");

  assert.equal(ordinary.parentShas.length, 2, "ordinary merge must have two direct parents");
  assert.equal(octopus.parentShas.length, 4, "octopus merge must have four direct parents");
  assert.equal(fanIn.parentShas.length, 4, "fan-in must converge four direct parents");
  assert.ok(childShasByParent.get(commitsById.get("fork").sha).length >= 10, "fan-out must create ten live child tracks");
  assert.deepEqual(new Set(left.parentShas), new Set(right.parentShas), "criss-cross pair must share bases");
  assert.notDeepEqual(left.parentShas, right.parentShas, "criss-cross first-parent order must differ");
  assert.equal(isAncestor(commitsBySha, left.sha, right.sha), false, "criss-cross sides must be independent");
  assert.equal(isAncestor(commitsBySha, right.sha, left.sha), false, "criss-cross sides must be independent");

  assert.equal(layout.maximumOccupiedLaneCount, 11, "metro convergence must use eleven physical lanes");
  assert.equal(layout.laneCount, 11, "derived placement must use exactly lanes 0 through 10");
  const peakRow = layout.rows.find((row) => row.activeBefore.filter(Boolean).length === 11);
  assert.ok(peakRow, "fixture must contain a visible eleven-track metro interval");
  const maximumDistinctDagPaths = Math.max(
    ...layout.rows.flatMap((row) => [
      new Set(row.activeBefore.filter(Boolean)).size,
      new Set(row.activeAfter.filter(Boolean)).size,
    ]),
  );
  assert.equal(
    maximumDistinctDagPaths,
    10,
    "the eleven tracks must represent ten genuine DAG paths plus one held convergence lane",
  );
  assert.ok(
    layout.rows.some((row) =>
      row.activeBefore.filter((sha) => sha != null && sha === row.sha).length > 1
    ),
    "a parent row must receive at least one held branch lane",
  );

  const reuseLane = rowById.get("reuseBranch").lane;
  const reusedBy = layout.rows.find(
    (row) => row.rowIndex > rowById.get("reuseBranch").rowIndex && row.lane === reuseLane && row.id !== "reuseBranch",
  );
  assert.ok(reusedBy, "a released branch lane must be reused by an older interval");

  const edgeCount = [...commitsBySha.values()].reduce((count, commit) => count + commit.parentShas.length, 0);
  const routeCount = layout.rows.reduce((count, row) => count + row.routes.length, 0);
  assert.equal(routeCount, edgeCount, "every direct parent relationship must have one route");

  const graphWidth = layout.graphWidth;
  const railWidth = Math.max(
    0,
    Math.min(graphWidth, METRICS.railCap, METRICS.paneWidth - METRICS.subjectMinimum),
  );
  const subjectWidth = METRICS.paneWidth - railWidth;
  assert.ok(railWidth <= METRICS.railCap, "graph rail must stay within 200 CSS px");
  assert.ok(subjectWidth >= METRICS.subjectMinimum, "subject must retain at least 180 CSS px");

  return {
    historyOrder: true,
    gitObjectGraph: true,
    maximumSimultaneousLanes: layout.maximumOccupiedLaneCount,
    maximumDistinctDagPaths,
    laneCount: layout.laneCount,
    peakRow: commitsBySha.get(peakRow.sha).id,
    peakLaneOccupants: peakRow.activeBefore.map((sha) => commitsBySha.get(sha)?.id ?? null),
    ordinaryMerge: ordinary.id,
    octopusParentCount: octopus.parentShas.length,
    fanOutChildCount: childShasByParent.get(commitsById.get("fork").sha).length,
    fanInParentCount: fanIn.parentShas.length,
    crissCrossPair: [left.id, right.id],
    laneReuse: {
      lane: reuseLane,
      first: "reuseBranch",
      reusedBy: commitsBySha.get(reusedBy.sha).id,
    },
    directParentConnections: edgeCount,
    graphWidth,
    subjectWidth,
    horizontalGraphOverflow: graphWidth > railWidth,
  };
}

function generateFixture() {
  const { commitsBySha, headSha } = buildRealDag();
  const historyOrder = deriveHistoryOrder(commitsBySha);
  const layout = deriveLayout(commitsBySha, historyOrder, headSha);
  const invariants = validate(commitsBySha, historyOrder, layout);
  const idForSha = (sha) => commitsBySha.get(sha).id;

  return {
    schemaVersion: 1,
    description: "Non-production proof fixture reconstructed from reachable Git objects; History order and lanes are derived only from their parent SHAs.",
    metrics: METRICS,
    themes: {
      light: ["#007aff", "#e8710a", "#007a5e", "#a80052", "#007f8c", "#896200", "#b83222", "#674ea7"],
      dark: ["#0a84ff", "#ff9f0a", "#29c18c", "#f06c9b", "#40c8e0", "#f0d15d", "#ff725c", "#bb9af7"],
    },
    headId: idForSha(headSha),
    historyOrder: historyOrder.map(idForSha),
    commits: historyOrder.map((sha) => {
      const commit = commitsBySha.get(sha);
      return {
        id: commit.id,
        sha: commit.sha,
        subject: commit.subject,
        parentIds: commit.parentShas.map(idForSha),
        timestamp: commit.timestamp,
      };
    }),
    layout: {
      ...layout,
      openLanes: layout.openLanes.map((sha) => sha == null ? null : idForSha(sha)),
      rows: layout.rows.map((row) => ({
        ...row,
        id: idForSha(row.sha),
        activeBefore: row.activeBefore.map((sha) => sha == null ? null : idForSha(sha)),
        activeAfter: row.activeAfter.map((sha) => sha == null ? null : idForSha(sha)),
        routes: row.routes.map(({ childSha, parentSha, ...route }) => ({
          ...route,
          childId: idForSha(childSha),
          parentId: idForSha(parentSha),
        })),
      })),
    },
    invariants,
  };
}

const fixture = generateFixture();
const mode = process.argv[2] ?? "--validate";

if (mode === "--write") {
  writeFileSync(ARTIFACT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote=${ARTIFACT}`);
} else if (mode === "--validate") {
  const recorded = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  assert.deepEqual(recorded, fixture, "recorded fixture must match a fresh real-Git generation");
  console.log("verdict=pass");
  console.log(`maximum_simultaneous_lanes=${fixture.invariants.maximumSimultaneousLanes}`);
  console.log(`lane_count=${fixture.invariants.laneCount}`);
  console.log(`graph_width_css_px=${fixture.invariants.graphWidth}`);
  console.log(`subject_width_css_px=${fixture.invariants.subjectWidth}`);
  console.log(`direct_parent_connections=${fixture.invariants.directParentConnections}`);
  console.log(`lane_reuse=${fixture.invariants.laneReuse.first}->lane${fixture.invariants.laneReuse.lane}->${fixture.invariants.laneReuse.reusedBy}`);
} else {
  console.error("usage: node generate-ten-lane-variant-e.mjs [--write|--validate]");
  process.exitCode = 2;
}
