export type ToolResultStore = ReturnType<typeof createToolResultStore>;

export function repositoryStateFromToolResult(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const meta = (value as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return undefined;
  return (meta as { repositoryState?: unknown }).repositoryState;
}

export function createToolResultStore() {
  let current: unknown;
  const listeners = new Set<(value: unknown) => void>();
  return {
    latest: () => current,
    waitForLatest(timeoutMs: number): Promise<unknown> {
      if (current !== undefined) return Promise.resolve(current);
      return new Promise((resolve) => {
        const listener = (value: unknown) => {
          clearTimeout(timeout);
          listeners.delete(listener);
          resolve(value);
        };
        const timeout = setTimeout(() => {
          listeners.delete(listener);
          resolve(undefined);
        }, timeoutMs);
        listeners.add(listener);
      });
    },
    publish(value: unknown): void {
      current = value;
      for (const listener of listeners) listener(value);
    },
    subscribe(listener: (value: unknown) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
