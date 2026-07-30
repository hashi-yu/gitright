export type RequestToken = {
  keys: readonly string[];
  generation: number;
};

/**
 * Tracks the latest in-flight request for a keyed resource so a stale
 * response can never overwrite newer state. `begin` claims the guard for
 * the given key tuple, `invalidate` discards any outstanding claim, and
 * `accepts` recognises only the token from the most recent `begin`.
 */
export function createRequestGuard() {
  let generation = 0;
  let activeKeys: readonly string[] | null = null;

  return {
    begin(...keys: string[]): RequestToken {
      generation += 1;
      activeKeys = keys;
      return { keys, generation };
    },
    invalidate(): void {
      generation += 1;
      activeKeys = null;
    },
    accepts(token: RequestToken): boolean {
      const active = activeKeys;
      return (
        token.generation === generation &&
        active !== null &&
        token.keys.length === active.length &&
        token.keys.every((key, index) => key === active[index])
      );
    },
  };
}
