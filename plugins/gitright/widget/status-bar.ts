/**
 * Abbreviates the macOS home-directory prefix of an absolute repository
 * path to `~` for the status bar. The widget cannot read the
 * host user's environment, so the supported-platform layout `/Users/<name>`
 * is matched structurally; other paths pass through unchanged.
 */
export function abbreviateHomePath(path: string): string {
  const home = /^\/Users\/[^/]+(?=\/|$)/.exec(path);
  return home ? `~${path.slice(home[0].length)}` : path;
}

export type StatusBarState = {
  path: string;
  branch: string | null;
  worktreeName: string | null;
};

export type StatusBarItem = {
  kind: "path" | "branch" | "worktree";
  value: string;
  title: string;
};

export function statusBarItems(
  state: StatusBarState,
  detachedLabel: string,
): StatusBarItem[] {
  const path = abbreviateHomePath(state.path);
  const items: StatusBarItem[] = [
    { kind: "path", value: path, title: state.path },
    {
      kind: "branch",
      value: state.branch ?? detachedLabel,
      title: state.branch ?? detachedLabel,
    },
  ];
  if (state.worktreeName !== null) {
    items.push({
      kind: "worktree",
      value: state.worktreeName,
      title: state.worktreeName,
    });
  }
  return items;
}
