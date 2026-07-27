export type DisplayMode = "inline" | "fullscreen" | "pip";

export type LauncherStatus = "idle" | "requesting" | "unavailable" | "failed" | "unsupported";

export type LauncherRequestOutcome =
  | { kind: "missing" }
  | { kind: "rejected" }
  | { kind: "thrown" }
  | { kind: "undefined" }
  | { kind: "resolved"; mode: DisplayMode };

export type LauncherTransition = {
  showCompleteView: boolean;
  status: Exclude<LauncherStatus, "requesting">;
};

export function resolveLauncherOutcome(outcome: LauncherRequestOutcome): LauncherTransition {
  if (outcome.kind === "resolved" && outcome.mode === "fullscreen") {
    return { showCompleteView: true, status: "idle" };
  }
  if (outcome.kind === "missing") {
    return { showCompleteView: false, status: "unavailable" };
  }
  if (outcome.kind === "rejected" || outcome.kind === "thrown") {
    return { showCompleteView: false, status: "failed" };
  }
  return { showCompleteView: false, status: "unsupported" };
}
