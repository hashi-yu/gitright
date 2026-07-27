export const WIDGET_STATE_VERSION = 1 as const;
export const MAX_WIDGET_STATE_QUERY_CODE_POINTS = 256;

export type WidgetStateMode = "graph" | "text";

export type PersistedWidgetState = {
  version: typeof WIDGET_STATE_VERSION;
  mode: WidgetStateMode;
  query: string;
  selectedSha: string | null;
  /* One-shot hand-off marker: the launcher sets it just before
     requesting the right pane, the pane instance consumes it to play
     the §2 entrance, and the first state synchronization clears it so
     restores never replay the animation. */
  launcherHandoff: boolean;
};

export const DEFAULT_WIDGET_STATE: Readonly<PersistedWidgetState> = Object.freeze({
  version: WIDGET_STATE_VERSION,
  mode: "graph",
  query: "",
  selectedSha: null,
  launcherHandoff: false,
});

const fullSha = /^[0-9a-f]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedQuery(value: unknown): value is string {
  return typeof value === "string" &&
    Array.from(value).length <= MAX_WIDGET_STATE_QUERY_CODE_POINTS;
}

export function truncateWidgetStateQuery(query: string): string {
  return Array.from(query).slice(0, MAX_WIDGET_STATE_QUERY_CODE_POINTS).join("");
}

export function parsePersistedWidgetState(value: unknown): PersistedWidgetState {
  if (!isRecord(value) || value.version !== WIDGET_STATE_VERSION) {
    return { ...DEFAULT_WIDGET_STATE };
  }
  return {
    version: WIDGET_STATE_VERSION,
    mode: value.mode === "graph" || value.mode === "text"
      ? value.mode
      : DEFAULT_WIDGET_STATE.mode,
    query: isBoundedQuery(value.query) ? value.query : DEFAULT_WIDGET_STATE.query,
    selectedSha: value.selectedSha === null ||
        (typeof value.selectedSha === "string" && fullSha.test(value.selectedSha))
      ? value.selectedSha
      : DEFAULT_WIDGET_STATE.selectedSha,
    launcherHandoff: value.launcherHandoff === true,
  };
}

/* Synchronized state always writes the hand-off marker back to false:
   reaching the complete view is what consumes it. */
export function createPersistedWidgetState({
  mode,
  query,
  selectedSha,
}: Omit<PersistedWidgetState, "version" | "launcherHandoff">): PersistedWidgetState {
  return {
    version: WIDGET_STATE_VERSION,
    mode,
    query: truncateWidgetStateQuery(query),
    selectedSha,
    launcherHandoff: false,
  };
}

export function restoreWidgetSelection(
  selectedSha: string | null,
  commits: ReadonlyArray<{ sha: string }>,
): string | null {
  return selectedSha !== null && commits.some((commit) => commit.sha === selectedSha)
    ? selectedSha
    : null;
}
