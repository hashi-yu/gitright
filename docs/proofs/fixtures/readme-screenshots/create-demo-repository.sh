#!/bin/sh
# Creates the neutral demo repository used for the README screenshots.
#
# Usage: create-demo-repository.sh [target directory]
# Default target: ~/gitright-demo/example-app
#
# The history is deterministic and neutral, and covers the graph shapes the
# screenshots should show: a long main line, feature branches merged with
# --no-ff, an octopus merge of three topic branches, branches that are still
# open, tags, and a linked worktree checked out on its own branch. Files carry
# real content so the commits produce ordinary review-sized diffs rather than
# single-line appends.
set -eu

target=${1:-"$HOME/gitright-demo/example-app"}
worktree=$(dirname "$target")/review
if [ -e "$target" ] || [ -e "$worktree" ]; then
  echo "refusing to overwrite existing path: $target or $worktree" >&2
  exit 1
fi

mkdir -p "$target"
git init -q -b main "$target"

# Commit timestamps advance three hours per commit from 2026-06-01T09:00:00Z so
# the graph order is stable across runs.
clock=1780304400

# file <repository> <path>, content on stdin
file() {
  mkdir -p "$(dirname "$1/$2")"
  cat >"$1/$2"
  git -C "$1" add "$2"
}

# commit <repository> <message>
commit() {
  clock=$((clock + 10800))
  GIT_AUTHOR_DATE="@$clock +0000" GIT_COMMITTER_DATE="@$clock +0000" git -C "$1" \
    -c user.name=Example \
    -c user.email=example@example.invalid \
    commit -q -m "$2"
}

# merge <repository> <message> <branch>...
merge() {
  repository=$1
  message=$2
  shift 2
  clock=$((clock + 10800))
  GIT_AUTHOR_DATE="@$clock +0000" GIT_COMMITTER_DATE="@$clock +0000" git -C "$repository" \
    -c user.name=Example \
    -c user.email=example@example.invalid \
    merge -q --no-ff -m "$message" "$@"
}

# --- main line -------------------------------------------------------------
file "$target" README.md <<'EOF'
# example-app

A small document search library used as a demo repository.
EOF
file "$target" src/store.js <<'EOF'
export const documents = [];

export function index(document) {
  documents.push(document);
}
EOF
file "$target" src/index.js <<'EOF'
import { search } from "./search.js";

export function main(query) {
  return search(query);
}
EOF
commit "$target" "Initial import"

file "$target" src/search.js <<'EOF'
import { documents } from "./store.js";

export function search(query) {
  return documents.filter((document) => document.title.includes(query));
}
EOF
commit "$target" "Add the search entry point"

file "$target" src/store.js <<'EOF'
export const documents = [];

export function index(document) {
  if (typeof document.id !== "string") {
    throw new TypeError("document.id must be a string");
  }
  documents.push(document);
}

export function get(id) {
  return documents.find((document) => document.id === id) ?? null;
}
EOF
commit "$target" "Validate and look up documents by id"

file "$target" test/search.test.js <<'EOF'
import { index } from "../src/store.js";
import { search } from "../src/search.js";

test("search returns a matching document", () => {
  index({ id: "a", title: "Release notes" });
  expect(search("Release")).toHaveLength(1);
});
EOF
commit "$target" "Add the first search test"

file "$target" README.md <<'EOF'
# example-app

A small document search library used as a demo repository.

## Usage

    node src/index.js "release notes"
EOF
commit "$target" "Document the command line"

git -C "$target" tag v0.1.0

# --- feature/ranking, merged ----------------------------------------------
git -C "$target" checkout -q -b feature/ranking
file "$target" src/ranking.js <<'EOF'
export function normalize(query) {
  return query.trim().toLowerCase();
}

export function score(document, query) {
  const title = document.title.toLowerCase();
  if (title === query) return 3;
  if (title.startsWith(query)) return 2;
  return 1;
}
EOF
commit "$target" "Add a ranking helper"

file "$target" src/ranking.js <<'EOF'
export function normalize(query) {
  return query.trim().toLowerCase();
}

export function score(document, query) {
  const title = document.title.toLowerCase();
  if (title === query) return 3;
  if (title.startsWith(query)) return 2;
  return 1;
}

export function tie(left, right) {
  return left.title.localeCompare(right.title);
}
EOF
commit "$target" "Break ranking ties by title"

file "$target" src/search.js <<'EOF'
import { score } from "./ranking.js";
import { documents } from "./store.js";

const DEFAULT_LIMIT = 20;

export function search(query, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [];

  const matches = [];
  for (const document of documents) {
    const title = document.title.toLowerCase();
    if (!title.includes(normalized)) continue;
    matches.push({ document, score: score(document, normalized) });
  }

  matches.sort((left, right) => right.score - left.score);
  return matches.slice(0, limit).map((match) => match.document);
}
EOF
commit "$target" "Sort search results by score"

file "$target" test/ranking.test.js <<'EOF'
import { score, tie } from "../src/ranking.js";

test("score prefers an exact title", () => {
  expect(score({ title: "Release notes" }, "release notes")).toBe(3);
});

test("tie orders by title", () => {
  expect(tie({ title: "a" }, { title: "b" })).toBeLessThan(0);
});
EOF
commit "$target" "Cover the ranking helper"

git -C "$target" checkout -q main
file "$target" docs/usage.md <<'EOF'
# Usage

Index a document, then search for it:

    import { index } from "./src/store.js";
    import { search } from "./src/search.js";

    index({ id: "a", title: "Release notes" });
    search("release");
EOF
commit "$target" "Add a usage guide"
merge "$target" "Merge branch 'feature/ranking'" feature/ranking

# --- feature/api, merged ---------------------------------------------------
git -C "$target" checkout -q -b feature/api
file "$target" src/api.js <<'EOF'
import { search } from "./search.js";

export function handle(request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return { status: 200, body: search(query) };
}
EOF
commit "$target" "Add an HTTP handler"

file "$target" src/api.js <<'EOF'
import { search } from "./search.js";

export const routes = {
  "/search": handle,
};

export function handle(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 20);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    return { status: 400, body: { error: "limit must be a positive integer" } };
  }
  return { status: 200, body: search(query, { limit }) };
}
EOF
commit "$target" "Register the route and validate the limit"

file "$target" test/api.test.js <<'EOF'
import { handle } from "../src/api.js";

test("handle answers a search request", () => {
  const response = handle({ url: "https://example.invalid/search?q=release" });
  expect(response.status).toBe(200);
});

test("handle rejects a negative limit", () => {
  const response = handle({ url: "https://example.invalid/search?q=a&limit=-1" });
  expect(response.status).toBe(400);
});
EOF
commit "$target" "Cover the HTTP handler"

git -C "$target" checkout -q main
file "$target" src/index.js <<'EOF'
import { search } from "./search.js";

export function main(query, options = {}) {
  if (typeof query !== "string") {
    throw new TypeError("query must be a string");
  }
  return search(query, options);
}
EOF
commit "$target" "Reject a non-string query"

file "$target" README.md <<'EOF'
# example-app

A small document search library used as a demo repository.

## Usage

    node src/index.js "release notes"

See [docs/usage.md](docs/usage.md) for the library API.
EOF
commit "$target" "Point the README at the usage guide"
merge "$target" "Merge branch 'feature/api'" feature/api

git -C "$target" tag v0.2.0

# --- fix/empty-query, merged ----------------------------------------------
git -C "$target" checkout -q -b fix/empty-query
file "$target" src/search.js <<'EOF'
import { normalize, score } from "./ranking.js";
import { documents } from "./store.js";

const DEFAULT_LIMIT = 20;

// Kept separate while the limit was still applied in two places.
function withinLimit(matches, limit) {
  if (matches.length <= limit) return matches;
  return matches.slice(0, limit);
}

export function search(query, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const normalized = normalize(query);
  if (normalized === "") return [];

  const matches = [];
  for (const document of documents) {
    const title = document.title.toLowerCase();
    if (!title.includes(normalized)) continue;
    matches.push({ document, score: score(document, normalized) });
  }

  matches.sort((left, right) => right.score - left.score);
  return withinLimit(matches, limit).map((match) => match.document);
}
EOF
commit "$target" "Reuse the shared query normalizer"

file "$target" test/search.test.js <<'EOF'
import { index } from "../src/store.js";
import { search } from "../src/search.js";

test("search returns a matching document", () => {
  index({ id: "a", title: "Release notes" });
  expect(search("Release")).toHaveLength(1);
});

test("an empty query returns no results", () => {
  expect(search("   ")).toHaveLength(0);
});
EOF
commit "$target" "Cover the empty query"

git -C "$target" checkout -q main
merge "$target" "Merge branch 'fix/empty-query'" fix/empty-query

# --- three topic branches, joined by one octopus merge ---------------------
git -C "$target" checkout -q -b topic/cache main
file "$target" src/cache.js <<'EOF'
const entries = new Map();

export function remember(key, value) {
  entries.set(key, { value, at: entries.size });
  return value;
}

export function recall(key) {
  return entries.has(key) ? entries.get(key).value : null;
}

export function clear() {
  entries.clear();
}
EOF
commit "$target" "Add a result cache"
file "$target" test/cache.test.js <<'EOF'
import { clear, recall, remember } from "../src/cache.js";

test("recall returns a remembered value", () => {
  clear();
  remember("release", ["a"]);
  expect(recall("release")).toEqual(["a"]);
});
EOF
commit "$target" "Cover the result cache"

git -C "$target" checkout -q -b topic/logging main
file "$target" src/logging.js <<'EOF'
const lines = [];

export function log(event, detail = {}) {
  lines.push({ event, detail });
}

export function drain() {
  const drained = [...lines];
  lines.length = 0;
  return drained;
}
EOF
commit "$target" "Add a log buffer"
file "$target" test/logging.test.js <<'EOF'
import { drain, log } from "../src/logging.js";

test("drain empties the buffer", () => {
  log("search", { query: "release" });
  expect(drain()).toHaveLength(1);
  expect(drain()).toHaveLength(0);
});
EOF
commit "$target" "Cover the log buffer"

git -C "$target" checkout -q -b topic/metrics main
file "$target" src/metrics.js <<'EOF'
const counters = new Map();

export function count(name) {
  counters.set(name, (counters.get(name) ?? 0) + 1);
}

export function report() {
  return Object.fromEntries(counters);
}
EOF
commit "$target" "Add counters"
file "$target" test/metrics.test.js <<'EOF'
import { count, report } from "../src/metrics.js";

test("count increments a counter", () => {
  count("search");
  count("search");
  expect(report().search).toBe(2);
});
EOF
commit "$target" "Cover the counters"

git -C "$target" checkout -q main
merge "$target" "Merge the cache, logging, and metrics topics" \
  topic/cache topic/logging topic/metrics

file "$target" src/index.js <<'EOF'
import { recall, remember } from "./cache.js";
import { count } from "./metrics.js";
import { log } from "./logging.js";
import { search } from "./search.js";

export function main(query, options = {}) {
  if (typeof query !== "string") {
    throw new TypeError("query must be a string");
  }
  count("search");
  log("search", { query });
  const cached = recall(query);
  if (cached !== null) return cached;
  return remember(query, search(query, options));
}
EOF
commit "$target" "Wire the new modules into the entry point"

# --- an open branch that is not merged yet ---------------------------------
git -C "$target" checkout -q -b experiment/index main
file "$target" src/index-builder.js <<'EOF'
export function build(documents) {
  const terms = new Map();
  for (const document of documents) {
    for (const term of document.title.toLowerCase().split(/\s+/)) {
      const posting = terms.get(term) ?? [];
      posting.push(document.id);
      terms.set(term, posting);
    }
  }
  return terms;
}
EOF
commit "$target" "Sketch an inverted index builder"
file "$target" src/index-builder.js <<'EOF'
export function build(documents) {
  const terms = new Map();
  for (const document of documents) {
    for (const term of document.title.toLowerCase().split(/\s+/)) {
      const posting = terms.get(term) ?? [];
      posting.push(document.id);
      terms.set(term, posting);
    }
  }
  return terms;
}

export function serialize(index) {
  return JSON.stringify([...index], null, 2);
}
EOF
commit "$target" "Serialize the sketched index"
file "$target" docs/index-builder.md <<'EOF'
# Index builder

The index builder is experimental and is not wired into the search path yet.
EOF
commit "$target" "Note that the index builder is experimental"

# --- a linked worktree on its own branch -----------------------------------
git -C "$target" checkout -q main
git -C "$target" worktree add -q -b review/docs "$worktree" main
file "$worktree" docs/usage.md <<'EOF'
# Usage

Index a document, then search for it:

    import { index } from "./src/store.js";
    import { search } from "./src/search.js";

    index({ id: "a", title: "Release notes" });
    search("release");

Results are ordered by score, then by title.
EOF
commit "$worktree" "Explain the result order"
file "$worktree" docs/architecture.md <<'EOF'
# Architecture

- `src/store.js` keeps the indexed documents.
- `src/ranking.js` scores a document against a query.
- `src/search.js` joins the store and the ranking.
- `src/api.js` exposes the search over HTTP.
EOF
commit "$worktree" "Add an architecture note"

# --- the latest main commits ----------------------------------------------
file "$target" src/store.js <<'EOF'
export const documents = [];

export function index(document) {
  if (typeof document.id !== "string") {
    throw new TypeError("document.id must be a string");
  }
  documents.push(document);
}

export function get(id) {
  return documents.find((document) => document.id === id) ?? null;
}

export function clear() {
  documents.length = 0;
}
EOF
commit "$target" "Allow the store to be cleared"

file "$target" test/store.test.js <<'EOF'
import { clear, get, index } from "../src/store.js";

test("clear empties the store", () => {
  index({ id: "a", title: "Release notes" });
  clear();
  expect(get("a")).toBeNull();
});
EOF
commit "$target" "Cover the store reset"

# The final commit is an ordinary review-sized rewrite: it matches document
# bodies, keeps the tie-break, and returns a result shape instead of the raw
# document.
file "$target" src/search.js <<'EOF'
import { normalize, score, tie } from "./ranking.js";
import { documents } from "./store.js";

const DEFAULT_LIMIT = 20;

function matches(document, query) {
  if (document.title.toLowerCase().includes(query)) return true;
  return (document.body ?? "").toLowerCase().includes(query);
}

export function search(query, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const normalized = normalize(query);
  if (normalized === "") return [];

  const found = [];
  for (const document of documents) {
    if (!matches(document, normalized)) continue;
    found.push({
      document,
      score: score(document, normalized),
    });
  }

  found.sort((left, right) =>
    right.score - left.score || tie(left.document, right.document)
  );

  return found.slice(0, limit).map((match) => ({
    id: match.document.id,
    title: match.document.title,
    score: match.score,
  }));
}
EOF
file "$target" test/search.test.js <<'EOF'
import { index } from "../src/store.js";
import { search } from "../src/search.js";

test("search returns a matching document", () => {
  index({ id: "a", title: "Release notes" });
  expect(search("Release")).toHaveLength(1);
});

test("an empty query returns no results", () => {
  expect(search("   ")).toHaveLength(0);
});

test("search matches the document body", () => {
  index({ id: "b", title: "Changelog", body: "Release process" });
  expect(search("process")).toHaveLength(1);
});

test("search returns the score with each result", () => {
  index({ id: "c", title: "Release" });
  expect(search("release")[0].score).toBe(3);
});
EOF
commit "$target" "Match document bodies and return scored results"

echo "created $target (worktree: $worktree)"
echo "commits: $(git -C "$target" rev-list --all --count)"
git -C "$target" log --oneline --graph --all
echo "--- HEAD diff ---"
git -C "$target" show --numstat --oneline HEAD | tail -5
