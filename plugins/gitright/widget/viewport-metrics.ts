export type ViewportMetricsShortcut = {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
};

export function formatViewportMetrics(width: number, height: number): string {
  const support = width < 380
    ? "below 380px support"
    : width === 380
      ? "supported minimum"
      : "supported width";
  return `${width} × ${height} CSS px · ${support}`;
}

export function isViewportMetricsShortcut(event: ViewportMetricsShortcut): boolean {
  return !event.repeat && event.ctrlKey && event.altKey && event.shiftKey && !event.metaKey &&
    event.code === "KeyW";
}
