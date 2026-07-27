export type LoadedHistorySearchCommit = {
  sha: string;
  subject: string;
  refs: Array<{ name: string; fullName: string }>;
};

export type SubjectMatchRange = {
  start: number;
  end: number;
};

export type HistorySearchMatches = {
  query: string;
  matchOrder: ReadonlyArray<string>;
  matchedShas: ReadonlySet<string>;
};

export const EMPTY_HISTORY_SEARCH_MATCHES: HistorySearchMatches = Object.freeze({
  query: "",
  matchOrder: Object.freeze([]),
  matchedShas: new Set<string>(),
});

export function normalizeHistorySearchQuery(rawQuery: string): string {
  return rawQuery.trim().toLowerCase();
}

export function commitMatchesQuery(
  commit: LoadedHistorySearchCommit,
  query: string,
): boolean {
  if (query === "") return false;
  if (commit.sha.toLowerCase().includes(query)) return true;
  if (commit.subject.toLowerCase().includes(query)) return true;
  return commit.refs.some(
    (ref) =>
      ref.name.toLowerCase().includes(query) ||
      ref.fullName.toLowerCase().includes(query),
  );
}

export function matchLoadedHistory<T extends LoadedHistorySearchCommit>(
  commits: readonly T[],
  rawQuery: string,
): HistorySearchMatches {
  const query = normalizeHistorySearchQuery(rawQuery);
  if (query === "") return EMPTY_HISTORY_SEARCH_MATCHES;

  const matchOrder: string[] = [];
  for (const commit of commits) {
    if (commitMatchesQuery(commit, query)) matchOrder.push(commit.sha);
  }
  return {
    query,
    matchOrder,
    matchedShas: new Set(matchOrder),
  };
}

export function refMatchesQuery(
  ref: { name: string; fullName: string },
  query: string,
): boolean {
  return query !== "" && (
    ref.name.toLowerCase().includes(query) ||
    ref.fullName.toLowerCase().includes(query)
  );
}

export function subjectMatchRanges(
  subject: string,
  query: string,
): SubjectMatchRange[] {
  if (query === "") return [];
  const haystack = subject.toLowerCase();
  const ranges: SubjectMatchRange[] = [];
  let start = haystack.indexOf(query);
  while (start !== -1) {
    const end = Math.min(start + query.length, subject.length);
    ranges.push({ start: Math.min(start, subject.length), end });
    start = haystack.indexOf(query, start + query.length);
  }
  return ranges;
}
